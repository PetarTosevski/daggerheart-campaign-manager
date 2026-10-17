import { ConvexError, v } from "convex/values";

import {
  addPyre as add,
  adjustBranches as adjust,
  assertCanRollLurking,
  igniteBranch as ignite,
  INITIAL_UMBRA,
  LURKING_FEAR,
  LURKING_TEXT,
  logLurking,
  removePyre as remove,
  renamePyre as rename,
  resolveLurking,
  setPyreLit,
  settlementSchema,
  umbraStateSchema,
  watchersSchema,
  type LurkingOutcome,
  type LurkingRoll,
  type Pyre,
  type UmbraState,
} from "../../src/lib/frames/trackers/age-of-umbra";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query, type MutationCtx } from "../_generated/server";
import { loadCampaign, loadGmCampaign } from "../lib/access";
import { requireUser } from "../lib/auth";
import { rollDie } from "../lib/dice";
import { gainFear } from "../lib/fear";
import { ruleError } from "../lib/mechanics";
import { campaignScope, withIdempotency } from "../lib/operations";
import { readTracker, writeTracker } from "../lib/trackers";

const FRAME = "age-of-umbra";
const KEY = "ageOfUmbra";

/** Pyres, branches and the at-a-pyre flag are public; the Lurking Darkness log is GM-only (`gm` is null for players). */
export type UmbraView = {
  pyres: Pyre[];
  blessedBranches: number;
  atPyre: boolean;
  gm: { log: LurkingRoll[] } | null;
};

export type LurkingResult = {
  gmRoll: number;
  watchRoll: number | null;
  result: number;
  outcome: LurkingOutcome;
  text: string;
  fear: { gained: number; lost: number; newValue: number } | null;
};

function assertFrame(campaign: Doc<"campaigns">) {
  if (campaign.frameId !== FRAME) throw new ConvexError("MECHANIC_DISABLED");
}

const parse = (data: unknown): UmbraState => (data === null ? INITIAL_UMBRA : umbraStateSchema.parse(data));

function settlement(raw: string): string {
  const parsed = settlementSchema.safeParse(raw);
  if (!parsed.success) throw new ConvexError({ code: "INVALID", message: parsed.error.issues[0]?.message });
  return parsed.data;
}

export const get = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<UmbraView> => {
    const user = await requireUser(ctx);
    const { campaign, role } = await loadCampaign(ctx, user, campaignId);
    assertFrame(campaign);
    const state = parse(await readTracker(ctx, campaignId, KEY));
    return {
      pyres: state.pyres,
      blessedBranches: state.blessedBranches,
      atPyre: state.atPyre,
      gm: role === "gm" ? { log: state.log } : null,
    };
  },
});

/** GM + frame checks, then one idempotent change of the tracker state. */
async function change<R>(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  op: { idempotencyKey: string; kind: string; request: unknown },
  apply: (state: UmbraState) => { state: UmbraState; result: R },
  after?: (result: R) => Promise<R>,
): Promise<R> {
  const user = await requireUser(ctx);
  assertFrame(await loadGmCampaign(ctx, user, campaignId));
  return withIdempotency(
    ctx,
    { scopeKey: campaignScope(campaignId), key: op.idempotencyKey, kind: op.kind, request: op.request, createdBy: user._id, campaignId },
    async () => {
      const current = parse(await readTracker(ctx, campaignId, KEY));
      let next: { state: UmbraState; result: R };
      try {
        next = apply(current);
      } catch (error) {
        ruleError("TRACKER_RULE", error);
      }
      await writeTracker(ctx, campaignId, KEY, next.state);
      return after ? after(next.result) : next.result;
    },
  );
}

const ARGS = { campaignId: v.id("campaigns"), idempotencyKey: v.string() };

export const addPyre = mutation({
  args: { ...ARGS, settlement: v.string(), lit: v.optional(v.boolean()) },
  handler: (ctx, { campaignId, idempotencyKey, settlement: raw, lit = true }): Promise<{ pyreId: string }> => {
    const name = settlement(raw);
    return change(ctx, campaignId, { idempotencyKey, kind: "umbra_add_pyre", request: { settlement: name, lit } }, (state) => {
      const next = add(state, name, lit);
      return { state: next.state, result: { pyreId: next.pyreId } };
    });
  },
});

