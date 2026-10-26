import { v } from "convex/values";

// Convex validators for Characters & Locations (CD19). Lengths and the
// frame's allegiances and regions are checked by the zod schemas in
// src/lib/codex/schema.ts; these give the shapes.

export const codexKindValidator = v.union(v.literal("character"), v.literal("location"));

/** The fields the GM edits directly (`codex.update`); images, cover and pin have their own mutations. */
export const codexPatchValidator = v.object({
  name: v.optional(v.string()),
  role: v.optional(v.string()),
  known: v.optional(v.boolean()),
  pdesc: v.optional(v.string()),
  gmn: v.optional(v.string()),
  allegiance: v.optional(v.string()),
  allegianceShown: v.optional(v.string()),
  region: v.optional(v.string()),
});

/** `GmEntry` (src/lib/codex/view.ts): every summary field; the long text is in `codex.entryText`. */
export const gmEntryValidator = v.object({
  _id: v.id("codexEntries"),
  kind: codexKindValidator,
  name: v.string(),
  role: v.string(),
  known: v.boolean(),
  allegiance: v.string(),
  allegianceShown: v.string(),
  region: v.string(),
  regionAuto: v.boolean(),
  tokenId: v.union(v.number(), v.null()),
  images: v.array(v.object({ key: v.string(), storageId: v.string(), shown: v.boolean(), url: v.union(v.string(), v.null()) })),
  cover: v.union(v.string(), v.null()),
  createdAt: v.number(),
});

/** `PlayerEntry`: only what the party may know (no GM notes, true allegiance or storage ids). */
export const playerEntryValidator = v.object({
  _id: v.id("codexEntries"),
  kind: codexKindValidator,
  name: v.string(),
  role: v.string(),
  allegianceShown: v.string(),
  region: v.string(),
  tokenId: v.union(v.number(), v.null()),
  images: v.array(v.object({ key: v.string(), url: v.union(v.string(), v.null()) })),
  cover: v.union(v.string(), v.null()),
  createdAt: v.number(),
});

const pinValidator = v.object({ id: v.number(), name: v.string(), x: v.number(), y: v.number(), hidden: v.boolean(), type: v.string() });

/** What `codex.list` returns: the GM's codex with the map's pins, or the players' codex. */
export const codexListValidator = v.union(
  v.object({ role: v.literal("gm"), entries: v.array(gmEntryValidator), pins: v.array(pinValidator) }),
  v.object({ role: v.literal("player"), entries: v.array(playerEntryValidator) }),
);

/** What `codex.entryText` returns: both texts for the GM, only "what the players know" for players, null without access. */
export const codexTextValidator = v.union(
  v.object({ role: v.literal("gm"), pdesc: v.string(), gmn: v.string() }),
  v.object({ role: v.literal("player"), pdesc: v.string() }),
  v.null(),
);
