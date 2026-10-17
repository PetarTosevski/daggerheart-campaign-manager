import { v } from "convex/values";
import { z } from "zod";

import { appError } from "../../src/lib/errors/app-error";
import {
  READING_DICE,
  REVELATION_KINDS,
  REVELATION_STATUSES,
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
  revelationPatchSchema,
  revelationStatusSchema,
  secretTextSchema,
  showdownReady,
  type WeredragonState,
} from "../../src/lib/frames/trackers/weredragon";
import { rollDice } from "../lib/dice";
import { campaignQuery, keyedCampaignMutation, keyedGmMutation } from "../lib/functions";
import { assertTrackerFrame, frameTrackerMutation, loadTracker, type FrameTracker } from "../lib/trackers";

/** The stored revelations, secrets and pending roll (structure only: the domain module checks values on write). */
const weredragonStateSchema = z.object({
  revelations: z.array(
    z.object({ kind: revelationKindSchema, die: z.number().nullable(), text: z.string(), status: revelationStatusSchema }),
  ),
  secrets: z.array(z.object({ id: z.string(), authorId: z.string(), text: z.string(), used: z.boolean(), createdAt: z.number() })),
  pendingRoll: z.array(z.number()).nullable(),
}) satisfies z.ZodType<WeredragonState>;

export const weredragonTracker: FrameTracker<typeof weredragonStateSchema> = {
  frameId: WEREDRAGON_FRAME_ID,
  key: WEREDRAGON_TRACKER_KEY,
  schema: weredragonStateSchema,
  initial: defaultWeredragonState,
  ruleCode: "INVALID",
};

const revelation = v.object({
  kind: v.union(...REVELATION_KINDS.map((k) => v.literal(k))),
  die: v.union(v.number(), v.null()),
  text: v.string(),
  status: v.union(...REVELATION_STATUSES.map((s) => v.literal(s))),
});
const secret = v.object({
  id: v.string(),
  authorId: v.string(),
  text: v.string(),
  used: v.boolean(),
  createdAt: v.number(),
  authorName: v.union(v.string(), v.null()),
});
const view = {
  revelations: v.array(revelation),
  secrets: v.array(secret),
  pendingRoll: v.union(v.array(v.number()), v.null()),
  showdownReady: v.boolean(),
};

/**
 * The Astromancer's Revelations. Players see only revealed revelations and
 * their own Forlorne secrets; the filtering happens here, never in the client.
 */
export const get = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.union(v.object({ role: v.literal("gm"), ...view }), v.object({ role: v.literal("player"), ...view })),
  handler: async (ctx) => {
    assertTrackerFrame(ctx.campaign, weredragonTracker);
    const state = await loadTracker(ctx, ctx.campaign._id, weredragonTracker);
    const ready = showdownReady(state.revelations);
    if (ctx.permission !== "owner") {
      const mine = playerWeredragonView(state, ctx.user._id);
      return {
        role: "player" as const,
        revelations: mine.revelations,
        secrets: mine.secrets.map((s) => ({ ...s, authorName: null })),
        pendingRoll: mine.pendingRoll,
        showdownReady: ready,
      };
    }
    const names = new Map<string, string | null>();
    for (const s of state.secrets) {
      if (names.has(s.authorId)) continue;
      // Stored ids are strings inside the blob (CD7): normalize before reading.
      const authorId = ctx.db.normalizeId("users", s.authorId);
      const author = authorId === null ? null : await ctx.db.get("users", authorId);
      names.set(s.authorId, author?.name ?? author?.email ?? null);
    }
    return {
      role: "gm" as const,
      revelations: state.revelations,
      secrets: state.secrets.map((s) => ({ ...s, authorName: names.get(s.authorId) ?? null })),
      pendingRoll: state.pendingRoll,
      showdownReady: ready,
    };
  },
});