export const renamePyre = mutation({
  args: { ...ARGS, pyreId: v.string(), settlement: v.string() },
  handler: (ctx, { campaignId, idempotencyKey, pyreId, settlement: raw }): Promise<null> => {
    const name = settlement(raw);
    return change(ctx, campaignId, { idempotencyKey, kind: "umbra_rename_pyre", request: { pyreId, settlement: name } }, (state) => ({
      state: rename(state, pyreId, name),
      result: null,
    }));
  },
});

export const removePyre = mutation({
  args: { ...ARGS, pyreId: v.string() },
  handler: (ctx, { campaignId, idempotencyKey, pyreId }): Promise<null> =>
    change(ctx, campaignId, { idempotencyKey, kind: "umbra_remove_pyre", request: { pyreId } }, (state) => ({
      state: remove(state, pyreId),
      result: null,
    })),
});

/** Lights or extinguishes a pyre in the fiction (no branch spent). */
export const setLit = mutation({
  args: { ...ARGS, pyreId: v.string(), lit: v.boolean() },
  handler: (ctx, { campaignId, idempotencyKey, pyreId, lit }): Promise<null> =>
    change(ctx, campaignId, { idempotencyKey, kind: "umbra_set_lit", request: { pyreId, lit } }, (state) => ({
      state: setPyreLit(state, pyreId, lit),
      result: null,
    })),
});

/** The party gains (+1) or loses (−1) a Blessed Branch without igniting it. */
export const adjustBranches = mutation({
  args: { ...ARGS, delta: v.union(v.literal(1), v.literal(-1)) },
  handler: (ctx, { campaignId, idempotencyKey, delta }): Promise<{ blessedBranches: number }> =>
    change(ctx, campaignId, { idempotencyKey, kind: "umbra_adjust_branches", request: { delta } }, (state) => {
      const next = adjust(state, delta);
      return { state: next, result: { blessedBranches: next.blessedBranches } };
    }),
});

/** Ignites a Blessed Branch to relight a pyre or found a new one. Hope is applied by hand until D5. */
export const igniteBranch = mutation({
  args: { ...ARGS, pyreId: v.optional(v.string()), settlement: v.optional(v.string()) },
  handler: (ctx, { campaignId, idempotencyKey, pyreId, settlement: raw }): Promise<{ pyreId: string; reminder: string }> => {
    if ((pyreId === undefined) === (raw === undefined)) {
      throw new ConvexError({ code: "INVALID", message: "Relight a pyre or found a new one." });
    }
    const use = pyreId !== undefined ? ({ mode: "relight", pyreId } as const) : ({ mode: "found", settlement: settlement(raw!) } as const);
    return change(ctx, campaignId, { idempotencyKey, kind: "umbra_ignite_branch", request: use }, (state) => {
      const next = ignite(state, use);
      return { state: next.state, result: { pyreId: next.pyreId, reminder: next.reminder } };
    });
  },
});

export const setAtPyre = mutation({
  args: { ...ARGS, atPyre: v.boolean() },
  handler: (ctx, { campaignId, idempotencyKey, atPyre }): Promise<null> =>
    change(ctx, campaignId, { idempotencyKey, kind: "umbra_set_at_pyre", request: { atPyre } }, (state) => ({
      state: { ...state, atPyre },
      result: null,
    })),
});

/**
 * The server rolls the GM's d12; `watchers` are Keep Watch Hope Die results
 * the GM enters. Fear outcomes are applied to GM Fear (clamped at 12).
 */
export const rollLurkingDarkness = mutation({
  args: { ...ARGS, watchers: v.optional(v.array(v.number())) },
  handler: (ctx, { campaignId, idempotencyKey, watchers: raw = [] }): Promise<LurkingResult> => {
    const parsed = watchersSchema.safeParse(raw);
    if (!parsed.success) throw new ConvexError({ code: "INVALID", message: parsed.error.issues[0]?.message });
    const watchers = parsed.data;
    return change(
      ctx,
      campaignId,
      { idempotencyKey, kind: "umbra_lurking_darkness", request: { watchers } },
      (state) => {
        assertCanRollLurking(state);
        const roll = resolveLurking(rollDie(12), watchers);
        const fearGained = LURKING_FEAR[roll.outcome];
        const result: LurkingResult = { ...roll, text: LURKING_TEXT[roll.outcome], fear: null };
        return { state: logLurking(state, { ...roll, fearGained, at: Date.now() }), result };
      },
      async (result) => {
        const amount = LURKING_FEAR[result.outcome];
        if (amount === 0) return result;
        const { gained, lost, newValue } = await gainFear(ctx, campaignId, amount);
        return { ...result, fear: { gained, lost, newValue } };
      },
    );
  },
});
