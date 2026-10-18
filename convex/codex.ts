import { v } from "convex/values";

import { checkGroups, codexPatchSchema, emptyEntry, MAX_CODEX_IMAGE_BYTES, MAX_CODEX_IMAGES } from "../src/lib/codex/schema";
import { coverOf, regionOf, toPlayerEntry, type GmEntry, type PlayerEntry } from "../src/lib/codex/view";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  campaignEntries,
  codexImageFiles,
  deleteText,
  entriesOfKind,
  hasToken,
  imageUrl,
  insertEntry,
  pinTokens,
  readCounter,
  readText,
  reserveEntries,
  saveSummary,
  seedCodex,
  storedEntry,
  writeCounter,
  writeText,
  type EntrySummary,
} from "./lib/codex";
import { claimFile, deleteFilesOf, deleteOwnFile, isAllowedImage, isClaimed } from "./lib/files";
import { playerTokenFilter } from "./lib/maps";
import { campaignMutation, keyedCampaignMutation, userMutation, userQuery } from "./lib/functions";
import { atLeast, liveCampaign, permissionFor, requirePermission, type Permission } from "./lib/permissions";
import { codexKindValidator, codexListValidator, codexPatchValidator, codexTextValidator } from "./lib/validators/codex";

function invalid(message: string): never {
  throw appError("INVALID", message);
}

/**
 * Characters & Locations for the campaign. The GM gets every entry's summary
 * and the map's pins; a player gets only entries the party knows, with the
 * shown allegiance, revealed images and a pin only if its token is visible.
 * The long text is in `entryText`. Reads the entries, the campaign's image
 * files and the map's marker rows; never the text or the map document.
 * Access errors stay string payloads (`requirePermission`) until
 * tests/convex/permissions.test.ts reads codes with `errorCode`.
 */
export const list = userQuery({
  args: { campaignId: v.id("campaigns") },
  returns: codexListValidator,
  handler: async (ctx, { campaignId }) => {
    const campaign = await liveCampaign(ctx, campaignId);
    const permission = await requirePermission(ctx, ctx.user, { type: "campaign", campaign }, "view", "edit");
    const tokens = await pinTokens(ctx, campaign._id);
    const tokenById = new Map(tokens.map((t) => [t.id, t]));
    const rows = await campaignEntries(ctx, campaign._id);
    const files = await codexImageFiles(ctx, campaign._id);

    // Edit and owner get the GM's codex; view gets the players' codex.
    if (atLeast(permission, "edit")) {
      const entries = await Promise.all(
        rows.map(async (row) => {
          const { summary: d } = storedEntry(row.data);
          const token = d.tokenId === null ? undefined : tokenById.get(d.tokenId);
          const images = await Promise.all(d.images.map(async (g) => ({ ...g, key: g.storageId, url: await imageUrl(ctx, files, row._id, g.storageId) })));
          const region = regionOf(campaign.frameId, d, token ?? null);
          return {
            _id: row._id,
            kind: row.kind,
            name: d.name,
            role: d.role,
            known: d.known,
            allegiance: d.allegiance,
            allegianceShown: d.allegianceShown,
            region: region.region,
            regionAuto: region.auto,
            tokenId: token ? token.id : null,
            images,
            cover: coverOf(d.cover, d.images),
            createdAt: row.createdAt,
          } satisfies GmEntry;
        }),
      );
      const pins = tokens.map(({ id, name, x, y, hidden, type }) => ({ id, name, x, y, hidden, type }));
      return { role: "gm" as const, entries, pins };
    }

    // An unreadable map shows no pins; the codex still works.
    const canSee = await playerTokenFilter(ctx, campaign).catch(() => () => false);
    const entries: (PlayerEntry & { _id: Id<"codexEntries"> })[] = [];
    for (const row of rows) {
      const { summary: d } = storedEntry(row.data);
      if (!d.known) continue;
      const token = d.tokenId === null ? undefined : tokenById.get(d.tokenId);
      const visiblePin = token && canSee(token) ? token : null;
      // Resolve URLs only for revealed images.
      const images = await Promise.all(d.images.filter((g) => g.shown).map(async (g) => ({ ...g, url: await imageUrl(ctx, files, row._id, g.storageId) })));
      const view = toPlayerEntry(campaign.frameId, { _id: row._id, kind: row.kind, createdAt: row.createdAt, data: d, images }, visiblePin);
      if (view) entries.push({ ...view, _id: row._id });
    }
    return { role: "player" as const, entries };
  },
});

type Loaded = { campaign: Doc<"campaigns">; entry: Doc<"codexEntries">; permission: Permission };

/** The entry, its live campaign and the user's permission on it (exact up to edit), or null without access. */
async function findEntry(ctx: QueryCtx, user: Doc<"users">, entryId: Id<"codexEntries">): Promise<Loaded | null> {
  const entry = await ctx.db.get("codexEntries", entryId);
  if (entry === null) return null;
  const campaign = await ctx.db.get("campaigns", entry.campaignId);
  if (campaign === null || campaign.deletedAt !== undefined) return null;
  const permission = await permissionFor(ctx, user, { type: "codexEntry", campaign, entry }, "edit");
  return permission === null ? null : { campaign, entry, permission };
}

