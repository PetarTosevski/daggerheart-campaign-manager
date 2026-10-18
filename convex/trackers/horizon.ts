import { v, type Infer } from "convex/values";

import { appError } from "../../src/lib/errors/app-error";
import {
  FIRST_ECHO,
  HORIZON_TRACKER_KEY,
  INITIAL_HORIZON_STATE,
  MAX_ECHOES,
  REFUSAL_MESSAGES,
  fearForMark,
  horizonStateSchema,
  markRefusal,
  occurredEvents,
  unmarkRefusal,
  withMark,
  withoutMark,
} from "../../src/lib/frames/trackers/horizon";
import { ENDURANCE_START, enduranceOwnerKey, horizonDaysPassed } from "../../src/lib/domain/rest/frame-hooks/index";
import { resolveOptions } from "../../src/lib/frames/options";
import { hexKey } from "../../src/lib/world/hex";
import { mapImageSize, SANCTUARY_TYPE, tokenHex } from "../../src/lib/world/map-state";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { gainFear } from "../lib/fear";
import { campaignQuery, keyedGmMutation } from "../lib/functions";
import { listMapTokens, saveScalars, writableMap } from "../lib/maps";
import type { RestHook } from "../lib/restHooks";
import { assertTrackerFrame, frameTrackerMutation, loadTracker, type FrameTracker } from "../lib/trackers";
import { recordHistory } from "../tables/history";

/** Journey to Horizon only; enforced here, not only in the UI. */
export const horizonTracker: FrameTracker<typeof horizonStateSchema> = {
  frameId: "journey-to-horizon",
  key: HORIZON_TRACKER_KEY,
  schema: horizonStateSchema,
  initial: () => INITIAL_HORIZON_STATE,
  ruleCode: "DOOM_RULE",
};

const horizonView = v.union(
  v.object({
    role: v.literal("gm"),
    partyTier: v.number(),
    echoesCollected: v.number(),
    boxes: v.record(
      v.string(),
      v.object({ marked: v.boolean(), session: v.optional(v.number()), occurred: v.boolean(), markedAt: v.number() }),
    ),
  }),
  v.object({
    role: v.literal("player"),
    echoesCollected: v.number(),
    occurred: v.array(
      v.object({ id: v.string(), tier: v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4)), text: v.string() }),
    ),
  }),
);

export type HorizonView = Infer<typeof horizonView>;

const markResult = v.object({
  boxId: v.string(),
  fear: v.union(v.object({ gained: v.number(), lost: v.number(), newValue: v.number() }), v.null()),
});
const echoesChange = v.object({ previousValue: v.number(), newValue: v.number(), levelUps: v.number(), horizonUnlocked: v.boolean() });

export type MarkResult = Infer<typeof markResult>;
export type EchoesChange = Infer<typeof echoesChange>;

function refuse(reason: keyof typeof REFUSAL_MESSAGES): never {
  throw appError("DOOM_RULE", REFUSAL_MESSAGES[reason]);
}

/** The GM sees the whole track; players see the Echo count and occurred events only. */
export const get = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: horizonView,
  handler: async (ctx): Promise<HorizonView> => {
    assertTrackerFrame(ctx.campaign, horizonTracker);
    const state = await loadTracker(ctx, ctx.campaign._id, horizonTracker);
    if (ctx.permission === "owner") {
      return { role: "gm", partyTier: ctx.campaign.tier, echoesCollected: state.echoesCollected, boxes: state.boxes };
    }
    return { role: "player", echoesCollected: state.echoesCollected, occurred: occurredEvents(state) };
  },
});

/**
 * Marks a Doom Track box in the party's tier (campaign.tier) or below, after
 * its parent. A Tier 4 mark gains Fear equal to the marked Tier 4 boxes.
 */
