import { v, type Infer } from "convex/values";

import { appError } from "../../src/lib/errors/app-error";
import {
  addPyre as add,
  adjustBranches as adjust,
  assertCanRollLurking,
  atPyreMode,
  effectiveAtPyre,
  igniteBranch as ignite,
  INITIAL_UMBRA,
  linkPyre as link,
  partyNearLitPyre,
  LURKING_FEAR,
  LURKING_OUTCOMES,
  LURKING_TEXT,
  logLurking,
  lurkingRestNote,
  removePyre as remove,
  renamePyre as rename,
  resolveLurking,
  restRollsLurking,
  setAtPyreChoice,
  setPyreLit,
  setVicinity as vicinity,
  settlementSchema,
  umbraStateSchema,
  vicinityKm,
  watchersSchema,
  type UmbraState,
} from "../../src/lib/frames/trackers/age-of-umbra";
import { mapScale } from "../../src/lib/domain/travel/index";
import { mapImageSize } from "../../src/lib/world/map-state";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { applyResourceDelta } from "../../src/lib/domain/characters/index";
import { chose, KEEP_WATCH_MOVE, keepWatchRolls } from "../../src/lib/domain/rest/frame-hooks/index";
import { rollDie } from "../lib/dice";
import { gainFear } from "../lib/fear";
import { campaignQuery, keyedGmMutation } from "../lib/functions";
import { playerTokenFilter, readMapTokens, tokenRow } from "../lib/maps";
import type { RestHook } from "../lib/restHooks";
import { postRuleNote, ruleMode } from "../lib/ruleModes";
import { assertTrackerFrame, frameTrackerMutation, loadTracker, TRACKER_SCHEMA_VERSION, writeTracker, type FrameTracker } from "../lib/trackers";

export const umbraTracker: FrameTracker<typeof umbraStateSchema> = {
  frameId: "age-of-umbra",
  key: "ageOfUmbra",
  schema: umbraStateSchema,
  initial: () => INITIAL_UMBRA,
  ruleCode: "TRACKER_RULE",
};

const outcome = v.union(...LURKING_OUTCOMES.map((o) => v.literal(o)));
const lurkingRoll = v.object({
  gmRoll: v.number(),
  watchRoll: v.union(v.number(), v.null()),
  result: v.number(),
  outcome,
  fearGained: v.number(),
  at: v.number(),
});
const shared = {
  pyres: v.array(v.object({ id: v.string(), settlement: v.string(), lit: v.boolean() })),
  blessedBranches: v.number(),
  atPyre: v.boolean(),
};
const umbraView = v.union(
  v.object({ ...shared, gm: v.object({ log: v.array(lurkingRoll) }) }),
  v.object({ ...shared, gm: v.null() }),
);

/** Pyres, branches and the at-a-pyre flag are public; the Lurking Darkness log is GM-only (`gm` is null for players). */
export type UmbraView = Infer<typeof umbraView>;

const fearChange = v.object({ gained: v.number(), lost: v.number(), newValue: v.number() });
const lurkingResult = v.object({
  gmRoll: v.number(),
  watchRoll: v.union(v.number(), v.null()),
  result: v.number(),
  outcome,
  text: v.string(),
  fear: v.union(fearChange, v.null()),
});

export type LurkingResult = Infer<typeof lurkingResult>;

/**
 * dcm-bxp.18: whether the party marker is within the vicinity of a lit pyre
 * linked to a World map marker. Reads the map's markers only when a lit pyre
 * is linked; an unreadable map counts as "not near".
 */
async function nearLitPyre(ctx: QueryCtx, campaign: Doc<"campaigns">, state: UmbraState): Promise<boolean> {
  if (!state.pyres.some((p) => p.lit && p.tokenId !== undefined)) return false;
  const map = await readMapTokens(ctx, campaign).catch(() => null);
  if (map === null) return false;
  const image = mapImageSize(campaign.frameId, map.state);
  const markers = new Map(map.tokens.map((t) => [t.id, { x: t.x, y: t.y }]));
  return partyNearLitPyre(state.pyres, markers, map.state.party, mapScale(map.state.scaleKm, image.width, image.height), vicinityKm(state));
}

