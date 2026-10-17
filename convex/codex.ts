import { ConvexError, v } from "convex/values";
import { ZodError } from "zod";

import {
  checkGroups,
  codexEntryDataSchema,
  codexPatchSchema,
  emptyEntry,
  MAX_CODEX_ENTRIES,
  MAX_CODEX_IMAGE_BYTES,
  MAX_CODEX_IMAGES,
  type CodexEntryData,
  type CodexKind,
} from "../src/lib/codex/schema";
import { seedCharacters } from "../src/lib/codex/seed";
import { coverOf, regionOf, toPlayerEntry, type GmEntry, type PlayerEntry } from "../src/lib/codex/view";
import type { MapToken } from "../src/lib/world/map-state";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { loadCampaign, loadGmCampaign } from "./lib/access";
import { requireUser } from "./lib/auth";
import { readMap } from "./lib/maps";
import { campaignScope, withIdempotency } from "./lib/operations";

function invalid(message: string): never {
  throw new ConvexError({ code: "INVALID", message });
}

function parseData(raw: unknown): CodexEntryData {
  const parsed = codexEntryDataSchema.safeParse(raw);
  if (!parsed.success) throw new ConvexError("CODEX_CORRUPT");
  return parsed.data;
}

/** The campaign's map tokens; none when the map is missing or unreadable (the codex still works). */
async function mapTokens(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<MapToken[]> {
  try {
    return (await readMap(ctx, campaign)).tokens;
  } catch {
    return [];
  }
}

/** URL of a stored file, or null when the id isn't a valid storage id or the file is gone. */
async function safeUrl(ctx: QueryCtx, storageId: string): Promise<string | null> {
  const id = ctx.db.system.normalizeId("_storage", storageId);
  if (id === null) return null;
  return ctx.storage.getUrl(id).catch(() => null);
}

async function campaignEntries(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  const byKind = (kind: CodexKind) =>
    ctx.db
      .query("codexEntries")
      .withIndex("by_campaign_kind", (q) => q.eq("campaignId", campaignId).eq("kind", kind))
      .collect();
  const rows = [...(await byKind("character")), ...(await byKind("location"))];
  // Newest first (the board puts new entries on top); entries created together keep their order.
  return rows.sort((a, b) => b.createdAt - a.createdAt || a._creationTime - b._creationTime);
}

/**
 * Characters & Locations for the campaign. The GM gets every entry, every
 * field and the map's pins; a player gets only entries the party knows, with
 * the shown allegiance, revealed images and a pin only if its token is visible.
 */
export const list = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (
    ctx,
    { campaignId },
  ): Promise<
    | { role: "gm"; entries: GmEntry[]; pins: Pick<MapToken, "id" | "name" | "x" | "y" | "hidden" | "type">[] }
    | { role: "player"; entries: PlayerEntry[] }
  > => {
    const user = await requireUser(ctx);
    const { campaign, role } = await loadCampaign(ctx, user, campaignId);
    const tokens = await mapTokens(ctx, campaign);
    const tokenById = new Map(tokens.map((t) => [t.id, t]));
    const rows = await campaignEntries(ctx, campaignId);

    if (role === "gm") {
      const entries = await Promise.all(
        rows.map(async (row): Promise<GmEntry> => {
          const d = parseData(row.data);
          const token = d.tokenId === null ? undefined : tokenById.get(d.tokenId);
          const images = await Promise.all(d.images.map(async (g) => ({ ...g, url: await safeUrl(ctx, g.storageId) })));
          const region = regionOf(campaign.frameId, d, token ?? null);
          return {
            _id: row._id,
            kind: row.kind,
            name: d.name,
            role: d.role,
            known: d.known,
            pdesc: d.pdesc,
            gmn: d.gmn,
            allegiance: d.allegiance,
            allegianceShown: d.allegianceShown,
            region: region.region,
            regionAuto: region.auto,
            tokenId: token ? token.id : null,
            images,
            cover: coverOf(d.cover, d.images),
            createdAt: row.createdAt,
          };
        }),
      );
      const pins = tokens.map(({ id, name, x, y, hidden, type }) => ({ id, name, x, y, hidden, type }));
      return { role: "gm", entries, pins };
    }

    const entries: PlayerEntry[] = [];
    for (const row of rows) {
      const d = parseData(row.data);
      if (!d.known) continue;
      const token = d.tokenId === null ? undefined : tokenById.get(d.tokenId);
      const visiblePin = token && !token.hidden ? token : null;
      // Resolve URLs only for revealed images.
      const images = await Promise.all(
        d.images.filter((g) => g.shown).map(async (g) => ({ ...g, url: await safeUrl(ctx, g.storageId) })),
      );
      const view = toPlayerEntry(campaign.frameId, { _id: row._id, kind: row.kind, createdAt: row.createdAt, data: d, images }, visiblePin);
      if (view) entries.push(view);
    }
    return { role: "player", entries };
  },
});