export const markBox = keyedGmMutation({
  args: { boxId: v.string(), session: v.optional(v.number()) },
  returns: markResult,
  handler: (ctx, { boxId, session }) => {
    const { _id: campaignId, tier } = ctx.campaign;
    return frameTrackerMutation<typeof horizonStateSchema, MarkResult>(ctx, horizonTracker, { kind: "horizon_mark", request: { boxId, session } }, async (state) => {
      const reason = markRefusal(state, boxId, tier);
      if (reason) refuse(reason);
      if (session !== undefined && (!Number.isInteger(session) || session < 1)) {
        throw appError("DOOM_RULE", "Session must be a whole number from 1.");
      }
      const next = withMark(state, boxId, Date.now(), session);
      const amount = fearForMark(next, boxId);
      if (amount === 0) return { state: next, result: { boxId, fear: null } };
      const { gained, lost, newValue } = await gainFear(ctx, campaignId, amount);
      return { state: next, result: { boxId, fear: { gained, lost, newValue } } };
    });
  },
});

/** GM correction. Fear already gained from a Tier 4 mark is not refunded. */
export const unmarkBox = keyedGmMutation({
  args: { boxId: v.string() },
  returns: v.object({ boxId: v.string() }),
  handler: (ctx, { boxId }) =>
    frameTrackerMutation(ctx, horizonTracker, { kind: "horizon_unmark", request: { boxId } }, (state) => {
      const reason = unmarkRefusal(state, boxId);
      if (reason) refuse(reason);
      return { state: withoutMark(state, boxId), result: { boxId } };
    }),
});

/** Once a marked event has occurred in play, its text becomes visible to players. */
export const setOccurred = keyedGmMutation({
  args: { boxId: v.string(), occurred: v.boolean() },
  returns: v.object({ boxId: v.string(), occurred: v.boolean() }),
  handler: (ctx, { boxId, occurred }) =>
    frameTrackerMutation(ctx, horizonTracker, { kind: "horizon_occurred", request: { boxId, occurred } }, (state) => {
      const entry = state.boxes[boxId];
      if (!entry?.marked) refuse("NOT_MARKED_OCCURRED");
      return { state: { ...state, boxes: { ...state.boxes, [boxId]: { ...entry, occurred } } }, result: { boxId, occurred } };
    }),
});

/** Sets the Soul Echoes collected (1–10). Each new Echo levels the party up; 10 unlocks Horizon. */
export const setEchoes = keyedGmMutation({
  args: { value: v.number() },
  returns: echoesChange,
  handler: (ctx, { value }) => {
    assertTrackerFrame(ctx.campaign, horizonTracker);
    if (!Number.isInteger(value) || value < FIRST_ECHO || value > MAX_ECHOES) {
      throw appError("ECHO_RANGE", `Soul Echoes run from ${FIRST_ECHO} to ${MAX_ECHOES}.`);
    }
    return frameTrackerMutation(ctx, horizonTracker, { kind: "horizon_echoes", request: { value } }, (state) => {
      const previousValue = state.echoesCollected;
      return {
        state: { ...state, echoesCollected: value },
        result: {
          previousValue,
          newValue: value,
          levelUps: Math.max(0, value - previousValue),
          horizonUnlocked: value === MAX_ECHOES,
        },
      };
    });
  },
});

/** The crawl's day counter's upper bound (`hexCrawlSchema`). */
const MAX_CRAWL_DAY = 100000;

/**
 * HF 176, Endurance Countdowns (optional): "At the end of a rest, each PC
 * gains an Endurance Countdown (6). … When a PC's Endurance Countdown
 * triggers, they become Vulnerable until their next rest. At the start of a
 * rest, all PCs' Endurance Countdowns end." One countdown row per PC, reset
 * to 6 (its history records the reset); a PC whose countdown had triggered
 * loses Vulnerable on the rest's sheet.
 */