/** "Read the night sky": the server rolls 5d6 for the GM to assign (HF p.140). */
export const readNightSky = keyedGmMutation({
  args: {},
  returns: v.object({ roll: v.array(v.number()) }),
  handler: (ctx) =>
    frameTrackerMutation(ctx, weredragonTracker, { kind: "weredragon_read", request: {} }, (state) => {
      const roll = rollDice(READING_DICE, 6);
      return { state: { ...state, pendingRoll: roll }, result: { roll } };
    }),
});

/**
 * Places the pending roll: `assignment[i]` is the index of the die for the i-th
 * revelation. Returns the places where more than one revelation landed.
 */
export const assignReading = keyedGmMutation({
  args: { assignment: v.array(v.number()) },
  returns: v.object({
    clashes: v.array(v.object({ place: v.string(), kinds: v.array(v.union(...REVELATION_KINDS.map((k) => v.literal(k)))) })),
  }),
  handler: (ctx, { assignment }) =>
    frameTrackerMutation(ctx, weredragonTracker, { kind: "weredragon_assign", request: { assignment } }, (state) => {
      const roll = state.pendingRoll;
      if (roll === null) throw appError("INVALID", "Read the night sky first.");
      const next = applyReading(state, roll, assignment);
      return { state: next, result: { clashes: placeClashes(next.revelations.map((r) => r.die)) } };
    }),
});

/** GM edits one revelation: its die (re-seeds the text), text or status. */
export const updateRevelation = keyedGmMutation({
  args: {
    kind: v.string(),
    die: v.optional(v.union(v.number(), v.null())),
    text: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  returns: v.null(),
  handler: (ctx, { kind, ...patch }) =>
    frameTrackerMutation(ctx, weredragonTracker, { kind: "weredragon_revelation", request: { kind, ...patch } }, (state) => {
      // The wrapper sends a ZodError as INVALID with its first message.
      const parsedKind = revelationKindSchema.safeParse(kind);
      if (!parsedKind.success) throw parsedKind.error;
      const parsedPatch = revelationPatchSchema.safeParse(patch);
      if (!parsedPatch.success) throw parsedPatch.error;
      return { state: patchRevelation(state, parsedKind.data, parsedPatch.data), result: null };
    }),
});

/** A player (or the GM) privately submits a secret Forlorne is hiding. Only the GM sees all of them. */
export const submitSecret = keyedCampaignMutation({
  need: "view",
  args: { text: v.string() },
  returns: v.object({ secretId: v.string() }),
  handler: (ctx, { text }) => {
    const author = ctx.user._id;
    return frameTrackerMutation(ctx, weredragonTracker, { kind: "weredragon_secret", request: { text } }, (state) => {
      const parsed = secretTextSchema.safeParse(text);
      if (!parsed.success) throw parsed.error;
      if (state.secrets.length >= MAX_SECRETS) throw appError("INVALID", "This campaign holds too many secrets already.");
      if (state.secrets.filter((s) => s.authorId === author).length >= MAX_SECRETS_PER_AUTHOR) {
        throw appError("INVALID", `You can submit up to ${MAX_SECRETS_PER_AUTHOR} secrets.`);
      }
      const secretId = crypto.randomUUID();
      const next: WeredragonState = {
        ...state,
        secrets: [...state.secrets, { id: secretId, authorId: author, text: parsed.data, used: false, createdAt: Date.now() }],
      };
      return { state: next, result: { secretId } };
    });
  },
});

/** GM marks a submitted secret as used (or not). */
export const setSecretUsed = keyedGmMutation({
  args: { secretId: v.string(), used: v.boolean() },
  returns: v.null(),
  handler: (ctx, { secretId, used }) =>
    frameTrackerMutation(ctx, weredragonTracker, { kind: "weredragon_secret_used", request: { secretId, used } }, (state) => {
      if (!state.secrets.some((s) => s.id === secretId)) throw appError("NOT_FOUND");
      return {
        state: { ...state, secrets: state.secrets.map((s) => (s.id === secretId ? { ...s, used } : s)) },
        result: null,
      };
    }),
});
