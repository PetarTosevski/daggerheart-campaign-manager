import { v } from "convex/values";

import { derivedDefense } from "../src/lib/domain/characters/derived";
import { appError } from "../src/lib/errors/app-error";
import { resolveOptions } from "../src/lib/frames/options";
import { MAX_PHOTO_BYTES, MAX_PHOTOS, PHOTO_TYPES, type PhotoReadResult } from "../src/lib/import/draft";
import { sheetFromImport } from "../src/lib/import/sheet";
import { draftFromReading, SHEET_READING_JSON_SCHEMA, sheetPrompt, sheetReadingSchema } from "../src/lib/import/sheet-photo";
import { characterSheetSchema } from "../src/lib/validation/characters";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { logAction } from "./lib/actionLog";
import { storedSheet } from "./lib/characterSheet";
import { claimFile, deleteOwnFile, isAllowedImage, isClaimed } from "./lib/files";
import { gmMutation, gmQuery, keyedGmMutation, userAction } from "./lib/functions";
import { campaignAccess } from "./lib/permissions";
import { traitsValidator, goldValidator } from "./lib/validators/characters";

/**
 * Photo import (D5 T7, decisions 13 and 14). The GM uploads up to four photos
 * of a paper sheet (`uploadUrl` + `claim`, recorded as `files` kind
 * `photoImport` on the campaign), `read` sends them to the Claude Messages API
 * once and deletes them whatever happens, and `create` saves the sheet the GM
 * reviewed. Hidden unless `ANTHROPIC_API_KEY` is set on the deployment; the key
 * never leaves the server. Abandoned photos expire through `cleanup.ts`.
 */

/** The model used unless `ANTHROPIC_MODEL` names another (decision 14). */
export const DEFAULT_MODEL = "claude-sonnet-5-5";
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

/** The API key, read in the handler (CF19); undefined when unset or blank. */
function apiKey(): string | undefined {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? key : undefined;
}

// ---------------------------------------------------------------- validators

const ancestryValidator = v.union(
  v.object({ kind: v.literal("single"), id: v.string() }),
  v.object({ kind: v.literal("mixed"), first: v.string(), second: v.string(), name: v.string() }),
  v.object({ kind: v.literal("shapeshifter"), form: v.string(), feature: v.string() }),
);

/** `importDraftSchema` (src/lib/import/draft.ts); the handler checks it with zod and the rules. */
export const importDraftValidator = v.object({
  name: v.string(),
  pronouns: v.string(),
  description: v.string(),
  level: v.number(),
  classId: v.string(),
  subclassId: v.string(),
  ancestry: ancestryValidator,
  communityId: v.string(),
  traits: traitsValidator,
  evasion: v.number(),
  hpMax: v.number(),
  hp: v.number(),
  stressMax: v.number(),
  stress: v.number(),
  hope: v.number(),
  armorMarked: v.number(),
  proficiency: v.number(),
  primaryWeaponId: v.string(),
  secondaryWeaponId: v.optional(v.string()),
  armorId: v.optional(v.string()),
  gold: goldValidator,
  experiences: v.array(v.object({ name: v.string(), value: v.number() })),
  domainCards: v.array(v.string()),
  inventory: v.array(v.string()),
});

const readResultValidator = v.object({
  draft: importDraftValidator,
  unreadable: v.array(v.string()),
  unmatched: v.array(v.object({ field: v.string(), text: v.string() })),
});

const claimResultValidator = v.union(
  v.object({ ok: v.literal(true) }),
  v.object({ ok: v.literal(false), code: v.union(v.literal("PHOTO_IMPORT_FILE"), v.literal("PHOTO_IMPORT_TOO_MANY")) }),
);

// ---------------------------------------------------------------- photos

/** The campaign's photo-import files (at most `MAX_PHOTOS` are ever claimed). */
function photoRows(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("files")
    .withIndex("by_ref", (q) => q.eq("kind", "photoImport").eq("refId", campaignId))
    .take(MAX_PHOTOS + 1);
}

async function deletePhotoRows(ctx: MutationCtx, campaignId: Id<"campaigns">, storageIds: Id<"_storage">[]) {
  for (const storageId of storageIds) await deleteOwnFile(ctx, "photoImport", campaignId, storageId);
}

