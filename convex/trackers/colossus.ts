import { v, type Infer } from "convex/values";

import {
  applyCorrection,
  COLOSSUS_PHASES,
  colossusCorrectionSchema,
  colossusStateSchema,
  defeatColossus as defeat,
  hasEmerged,
  INITIAL_COLOSSUS,
  kudamatThresholds,
  markRest as mark,
} from "../../src/lib/frames/trackers/colossus";
import { rollDice } from "../lib/dice";
import { campaignQuery, keyedGmMutation } from "../lib/functions";
import type { RestHook } from "../lib/restHooks";
import { assertTrackerFrame, frameTrackerMutation, loadTracker, TRACKER_SCHEMA_VERSION, writeTracker, type FrameTracker } from "../lib/trackers";

export const colossusTracker: FrameTracker<typeof colossusStateSchema> = {
  frameId: "colossus-of-the-drylands",
  key: "colossus",
  schema: colossusStateSchema,
  initial: () => INITIAL_COLOSSUS,
  ruleCode: "TRACKER_RULE",
};

const rollD12s = (count: number) => rollDice(count, 12);

const phase = v.union(...COLOSSUS_PHASES.map((p) => v.literal(p)));
const siphonRoll = v.object({
  reason: v.union(v.literal("defeat"), v.literal("full")),
  dice: v.array(v.number()),
  gained: v.number(),
  powerAfter: v.number(),
  at: v.number(),
});
const shared = { phase, colossiDefeated: v.number() };
const colossusView = v.union(
  v.object({
    ...shared,
    gm: v.object({
      siphonMarked: v.number(),
      kudamatPower: v.number(),
      emerged: v.boolean(),
      thresholds: v.object({ major: v.number(), severe: v.number() }),
      log: v.array(siphonRoll),
    }),
  }),
  v.object({ ...shared, gm: v.null() }),
);

/** Phase and slain colossi are public; the Siphoning Track and Kudamat's Power are GM-only (`gm` is null for players). */
export type ColossusView = Infer<typeof colossusView>;

export const get = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: colossusView,
  handler: async (ctx): Promise<ColossusView> => {
    assertTrackerFrame(ctx.campaign, colossusTracker);
    const state = await loadTracker(ctx, ctx.campaign._id, colossusTracker);
    return {
      phase: state.phase,
      colossiDefeated: state.colossiDefeated,
      gm:
        ctx.permission === "owner"
          ? {
              siphonMarked: state.siphonMarked,
              kudamatPower: state.kudamatPower,
              emerged: hasEmerged(state),
              thresholds: kudamatThresholds(state.kudamatPower),
              log: state.log,
            }
          : null,
    };
  },
});

/** A hunt-phase rest marks the Siphoning Track (short +1, long +2); a full track is rolled at once. */
export const markRest = keyedGmMutation({
  args: { kind: v.union(v.literal("short"), v.literal("long")) },
  returns: v.object({ siphonMarked: v.number(), rolls: v.array(siphonRoll) }),
  handler: (ctx, { kind }) =>
    frameTrackerMutation(ctx, colossusTracker, { kind: "colossus_mark_rest", request: { kind } }, (state) => {
      const next = mark(state, kind, rollD12s, Date.now());
      return { state: next.state, result: { siphonMarked: next.state.siphonMarked, rolls: next.rolls } };
    }),
});

/**
 * Rest hook (D5 T3b, CB 327): "When the PCs take a short rest during the hunt
 * phase, mark the Siphoning Track once. When the PCs take a long rest during
 * the hunt phase, mark the Siphoning Track twice." `kind` is the rest's
 * effect, so an interrupted long rest marks once. The track is GM-only, so
 * the hook adds no line to the public feed; rest undo leaves it (plan note 11).
 */
export const colossusRestHook: RestHook = async (ctx, { campaign, kind, rng }) => {
  if (campaign.frameId !== colossusTracker.frameId) return [];
  const state = await loadTracker(ctx, campaign._id, colossusTracker);
  if (state.phase !== "hunt") return [];
  const next = mark(state, kind, (count) => Array.from({ length: count }, () => rng(12)), Date.now());
  await writeTracker(ctx, campaign._id, colossusTracker.key, next.state, TRACKER_SCHEMA_VERSION);
  return [];
};

/** A colossus falls: the shard is rolled into Kudamat's Power, the track resets and the interlude begins. */
export const defeatColossus = keyedGmMutation({
  args: {},
  returns: v.object({ colossiDefeated: v.number(), roll: siphonRoll, notice: v.string() }),
  handler: (ctx) =>
    frameTrackerMutation(ctx, colossusTracker, { kind: "colossus_defeat", request: {} }, (state) => {
      const next = defeat(state, rollD12s, Date.now());
      return { state: next.state, result: { colossiDefeated: next.state.colossiDefeated, roll: next.roll, notice: next.notice } };
    }),
});

export const setPhase = keyedGmMutation({
  args: { phase },
  returns: v.object({ phase }),
  handler: (ctx, { phase }) =>
    frameTrackerMutation(ctx, colossusTracker, { kind: "colossus_set_phase", request: { phase } }, (state) => ({
      state: { ...state, phase },
      result: { phase },
    })),
});

/** Manual corrections of the track, Power or slain count. */
export const correct = keyedGmMutation({
  args: {
    siphonMarked: v.optional(v.number()),
    kudamatPower: v.optional(v.number()),
    colossiDefeated: v.optional(v.number()),
  },
  returns: v.null(),
  handler: (ctx, raw) => {
    assertTrackerFrame(ctx.campaign, colossusTracker);
    // The wrapper sends a ZodError as INVALID with its first message.
    const parsed = colossusCorrectionSchema.safeParse(raw);
    if (!parsed.success) throw parsed.error;
    return frameTrackerMutation(ctx, colossusTracker, { kind: "colossus_correct", request: parsed.data }, (state) => ({
      state: applyCorrection(state, parsed.data),
      result: null,
    }));
  },
});
