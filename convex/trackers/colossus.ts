import { ConvexError, v } from "convex/values";

import {
  applyCorrection,
  colossusCorrectionSchema,
  colossusStateSchema,
  defeatColossus as defeat,
  hasEmerged,
  INITIAL_COLOSSUS,
  kudamatThresholds,
  markRest as mark,
  type ColossusPhase,
  type ColossusState,
  type SiphonRoll,
} from "../../src/lib/frames/trackers/colossus";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query, type MutationCtx } from "../_generated/server";
import { loadCampaign, loadGmCampaign } from "../lib/access";
import { requireUser } from "../lib/auth";
import { rollDice } from "../lib/dice";
import { ruleError } from "../lib/mechanics";
import { campaignScope, withIdempotency } from "../lib/operations";
import { readTracker, writeTracker } from "../lib/trackers";

const FRAME = "colossus-of-the-drylands";
const KEY = "colossus";
const rollD12s = (count: number) => rollDice(count, 12);

/** Phase and slain colossi are public; the Siphoning Track and Kudamat's Power are GM-only (`gm` is null for players). */
export type ColossusView = {
  phase: ColossusPhase;
  colossiDefeated: number;
  gm: {
    siphonMarked: number;
    kudamatPower: number;
    emerged: boolean;
    thresholds: { major: number; severe: number };
    log: SiphonRoll[];
  } | null;
};

function assertFrame(campaign: Doc<"campaigns">) {
  if (campaign.frameId !== FRAME) throw new ConvexError("MECHANIC_DISABLED");
}

const parse = (data: unknown): ColossusState => (data === null ? INITIAL_COLOSSUS : colossusStateSchema.parse(data));

export const get = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<ColossusView> => {
    const user = await requireUser(ctx);
    const { campaign, role } = await loadCampaign(ctx, user, campaignId);
    assertFrame(campaign);
    const state = parse(await readTracker(ctx, campaignId, KEY));
    return {
      phase: state.phase,
      colossiDefeated: state.colossiDefeated,
      gm:
        role === "gm"
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

/** GM + frame checks, then one idempotent change of the tracker state. */
async function change<R>(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  op: { idempotencyKey: string; kind: string; request: unknown },
  apply: (state: ColossusState, at: number) => { state: ColossusState; result: R },
): Promise<R> {
  const user = await requireUser(ctx);
  assertFrame(await loadGmCampaign(ctx, user, campaignId));
  return withIdempotency(
    ctx,
    { scopeKey: campaignScope(campaignId), key: op.idempotencyKey, kind: op.kind, request: op.request, createdBy: user._id, campaignId },
    async () => {
      const current = parse(await readTracker(ctx, campaignId, KEY));
      let next: { state: ColossusState; result: R };
      try {
        next = apply(current, Date.now());
      } catch (error) {
        ruleError("TRACKER_RULE", error);
      }
      await writeTracker(ctx, campaignId, KEY, next.state);
      return next.result;
    },
  );
}

/** A hunt-phase rest marks the Siphoning Track (short +1, long +2); a full track is rolled at once. */
export const markRest = mutation({
  args: { campaignId: v.id("campaigns"), kind: v.union(v.literal("short"), v.literal("long")), idempotencyKey: v.string() },
  handler: (ctx, { campaignId, kind, idempotencyKey }): Promise<{ siphonMarked: number; rolls: SiphonRoll[] }> =>
    change(ctx, campaignId, { idempotencyKey, kind: "colossus_mark_rest", request: { kind } }, (state, at) => {
      const next = mark(state, kind, rollD12s, at);
      return { state: next.state, result: { siphonMarked: next.state.siphonMarked, rolls: next.rolls } };
    }),
});

/** A colossus falls: the shard is rolled into Kudamat's Power, the track resets and the interlude begins. */
export const defeatColossus = mutation({
  args: { campaignId: v.id("campaigns"), idempotencyKey: v.string() },
  handler: (ctx, { campaignId, idempotencyKey }): Promise<{ colossiDefeated: number; roll: SiphonRoll; notice: string }> =>
    change(ctx, campaignId, { idempotencyKey, kind: "colossus_defeat", request: {} }, (state, at) => {
      const next = defeat(state, rollD12s, at);
      return { state: next.state, result: { colossiDefeated: next.state.colossiDefeated, roll: next.roll, notice: next.notice } };
    }),
});

export const setPhase = mutation({
  args: { campaignId: v.id("campaigns"), phase: v.union(v.literal("hunt"), v.literal("interlude")), idempotencyKey: v.string() },
  handler: (ctx, { campaignId, phase, idempotencyKey }): Promise<{ phase: ColossusPhase }> =>
    change(ctx, campaignId, { idempotencyKey, kind: "colossus_set_phase", request: { phase } }, (state) => ({
      state: { ...state, phase },
      result: { phase },
    })),
});

/** Manual corrections of the track, Power or slain count. */
export const correct = mutation({
  args: {
    campaignId: v.id("campaigns"),
    siphonMarked: v.optional(v.number()),
    kudamatPower: v.optional(v.number()),
    colossiDefeated: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { campaignId, idempotencyKey, ...raw }): Promise<null> => {
    const parsed = colossusCorrectionSchema.safeParse(raw);
    if (!parsed.success) throw new ConvexError({ code: "INVALID", message: parsed.error.issues[0]?.message });
    return change(ctx, campaignId, { idempotencyKey, kind: "colossus_correct", request: parsed.data }, (state) => ({
      state: applyCorrection(state, parsed.data),
      result: null,
    }));
  },
});