/** Whether the party is at a Sacred Pyre now: the GM's checkbox, or the map in automatic mode. */
async function atPyreNow(ctx: QueryCtx, campaign: Doc<"campaigns">, state: UmbraState): Promise<boolean> {
  return atPyreMode(state) === "gm" ? state.atPyre : effectiveAtPyre(state, await nearLitPyre(ctx, campaign, state));
}

/** A settlement name, or the wrapper sends the ZodError as INVALID with its first message. */
function settlement(raw: string): string {
  const parsed = settlementSchema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

export const get = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: umbraView,
  handler: async (ctx): Promise<UmbraView> => {
    assertTrackerFrame(ctx.campaign, umbraTracker);
    const state = await loadTracker(ctx, ctx.campaign._id, umbraTracker);
    return {
      pyres: state.pyres.map(({ id, settlement, lit }) => ({ id, settlement, lit })),
      blessedBranches: state.blessedBranches,
      atPyre: await atPyreNow(ctx, ctx.campaign, state),
      gm: ctx.permission === "owner" ? { log: state.log } : null,
    };
  },
});

const pyreMapView = v.object({
  /** The checkbox decides ("gm") or the map does ("auto"). */
  mode: v.union(v.literal("auto"), v.literal("gm")),
  vicinityKm: v.number(),
  /** The map's answer: the party marker within the vicinity of a lit linked pyre. */
  nearLitPyre: v.boolean(),
  /** Each linked pyre's marker; players get only markers they can see. */
  links: v.array(v.object({ pyreId: v.string(), tokenId: v.number(), lit: v.boolean() })),
});

export type PyreMapView = Infer<typeof pyreMapView>;

/** dcm-bxp.18: the pyres' World map links and the automatic "at a Sacred Pyre" (Show on map, the markers' lit badge). */
export const pyreMap = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: pyreMapView,
  handler: async (ctx): Promise<PyreMapView> => {
    assertTrackerFrame(ctx.campaign, umbraTracker);
    const state = await loadTracker(ctx, ctx.campaign._id, umbraTracker);
    const linked = state.pyres.flatMap((p) => (p.tokenId === undefined ? [] : [{ pyreId: p.id, tokenId: p.tokenId, lit: p.lit }]));
    let links = linked;
    if (ctx.permission !== "owner" && linked.length > 0) {
      const map = await readMapTokens(ctx, ctx.campaign).catch(() => null);
      const canSee = map === null ? () => false : await playerTokenFilter(ctx, ctx.campaign).catch(() => () => false);
      const visible = new Set((map?.tokens ?? []).filter(canSee).map((t) => t.id));
      links = linked.filter((l) => visible.has(l.tokenId));
    }
    return { mode: atPyreMode(state), vicinityKm: vicinityKm(state), nearLitPyre: await nearLitPyre(ctx, ctx.campaign, state), links };
  },
});

/** dcm-bxp.18: links a pyre to a World map marker, or unlinks it (null). INVALID when the marker isn't on the map. */
export const linkPyre = keyedGmMutation({
  args: { pyreId: v.string(), tokenId: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { pyreId, tokenId }) => {
    assertTrackerFrame(ctx.campaign, umbraTracker);
    if (tokenId !== null && (!Number.isInteger(tokenId) || (await tokenRow(ctx, ctx.campaign._id, tokenId)) === null)) {
      throw appError("INVALID", "That marker is no longer on the map.");
    }
    return frameTrackerMutation(ctx, umbraTracker, { kind: "umbra_link_pyre", request: { pyreId, tokenId } }, (state) => ({
      state: link(state, pyreId, tokenId),
      result: null,
    }));
  },
});

/** dcm-bxp.18: the vicinity (km) within which the party marker counts as at a lit linked pyre. */
export const setVicinity = keyedGmMutation({
  args: { km: v.number() },
  returns: v.object({ vicinityKm: v.number() }),
  handler: (ctx, { km }) =>
    frameTrackerMutation(ctx, umbraTracker, { kind: "umbra_set_vicinity", request: { km } }, (state) => {
      const next = vicinity(state, km);
      return { state: next, result: { vicinityKm: vicinityKm(next) } };
    }),
});

