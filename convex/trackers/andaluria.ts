import { v } from "convex/values";
import { z } from "zod";

import {
  ANDALURIA_FRAME_ID,
  ANDALURIA_TRACKER_KEY,
  HUNT_BEATS,
  addClue,
  allCluesRevealed,
  createHunt as addHunt,
  defaultAndaluriaState,
  huntBeatSchema,
  huntPatchSchema,
  patchClue,
  patchHunt,
  playerHuntView,
  removeClue,
  removeHunt,
  type AndaluriaState,
} from "../../src/lib/frames/trackers/andaluria";
import { applyCountdownAction } from "../../src/lib/domain/countdowns/index";
import { chose, HALT_LYCANTHROPY_MOVE, lycanthropyOwnerKey } from "../../src/lib/domain/rest/frame-hooks/index";
import { resolveOptions } from "../../src/lib/frames/options";
import { campaignQuery, keyedGmMutation } from "../lib/functions";
import type { RestHook } from "../lib/restHooks";
import { assertTrackerFrame, frameTrackerMutation, loadTracker, type FrameTracker } from "../lib/trackers";
import { recordHistory } from "../tables/history";

/** The stored hunts (structure only: the domain module checks lengths on write). */
const andaluriaStateSchema = z.object({
  hunts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      monster: z.string(),
      what: z.string(),
      wants: z.string(),
      where: z.string(),
      defeat: z.string(),
      beat: huntBeatSchema,
      clues: z.array(z.object({ id: z.string(), text: z.string(), revealed: z.boolean(), note: z.string() })),
      underlings: z.array(z.string()),
      bystanders: z.array(z.string()),
      archived: z.boolean(),
      monsterRevealed: z.boolean(),
      createdAt: z.number(),
    }),
  ),
}) satisfies z.ZodType<AndaluriaState>;

export const andaluriaTracker: FrameTracker<typeof andaluriaStateSchema> = {
  frameId: ANDALURIA_FRAME_ID,
  key: ANDALURIA_TRACKER_KEY,
  schema: andaluriaStateSchema,
  initial: defaultAndaluriaState,
  ruleCode: "INVALID",
};

const beat = v.union(...HUNT_BEATS.map((b) => v.literal(b)));
const monsterAnswers = { monster: v.string(), what: v.string(), wants: v.string(), where: v.string(), defeat: v.string() };

const gmHunt = v.object({
  id: v.string(),
  title: v.string(),
  ...monsterAnswers,
  beat,
  clues: v.array(v.object({ id: v.string(), text: v.string(), revealed: v.boolean(), note: v.string() })),
  underlings: v.array(v.string()),
  bystanders: v.array(v.string()),
  archived: v.boolean(),
  monsterRevealed: v.boolean(),
  createdAt: v.number(),
  allCluesRevealed: v.boolean(),
});

const playerHunt = v.object({
  id: v.string(),
  title: v.string(),
  beat,
  archived: v.boolean(),
  clues: v.array(v.object({ id: v.string(), text: v.string() })),
  allCluesRevealed: v.boolean(),
  monster: v.optional(v.object(monsterAnswers)),
});

/**
 * The campaign's Hunts. Players get each hunt's title, beat and revealed clues
 * only (plus the monster once the GM reveals it); filtered here, on the server.
 */
export const get = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.union(
    v.object({ role: v.literal("gm"), hunts: v.array(gmHunt) }),
    v.object({ role: v.literal("player"), hunts: v.array(playerHunt) }),
  ),
  handler: async (ctx) => {
    assertTrackerFrame(ctx.campaign, andaluriaTracker);
    const { hunts } = await loadTracker(ctx, ctx.campaign._id, andaluriaTracker);
    if (ctx.permission === "owner") {
      return { role: "gm" as const, hunts: hunts.map((h) => ({ ...h, allCluesRevealed: allCluesRevealed(h) })) };
    }
    return { role: "player" as const, hunts: hunts.map(playerHuntView) };
  },
});

export const createHunt = keyedGmMutation({
  args: { title: v.string() },
  returns: v.object({ huntId: v.string() }),
  handler: (ctx, { title }) =>
    frameTrackerMutation(ctx, andaluriaTracker, { kind: "andaluria_hunt_create", request: { title } }, (state) => {
      const huntId = crypto.randomUUID();
      return { state: addHunt(state, huntId, title, Date.now()), result: { huntId } };
    }),
});

const huntPatch = v.object({
  title: v.optional(v.string()),
  monster: v.optional(v.string()),
  what: v.optional(v.string()),
  wants: v.optional(v.string()),
  where: v.optional(v.string()),
  defeat: v.optional(v.string()),
  // A plain string: the domain schema rejects an unknown beat with a readable message.
  beat: v.optional(v.string()),
  underlings: v.optional(v.array(v.string())),
  bystanders: v.optional(v.array(v.string())),
  archived: v.optional(v.boolean()),
  monsterRevealed: v.optional(v.boolean()),
});

