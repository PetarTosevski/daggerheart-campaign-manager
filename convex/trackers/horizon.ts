import { ConvexError, v } from "convex/values";

import {
  FIRST_ECHO,
  HORIZON_TRACKER_KEY,
  MAX_ECHOES,
  REFUSAL_MESSAGES,
  fearForMark,
  markRefusal,
  occurredEvents,
  parseHorizonState,
  unmarkRefusal,
  withMark,
  withoutMark,
  type DoomBoxState,
  type DoomTierNumber,
  type HorizonState,
} from "../../src/lib/frames/trackers/horizon";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { loadCampaign } from "../lib/access";
import { requireUser } from "../lib/auth";
import { gainFear } from "../lib/fear";
import { campaignScope, withIdempotency } from "../lib/operations";
import { readTracker, writeTracker } from "../lib/trackers";

export type HorizonView =
  | { role: "gm"; partyTier: number; echoesCollected: number; boxes: Record<string, DoomBoxState> }
  | { role: "player"; echoesCollected: number; occurred: { id: string; tier: DoomTierNumber; text: string }[] };

export type MarkResult = { boxId: string; fear: { gained: number; lost: number; newValue: number } | null };
export type EchoesChange = { previousValue: number; newValue: number; levelUps: number; horizonUnlocked: boolean };

/** Journey to Horizon only; enforced here, not only in the UI. */
async function load(ctx: QueryCtx, user: Doc<"users">, campaignId: Id<"campaigns">, gmOnly: boolean) {
  const { campaign, role } = await loadCampaign(ctx, user, campaignId, { gmOnly });
  if (campaign.frameId !== "journey-to-horizon") throw new ConvexError("MECHANIC_DISABLED");
  const state = parseHorizonState(await readTracker(ctx, campaignId, HORIZON_TRACKER_KEY));
  return { campaign, role, state };
}

function refuse(reason: keyof typeof REFUSAL_MESSAGES): never {
  throw new ConvexError({ code: "DOOM_RULE", message: REFUSAL_MESSAGES[reason] });
}

/** The GM sees the whole track; players see the Echo count and occurred events only. */
export const get = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<HorizonView> => {
    const user = await requireUser(ctx);
    const { campaign, role, state } = await load(ctx, user, campaignId, false);
    if (role === "gm") {
      return { role, partyTier: campaign.tier, echoesCollected: state.echoesCollected, boxes: state.boxes };
    }
    return { role, echoesCollected: state.echoesCollected, occurred: occurredEvents(state) };
  },
});

async function save(ctx: MutationCtx, campaignId: Id<"campaigns">, state: HorizonState) {
  await writeTracker(ctx, campaignId, HORIZON_TRACKER_KEY, state);
}

/**
 * Marks a Doom Track box in the party's tier (campaign.tier) or below, after
 * its parent. A Tier 4 mark gains Fear equal to the marked Tier 4 boxes.
 */
export const markBox = mutation({
  args: {
    campaignId: v.id("campaigns"),
    boxId: v.string(),
    session: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { campaignId, boxId, session, idempotencyKey }): Promise<MarkResult> => {
    const user = await requireUser(ctx);
    const { campaign, state } = await load(ctx, user, campaignId, true);
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "horizon_mark",
        request: { boxId, session },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const reason = markRefusal(state, boxId, campaign.tier);
        if (reason) refuse(reason);
        if (session !== undefined && (!Number.isInteger(session) || session < 1)) {
          throw new ConvexError({ code: "DOOM_RULE", message: "Session must be a whole number from 1." });
        }
        const next = withMark(state, boxId, Date.now(), session);
        await save(ctx, campaignId, next);
        const amount = fearForMark(next, boxId);
        if (amount === 0) return { boxId, fear: null };
        const { gained, lost, newValue } = await gainFear(ctx, campaignId, amount);
        return { boxId, fear: { gained, lost, newValue } };
      },
    );
  },
});

/** GM correction. Fear already gained from a Tier 4 mark is not refunded. */
export const unmarkBox = mutation({
  args: { campaignId: v.id("campaigns"), boxId: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, boxId, idempotencyKey }): Promise<{ boxId: string }> => {
    const user = await requireUser(ctx);
    const { state } = await load(ctx, user, campaignId, true);
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "horizon_unmark",
        request: { boxId },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const reason = unmarkRefusal(state, boxId);
        if (reason) refuse(reason);
        await save(ctx, campaignId, withoutMark(state, boxId));
        return { boxId };
      },
    );
  },
});

/** Once a marked event has occurred in play, its text becomes visible to players. */
export const setOccurred = mutation({
  args: { campaignId: v.id("campaigns"), boxId: v.string(), occurred: v.boolean(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, boxId, occurred, idempotencyKey }): Promise<{ boxId: string; occurred: boolean }> => {
    const user = await requireUser(ctx);
    const { state } = await load(ctx, user, campaignId, true);
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "horizon_occurred",
        request: { boxId, occurred },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const entry = state.boxes[boxId];
        if (!entry?.marked) refuse("NOT_MARKED_OCCURRED");
        if (entry.occurred !== occurred) {
          await save(ctx, campaignId, { ...state, boxes: { ...state.boxes, [boxId]: { ...entry, occurred } } });
        }
        return { boxId, occurred };
      },
    );
  },
});

/** Sets the Soul Echoes collected (1–10). Each new Echo levels the party up; 10 unlocks Horizon. */
export const setEchoes = mutation({
  args: { campaignId: v.id("campaigns"), value: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, value, idempotencyKey }): Promise<EchoesChange> => {
    const user = await requireUser(ctx);
    const { state } = await load(ctx, user, campaignId, true);
    if (!Number.isInteger(value) || value < FIRST_ECHO || value > MAX_ECHOES) {
      throw new ConvexError({ code: "ECHO_RANGE", message: `Soul Echoes run from ${FIRST_ECHO} to ${MAX_ECHOES}.` });
    }
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "horizon_echoes",
        request: { value },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const previousValue = state.echoesCollected;
        if (value !== previousValue) await save(ctx, campaignId, { ...state, echoesCollected: value });
        return {
          previousValue,
          newValue: value,
          levelUps: Math.max(0, value - previousValue),
          horizonUnlocked: value === MAX_ECHOES,
        };
      },
    );
  },
});