export const addPyre = keyedGmMutation({
  args: { settlement: v.string(), lit: v.optional(v.boolean()) },
  returns: v.object({ pyreId: v.string() }),
  handler: (ctx, { settlement: raw, lit = true }) => {
    assertTrackerFrame(ctx.campaign, umbraTracker);
    const name = settlement(raw);
    return frameTrackerMutation(ctx, umbraTracker, { kind: "umbra_add_pyre", request: { settlement: name, lit } }, (state) => {
      const next = add(state, name, lit);
      return { state: next.state, result: { pyreId: next.pyreId } };
    });
  },
});

export const renamePyre = keyedGmMutation({
  args: { pyreId: v.string(), settlement: v.string() },
  returns: v.null(),
  handler: (ctx, { pyreId, settlement: raw }) => {
    assertTrackerFrame(ctx.campaign, umbraTracker);
    const name = settlement(raw);
    return frameTrackerMutation(ctx, umbraTracker, { kind: "umbra_rename_pyre", request: { pyreId, settlement: name } }, (state) => ({
      state: rename(state, pyreId, name),
      result: null,
    }));
  },
});

export const removePyre = keyedGmMutation({
  args: { pyreId: v.string() },
  returns: v.null(),
  handler: (ctx, { pyreId }) =>
    frameTrackerMutation(ctx, umbraTracker, { kind: "umbra_remove_pyre", request: { pyreId } }, (state) => ({
      state: remove(state, pyreId),
      result: null,
    })),
});

/** Lights or extinguishes a pyre in the fiction (no branch spent). */
export const setLit = keyedGmMutation({
  args: { pyreId: v.string(), lit: v.boolean() },
  returns: v.null(),
  handler: (ctx, { pyreId, lit }) =>
    frameTrackerMutation(ctx, umbraTracker, { kind: "umbra_set_lit", request: { pyreId, lit } }, (state) => ({
      state: setPyreLit(state, pyreId, lit),
      result: null,
    })),
});

/** The party gains (+1) or loses (−1) a Blessed Branch without igniting it. */
export const adjustBranches = keyedGmMutation({
  args: { delta: v.union(v.literal(1), v.literal(-1)) },
  returns: v.object({ blessedBranches: v.number() }),
  handler: (ctx, { delta }) =>
    frameTrackerMutation(ctx, umbraTracker, { kind: "umbra_adjust_branches", request: { delta } }, (state) => {
      const next = adjust(state, delta);
      return { state: next, result: { blessedBranches: next.blessedBranches } };
    }),
});

/** Ignites a Blessed Branch to relight a pyre or found a new one. Hope is applied by hand until D5. */
export const igniteBranch = keyedGmMutation({
  args: { pyreId: v.optional(v.string()), settlement: v.optional(v.string()) },
  returns: v.object({ pyreId: v.string(), reminder: v.string() }),
  handler: (ctx, { pyreId, settlement: raw }) => {
    assertTrackerFrame(ctx.campaign, umbraTracker);
    let use: { mode: "relight"; pyreId: string } | { mode: "found"; settlement: string };
    if (pyreId !== undefined && raw === undefined) use = { mode: "relight", pyreId };
    else if (pyreId === undefined && raw !== undefined) use = { mode: "found", settlement: settlement(raw) };
    else throw appError("INVALID", "Relight a pyre or found a new one.");
    return frameTrackerMutation(ctx, umbraTracker, { kind: "umbra_ignite_branch", request: use }, (state) => {
      const next = ignite(state, use);
      return { state: next.state, result: { pyreId: next.pyreId, reminder: next.reminder } };
    });
  },
});

