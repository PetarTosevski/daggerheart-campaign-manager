import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { loadCharacter } from "./lib/characterSheet";
import { userMutation, userQuery } from "./lib/functions";
import { campaignAccess } from "./lib/permissions";
import { draftKindValidator, legacyDraftKindValidator } from "./lib/validators/preferences";
import { appError } from "../src/lib/errors/app-error";
import { DRAFT_MAX_BYTES, DRAFT_SCHEMA_VERSION, utf8Bytes, type DraftKind } from "../src/lib/config/preferences";

/**
 * Unsent drafts on the account (config P2, Q15 b): the character wizard (one per campaign), the custom frame form
 * (one, no campaign) and a guided level-up's unconfirmed picks (one per character, config N4 b). `data` is JSON text
 * of an object, at most `DRAFT_MAX_BYTES`, with its `schemaVersion` (rule 7); the client parses it with zod. Only the
 * caller's own rows are ever read or written. A wizard draft needs view on its campaign (NOT_FOUND otherwise); a
 * level-up draft needs edit on its character, which only the character's owner and the GM (and an edit grant) hold
 * (`permissionFor` through `loadCharacter`: NOT_FOUND without access, FORBIDDEN for another player). Drafts go with
 * their campaign's purge and expire after 90 days of no change (`draftsRetention.expire`).
 */

/** The most legacy drafts one import call looks at (a browser held one per campaign plus the custom frame). */
export const IMPORT_MAX = 100;

const draftValidator = v.object({ schemaVersion: v.number(), data: v.string(), updatedAt: v.number() });

/** What a draft belongs to besides its user and kind. */
type Scope = { campaignId?: Id<"campaigns">; characterId?: Id<"characters"> };

/** The scope arguments every draft function takes (`characterId` added for level-up drafts, a widening). */
const scopeArgs = {
  kind: draftKindValidator,
  campaignId: v.optional(v.id("campaigns")),
  characterId: v.optional(v.id("characters")),
};

