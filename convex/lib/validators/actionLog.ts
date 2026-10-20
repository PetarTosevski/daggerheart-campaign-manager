import { v, type Infer } from "convex/values";

import type { RollRecord } from "../../../src/lib/domain/duality";

/**
 * Validators of the action log (D5 T0, CD19). The roll mirrors `RollRecord`
 * in src/lib/domain/duality.ts; the type checks at the bottom fail if they drift.
 */

export const actionKindValidator = v.union(
  v.literal("roll"),
  v.literal("gmRoll"),
  v.literal("feature"),
  v.literal("levelUp"),
  v.literal("rest"),
  v.literal("death"),
  v.literal("wither"),
  v.literal("session"),
  v.literal("import"),
);

/** `public`: every member reads it; `gm`: only the GM (GM free rolls until revealed, decision 2). */
export const visibilityValidator = v.union(v.literal("public"), v.literal("gm"));

export const rolledDieValidator = v.object({
  sides: v.number(),
  value: v.number(),
  role: v.union(
    v.literal("hope"),
    v.literal("fear"),
    v.literal("advantage"),
    v.literal("disadvantage"),
    v.literal("help"),
    v.literal("extra"),
    v.literal("damage"),
  ),
  dropped: v.optional(v.boolean()),
});

export const rollValidator = v.object({
  kind: v.union(v.literal("action"), v.literal("reaction"), v.literal("damage"), v.literal("free")),
  dice: v.array(rolledDieValidator),
  modifier: v.number(),
  total: v.number(),
  difficulty: v.optional(v.number()),
  outcome: v.union(
    v.literal("critical"),
    v.literal("successHope"),
    v.literal("successFear"),
    v.literal("failHope"),
    v.literal("failFear"),
    v.literal("none"),
  ),
  manual: v.boolean(),
});

/** The stored fields of one `actionLog` row (see convex/tables/actionLog.ts). */
export const actionLogFields = {
  campaignId: v.id("campaigns"),
  /** Unset for campaign-wide rows (a GM free roll, the campaign row of a rest or session). */
  characterId: v.optional(v.id("characters")),
  /** Who did it: the roller, the feature's user, the GM who finished a rest. */
  actorId: v.id("users"),
  kind: actionKindValidator,
  visibility: visibilityValidator,
  /** One line for the feed, at most 300 characters (`logAction` trims it). */
  summary: v.string(),
  roll: v.optional(rollValidator),
  /** Rows written by one action (a rest, a tag team, a cross-character feature) share it and undo together. */
  groupId: v.optional(v.string()),
  /** The character's stored sheet before the change, as JSON; undo restores it through `readSheet`. */
  before: v.optional(v.string()),
  /** GM Fear this row gained (positive) or removed (negative); undo reverts it through `revertFear`. */
  fearDelta: v.optional(v.number()),
  undoable: v.boolean(),
  undoneAt: v.optional(v.number()),
  undoneBy: v.optional(v.id("users")),
  /** Set when the GM deletes the row from the feed (`feed.remove`). Display only: undo and "latest roll" checks still see it. */
  removedAt: v.optional(v.number()),
  at: v.number(),
};

export const actionLogRowValidator = v.object({ _id: v.id("actionLog"), _creationTime: v.number(), ...actionLogFields });

export type ActionKind = Infer<typeof actionKindValidator>;
export type Visibility = Infer<typeof visibilityValidator>;
export type StoredRoll = Infer<typeof rollValidator>;

// Drift checks: each type must be assignable to the other.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const rollMatchesDomain: Same<StoredRoll, RollRecord> = true;
void rollMatchesDomain;
