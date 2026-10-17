import { v, type Infer } from "convex/values";

import { appError } from "../../src/lib/errors/app-error";
import {
  addPyre as add,
  adjustBranches as adjust,
  assertCanRollLurking,
  igniteBranch as ignite,
  INITIAL_UMBRA,
  LURKING_FEAR,
  LURKING_OUTCOMES,
  LURKING_TEXT,
  logLurking,
  removePyre as remove,
  renamePyre as rename,
  resolveLurking,
  setPyreLit,
  settlementSchema,
  umbraStateSchema,
  watchersSchema,
} from "../../src/lib/frames/trackers/age-of-umbra";
import { rollDie } from "../lib/dice";
import { gainFear } from "../lib/fear";
import { campaignQuery, keyedGmMutation } from "../lib/functions";
import { assertTrackerFrame, frameTrackerMutation, loadTracker, type FrameTracker } from "../lib/trackers";

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
      pyres: state.pyres,
      blessedBranches: state.blessedBranches,
      atPyre: state.atPyre,
      gm: ctx.permission === "owner" ? { log: state.log } : null,
    };
  },
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

export const setAtPyre = keyedGmMutation({
  args: { atPyre: v.boolean() },
  returns: v.null(),
  handler: (ctx, { atPyre }) =>
    frameTrackerMutation(ctx, umbraTracker, { kind: "umbra_set_at_pyre", request: { atPyre } }, (state) => ({
      state: { ...state, atPyre },
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
      assertCanRollLurking(state);
      const roll = resolveLurking(rollDie(12), watchers);
      const fearGained = LURKING_FEAR[roll.outcome];
      const next = logLurking(state, { ...roll, fearGained, at: Date.now() });
      if (fearGained === 0) return { state: next, result: { ...roll, text: LURKING_TEXT[roll.outcome], fear: null } };
      const { gained, lost, newValue } = await gainFear(ctx, campaignId, fearGained);
      return { state: next, result: { ...roll, text: LURKING_TEXT[roll.outcome], fear: { gained, lost, newValue } } };
    });
  },
});
