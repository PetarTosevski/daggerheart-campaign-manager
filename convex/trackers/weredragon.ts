import { ConvexError, v } from "convex/values";
import { ZodError } from "zod";

import {
  READING_DICE,
  WEREDRAGON_FRAME_ID,
  WEREDRAGON_TRACKER_KEY,
  MAX_SECRETS,
  MAX_SECRETS_PER_AUTHOR,
  applyReading,
  defaultWeredragonState,
  patchRevelation,
  placeClashes,
  playerWeredragonView,
  revelationKindSchema,
  secretTextSchema,
  showdownReady,
  type WeredragonState,
} from "../../src/lib/frames/trackers/weredragon";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { loadCampaign, loadGmCampaign } from "../lib/access";
import { requireUser } from "../lib/auth";
import { rollDice } from "../lib/dice";
import { campaignScope, withIdempotency } from "../lib/operations";
import { readTracker, writeTracker } from "../lib/trackers";

function assertFrame(campaign: Doc<"campaigns">): void {
  if (campaign.frameId !== WEREDRAGON_FRAME_ID) throw new ConvexError("MECHANIC_DISABLED");
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

async function load(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<WeredragonState> {
  return (await readTracker<WeredragonState>(ctx, campaignId, WEREDRAGON_TRACKER_KEY)) ?? defaultWeredragonState();
}

async function gmMutation<T>(
  ctx: MutationCtx,
  args: { campaignId: Id<"campaigns">; idempotencyKey: string; kind: string; request: unknown },
  run: (state: WeredragonState) => { state: WeredragonState; result: T },
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
      const { state, result } = run(await load(ctx, args.campaignId));
      await writeTracker(ctx, args.campaignId, WEREDRAGON_TRACKER_KEY, state);
      return result;
    },
  );
}

/**
 * The Astromancer's Revelations. Players see only revealed revelations and
 * their own Forlorne secrets; the filtering happens here, never in the client.
 */
export const get = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    const { campaign, role } = await loadCampaign(ctx, user, campaignId);
    assertFrame(campaign);
    const state = await load(ctx, campaignId);
    const ready = showdownReady(state.revelations);
    if (role !== "gm") {
      const view = playerWeredragonView(state, user._id);
      return {
        role,
        revelations: view.revelations,
        secrets: view.secrets.map((s) => ({ ...s, authorName: null as string | null })),
        pendingRoll: view.pendingRoll,
        showdownReady: ready,
      };
    }
    const names = new Map<string, string | null>();
    for (const s of state.secrets) {
      if (!names.has(s.authorId)) {
        const author = await ctx.db.get(s.authorId as Id<"users">);
        names.set(s.authorId, author?.name ?? author?.email ?? null);
      }
    }
    return {
      role,
      revelations: state.revelations,
      secrets: state.secrets.map((s) => ({ ...s, authorName: names.get(s.authorId) ?? null })),
      pendingRoll: state.pendingRoll,
      showdownReady: ready,
    };
  },
});

/** "Read the night sky": the server rolls 5d6 for the GM to assign (HF p.140). */
export const readNightSky = mutation({
  args: { campaignId: v.id("campaigns"), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, idempotencyKey }): Promise<{ roll: number[] }> =>
    gmMutation(ctx, { campaignId, idempotencyKey, kind: "weredragon_read", request: {} }, (state) => {
      const roll = rollDice(READING_DICE, 6);
      return { state: { ...state, pendingRoll: roll }, result: { roll } };
    }),
});

/**
 * Places the pending roll: `assignment[i]` is the index of the die for the i-th
 * revelation. Returns the places where more than one revelation landed.
 */
export const assignReading = mutation({
  args: { campaignId: v.id("campaigns"), assignment: v.array(v.number()), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, assignment, idempotencyKey }) =>
    gmMutation(ctx, { campaignId, idempotencyKey, kind: "weredragon_assign", request: { assignment } }, (state) => {
      const roll = state.pendingRoll;
      if (roll === null) throw new ConvexError({ code: "INVALID", message: "Read the night sky first." });
      const next = rule(() => applyReading(state, roll, assignment));
      return { state: next, result: { clashes: placeClashes(next.revelations.map((r) => r.die)) } };
    }),
});

/** GM edits one revelation: its die (re-seeds the text), text or status. */
export const updateRevelation = mutation({
  args: {
    campaignId: v.id("campaigns"),
    kind: v.string(),
    die: v.optional(v.union(v.number(), v.null())),
    text: v.optional(v.string()),
    status: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { campaignId, idempotencyKey, kind, ...patch }) =>
    gmMutation(
      ctx,
      { campaignId, idempotencyKey, kind: "weredragon_revelation", request: { kind, ...patch } },
      (state) => {
        const next = rule(() =>
          patchRevelation(state, revelationKindSchema.parse(kind), patch as Parameters<typeof patchRevelation>[2]),
        );
        return { state: next, result: null };
      },
    ),
});

/** A player (or the GM) privately submits a secret Forlorne is hiding. Only the GM sees all of them. */
export const submitSecret = mutation({
  args: { campaignId: v.id("campaigns"), text: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, text, idempotencyKey }): Promise<{ secretId: string }> => {
    const user = await requireUser(ctx);
    const { campaign } = await loadCampaign(ctx, user, campaignId);
    assertFrame(campaign);
    const clean = rule(() => secretTextSchema.parse(text));
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "weredragon_secret",
        request: { text: clean, by: user._id },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const state = await load(ctx, campaignId);
        if (state.secrets.length >= MAX_SECRETS) {
          throw new ConvexError({ code: "INVALID", message: "This campaign holds too many secrets already." });
        }
        if (state.secrets.filter((s) => s.authorId === user._id).length >= MAX_SECRETS_PER_AUTHOR) {
          throw new ConvexError({ code: "INVALID", message: `You can submit up to ${MAX_SECRETS_PER_AUTHOR} secrets.` });
        }
        const secretId = crypto.randomUUID();
        const next: WeredragonState = {
          ...state,
          secrets: [...state.secrets, { id: secretId, authorId: user._id, text: clean, used: false, createdAt: Date.now() }],
        };
        await writeTracker(ctx, campaignId, WEREDRAGON_TRACKER_KEY, next);
        return { secretId };
      },
    );
  },
});

/** GM marks a submitted secret as used (or not). */
export const setSecretUsed = mutation({
  args: { campaignId: v.id("campaigns"), secretId: v.string(), used: v.boolean(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, secretId, used, idempotencyKey }) =>
    gmMutation(ctx, { campaignId, idempotencyKey, kind: "weredragon_secret_used", request: { secretId, used } }, (state) => {
      if (!state.secrets.some((s) => s.id === secretId)) throw new ConvexError("NOT_FOUND");
      return {
        state: { ...state, secrets: state.secrets.map((s) => (s.id === secretId ? { ...s, used } : s)) },
        result: null,
      };
    }),
});
