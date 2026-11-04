import { v, type Infer } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { userMutation, userQuery } from "./lib/functions";
import { catalogueSortValidator } from "./lib/validators/preferences";
import { appError } from "../src/lib/errors/app-error";
import {
  RANGE_RINGS_MAX,
  UI_STATE_KEYS,
  capRangeRings,
  resolveUiState,
  uiStateValueFor,
  type UiStateKey,
  type UiStateValue,
} from "../src/lib/config/preferences";

/**
 * The caller's UI state on the account (config P2, Q15 b): the Combat Map's Names switch and range circles, the
 * catalogue sort orders and the roll panels' folds. One `userUiState` row per key, so a flip writes one small row and
 * never the preferences row (CD10, rule 6). Defaults and shapes: `src/lib/config/preferences.ts`.
 */

/** The longest token id a range-circle list keeps (Convex ids are 32 characters; room to spare). */
export const TOKEN_ID_MAX = 64;

/** Every key the account can hold, so `get` reads them all in one bounded range. */
const ROWS_TAKE = UI_STATE_KEYS.length * 2;

const uiStateValidator = v.object({
  tokenNames: v.boolean(),
  rangeRings: v.array(v.string()),
  adversarySort: catalogueSortValidator,
  environmentSort: catalogueSortValidator,
  rollFeedCollapsed: v.boolean(),
  gmRollFormCollapsed: v.boolean(),
  freeRollFormOpen: v.boolean(),
});

/** One key and its new value (rule 12: a single-field intent, never the whole state). */
const uiStateChangeValidator = v.union(
  v.object({ key: v.literal("tokenNames"), value: v.boolean() }),
  /** The whole list for this one key: the client sends the new list, at most `RANGE_RINGS_MAX` ids. */
  v.object({ key: v.literal("rangeRings"), value: v.array(v.string()) }),
  v.object({ key: v.literal("adversarySort"), value: catalogueSortValidator }),
  v.object({ key: v.literal("environmentSort"), value: catalogueSortValidator }),
  v.object({ key: v.literal("rollFeedCollapsed"), value: v.boolean() }),
  v.object({ key: v.literal("gmRollFormCollapsed"), value: v.boolean() }),
  v.object({ key: v.literal("freeRollFormOpen"), value: v.boolean() }),
);
export type UiStateChange = Infer<typeof uiStateChangeValidator>;

/** The parsed legacy values (`readLegacyPrefs(...).uiState`): any subset of the keys. */
const legacyUiStateValidator = v.object({
  tokenNames: v.optional(v.boolean()),
  rangeRings: v.optional(v.array(v.string())),
  adversarySort: v.optional(catalogueSortValidator),
  environmentSort: v.optional(catalogueSortValidator),
  rollFeedCollapsed: v.optional(v.boolean()),
  gmRollFormCollapsed: v.optional(v.boolean()),
  freeRollFormOpen: v.optional(v.boolean()),
});

function validTokenId(id: string): boolean {
  return id !== "" && id.length <= TOKEN_ID_MAX;
}

async function rowFor(ctx: MutationCtx, userId: Id<"users">, key: UiStateKey) {
  return ctx.db
    .query("userUiState")
    .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", key))
    .unique();
}

async function writeKey(ctx: MutationCtx, userId: Id<"users">, key: UiStateKey, value: UiStateValue) {
  const now = Date.now();
  const row = await rowFor(ctx, userId, key);
  if (row === null) await ctx.db.insert("userUiState", { userId, key, value, updatedAt: now });
  else await ctx.db.patch("userUiState", row._id, { value, updatedAt: now });
}

/** The caller's UI state: each key's saved value, or its default. */
export const get = userQuery({
  args: {},
  returns: uiStateValidator,
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("userUiState")
      .withIndex("by_user_key", (q) => q.eq("userId", ctx.user._id))
      .take(ROWS_TAKE);
    return resolveUiState(rows);
  },
});

/**
 * Sets one key. Range circles: the new list replaces the old one whole (it is that key's value); more than
 * `RANGE_RINGS_MAX` ids, a repeated id or an empty / overlong id is INVALID.
 */
export const set = userMutation({
  args: { change: uiStateChangeValidator },
  returns: v.null(),
  handler: async (ctx, { change }) => {
    if (change.key === "rangeRings") {
      const ids = change.value;
      if (ids.length > RANGE_RINGS_MAX) throw appError("INVALID", `At most ${RANGE_RINGS_MAX} range circles.`);
      if (!ids.every(validTokenId) || new Set(ids).size !== ids.length) throw appError("INVALID", "Bad token id.");
    }
    await writeKey(ctx, ctx.user._id, change.key, change.value);
    return null;
  },
});

/**
 * The one-time move of this browser's old values (tracer IMP): sets only keys the account has no row for, so a second
 * run, or a run from another browser, changes nothing already saved. Never fails on a value: range circles are
 * cleaned (bad ids dropped, newest `RANGE_RINGS_MAX` kept).
 */
export const importLegacy = userMutation({
  args: { uiState: legacyUiStateValidator },
  returns: v.null(),
  handler: async (ctx, { uiState }) => {
    for (const key of UI_STATE_KEYS) {
      const raw = uiState[key];
      if (raw === undefined) continue;
      const value = key === "rangeRings" ? capRangeRings((raw as string[]).filter(validTokenId)) : uiStateValueFor(key, raw);
      if (value === undefined) continue;
      if ((await rowFor(ctx, ctx.user._id, key)) !== null) continue;
      await ctx.db.insert("userUiState", { userId: ctx.user._id, key, value, updatedAt: Date.now() });
    }
    return null;
  },
});