/** Whether photo import is set up here (the key is never returned). GM only. */
export const available = gmQuery({
  args: {},
  returns: v.boolean(),
  handler: async () => apiKey() !== undefined,
});

/** An upload URL for one photo. GM only, rate-limited; refused while photo import isn't set up. */
export const uploadUrl = gmMutation({
  rateLimit: "uploadUrl",
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    if (apiKey() === undefined) throw appError("PHOTO_IMPORT_UNAVAILABLE");
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Records a just-uploaded photo for the campaign's import. Only an unclaimed
 * file is accepted (NOT_FOUND otherwise). A file that isn't a JPEG, PNG or
 * WebP of at most 5 MB, or a fifth photo, is deleted and the reason returned,
 * not thrown, so the delete is kept (CF16).
 */
export const claim = gmMutation({
  args: { storageId: v.id("_storage") },
  returns: claimResultValidator,
  handler: async (ctx, { storageId }) => {
    const meta = await ctx.db.system.get("_storage", storageId);
    if (meta === null || (await isClaimed(ctx, storageId))) throw appError("NOT_FOUND");
    if (!isAllowedImage(meta, MAX_PHOTO_BYTES) || !PHOTO_TYPES.includes(meta.contentType ?? "")) {
      await ctx.storage.delete(storageId);
      return { ok: false as const, code: "PHOTO_IMPORT_FILE" as const };
    }
    if ((await photoRows(ctx, ctx.campaign._id)).length >= MAX_PHOTOS) {
      await ctx.storage.delete(storageId);
      return { ok: false as const, code: "PHOTO_IMPORT_TOO_MANY" as const };
    }
    await claimFile(ctx, { storageId, campaignId: ctx.campaign._id, uploadedBy: ctx.user._id, kind: "photoImport", refId: ctx.campaign._id });
    return { ok: true as const };
  },
});

/** Deletes the campaign's uploaded photos without reading them (the GM cancelled). GM only. */
export const discard = gmMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const rows = await photoRows(ctx, ctx.campaign._id);
    await deletePhotoRows(
      ctx,
      ctx.campaign._id,
      rows.map((r) => r.storageId),
    );
    return null;
  },
});

/** For `read`: the GM check and the photos, in one query (CF8). */
export const readContext = internalQuery({
  args: { userId: v.id("users"), campaignId: v.id("campaigns") },
  returns: v.object({ hopeAndFear: v.boolean(), storageIds: v.array(v.id("_storage")) }),
  handler: async (ctx, { userId, campaignId }) => {
    const user = await ctx.db.get("users", userId);
    const access = user === null ? null : await campaignAccess(ctx, user, campaignId, "owner");
    if (access === null) throw appError("NOT_FOUND");
    if (access.permission !== "owner") throw appError("FORBIDDEN");
    const rows = await photoRows(ctx, campaignId);
    return {
      hopeAndFear: resolveOptions(access.campaign.frameId, access.campaign.options).hopeAndFear,
      storageIds: rows.slice(0, MAX_PHOTOS).map((r) => r.storageId),
    };
  },
});

/** For `read`: deletes the photos it was given, in one mutation (CF8). */
export const deletePhotos = internalMutation({
  args: { campaignId: v.id("campaigns"), storageIds: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { campaignId, storageIds }) => {
    await deletePhotoRows(ctx, campaignId, storageIds);
    return null;
  },
});

/** Base64 of the bytes, in chunks small enough for `String.fromCharCode`. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** One Messages API call with the photos; no retry (decision 14). Returns Claude's reading, or throws PHOTO_IMPORT_FAILED. */
async function askClaude(key: string, images: { mediaType: string; data: string }[], hopeAndFear: boolean): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(MESSAGES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL,
        max_tokens: 8000,
        output_config: { effort: "low", format: { type: "json_schema", schema: SHEET_READING_JSON_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              ...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } })),
              { type: "text", text: sheetPrompt(hopeAndFear) },
            ],
          },
        ],
      }),
    });
  } catch (error) {
    console.error("Photo import: the Messages API request failed.", error);
    throw appError("PHOTO_IMPORT_FAILED");
  }
  if (!response.ok) {
    console.error(`Photo import: the Messages API answered ${response.status}.`, (await response.text()).slice(0, 500));
    throw appError("PHOTO_IMPORT_FAILED");
  }
  const body = (await response.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
  const text = body.content?.find((block) => block.type === "text")?.text;
  if (body.stop_reason !== "end_turn" || text === undefined) {
    console.error(`Photo import: no answer (stop reason ${body.stop_reason ?? "none"}).`);
    throw appError("PHOTO_IMPORT_FAILED");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw appError("PHOTO_IMPORT_FAILED");
  }
}

