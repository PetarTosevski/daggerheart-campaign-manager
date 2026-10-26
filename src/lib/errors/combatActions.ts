/**
 * Errors of combat actions on the Combat Map (plan combat-actions: weapon attacks, domain cards). Contract: see
 * `actionLog.ts`; add this domain's codes here only (tracer CA0). A combat-actions tracer that needs a code missing here
 * stops and asks the orchestrator. Messages never name an enemy's HP, Stress, thresholds or Difficulty (U1).
 */
export const combatActionMessages = {
  /** A target that is not an enemy token linked to a running encounter instance, or not on this map. */
  COMBAT_TARGET_INVALID: "That target can't be attacked right now.",
  /** The attacker's token has no line of sight to a target (Q2, CB p.104). */
  COMBAT_NO_LINE_OF_SIGHT: "You can't see that target from where you stand.",
  /** A card the character owns but has not got in their loadout. */
  CARD_NOT_IN_LOADOUT: "That card isn't in your loadout.",
  /** A card whose once-per limit is used up until the next rest or long rest (CB p.101). */
  CARD_EXHAUSTED: "That card is used up until your next rest.",
  /** An out-of-combat card (social, downtime, level-up) used from the map (CA0 classification). */
  CARD_NOT_COMBAT: "That card can't be used in combat.",
  /** Not enough Hope, Stress slots, tokens or Armor Slots to pay the card's cost (CB p.90). */
  CARD_COST_UNPAID: "You can't pay that card's cost right now.",
  /** A player acting for a character that is not theirs. */
  COMBAT_NOT_YOUR_CHARACTER: "You can only act for your own character.",
} as const satisfies Record<string, string>;

export type CombatActionErrorCode = keyof typeof combatActionMessages;
