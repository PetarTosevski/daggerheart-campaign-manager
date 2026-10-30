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
 * (Beast Feast, CB 278), `keepWatch` (The Age of Umbra, CB 289),
 * `haltLycanthropy` (Dark Heart of Andaluria, HF 153) and `tribute` (Warlock
 * Favor, HF 14) are frame and class moves (src/lib/domain/rest/frame-hooks).
 * `martialPreparation` (Call of the Slayer mastery, CB 48; dcm-bxp.63, widened)
 * is the party's move on either rest while a resting PC holds the mastery card.
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
  v.literal("keepWatch"),
  v.literal("haltLycanthropy"),
  v.literal("martialPreparation"),
);

/** One chosen move: an ally target for Tend to Wounds or Repair Armor, a countdown for Work on a Project. */
export const restChoiceMoveValidator = v.object({
  move: restMoveValidator,
  targetId: v.optional(v.id("characters")),
  countdownId: v.optional(v.id("countdowns")),
});

/** The downtime moves that roll a die (1d4 + tier, CB 105); mirrors `DiceMove` (src/lib/domain/rest/feature-moves.ts). */
export const diceMoveValidator = v.union(v.literal("tendToWounds"), v.literal("clearStress"), v.literal("repairArmor"));

/**
 * One Oasis reroll (HF p.27) of a downtime die: the Duneborne holder who pressed, the new roll and the result kept (the
 * higher). `spentFrom` (DA15, widened): the holder whose reroll of the party pool it spent; DA5 rows have none (the
 * holder's own).
 */
export const oasisRerollValidator = v.object({
  holderId: v.id("characters"),
  rolled: v.number(),
  kept: v.number(),
  spentFrom: v.optional(v.id("characters")),
});

/**
 * A die a finished short rest (or an interrupted long one) rolled for a downtime move (DA5): the mover, the move, the
 * ally it targeted, the die, the mover's tier, the first roll, the result the move now uses and each Oasis reroll.
 */
export const downtimeDieValidator = v.object({
  characterId: v.id("characters"),
  move: diceMoveValidator,
  targetId: v.optional(v.id("characters")),
  sides: v.number(),
  bonus: v.number(),
  rolled: v.number(),
  value: v.number(),
  rerolls: v.array(oasisRerollValidator),
});

export const restFields = {
  campaignId: v.id("campaigns"),
  kind: restKindValidator,
  status: restStatusValidator,
  startedBy: v.id("users"),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  /**
   * @deprecated The GM started a fourth short rest anyway (decision 17). No
   * longer written (RF2: a fourth short rest is refused); still read for old
   * rows (Horizon days passed). Narrow once no row carries it.
   */
  gmOverride: v.optional(v.boolean()),
  /** The GM's rest Fear roll (1d4, CB 105) and the Fear it gave. */
  fearRoll: v.optional(v.number()),
  fearGained: v.optional(v.number()),
  /** The `actionLog` group of the finished rest, for undo. */
  groupId: v.optional(v.string()),
  /**
   * DA5 (widened; rows before it have none): the downtime dice the ended rest rolled, in roll order, for Oasis (HF
   * p.27). At most three per resting PC (Celestial Trance), so hard-capped by REST_PARTY_MAX (CD8). Cleared by undo.
   */
  dice: v.optional(v.array(downtimeDieValidator)),
  /** DA5 (widened): the resting PCs who held Oasis when a short rest (or an interrupted long one) ended. Cleared by undo. */
  oasisHolders: v.optional(v.array(v.id("characters"))),
  /**
   * @deprecated DA5 (widened): when the GM closed the ended rest's results panel for everyone. No longer written (DA15:
   * each holder closes their own panel, `oasisClosed`); still read, so a rest closed this way stays closed. Cleared by
   * undo. Narrow once no row carries it.
   */
  resultsClosedAt: v.optional(v.number()),
  /**
   * DA15 (widened): the Oasis holders who closed their own Oasis panel (`rests.closeOasis`). Closing withdraws the
   * holder's unused reroll from the party pool; once every holder closed, the window is over. At most `oasisHolders`.
   * Cleared by undo.
   */
  oasisClosed: v.optional(v.array(v.id("characters"))),
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
export type DiceMove = Infer<typeof diceMoveValidator>;
