import { v, type Infer } from "convex/values";

/**
 * Validators of party rests (D5 T0, CD19). The rules (which moves a rest
 * allows, how many, who may target whom) live in T3's src/lib/domain/rest.
 */

export const restKindValidator = v.union(v.literal("short"), v.literal("long"));

export const restStatusValidator = v.union(v.literal("open"), v.literal("finished"), v.literal("interrupted"));

/**
 * A downtime move (CB 105). Short rest: the first four plus `prepareTogether`;
 * long rest: the "All" moves, Prepare and Work on a Project. `makeAFeast`
 * (Beast Feast, CB 271-279) and `tribute` (Warlock Patron's Pact, HF 14) are
 * frame and class moves T3b and T8c offer.
 */
export const restMoveValidator = v.union(
  v.literal("tendToWounds"),
  v.literal("clearStress"),
  v.literal("repairArmor"),
  v.literal("prepare"),
  v.literal("prepareTogether"),
  v.literal("tendToAllWounds"),
  v.literal("clearAllStress"),
  v.literal("repairAllArmor"),
  v.literal("workOnProject"),
  v.literal("makeAFeast"),
  v.literal("tribute"),
);

/** One chosen move: an ally target for Tend to Wounds or Repair Armor, a countdown for Work on a Project. */
export const restChoiceMoveValidator = v.object({
  move: restMoveValidator,
  targetId: v.optional(v.id("characters")),
  countdownId: v.optional(v.id("countdowns")),
});

export const restFields = {
  campaignId: v.id("campaigns"),
  kind: restKindValidator,
  status: restStatusValidator,
  startedBy: v.id("users"),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  /** The GM started a fourth short rest anyway (decision 17). */
  gmOverride: v.optional(v.boolean()),
  /** The GM's rest Fear roll (1d4, CB 105) and the Fear it gave. */
  fearRoll: v.optional(v.number()),
  fearGained: v.optional(v.number()),
  /** The `actionLog` group of the finished rest, for undo. */
  groupId: v.optional(v.string()),
};

export const restChoiceFields = {
  campaignId: v.id("campaigns"),
  restId: v.id("rests"),
  characterId: v.id("characters"),
  /** Two moves on a core rest (CB 105); frame rules may allow more (T3 enforces the count). */
  moves: v.array(restChoiceMoveValidator),
  updatedBy: v.id("users"),
  updatedAt: v.number(),
};

export type RestKind = Infer<typeof restKindValidator>;
export type RestMove = Infer<typeof restMoveValidator>;
