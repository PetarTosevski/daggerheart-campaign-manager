import { v, type Infer } from "convex/values";

import { appError, RuleError } from "../../src/lib/errors/app-error";
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
  tierRuleActive,
  unmarkRefusal,
  withMark,
  withoutMark,
} from "../../src/lib/frames/trackers/horizon";
import { ENDURANCE_START, enduranceOwnerKey, horizonDaysPassed } from "../../src/lib/domain/rest/frame-hooks/index";
import { resolveOptions } from "../../src/lib/frames/options";
import { hexKey, hexToPixel } from "../../src/lib/world/hex";
import {
  addRegionEncounter,
  BEARINGS,
  collectEcho as collect,
  crawlStateSchema,
  echoBearing,
  generateRegion as generate,
  HABITAT_IDS,
  HORIZON_CRAWL_KEY,
  INITIAL_CRAWL_STATE,
  MAX_REGIONS,
  nearestEcho,
  REGION_KEY_PREFIX,
  regionKey,
  regionNameSchema,
  regionSchema,
  RUMOR_TEXT_MAX,
  setEcho as placeEcho,
  setEncounterUsed,
  type Region,
} from "../../src/lib/world/hex-crawl";
import { mapImageSize, SANCTUARY_TYPE, tokenHex } from "../../src/lib/world/map-state";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { rollDie } from "../lib/dice";
import { gainFear } from "../lib/fear";
import { campaignQuery, keyedGmMutation, type Once } from "../lib/functions";
import { listMapTokens, saveScalars, tokenRow, writableMap } from "../lib/maps";
import type { RestHook } from "../lib/restHooks";
import { ruleMode } from "../lib/ruleModes";
import {
  assertTrackerFrame,
  deleteTracker,
  frameTrackerMutation,
  loadTracker,
  readTracker,
  readTrackerRows,
  TRACKER_SCHEMA_VERSION,
  writeTracker,
  type FrameTracker,
} from "../lib/trackers";
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

// ---- Hex crawl: regions, Soul Echo sanctuaries, Locate Soul Echoes (HF pp.169–176, dcm-bxp.17)

/** The crawl's campaign-level state: regions counter, Echo sanctuaries, last Locate Soul Echoes. */
export const crawlTracker: FrameTracker<typeof crawlStateSchema> = {
  frameId: "journey-to-horizon",
  key: HORIZON_CRAWL_KEY,
  schema: crawlStateSchema,
  initial: () => INITIAL_CRAWL_STATE,
  ruleCode: "TRACKER_RULE",
};

const regionValidator = v.object({
  id: v.number(),
  name: v.string(),
  habitatRolls: v.array(v.number()),
  habitat: v.union(...HABITAT_IDS.map((h) => v.literal(h))),
  shadowblighted: v.boolean(),
  impassable: v.boolean(),
  size: v.number(),
  terrain: v.number(),
  encounters: v.array(v.object({ dice: v.array(v.number()), total: v.number(), used: v.boolean() })),
  rumor: v.object({ roll: v.number(), text: v.string(), known: v.boolean() }),
  createdAt: v.number(),
});
const bearingValidator = v.union(...BEARINGS.map((b) => v.literal(b)));

const crawlView = v.union(
  v.object({
    role: v.literal("gm"),
    regions: v.array(regionValidator),
    echoes: v.array(v.object({ tokenId: v.number(), collected: v.boolean() })),
    located: v.union(v.object({ bearing: bearingValidator, day: v.number(), tokenId: v.number(), seekersAlerted: v.boolean() }), v.null()),
  }),
  v.object({
    role: v.literal("player"),
    /** Rumors the party knows, by region name. */
    rumors: v.array(v.object({ regionId: v.number(), name: v.string(), text: v.string() })),
    located: v.union(v.object({ bearing: bearingValidator, day: v.number() }), v.null()),
  }),
);

export type CrawlView = Infer<typeof crawlView>;

function readRegions(ctx: QueryCtx, campaignId: Doc<"campaigns">["_id"]) {
  return readTrackerRows(ctx, campaignId, REGION_KEY_PREFIX, regionSchema, MAX_REGIONS);
}

/**
 * The hex crawl's regions, Echo sanctuaries and last Locate Soul Echoes. The
 * GM gets everything; players get the rumors they know and the last bearing
 * only (encounters, Echo locations and the Seekers flag are GM only).
 */
