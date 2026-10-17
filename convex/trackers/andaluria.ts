import { ConvexError, v } from "convex/values";
import { ZodError } from "zod";

import {
  ANDALURIA_FRAME_ID,
  ANDALURIA_TRACKER_KEY,
  addClue,
  allCluesRevealed,
  createHunt as addHunt,
  defaultAndaluriaState,
  patchClue,
  patchHunt,
  playerHuntView,
  removeClue,
  removeHunt,
  type AndaluriaState,
  type CluePatch,
  type HuntPatch,
} from "../../src/lib/frames/trackers/andaluria";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { loadCampaign, loadGmCampaign } from "../lib/access";
import { requireUser } from "../lib/auth";
import { campaignScope, withIdempotency } from "../lib/operations";
import { readTracker, writeTracker } from "../lib/trackers";

function assertFrame(campaign: Doc<"campaigns">): void {
  if (campaign.frameId !== ANDALURIA_FRAME_ID) throw new ConvexError("MECHANIC_DISABLED");
}

/** Runs a pure rule; its validation errors become `{ code: "INVALID", message }`. */
function rule<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ZodError) throw new ConvexError({ code: "INVALID", message: error.issues[0]?.message ?? "Invalid input." });
    if (error instanceof Error) throw new ConvexError({ code: "INVALID", message: error.message });
    throw error;
  }
}

async function load(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<AndaluriaState> {
  return (await readTracker<AndaluriaState>(ctx, campaignId, ANDALURIA_TRACKER_KEY)) ?? defaultAndaluriaState();
}

/** GM-only, frame-gated, idempotent read-modify-write of the hunts. */
async function gmMutation<T>(
  ctx: MutationCtx,
  args: { campaignId: Id<"campaigns">; idempotencyKey: string; kind: string; request: unknown },
  run: (state: AndaluriaState) => { state: AndaluriaState; result: T },
): Promise<T> {
  const user = await requireUser(ctx);
  const campaign = await loadGmCampaign(ctx, user, args.campaignId);
  assertFrame(campaign);
  return withIdempotency(
    ctx,
    {
      scopeKey: campaignScope(args.campaignId),
      key: args.idempotencyKey,
      kind: args.kind,
      request: args.request,
      createdBy: user._id,
      campaignId: args.campaignId,
    },
    async () => {
      const current = await load(ctx, args.campaignId);
      const { state, result } = rule(() => run(current));
      await writeTracker(ctx, args.campaignId, ANDALURIA_TRACKER_KEY, state);
      return result;
    },
  );
}

/**
 * The campaign's Hunts. Players get each hunt's title, beat and revealed clues
 * only (plus the monster once the GM reveals it); filtered here, on the server.
 */
export const get = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    const { campaign, role } = await loadCampaign(ctx, user, campaignId);
    assertFrame(campaign);
    const { hunts } = await load(ctx, campaignId);
    if (role === "gm") {
      return { role: "gm" as const, hunts: hunts.map((h) => ({ ...h, allCluesRevealed: allCluesRevealed(h) })) };
    }
    return { role: "player" as const, hunts: hunts.map(playerHuntView) };
  },
});

export const createHunt = mutation({
  args: { campaignId: v.id("campaigns"), title: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, title, idempotencyKey }): Promise<{ huntId: string }> =>
    gmMutation(ctx, { campaignId, idempotencyKey, kind: "andaluria_hunt_create", request: { title } }, (state) => {
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
  beat: v.optional(v.string()),
  underlings: v.optional(v.array(v.string())),
  bystanders: v.optional(v.array(v.string())),
  archived: v.optional(v.boolean()),
  monsterRevealed: v.optional(v.boolean()),
});

export const updateHunt = mutation({
  args: { campaignId: v.id("campaigns"), huntId: v.string(), patch: huntPatch, idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, huntId, patch, idempotencyKey }) =>
    gmMutation(ctx, { campaignId, idempotencyKey, kind: "andaluria_hunt_update", request: { huntId, patch } }, (state) => ({
      state: patchHunt(state, huntId, patch as HuntPatch),
      result: null,
    })),
});

export const deleteHunt = mutation({
  args: { campaignId: v.id("campaigns"), huntId: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, huntId, idempotencyKey }) =>
    gmMutation(ctx, { campaignId, idempotencyKey, kind: "andaluria_hunt_delete", request: { huntId } }, (state) => ({
      state: removeHunt(state, huntId),
      result: null,
    })),
});

export const createClue = mutation({
  args: { campaignId: v.id("campaigns"), huntId: v.string(), text: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, huntId, text, idempotencyKey }): Promise<{ clueId: string }> =>
    gmMutation(ctx, { campaignId, idempotencyKey, kind: "andaluria_clue_create", request: { huntId, text } }, (state) => {
      const clueId = crypto.randomUUID();
      return { state: addClue(state, huntId, clueId, text), result: { clueId } };
    }),
});

/** Edits a clue; `revealed: true` makes it solid and visible to players (HF p.155). */
export const updateClue = mutation({
  args: {
    campaignId: v.id("campaigns"),
    huntId: v.string(),
    clueId: v.string(),
    patch: v.object({ text: v.optional(v.string()), note: v.optional(v.string()), revealed: v.optional(v.boolean()) }),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { campaignId, huntId, clueId, patch, idempotencyKey }) =>
    gmMutation(
      ctx,
      { campaignId, idempotencyKey, kind: "andaluria_clue_update", request: { huntId, clueId, patch } },
      (state) => ({ state: patchClue(state, huntId, clueId, patch as CluePatch), result: null }),
    ),
});

export const deleteClue = mutation({
  args: { campaignId: v.id("campaigns"), huntId: v.string(), clueId: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, huntId, clueId, idempotencyKey }) =>
    gmMutation(ctx, { campaignId, idempotencyKey, kind: "andaluria_clue_delete", request: { huntId, clueId } }, (state) => ({
      state: removeClue(state, huntId, clueId),
      result: null,
    })),
});