/** Loads an entry for a GM-only change (edit permission): NOT_FOUND for outsiders, FORBIDDEN for players. */
async function loadEntryForGm(ctx: QueryCtx, user: Doc<"users">, entryId: Id<"codexEntries">) {
  const found = await findEntry(ctx, user, entryId);
  if (found === null) throw appError("NOT_FOUND");
  if (!atLeast(found.permission, "edit")) throw appError("FORBIDDEN");
  return { ...found, summary: storedEntry(found.entry.data).summary };
}

/**
 * An entry's long text: "what the players know" and the GM notes for the GM;
 * only "what the players know" for a player, and only while the party knows
 * the entry. Null when the entry is gone, unknown to the party, or not the
 * caller's to see (so a live view never throws as an entry disappears).
 */
export const entryText = userQuery({
  args: { entryId: v.id("codexEntries") },
  returns: codexTextValidator,
  handler: async (ctx, { entryId }) => {
    const found = await findEntry(ctx, ctx.user, entryId);
    if (found === null) return null;
    const text = await readText(ctx, found.entry);
    if (atLeast(found.permission, "edit")) return { role: "gm" as const, pdesc: text.pdesc, gmn: text.gmn };
    if (!storedEntry(found.entry.data).summary.known) return null;
    return { role: "player" as const, pdesc: text.pdesc };
  },
});

/** GM only: a new, empty, secret entry. */
export const create = keyedCampaignMutation({
  need: "edit",
  args: { kind: codexKindValidator },
  returns: v.object({ entryId: v.id("codexEntries") }),
  handler: async (ctx, { kind }) =>
    ctx.once("codex_create", { kind }, async () => {
      const campaignId = ctx.campaign._id;
      const counter = await reserveEntries(ctx, campaignId, 1);
      const entryId = await insertEntry(ctx, campaignId, kind, emptyEntry(), Date.now());
      await writeCounter(ctx, campaignId, counter, { entries: counter.entries + 1, seeded: counter.seeded });
      return { entryId };
    }),
});

/**
 * GM only: creates the frame's starting characters (all secret) for a
 * campaign created before `campaigns.create` seeded them. Idempotent: a
 * seeded campaign gets `{ created: 0 }`.
 */
export const seed = campaignMutation({
  need: "edit",
  args: {},
  returns: v.object({ created: v.number() }),
  handler: async (ctx) => seedCodex(ctx, ctx.campaign._id, ctx.campaign.frameId),
});

/** GM only: edits name, role, known, what players know, GM notes, allegiances and region. Text and summary are stored apart. */
export const update = userMutation({
  args: { entryId: v.id("codexEntries"), patch: codexPatchValidator },
  returns: v.null(),
  handler: async (ctx, { entryId, patch }) => {
    const { campaign, entry, summary } = await loadEntryForGm(ctx, ctx.user, entryId);
    const { pdesc, gmn, ...fields } = codexPatchSchema.parse(patch);
    if (pdesc !== undefined || gmn !== undefined) {
      await writeText(ctx, entry, { ...(pdesc !== undefined ? { pdesc } : {}), ...(gmn !== undefined ? { gmn } : {}) });
    }
    if (Object.keys(fields).length > 0) {
      const next: EntrySummary = { ...summary, ...fields };
      const groupError = checkGroups(campaign.frameId, next);
      if (groupError) invalid(groupError);
      await saveSummary(ctx, entry, next);
    }
    return null;
  },
});

/**
 * GM only: links the entry to a World map token, or unlinks it with null. A
 * token that isn't on the map is stored as no pin. Returns the stored id.
 */
export const setPin = userMutation({
  args: { entryId: v.id("codexEntries"), tokenId: v.union(v.number(), v.null()) },
  returns: v.object({ tokenId: v.union(v.number(), v.null()) }),
  handler: async (ctx, { entryId, tokenId }) => {
    const { entry, summary } = await loadEntryForGm(ctx, ctx.user, entryId);
    const stored = tokenId !== null && (await hasToken(ctx, entry.campaignId, tokenId)) ? tokenId : null;
    await saveSummary(ctx, entry, { ...summary, tokenId: stored });
    return { tokenId: stored };
  },
});

/** GM only: adds a location for every map pin no location links to yet. */
export const importPins = keyedCampaignMutation({
  need: "edit",
  args: {},
  returns: v.object({ added: v.number() }),
  handler: async (ctx) =>
    ctx.once("codex_import_pins", {}, async () => {
      const campaignId = ctx.campaign._id;
      const linked = new Set<number>();
      for (const row of await entriesOfKind(ctx, campaignId, "location")) {
        const tokenId = storedEntry(row.data).summary.tokenId;
        if (tokenId !== null) linked.add(tokenId);
      }
      const fresh = (await pinTokens(ctx, campaignId)).filter((t) => !linked.has(t.id));
      const counter = await reserveEntries(ctx, campaignId, fresh.length);
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
      if (fresh.length > 0) await writeCounter(ctx, campaignId, counter, { entries: counter.entries + fresh.length, seeded: counter.seeded });
      return { added: fresh.length };
    }),
});