/** True when `data` is JSON text of a plain object. */
function isObjectJson(data: string): boolean {
  try {
    const value: unknown = JSON.parse(data);
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * What a draft of `kind` belongs to, after the access check: a wizard draft names a campaign the caller can view
 * (missing → INVALID, no access → NOT_FOUND); a level-up draft names a character the caller edits (missing → INVALID,
 * no access → NOT_FOUND, view only → FORBIDDEN) and is stored with that character's campaign; a custom-frame draft
 * names neither. Any other id given is INVALID.
 */
async function draftScope(ctx: QueryCtx, user: Doc<"users">, kind: DraftKind, args: Scope): Promise<Scope> {
  const { campaignId, characterId } = args;
  if (kind === "customFrame") {
    if (campaignId !== undefined || characterId !== undefined) throw appError("INVALID", "A custom frame draft has no campaign.");
    return {};
  }
  if (kind === "levelUp") {
    if (characterId === undefined || campaignId !== undefined) throw appError("INVALID", "A level-up draft names its character only.");
    const { character } = await loadCharacter(ctx, user, characterId, "edit");
    return { campaignId: character.campaignId, characterId };
  }
  if (campaignId === undefined || characterId !== undefined) throw appError("INVALID", "A character draft needs its campaign.");
  if ((await campaignAccess(ctx, user, campaignId, "view")) === null) throw appError("NOT_FOUND");
  return { campaignId };
}

function ownRow(ctx: QueryCtx, userId: Id<"users">, kind: DraftKind, scope: Scope) {
  if (kind === "levelUp") {
    return ctx.db
      .query("userDrafts")
      .withIndex("by_user_kind_character", (q) => q.eq("userId", userId).eq("kind", kind).eq("characterId", scope.characterId))
      .unique();
  }
  return ctx.db
    .query("userDrafts")
    .withIndex("by_user_kind_campaign", (q) => q.eq("userId", userId).eq("kind", kind).eq("campaignId", scope.campaignId))
    .unique();
}

/** The caller's draft of `kind` (for `campaignId` when a wizard draft, `characterId` when a level-up), or null. */
export const get = userQuery({
  args: scopeArgs,
  returns: v.union(v.null(), draftValidator),
  handler: async (ctx, { kind, ...args }) => {
    const scope = await draftScope(ctx, ctx.user, kind, args);
    const row = await ownRow(ctx, ctx.user._id, kind, scope);
    return row === null ? null : { schemaVersion: row.schemaVersion, data: row.data, updatedAt: row.updatedAt };
  },
});

/** Saves (replaces) the caller's draft. `data` must be JSON text of an object within `DRAFT_MAX_BYTES`, else INVALID. */
export const save = userMutation({
  args: { ...scopeArgs, schemaVersion: v.number(), data: v.string() },
  returns: v.null(),
  handler: async (ctx, { kind, campaignId, characterId, schemaVersion, data }) => {
    const scope = await draftScope(ctx, ctx.user, kind, { campaignId, characterId });
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw appError("INVALID", "Bad draft version.");
    if (utf8Bytes(data) > DRAFT_MAX_BYTES) throw appError("INVALID", "This draft is too large to save.");
    if (!isObjectJson(data)) throw appError("INVALID", "A draft is a JSON object.");
    await upsert(ctx, ctx.user._id, kind, scope, schemaVersion, data);
    return null;
  },
});

async function upsert(ctx: MutationCtx, userId: Id<"users">, kind: DraftKind, scope: Scope, schemaVersion: number, data: string) {
  const now = Date.now();
  const row = await ownRow(ctx, userId, kind, scope);
  if (row === null) await ctx.db.insert("userDrafts", { userId, kind, ...scope, schemaVersion, data, updatedAt: now });
  else await ctx.db.patch("userDrafts", row._id, { schemaVersion, data, updatedAt: now });
}

/**
 * Deletes the caller's draft of `kind` (for `campaignId`, or `characterId` for a level-up), if any. No campaign or
 * character check: it only ever touches the caller's own row and reveals nothing, so a player who left (or lost the
 * character) can still clear theirs.
 */
export const clear = userMutation({
  args: scopeArgs,
  returns: v.null(),
  handler: async (ctx, { kind, campaignId, characterId }) => {
    if (kind === "levelUp" && characterId === undefined) return null;
    const scope: Scope = kind === "levelUp" ? { characterId } : kind === "customFrame" ? {} : { campaignId };
    const row = await ownRow(ctx, ctx.user._id, kind, scope);
    if (row !== null) await ctx.db.delete("userDrafts", row._id);
    return null;
  },
});

/**
 * The one-time move of this browser's old drafts (tracer IMP; `readLegacyPrefs(...).drafts`). Saves each draft the
 * account has none of yet (idempotent), as `DRAFT_SCHEMA_VERSION`. Never fails for a draft: one for a campaign id
 * that is malformed, missing or not visible to the caller, too large or not a JSON object is skipped. Looks at the
 * first `IMPORT_MAX`. Takes the legacy kinds only (a level-up draft never lived in the browser's account storage).
 */
export const importLegacy = userMutation({
  args: {
    drafts: v.array(v.object({ kind: legacyDraftKindValidator, campaignId: v.optional(v.string()), data: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, { drafts }) => {
    for (const draft of drafts.slice(0, IMPORT_MAX)) {
      if (utf8Bytes(draft.data) > DRAFT_MAX_BYTES || !isObjectJson(draft.data)) continue;
      let campaignId: Id<"campaigns"> | undefined;
      if (draft.kind === "characterWizard") {
        const id = draft.campaignId === undefined ? null : ctx.db.normalizeId("campaigns", draft.campaignId);
        if (id === null || (await campaignAccess(ctx, ctx.user, id, "view")) === null) continue;
        campaignId = id;
      }
      if ((await ownRow(ctx, ctx.user._id, draft.kind, { campaignId })) !== null) continue;
      await ctx.db.insert("userDrafts", {
        userId: ctx.user._id,
        kind: draft.kind,
        campaignId,
        schemaVersion: DRAFT_SCHEMA_VERSION,
        data: draft.data,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
