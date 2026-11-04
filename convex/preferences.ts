import { v } from "convex/values";

import {
  DICE_VOLUME_MAX,
  DICE_VOLUME_MIN,
  resolvePreferences,
} from "../src/lib/config/preferences";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  campaignMutation,
  campaignQuery,
  userMutation,
  userQuery,
} from "./lib/functions";
import { campaignAccess } from "./lib/permissions";
import { textSizeValidator } from "./lib/validators/preferences";

/**
 * The account's preferences and folded hands (plan config P1, Q15 b; defaults in `src/lib/config/preferences.ts`).
 * Every function acts on the caller's own rows (`ctx.user`, rule 3); no argument names a user.
 */

/** The most folds one legacy import may carry. */
export const LEGACY_FOLDS_MAX = 50;

/** The most fold rows of one user a read scans (one row per folded character, across their campaigns). */
const FOLDS_SCAN_MAX = 500;

const preferencesView = v.object({
  dice3d: v.boolean(),
  diceSound: v.boolean(),
  diceVolume: v.number(),
  reduceMotion: v.boolean(),
  textSize: textSizeValidator,
  spotlightPing: v.boolean(),
  /** True once this account imported a browser's old values (`importLegacy`); the client then skips the import. */
  legacyImported: v.boolean(),
});

/** One preference, changed alone (rule 12: a single-field intent, never the whole row). */
const changeValidator = v.union(
  v.object({ key: v.literal("dice3d"), value: v.boolean() }),
  v.object({ key: v.literal("diceSound"), value: v.boolean() }),
  v.object({ key: v.literal("diceVolume"), value: v.number() }),
  v.object({ key: v.literal("reduceMotion"), value: v.boolean() }),
  v.object({ key: v.literal("textSize"), value: textSizeValidator }),
  v.object({ key: v.literal("spotlightPing"), value: v.boolean() }),
);

const preferencesRow = (ctx: QueryCtx, userId: Id<"users">) =>
  ctx.db
    .query("userPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

type PreferencesPatch = Partial<
  Omit<Doc<"userPreferences">, "_id" | "_creationTime" | "userId">
>;

/** Patches the caller's row, creating it on first write. */
async function writePreferences(
  ctx: MutationCtx,
  userId: Id<"users">,
  row: Doc<"userPreferences"> | null,
  patch: PreferencesPatch,
) {
  const updatedAt = Date.now();
  if (row === null)
    await ctx.db.insert("userPreferences", { userId, ...patch, updatedAt });
  else await ctx.db.patch("userPreferences", row._id, { ...patch, updatedAt });
}

const foldRow = (
  ctx: QueryCtx,
  userId: Id<"users">,
  characterId: Id<"characters">,
) =>
  ctx.db
    .query("handFolds")
    .withIndex("by_user_character", (q) =>
      q.eq("userId", userId).eq("characterId", characterId),
    )
    .unique();

/** The caller's preferences: stored values over the defaults (defaults when no row), plus `legacyImported`. */
export const get = userQuery({
  args: {},
  returns: preferencesView,
  handler: async (ctx) => {
    const row = await preferencesRow(ctx, ctx.user._id);
    return {
      ...resolvePreferences(row),
      legacyImported: row?.legacyImportedAt !== undefined,
    };
  },
});

/** Sets one preference. `diceVolume` must be an integer 0-100 (`SETTING_INVALID` otherwise). */
export const set = userMutation({
  args: { change: changeValidator },
  returns: v.null(),
  handler: async (ctx, { change }) => {
    if (
      change.key === "diceVolume" &&
      (!Number.isInteger(change.value) ||
        change.value < DICE_VOLUME_MIN ||
        change.value > DICE_VOLUME_MAX)
    ) {
      throw appError("SETTING_INVALID");
    }
    const row = await preferencesRow(ctx, ctx.user._id);
    await writePreferences(ctx, ctx.user._id, row, {
      [change.key]: change.value,
    });
    return null;
  },
});

/**
 * Moves one browser's old values to the account, once per account (`legacyImportedAt`; a second call does nothing).
 * Sets only the fields still unset. A fold whose ids are malformed, whose character is not in that campaign, or whose
 * campaign the caller cannot view is skipped, never an error. More than `LEGACY_FOLDS_MAX` folds is `INVALID`.
 */
export const importLegacy = userMutation({
  args: {
    dice3d: v.optional(v.boolean()),
    diceSound: v.optional(v.boolean()),
    folds: v.array(
      v.object({ campaignId: v.string(), characterId: v.string() }),
    ),
  },
  returns: v.object({ imported: v.boolean(), folds: v.number() }),
  handler: async (ctx, { dice3d, diceSound, folds }) => {
    if (folds.length > LEGACY_FOLDS_MAX) throw appError("INVALID");
    const userId = ctx.user._id;
    const row = await preferencesRow(ctx, userId);
    if (row?.legacyImportedAt !== undefined)
      return { imported: false, folds: 0 };

    const patch: PreferencesPatch = { legacyImportedAt: Date.now() };
    if (dice3d !== undefined && row?.dice3d === undefined)
      patch.dice3d = dice3d;
    if (diceSound !== undefined && row?.diceSound === undefined)
      patch.diceSound = diceSound;
    await writePreferences(ctx, userId, row, patch);

    const visible = new Map<Id<"campaigns">, boolean>();
    const done = new Set<Id<"characters">>();
    let added = 0;
    for (const fold of folds) {
      const campaignId = ctx.db.normalizeId("campaigns", fold.campaignId);
      const characterId = ctx.db.normalizeId("characters", fold.characterId);
      if (campaignId === null || characterId === null || done.has(characterId))
        continue;
      done.add(characterId);
      const character = await ctx.db.get("characters", characterId);
      if (character === null || character.campaignId !== campaignId) continue;
      let canView = visible.get(campaignId);
      if (canView === undefined) {
        canView =
          (await campaignAccess(ctx, ctx.user, campaignId, "view")) !== null;
        visible.set(campaignId, canView);
      }
      if (!canView || (await foldRow(ctx, userId, characterId)) !== null)
        continue;
      await ctx.db.insert("handFolds", {
        userId,
        campaignId,
        characterId,
        updatedAt: Date.now(),
      });
      added++;
    }
    return { imported: true, folds: added };
  },
});

/** The ids of the characters whose hand the caller folded in this campaign (their own rows only, bounded). */
export const folds = campaignQuery({
  need: "view",
  args: {},
  returns: v.array(v.id("characters")),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("handFolds")
      .withIndex("by_user_character", (q) => q.eq("userId", ctx.user._id))
      .take(FOLDS_SCAN_MAX);
    return rows
      .filter((row) => row.campaignId === ctx.campaign._id)
      .map((row) => row.characterId);
  },
});

/** Folds or unfolds the caller's view of a character's hand. The character must be in this campaign (`NOT_FOUND`). */
export const setFold = campaignMutation({
  need: "view",
  args: { characterId: v.id("characters"), folded: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { characterId, folded }) => {
    const character = await ctx.db.get("characters", characterId);
    if (character === null || character.campaignId !== ctx.campaign._id)
      throw appError("NOT_FOUND");
    const row = await foldRow(ctx, ctx.user._id, characterId);
    if (folded && row === null) {
      await ctx.db.insert("handFolds", {
        userId: ctx.user._id,
        campaignId: ctx.campaign._id,
        characterId,
        updatedAt: Date.now(),
      });
    } else if (!folded && row !== null) {
      await ctx.db.delete("handFolds", row._id);
    }
    return null;
  },
});