/** GM only: deletes the entry, its text and its image files. */
export const remove = userMutation({
  args: { entryId: v.id("codexEntries") },
  returns: v.null(),
  handler: async (ctx, { entryId }) => {
    const { entry } = await loadEntryForGm(ctx, ctx.user, entryId);
    const counter = await readCounter(ctx, entry.campaignId);
    await deleteFilesOf(ctx, "codexImage", entry._id);
    await deleteText(ctx, entry._id);
    await ctx.db.delete("codexEntries", entry._id);
    // A counter read before this delete (a campaign from before the counter) still includes the entry.
    await writeCounter(ctx, entry.campaignId, counter, { entries: Math.max(0, counter.entries - 1), seeded: counter.seeded });
    return null;
  },
});

/** GM only: an upload URL for an image of an entry with room for one more. Rate-limited per user. */
export const imageUploadUrl = userMutation({
  rateLimit: "uploadUrl",
  args: { entryId: v.id("codexEntries") },
  returns: v.string(),
  handler: async (ctx, { entryId }) => {
    const { summary } = await loadEntryForGm(ctx, ctx.user, entryId);
    if (summary.images.length >= MAX_CODEX_IMAGES) invalid(`An entry holds at most ${MAX_CODEX_IMAGES} images.`);
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * GM only: attaches a just-uploaded file to the entry, hidden from players.
 * The file must be a PNG, JPEG, WebP or GIF of at most 3 MB that nothing else has claimed.
 * The first image becomes the main picture. A rejected file is deleted and
 * the reason returned (throwing would roll the deletion back).
 */
export const attachImage = userMutation({
  args: { entryId: v.id("codexEntries"), storageId: v.id("_storage") },
  returns: v.object({ error: v.union(v.string(), v.null()) }),
  handler: async (ctx, { entryId, storageId }) => {
    const { entry, summary } = await loadEntryForGm(ctx, ctx.user, entryId);
    const meta = await ctx.db.system.get("_storage", storageId);
    // Only an unclaimed file may be attached, so the rejections below only ever delete unclaimed files.
    if (meta === null || (await isClaimed(ctx, storageId))) throw appError("NOT_FOUND");
    if (!isAllowedImage(meta, MAX_CODEX_IMAGE_BYTES)) {
      await ctx.storage.delete(storageId);
      return { error: "Images must be PNG, JPEG, WebP or GIF files of at most 3 MB." };
    }
    if (summary.images.length >= MAX_CODEX_IMAGES) {
      await ctx.storage.delete(storageId);
      return { error: `An entry holds at most ${MAX_CODEX_IMAGES} images.` };
    }
    await claimFile(ctx, { storageId, campaignId: entry.campaignId, uploadedBy: ctx.user._id, kind: "codexImage", refId: entryId });
    await saveSummary(ctx, entry, { ...summary, images: [...summary.images, { storageId, shown: false }], cover: summary.cover ?? storageId });
    return { error: null };
  },
});

function requireImage(summary: EntrySummary, storageId: string) {
  if (!summary.images.some((g) => g.storageId === storageId)) throw appError("NOT_FOUND");
}

/** GM only: reveals or hides an image. Revealing one also marks the entry known. */
export const setImageShown = userMutation({
  args: { entryId: v.id("codexEntries"), storageId: v.string(), shown: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { entryId, storageId, shown }) => {
    const { entry, summary } = await loadEntryForGm(ctx, ctx.user, entryId);
    requireImage(summary, storageId);
    await saveSummary(ctx, entry, {
      ...summary,
      images: summary.images.map((g) => (g.storageId === storageId ? { ...g, shown } : g)),
      known: shown ? true : summary.known,
    });
    return null;
  },
});

/** GM only: uses an image as the entry's main picture. */
export const setCover = userMutation({
  args: { entryId: v.id("codexEntries"), storageId: v.string() },
  returns: v.null(),
  handler: async (ctx, { entryId, storageId }) => {
    const { entry, summary } = await loadEntryForGm(ctx, ctx.user, entryId);
    requireImage(summary, storageId);
    await saveSummary(ctx, entry, { ...summary, cover: storageId });
    return null;
  },
});

/** GM only: removes an image from the entry and deletes the file (only if it was uploaded for this entry). */
export const removeImage = userMutation({
  args: { entryId: v.id("codexEntries"), storageId: v.string() },
  returns: v.null(),
  handler: async (ctx, { entryId, storageId }) => {
    const { entry, summary } = await loadEntryForGm(ctx, ctx.user, entryId);
    requireImage(summary, storageId);
    await saveSummary(ctx, entry, {
      ...summary,
      images: summary.images.filter((g) => g.storageId !== storageId),
      cover: summary.cover === storageId ? null : summary.cover,
    });
    await deleteOwnFile(ctx, "codexImage", entryId, storageId);
    return null;
  },
});
