import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { userMutation, userQuery } from "./lib/functions";
import { campaignAccess } from "./lib/permissions";
import { draftKindValidator } from "./lib/validators/preferences";
import { appError } from "../src/lib/errors/app-error";
import { DRAFT_MAX_BYTES, DRAFT_SCHEMA_VERSION, utf8Bytes, type DraftKind } from "../src/lib/config/preferences";

/**
 * Unsent drafts on the account (config P2, Q15 b): the character wizard (one per campaign) and the custom frame form
 * (one, no campaign). `data` is JSON text of an object, at most `DRAFT_MAX_BYTES`, with its `schemaVersion` (rule 7);
 * the client parses it with zod. Only the caller's own rows are ever read or written. A wizard draft needs view on
 * its campaign (NOT_FOUND otherwise); drafts go with their campaign's purge and expire after 90 days of no change
 * (`draftsRetention.expire`).
 */

/** The most legacy drafts one import call looks at (a browser held one per campaign plus the custom frame). */
export const IMPORT_MAX = 100;

const draftValidator = v.object({ schemaVersion: v.number(), data: v.string(), updatedAt: v.number() });

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
 * The campaign a draft of `kind` belongs to: a wizard draft names a campaign the caller can view (missing → INVALID,
 * no access → NOT_FOUND); a custom-frame draft names none (INVALID if it does).
 */
async function draftCampaign(
  ctx: QueryCtx,
  user: Doc<"users">,
  kind: DraftKind,
  campaignId: Id<"campaigns"> | undefined,
): Promise<Id<"campaigns"> | undefined> {
  if (kind === "customFrame") {
    if (campaignId !== undefined) throw appError("INVALID", "A custom frame draft has no campaign.");
    return undefined;
  }
  if (campaignId === undefined) throw appError("INVALID", "A character draft needs its campaign.");
  if ((await campaignAccess(ctx, user, campaignId, "view")) === null) throw appError("NOT_FOUND");
  return campaignId;
}

function ownRow(ctx: QueryCtx, userId: Id<"users">, kind: DraftKind, campaignId: Id<"campaigns"> | undefined) {
  return ctx.db
    .query("userDrafts")
    .withIndex("by_user_kind_campaign", (q) => q.eq("userId", userId).eq("kind", kind).eq("campaignId", campaignId))
    .unique();
}

/** The caller's draft of `kind` (for `campaignId` when a wizard draft), or null. */
export const get = userQuery({
  args: { kind: draftKindValidator, campaignId: v.optional(v.id("campaigns")) },
  returns: v.union(v.null(), draftValidator),
  handler: async (ctx, { kind, campaignId }) => {
    const scope = await draftCampaign(ctx, ctx.user, kind, campaignId);
    const row = await ownRow(ctx, ctx.user._id, kind, scope);
    return row === null ? null : { schemaVersion: row.schemaVersion, data: row.data, updatedAt: row.updatedAt };
  },
});

/** Saves (replaces) the caller's draft. `data` must be JSON text of an object within `DRAFT_MAX_BYTES`, else INVALID. */
export const save = userMutation({
  args: {
    kind: draftKindValidator,
    campaignId: v.optional(v.id("campaigns")),
    schemaVersion: v.number(),
    data: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { kind, campaignId, schemaVersion, data }) => {
    const scope = await draftCampaign(ctx, ctx.user, kind, campaignId);
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw appError("INVALID", "Bad draft version.");
    if (utf8Bytes(data) > DRAFT_MAX_BYTES) throw appError("INVALID", "This draft is too large to save.");
    if (!isObjectJson(data)) throw appError("INVALID", "A draft is a JSON object.");
    await upsert(ctx, ctx.user._id, kind, scope, schemaVersion, data);
    return null;
  },
});

async function upsert(
  ctx: MutationCtx,
  userId: Id<"users">,
  kind: DraftKind,
  campaignId: Id<"campaigns"> | undefined,
  schemaVersion: number,
  data: string,
) {
  const now = Date.now();
  const row = await ownRow(ctx, userId, kind, campaignId);
  if (row === null) await ctx.db.insert("userDrafts", { userId, kind, campaignId, schemaVersion, data, updatedAt: now });
  else await ctx.db.patch("userDrafts", row._id, { schemaVersion, data, updatedAt: now });
}

/**
 * Deletes the caller's draft of `kind` (for `campaignId`), if any. No campaign check: it only ever touches the
 * caller's own row and reveals nothing, so a player who left can still clear theirs.
 */
export const clear = userMutation({
  args: { kind: draftKindValidator, campaignId: v.optional(v.id("campaigns")) },
  returns: v.null(),
  handler: async (ctx, { kind, campaignId }) => {
    const row = await ownRow(ctx, ctx.user._id, kind, kind === "customFrame" ? undefined : campaignId);
    if (row !== null) await ctx.db.delete("userDrafts", row._id);
    return null;
  },
});

/**
 * The one-time move of this browser's old drafts (tracer IMP; `readLegacyPrefs(...).drafts`). Saves each draft the
 * account has none of yet (idempotent), as `DRAFT_SCHEMA_VERSION`. Never fails for a draft: one for a campaign id
 * that is malformed, missing or not visible to the caller, too large or not a JSON object is skipped. Looks at the
 * first `IMPORT_MAX`.
 */
export const importLegacy = userMutation({
  args: {
    drafts: v.array(v.object({ kind: draftKindValidator, campaignId: v.optional(v.string()), data: v.string() })),
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
      if ((await ownRow(ctx, ctx.user._id, draft.kind, campaignId)) !== null) continue;
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