export const updateHunt = keyedGmMutation({
  args: { huntId: v.string(), patch: huntPatch },
  returns: v.null(),
  handler: (ctx, { huntId, patch }) =>
    frameTrackerMutation(ctx, andaluriaTracker, { kind: "andaluria_hunt_update", request: { huntId, patch } }, (state) => {
      // The wrapper sends a ZodError as INVALID with its first message.
      const parsed = huntPatchSchema.safeParse(patch);
      if (!parsed.success) throw parsed.error;
      return { state: patchHunt(state, huntId, parsed.data), result: null };
    }),
});

export const deleteHunt = keyedGmMutation({
  args: { huntId: v.string() },
  returns: v.null(),
  handler: (ctx, { huntId }) =>
    frameTrackerMutation(ctx, andaluriaTracker, { kind: "andaluria_hunt_delete", request: { huntId } }, (state) => ({
      state: removeHunt(state, huntId),
      result: null,
    })),
});

export const createClue = keyedGmMutation({
  args: { huntId: v.string(), text: v.string() },
  returns: v.object({ clueId: v.string() }),
  handler: (ctx, { huntId, text }) =>
    frameTrackerMutation(ctx, andaluriaTracker, { kind: "andaluria_clue_create", request: { huntId, text } }, (state) => {
      const clueId = crypto.randomUUID();
      return { state: addClue(state, huntId, clueId, text), result: { clueId } };
    }),
});

/** Edits a clue; `revealed: true` makes it solid and visible to players (HF p.155). */
export const updateClue = keyedGmMutation({
  args: {
    huntId: v.string(),
    clueId: v.string(),
    patch: v.object({ text: v.optional(v.string()), note: v.optional(v.string()), revealed: v.optional(v.boolean()) }),
  },
  returns: v.null(),
  handler: (ctx, { huntId, clueId, patch }) =>
    frameTrackerMutation(ctx, andaluriaTracker, { kind: "andaluria_clue_update", request: { huntId, clueId, patch } }, (state) => ({
      state: patchClue(state, huntId, clueId, patch),
      result: null,
    })),
});

export const deleteClue = keyedGmMutation({
  args: { huntId: v.string(), clueId: v.string() },
  returns: v.null(),
  handler: (ctx, { huntId, clueId }) =>
    frameTrackerMutation(ctx, andaluriaTracker, { kind: "andaluria_clue_delete", request: { huntId, clueId } }, (state) => ({
      state: removeClue(state, huntId, clueId),
      result: null,
    })),
});

/**
 * Rest hook (D5 T3b, HF 153, Werewolf): "activate a long-term Lycanthropy
 * Countdown (6). It ticks down each time the PC takes a rest without using a
 * downtime move to halt their lycanthropy's progression. When it triggers,
 * the PC gains the Werewolf transformation." With `transformations` on, each
 * resting PC's active Lycanthropy countdown (ownerKey `lycanthropy:<id>`)
 * ticks through the countdown rules and its history; rest undo leaves it
 * (plan note 11). A trigger is announced; the transformation itself is set
 * by hand (player consent, decisions).
 */
export const andaluriaRestHook: RestHook = async (ctx, { campaign, choices, sheets, actorId }) => {
  if (campaign.frameId !== andaluriaTracker.frameId || !resolveOptions(campaign.frameId, campaign.options).transformations) return [];
  const lines: string[] = [];
  for (const [id, sheet] of sheets) {
    if (chose(choices, id, HALT_LYCANTHROPY_MOVE)) continue;
    const ownerKey = lycanthropyOwnerKey(id);
    // At most one row per PC.
    const countdown = await ctx.db
      .query("countdowns")
      .withIndex("by_campaign_owner", (q) => q.eq("campaignId", campaign._id).eq("ownerKey", ownerKey))
      .first();
    if (countdown === null || countdown.status !== "active") continue;
    const next = applyCountdownAction(countdown, "advance");
    await ctx.db.patch("countdowns", countdown._id, {
      currentValue: next.currentValue,
      status: next.status,
      completedAt: next.completedNow ? Date.now() : countdown.completedAt,
    });
    await recordHistory(ctx, actorId, {
      campaignId: campaign._id,
      kind: "countdown",
      action: "advance",
      countdownId: countdown._id,
      before: { currentValue: countdown.currentValue, status: countdown.status },
      after: { currentValue: next.currentValue, status: next.status },
    });
    if (next.completedNow) lines.push(`${sheet.name}'s Lycanthropy Countdown triggers: the Werewolf transformation`);
  }
  return lines;
};