type GmAccess = { user: Doc<"users">; campaign: Doc<"campaigns">; entry: Doc<"codexEntries">; data: CodexEntryData };

/** Loads an entry for a GM-only change: NOT_FOUND for outsiders, FORBIDDEN for players. */
async function loadEntryForGm(ctx: QueryCtx, entryId: Id<"codexEntries">): Promise<GmAccess> {
  const user = await requireUser(ctx);
  const entry = await ctx.db.get(entryId);
  if (entry === null) throw new ConvexError("NOT_FOUND");
  const campaign = await loadGmCampaign(ctx, user, entry.campaignId);
  return { user, campaign, entry, data: parseData(entry.data) };
}

async function save(ctx: MutationCtx, entry: Doc<"codexEntries">, data: CodexEntryData) {
  const parsed = codexEntryDataSchema.safeParse(data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? "Invalid entry.");
  await ctx.db.patch(entry._id, { data: parsed.data, updatedAt: Date.now() });
}

async function countEntries(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return (await campaignEntries(ctx, campaignId)).length;
}

async function insertEntry(ctx: MutationCtx, campaignId: Id<"campaigns">, kind: CodexKind, data: CodexEntryData, now: number) {
  return ctx.db.insert("codexEntries", { campaignId, kind, data: codexEntryDataSchema.parse(data), createdAt: now, updatedAt: now });
}

const kindValidator = v.union(v.literal("character"), v.literal("location"));

/** GM only: a new, empty, secret entry. */
export const create = mutation({
  args: { campaignId: v.id("campaigns"), kind: kindValidator, idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, kind, idempotencyKey }) => {
    const user = await requireUser(ctx);
    await loadGmCampaign(ctx, user, campaignId);
    return withIdempotency(
      ctx,
      { scopeKey: campaignScope(campaignId), key: idempotencyKey, kind: "codex_create", request: { kind }, createdBy: user._id, campaignId },
      async () => {
        if ((await countEntries(ctx, campaignId)) >= MAX_CODEX_ENTRIES) invalid(`A campaign holds at most ${MAX_CODEX_ENTRIES} entries.`);
        const entryId = await insertEntry(ctx, campaignId, kind, emptyEntry(), Date.now());
        return { entryId };
      },
    );
  },
});

/**
 * GM only: creates the frame's starting characters (all secret) the first
 * time the GM opens Characters & Locations. Runs once per campaign.
 */
export const seed = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    const campaign = await loadGmCampaign(ctx, user, campaignId);
    return withIdempotency(
      ctx,
      { scopeKey: campaignScope(campaignId), key: "codex:seed", kind: "codex_seed", request: {}, createdBy: user._id, campaignId },
      async () => {
        const now = Date.now();
        let room = MAX_CODEX_ENTRIES - (await countEntries(ctx, campaignId));
        let created = 0;
        for (const s of seedCharacters(campaign.frameId)) {
          if (room-- <= 0) break;
          await insertEntry(ctx, campaignId, "character", emptyEntry({ name: s.name, role: s.role, allegiance: s.allegiance ?? "" }), now);
          created++;
        }
        return { created };
      },
    );
  },
});