export const crawl = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: crawlView,
  handler: async (ctx): Promise<CrawlView> => {
    assertTrackerFrame(ctx.campaign, crawlTracker);
    const state = await loadTracker(ctx, ctx.campaign._id, crawlTracker);
    const regions = await readRegions(ctx, ctx.campaign._id);
    if (ctx.permission === "owner") return { role: "gm", regions, echoes: state.echoes, located: state.located };
    return {
      role: "player",
      rumors: regions.filter((r) => r.rumor.known && r.rumor.text.trim() !== "").map((r) => ({ regionId: r.id, name: r.name, text: r.rumor.text })),
      located: state.located ? { bearing: state.located.bearing, day: state.located.day } : null,
    };
  },
});

/** One idempotent change of a region's row; TRACKER_RULE when the region is gone. */
function regionMutation<R>(
  ctx: MutationCtx & { campaign: Doc<"campaigns">; once: Once },
  op: { kind: string; regionId: number; request: object },
  run: (region: Region) => { region: Region; result: R },
): Promise<R> {
  assertTrackerFrame(ctx.campaign, crawlTracker);
  const campaignId = ctx.campaign._id;
  return ctx.once(op.kind, { regionId: op.regionId, ...op.request }, async () => {
    const key = regionKey(op.regionId);
    const region = Number.isInteger(op.regionId) && op.regionId > 0 ? await readTracker(ctx, campaignId, key, regionSchema) : null;
    if (region === null) throw appError("TRACKER_RULE", "That region is gone.");
    const next = run(region);
    await writeTracker(ctx, campaignId, key, regionSchema.parse(next.region), TRACKER_SCHEMA_VERSION);
    return next.result;
  });
}

/**
 * Generates a wilderness region (HF p.170): the server rolls d20 habitat
 * (Shadowblighted rerolls; with the Doom Track's Tier 2 rule a 1 counts as a
 * double 1), d12 size, d8+d6 encounter, d4 terrain and d100 rumor. The GM then
 * paints the region onto hexes (`maps.updateHex`) and writes the rumor.
 */
export const generateRegion = keyedGmMutation({
  args: { name: v.optional(v.string()) },
  returns: regionValidator,
  handler: (ctx, { name }) => {
    assertTrackerFrame(ctx.campaign, crawlTracker);
    const campaignId = ctx.campaign._id;
    return ctx.once("horizon_generate_region", { name: name ?? null }, async () => {
      const state = await loadTracker(ctx, campaignId, crawlTracker);
      if (state.regionCount >= MAX_REGIONS) throw appError("TRACKER_RULE", `A hex crawl holds at most ${MAX_REGIONS} regions.`);
      const doom = await loadTracker(ctx, campaignId, horizonTracker);
      const id = state.nextRegionId;
      const regionName = regionNameSchema.parse(name?.trim() ? name : `Region ${id}`);
      const region = generate(rollDie, { id, name: regionName, oneIsDouble: tierRuleActive(doom, 2), now: Date.now() });
      await writeTracker(ctx, campaignId, regionKey(id), region, TRACKER_SCHEMA_VERSION);
      await writeTracker(ctx, campaignId, crawlTracker.key, { ...state, nextRegionId: id + 1, regionCount: state.regionCount + 1 }, TRACKER_SCHEMA_VERSION);
      return region;
    });
  },
});

/** Deletes a region (its hexes keep their painted name, habitat and terrain). */
export const removeRegion = keyedGmMutation({
  args: { regionId: v.number() },
  returns: v.null(),
  handler: (ctx, { regionId }) => {
    assertTrackerFrame(ctx.campaign, crawlTracker);
    const campaignId = ctx.campaign._id;
    return ctx.once("horizon_remove_region", { regionId }, async () => {
      const key = regionKey(regionId);
      if (!Number.isInteger(regionId) || regionId < 1 || (await readTracker(ctx, campaignId, key, regionSchema)) === null) return null;
      const state = await loadTracker(ctx, campaignId, crawlTracker);
      await deleteTracker(ctx, campaignId, key);
      await writeTracker(ctx, campaignId, crawlTracker.key, { ...state, regionCount: Math.max(0, state.regionCount - 1) }, TRACKER_SCHEMA_VERSION);
      return null;
    });
  },
});