/** The GM's "at a Sacred Pyre" checkbox (overrides the map); null hands the decision back to the map (dcm-bxp.18). */
export const setAtPyre = keyedGmMutation({
  args: { atPyre: v.union(v.boolean(), v.null()) },
  returns: v.null(),
  handler: (ctx, { atPyre }) =>
    frameTrackerMutation(ctx, umbraTracker, { kind: "umbra_set_at_pyre", request: { atPyre } }, (state) => ({
      state: setAtPyreChoice(state, atPyre),
      result: null,
    })),
});

/**
 * The server rolls the GM's d12; `watchers` are Keep Watch Hope Die results
 * the GM enters. Fear outcomes are applied to GM Fear (clamped at 12).
 */
export const rollLurkingDarkness = keyedGmMutation({
  args: { watchers: v.optional(v.array(v.number())) },
  returns: lurkingResult,
  handler: (ctx, { watchers: raw = [] }) => {
    assertTrackerFrame(ctx.campaign, umbraTracker);
    const parsed = watchersSchema.safeParse(raw);
    if (!parsed.success) throw parsed.error;
    const watchers = parsed.data;
    const campaignId = ctx.campaign._id;
    return frameTrackerMutation<typeof umbraStateSchema, LurkingResult>(ctx, umbraTracker, { kind: "umbra_lurking_darkness", request: { watchers } }, async (state) => {
      assertCanRollLurking(state, await nearLitPyre(ctx, ctx.campaign, state));
      const roll = resolveLurking(rollDie(12), watchers);
      const fearGained = LURKING_FEAR[roll.outcome];
      const next = logLurking(state, { ...roll, fearGained, at: Date.now() });
      if (fearGained === 0) return { state: next, result: { ...roll, text: LURKING_TEXT[roll.outcome], fear: null } };
      const { gained, lost, newValue } = await gainFear(ctx, campaignId, fearGained);
      return { state: next, result: { ...roll, text: LURKING_TEXT[roll.outcome], fear: { gained, lost, newValue } } };
    });
  },
});

/**
 * Rest hook (D5 T3b, CB 289): "When the party finishes a short or long rest
 * while not in the vicinity of a Sacred Pyre, roll a d12 for the Lurking
 * Darkness". The server rolls it with each Keep Watch Hope Die (the party
 * takes the highest), logs it on the tracker (GM-only) and applies Fear
 * through gainFear; on a 12 each resting PC gains a Hope on the rest's sheets
 * (undone with the rest). The tracker log and that Fear keep their own
 * history (plan note 11). W6 Manual (house rule): nothing is rolled; the GM
 * gets a note to roll from the tracker, naming the PCs who kept watch.
 */
export const ageOfUmbraRestHook: RestHook = async (ctx, { campaign, choices, sheets, rng, actorId, groupId }) => {
  if (campaign.frameId !== umbraTracker.frameId) return [];
  const state = await loadTracker(ctx, campaign._id, umbraTracker);
  const atPyre = await atPyreNow(ctx, campaign, state);
  const mode = ruleMode(campaign, "umbraLurkingDarkness");
  if (!restRollsLurking(atPyre, mode)) {
    if (!atPyre) {
      const watchers = [...sheets].filter(([id]) => chose(choices, id, KEEP_WATCH_MOVE)).map(([, sheet]) => sheet.name);
      await postRuleNote(ctx, campaign, { ruleId: "umbraLurkingDarkness", summary: lurkingRestNote(watchers), actorId, ...(groupId !== undefined ? { groupId } : {}) });
    }
    return [];
  }
  const watchers = keepWatchRolls(choices, new Set<string>(sheets.keys()), rng);
  const roll = resolveLurking(rng(12), watchers);
  const fearGained = LURKING_FEAR[roll.outcome];
  if (fearGained > 0) await gainFear(ctx, campaign._id, fearGained);
  await writeTracker(ctx, campaign._id, umbraTracker.key, logLurking(state, { ...roll, fearGained, at: Date.now() }), TRACKER_SCHEMA_VERSION);
  if (roll.outcome !== "hope") return [];
  for (const [id, sheet] of sheets) sheets.set(id, applyResourceDelta(sheet, "hope", 1));
  return ["Lurking Darkness: a hopeful omen, each PC gains a Hope"];
};