/**
 * Reads the uploaded photos into a draft for the GM to review: one Messages
 * API call per click, no automatic retry, names fuzzy-matched to SRD ids
 * (classes limited by the campaign's Hope & Fear switch). The photos and their
 * `files` rows are deleted in every outcome. GM only (FORBIDDEN for players);
 * PHOTO_IMPORT_UNAVAILABLE without `ANTHROPIC_API_KEY`.
 */
export const read = userAction({
  rateLimit: "photoImport",
  args: { campaignId: v.id("campaigns") },
  returns: readResultValidator,
  handler: async (ctx, { campaignId }): Promise<PhotoReadResult> => {
    const { hopeAndFear, storageIds } = await ctx.runQuery(internal.photoImport.readContext, { userId: ctx.user._id, campaignId });
    try {
      const key = apiKey();
      if (key === undefined) throw appError("PHOTO_IMPORT_UNAVAILABLE");
      const images: { mediaType: string; data: string }[] = [];
      for (const id of storageIds) {
        const blob = await ctx.storage.get(id);
        if (blob !== null) images.push({ mediaType: blob.type || "image/jpeg", data: base64(new Uint8Array(await blob.arrayBuffer())) });
      }
      if (images.length === 0) throw appError("PHOTO_IMPORT_RULE", "Upload at least one photo first.");
      const reading = sheetReadingSchema.safeParse(await askClaude(key, images, hopeAndFear));
      if (!reading.success) {
        console.error("Photo import: the answer didn't match the schema.", reading.error.issues[0]);
        throw appError("PHOTO_IMPORT_FAILED");
      }
      return draftFromReading(reading.data, hopeAndFear);
    } finally {
      await ctx.runMutation(internal.photoImport.deletePhotos, { campaignId, storageIds });
    }
  },
});

// ---------------------------------------------------------------- saving

/** The owner of an imported character: the GM, or a player in the campaign. */
async function ownerFor(ctx: QueryCtx, campaign: Doc<"campaigns">, gm: Id<"users">, ownerId?: Id<"users">): Promise<Id<"users">> {
  if (!ownerId || ownerId === gm || ownerId === campaign.ownerId) return ownerId ?? gm;
  const member = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", ownerId))
    .unique();
  if (!member) throw appError("INVALID", "That player isn't in this campaign.");
  return ownerId;
}

/**
 * Saves the reviewed draft as a character at any level, with the sheet and
 * equipment checks of `sheetFromImport` (INVALID for a malformed draft,
 * PHOTO_IMPORT_RULE for a rules problem), owned by the GM or the chosen
 * player, and logs an `import` row. GM only, retry-safe.
 */
export const create = keyedGmMutation({
  args: { draft: importDraftValidator, ownerId: v.optional(v.id("users")) },
  returns: v.object({ characterId: v.id("characters") }),
  handler: async (ctx, { draft, ownerId }) => {
    const hopeAndFear = resolveOptions(ctx.campaign.frameId, ctx.campaign.options).hopeAndFear;
    const sheet = characterSheetSchema.parse(sheetFromImport(draft, hopeAndFear));
    sheet.armorMarked = Math.min(sheet.armorMarked, derivedDefense(sheet).armorScore);
    const owner = await ownerFor(ctx, ctx.campaign, ctx.user._id, ownerId);
    return ctx.once("photo_import_create", { draft, owner }, async () => {
      const now = Date.now();
      const characterId = await ctx.db.insert("characters", {
        campaignId: ctx.campaign._id,
        ownerId: owner,
        createdBy: ctx.user._id,
        status: "active",
        sheet: storedSheet(sheet),
        createdAt: now,
        updatedAt: now,
      });
      await logAction(ctx, {
        campaignId: ctx.campaign._id,
        characterId,
        actorId: ctx.user._id,
        kind: "import",
        visibility: "public",
        summary: `Imported ${sheet.name} (level ${sheet.level}) from photos`,
        undoable: false,
      });
      return { characterId };
    });
  },
});