/** Another Encounter-table roll (d8+d6) for the region. */
export const rollRegionEncounter = keyedGmMutation({
  args: { regionId: v.number() },
  returns: v.object({ total: v.number() }),
  handler: (ctx, { regionId }) =>
    regionMutation(ctx, { kind: "horizon_region_encounter", regionId, request: {} }, (region) => {
      const next = addRegionEncounter(region, rollDie);
      return { region: next, result: { total: next.encounters[next.encounters.length - 1].total } };
    }),
});

/** Marks a region's encounter used (or unused again). */
export const setRegionEncounterUsed = keyedGmMutation({
  args: { regionId: v.number(), index: v.number(), used: v.boolean() },
  returns: v.null(),
  handler: (ctx, { regionId, index, used }) =>
    regionMutation(ctx, { kind: "horizon_region_encounter_used", regionId, request: { index, used } }, (region) => ({
      region: setEncounterUsed(region, index, used),
      result: null,
    })),
});

/** The region's rumor text (the GM's, from the d100 Rumors table) and whether the party knows it. */
export const setRegionRumor = keyedGmMutation({
  args: { regionId: v.number(), text: v.optional(v.string()), known: v.optional(v.boolean()) },
  returns: v.null(),
  handler: (ctx, { regionId, text, known }) =>
    regionMutation(ctx, { kind: "horizon_region_rumor", regionId, request: { text: text ?? null, known: known ?? null } }, (region) => {
      if (text !== undefined && text.length > RUMOR_TEXT_MAX) throw appError("INVALID", `Keep the rumor under ${RUMOR_TEXT_MAX + 1} characters.`);
      return {
        region: { ...region, rumor: { ...region.rumor, ...(text !== undefined ? { text: text.trim() } : {}), ...(known !== undefined ? { known } : {}) } },
        result: null,
      };
    }),
});

/** A sanctuary marker on the map (INVALID otherwise). */
async function sanctuaryToken(ctx: QueryCtx, campaignId: Doc<"campaigns">["_id"], tokenId: number) {
  const row = Number.isInteger(tokenId) && tokenId > 0 ? await tokenRow(ctx, campaignId, tokenId) : null;
  if (row === null || row.type !== SANCTUARY_TYPE) throw appError("INVALID", "Pick a sanctuary marker on the map.");
  return row;
}

/** "Choose nine sanctuaries in which a Soul Echo can be located" (HF p.169): places or removes an Echo. GM only. */
export const setEcho = keyedGmMutation({
  args: { tokenId: v.number(), hasEcho: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { tokenId, hasEcho }) => {
    assertTrackerFrame(ctx.campaign, crawlTracker);
    if (hasEcho) await sanctuaryToken(ctx, ctx.campaign._id, tokenId);
    return frameTrackerMutation(ctx, crawlTracker, { kind: "horizon_set_echo", request: { tokenId, hasEcho } }, (state) => ({
      state: placeEcho(state, tokenId, hasEcho),
      result: null,
    }));
  },
});

/**
 * Collects the Soul Echo at a sanctuary: the sanctuary's Echo is marked
 * collected and the Soul Echoes count rises by one in the same mutation
 * ("The party levels up each time they add a new Soul Echo", HF p.177; 10
 * unlocks Horizon).
 */
export const collectEcho = keyedGmMutation({
  args: { tokenId: v.number() },
  returns: echoesChange,
  handler: (ctx, { tokenId }) => {
    assertTrackerFrame(ctx.campaign, crawlTracker);
    const campaignId = ctx.campaign._id;
    return ctx.once("horizon_collect_echo", { tokenId }, async () => {
      const crawlState = await loadTracker(ctx, campaignId, crawlTracker);
      const doom = await loadTracker(ctx, campaignId, horizonTracker);
      if (doom.echoesCollected >= MAX_ECHOES) throw appError("ECHO_RANGE", `Soul Echoes run from ${FIRST_ECHO} to ${MAX_ECHOES}.`);
      const next = collect(crawlState, tokenId);
      const previousValue = doom.echoesCollected;
      const newValue = previousValue + 1;
      await writeTracker(ctx, campaignId, crawlTracker.key, next, TRACKER_SCHEMA_VERSION);
      await writeTracker(ctx, campaignId, horizonTracker.key, { ...doom, echoesCollected: newValue }, TRACKER_SCHEMA_VERSION);
      return { previousValue, newValue, levelUps: 1, horizonUnlocked: newValue === MAX_ECHOES };
    });
  },
});