async function resetEndurance(ctx: MutationCtx, campaign: Doc<"campaigns">, input: Parameters<RestHook>[1]): Promise<void> {
  const after = { currentValue: ENDURANCE_START, status: "active" as const };
  for (const [id, sheet] of input.sheets) {
    const ownerKey = enduranceOwnerKey(id);
    // At most one row per PC.
    const row = await ctx.db
      .query("countdowns")
      .withIndex("by_campaign_owner", (q) => q.eq("campaignId", campaign._id).eq("ownerKey", ownerKey))
      .first();
    if (row === null) {
      const countdownId = await ctx.db.insert("countdowns", {
        campaignId: campaign._id,
        name: `Endurance: ${sheet.name}`,
        description: "Each wilderness hex: roll your Hope Die; at or below the countdown, mark a Stress, otherwise tick it down (HF 176).",
        category: "consequence",
        startingValue: ENDURANCE_START,
        ...after,
        consequence: "Vulnerable until the next rest.",
        createdAt: Date.now(),
        ownerKey,
        kind: "endurance",
        revealed: true,
      });
      await recordHistory(ctx, input.actorId, { campaignId: campaign._id, kind: "countdown", action: "create", countdownId, before: null, after });
      continue;
    }
    if (row.status === "completed" && sheet.conditions.includes("vulnerable")) {
      input.sheets.set(id, { ...sheet, conditions: sheet.conditions.filter((c) => c !== "vulnerable") });
    }
    await ctx.db.patch("countdowns", row._id, { ...after, startingValue: ENDURANCE_START, completedAt: undefined });
    await recordHistory(ctx, input.actorId, {
      campaignId: campaign._id,
      kind: "countdown",
      action: "endurance_reset",
      countdownId: row._id,
      before: { currentValue: row.currentValue, status: row.status },
      after,
    });
  }
}

/**
 * HF 176, "Resting": "Inside a sanctuary, the party can take a long rest".
 * In Journey to Horizon, REST_RULE when the hex crawl puts the party in a hex
 * with no sanctuary marker; other frames, or no crawl, pass. `rests.start`
 * calls it up front; the rest hook checks again on finish. `map`: the
 * caller's already loaded map.
 */
export async function assertSanctuaryLongRest(ctx: MutationCtx, campaign: Doc<"campaigns">, map?: Awaited<ReturnType<typeof writableMap>>): Promise<void> {
  if (campaign.frameId !== horizonTracker.frameId) return;
  const { scalars } = map ?? (await writableMap(ctx, campaign));
  const crawl = scalars.hexCrawl;
  if (!crawl?.party) return;
  const image = mapImageSize(campaign.frameId, scalars);
  const party = hexKey(crawl.party);
  const tokens = await listMapTokens(ctx, campaign._id);
  if (!tokens.some((t) => t.type === SANCTUARY_TYPE && hexKey(tokenHex(t, image, crawl.grid)) === party)) {
    throw appError("REST_RULE", "Outside a sanctuary the party can take only short rests (HF 176). Move the party to a sanctuary, or interrupt the rest for a short rest's benefits.");
  }
}

/**
 * Rest hook (D5 T3b, HF 176, "Resting"): "Outside a sanctuary, the party can
 * take only short rests, each of which represents an entire day spent in one
 * location. Inside a sanctuary, the party can take a long rest". A long rest
 * is refused (REST_RULE) when the hex crawl puts the party in a hex with no
 * sanctuary marker; a short rest advances the crawl's day counter by one
 * (`horizonDaysPassed`); with `enduranceCountdowns` on, every resting PC's
 * Endurance Countdown restarts at 6. Day and countdowns keep their own
 * history; rest undo restores sheets only (plan note 11).
 */
export const horizonRestHook: RestHook = async (ctx, input) => {
  const { campaign, rest, kind, interrupted } = input;
  if (campaign.frameId !== horizonTracker.frameId) return [];
  const map = await writableMap(ctx, campaign);
  const crawl = map.scalars.hexCrawl;
  if (kind === "long") await assertSanctuaryLongRest(ctx, campaign, map);
  const lines: string[] = [];
  const days = horizonDaysPassed({ kind, interrupted, gmOverride: rest.gmOverride ?? false });
  if (days > 0 && crawl !== undefined && crawl.day + days <= MAX_CRAWL_DAY) {
    await saveScalars(ctx, campaign._id, map, { ...map.scalars, hexCrawl: { ...crawl, day: crawl.day + days } });
    lines.push(`A day passes: day ${crawl.day + days} of the journey`);
  }
  if (resolveOptions(campaign.frameId, campaign.options).enduranceCountdowns) {
    await resetEndurance(ctx, campaign, input);
    lines.push(`Endurance Countdowns start at ${ENDURANCE_START}`);
  }
  return lines;
};