/** GM only: edits name, role, known, what players know, GM notes, allegiances and region. */
export const update = mutation({
  args: { entryId: v.id("codexEntries"), patch: v.any() },
  handler: async (ctx, { entryId, patch }) => {
    const { campaign, entry, data } = await loadEntryForGm(ctx, entryId);
    let clean;
    try {
      clean = codexPatchSchema.parse(patch);
    } catch (e) {
      invalid(e instanceof ZodError ? (e.issues[0]?.message ?? "Invalid entry.") : "Invalid entry.");
    }
    const next = { ...data, ...clean };
    const groupError = checkGroups(campaign.frameId, next);
    if (groupError) invalid(groupError);
    await save(ctx, entry, next);
  },
});

/**
 * GM only: links the entry to a World map token, or unlinks it with null. A
 * token that isn't on the map is stored as no pin. Returns the stored id.
 */
export const setPin = mutation({
  args: { entryId: v.id("codexEntries"), tokenId: v.union(v.number(), v.null()) },
  handler: async (ctx, { entryId, tokenId }) => {
    const { campaign, entry, data } = await loadEntryForGm(ctx, entryId);
    let stored: number | null = null;
    if (tokenId !== null) {
      const tokens = await mapTokens(ctx, campaign);
      stored = tokens.some((t) => t.id === tokenId) ? tokenId : null;
    }
    await save(ctx, entry, { ...data, tokenId: stored });
    return { tokenId: stored };
  },
});

/** GM only: adds a location for every map pin no location links to yet. */
export const importPins = mutation({
  args: { campaignId: v.id("campaigns"), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, idempotencyKey }) => {
    const user = await requireUser(ctx);
    const campaign = await loadGmCampaign(ctx, user, campaignId);
    return withIdempotency(
      ctx,
      { scopeKey: campaignScope(campaignId), key: idempotencyKey, kind: "codex_import_pins", request: {}, createdBy: user._id, campaignId },
      async () => {
        const rows = await campaignEntries(ctx, campaignId);
        const linked = new Set<number>();
        for (const row of rows) {
          if (row.kind !== "location") continue;
          const tokenId = parseData(row.data).tokenId;
          if (tokenId !== null) linked.add(tokenId);
        }
        const fresh = (await mapTokens(ctx, campaign)).filter((t) => !linked.has(t.id));
        if (rows.length + fresh.length > MAX_CODEX_ENTRIES) invalid(`A campaign holds at most ${MAX_CODEX_ENTRIES} entries.`);
        const now = Date.now();
        for (const t of fresh) {
          await insertEntry(
            ctx,
            campaignId,
            "location",
            emptyEntry({ name: (t.name || "Map pin").slice(0, 120), known: !t.hidden && t.location, gmn: t.notes, tokenId: t.id }),
            now,
          );
        }
        return { added: fresh.length };
      },
    );
  },
});

async function deleteImageFiles(ctx: MutationCtx, entryId: Id<"codexEntries">) {
  const rows = await ctx.db
    .query("codexImages")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
    await ctx.storage.delete(row.storageId).catch(() => undefined);
  }
}

/** GM only: deletes the entry and its image files. */
export const remove = mutation({
  args: { entryId: v.id("codexEntries") },
  handler: async (ctx, { entryId }) => {
    const { entry } = await loadEntryForGm(ctx, entryId);
    await deleteImageFiles(ctx, entry._id);
    await ctx.db.delete(entry._id);
  },
});