/**
 * Locate Soul Echoes (HF p.176): "The PC learns the direction (north, south,
 * east, west, or a combination) of the nearest sanctuary with a Soul Echo at
 * its shrine." The bearing runs from the party's hex to the nearest sanctuary
 * (by hexes) whose Echo is not yet collected; players see the bearing.
 * `seekersAlerted`: "At the GM's discretion, using this downtime move alerts
 * nearby Seekers-in-Shadow" (GM only).
 */
export const locateEchoes = keyedGmMutation({
  args: { seekersAlerted: v.boolean() },
  returns: v.object({ bearing: bearingValidator }),
  handler: async (ctx, { seekersAlerted }) => {
    assertTrackerFrame(ctx.campaign, crawlTracker);
    const campaign = ctx.campaign;
    return ctx.once("horizon_locate_echoes", { seekersAlerted }, async () => {
      const state = await loadTracker(ctx, campaign._id, crawlTracker);
      const { scalars } = await writableMap(ctx, campaign);
      const hexCrawl = scalars.hexCrawl;
      if (!hexCrawl?.party) throw appError("TRACKER_RULE", "Place the party on a hex first.");
      const image = mapImageSize(campaign.frameId, scalars);
      const open = new Set(state.echoes.filter((e) => !e.collected).map((e) => e.tokenId));
      const sanctuaries = (await listMapTokens(ctx, campaign._id))
        .filter((t) => open.has(t.id))
        .map((t) => {
          const at = { x: (t.x / 100) * image.width, y: (t.y / 100) * image.height };
          return { tokenId: t.id, at, hex: tokenHex(t, image, hexCrawl.grid) };
        });
      const nearest = nearestEcho(hexCrawl.party, sanctuaries);
      if (nearest === null) throw appError("TRACKER_RULE", "No uncollected Soul Echo is placed in a sanctuary on the map.");
      const result = echoBearing(hexCrawl.party, hexToPixel(hexCrawl.party, hexCrawl.grid), nearest);
      const located = { bearing: result, day: hexCrawl.day, tokenId: nearest.tokenId, seekersAlerted };
      await writeTracker(ctx, campaign._id, crawlTracker.key, { ...state, located }, TRACKER_SCHEMA_VERSION);
      return { bearing: result };
    });
  },
});

/** Sets or clears "Seekers alerted" on the last Locate Soul Echoes (GM only). */
export const setSeekersAlerted = keyedGmMutation({
  args: { alerted: v.boolean() },
  returns: v.null(),
  handler: (ctx, { alerted }) =>
    frameTrackerMutation(ctx, crawlTracker, { kind: "horizon_seekers", request: { alerted } }, (state) => {
      if (state.located === null) throw new RuleError("TRACKER_RULE", "Locate the Soul Echoes first.");
      return { state: { ...state, located: { ...state.located, seekersAlerted: alerted } }, result: null };
    }),
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
 * caller's already loaded map. W2 Manual (house rule): never refuses; the
 * rest hook warns instead (convex/lib/restHooks.ts).
 */
export async function assertSanctuaryLongRest(ctx: MutationCtx, campaign: Doc<"campaigns">, map?: Awaited<ReturnType<typeof writableMap>>): Promise<void> {
  if (ruleMode(campaign, "horizonSanctuaryRest") === "manual") return;
  if (await partyOutsideSanctuary(ctx, campaign, map)) {
    throw appError("REST_RULE", "Outside a sanctuary the party can take only short rests (HF 176). Move the party to a sanctuary, or interrupt the rest for a short rest's benefits.");
  }
}

/** Journey to Horizon: the hex crawl puts the party in a hex with no sanctuary marker (other frames, or no crawl: false). */
export async function partyOutsideSanctuary(ctx: MutationCtx, campaign: Doc<"campaigns">, map?: Awaited<ReturnType<typeof writableMap>>): Promise<boolean> {
  if (campaign.frameId !== horizonTracker.frameId) return false;
  const { scalars } = map ?? (await writableMap(ctx, campaign));
  const crawl = scalars.hexCrawl;
  if (!crawl?.party) return false;
  const image = mapImageSize(campaign.frameId, scalars);
  const party = hexKey(crawl.party);
  const tokens = await listMapTokens(ctx, campaign._id);
  return !tokens.some((t) => t.type === SANCTUARY_TYPE && hexKey(tokenHex(t, image, crawl.grid)) === party);
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