/** GM only: an upload URL for an image of an entry with room for one more. */
export const imageUploadUrl = mutation({
  args: { entryId: v.id("codexEntries") },
  handler: async (ctx, { entryId }) => {
    const { data } = await loadEntryForGm(ctx, entryId);
    if (data.images.length >= MAX_CODEX_IMAGES) invalid(`An entry holds at most ${MAX_CODEX_IMAGES} images.`);
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * GM only: attaches a just-uploaded file to the entry, hidden from players.
 * The file must be an image of at most 3 MB that nothing else has claimed.
 * The first image becomes the main picture. A rejected file is deleted and
 * the reason returned (throwing would roll the deletion back).
 */
export const attachImage = mutation({
  args: { entryId: v.id("codexEntries"), storageId: v.id("_storage") },
  handler: async (ctx, { entryId, storageId }) => {
    const { user, entry, data } = await loadEntryForGm(ctx, entryId);
    const meta = await ctx.db.system.get(storageId);
    const claimed =
      (await ctx.db
        .query("codexImages")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .unique()) ??
      (await ctx.db
        .query("portraitUploads")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .unique());
    if (meta === null || claimed !== null) throw new ConvexError("NOT_FOUND");
    if (!meta.contentType?.startsWith("image/") || meta.size > MAX_CODEX_IMAGE_BYTES) {
      await ctx.storage.delete(storageId);
      return { error: "Images must be at most 3 MB." };
    }
    if (data.images.length >= MAX_CODEX_IMAGES) {
      await ctx.storage.delete(storageId);
      return { error: `An entry holds at most ${MAX_CODEX_IMAGES} images.` };
    }
    await ctx.db.insert("codexImages", { storageId, campaignId: entry.campaignId, entryId, uploadedBy: user._id, createdAt: Date.now() });
    await save(ctx, entry, { ...data, images: [...data.images, { storageId, shown: false }], cover: data.cover ?? storageId });
    return { error: null };
  },
});

function requireImage(data: CodexEntryData, storageId: string) {
  if (!data.images.some((g) => g.storageId === storageId)) throw new ConvexError("NOT_FOUND");
}

/** GM only: reveals or hides an image. Revealing one also marks the entry known. */
export const setImageShown = mutation({
  args: { entryId: v.id("codexEntries"), storageId: v.string(), shown: v.boolean() },
  handler: async (ctx, { entryId, storageId, shown }) => {
    const { entry, data } = await loadEntryForGm(ctx, entryId);
    requireImage(data, storageId);
    await save(ctx, entry, {
      ...data,
      images: data.images.map((g) => (g.storageId === storageId ? { ...g, shown } : g)),
      known: shown ? true : data.known,
    });
  },
});

/** GM only: uses an image as the entry's main picture. */
export const setCover = mutation({
  args: { entryId: v.id("codexEntries"), storageId: v.string() },
  handler: async (ctx, { entryId, storageId }) => {
    const { entry, data } = await loadEntryForGm(ctx, entryId);
    requireImage(data, storageId);
    await save(ctx, entry, { ...data, cover: storageId });
  },
});

/** GM only: removes an image from the entry and deletes the file (only if it was uploaded for this entry). */
export const removeImage = mutation({
  args: { entryId: v.id("codexEntries"), storageId: v.string() },
  handler: async (ctx, { entryId, storageId }) => {
    const { entry, data } = await loadEntryForGm(ctx, entryId);
    requireImage(data, storageId);
    await save(ctx, entry, {
      ...data,
      images: data.images.filter((g) => g.storageId !== storageId),
      cover: data.cover === storageId ? null : data.cover,
    });
    const id = ctx.db.system.normalizeId("_storage", storageId);
    if (id === null) return;
    const row = await ctx.db
      .query("codexImages")
      .withIndex("by_storage", (q) => q.eq("storageId", id))
      .unique();
    if (row === null || row.entryId !== entryId) return;
    await ctx.db.delete(row._id);
    await ctx.storage.delete(id).catch(() => undefined);
  },
});
