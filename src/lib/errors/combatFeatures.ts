/**
 * Errors of Hope, class, subclass, ancestry, community, Beastform, transformation and stance features used from the
 * Combat Map sheet drawer (plan sheet-drawer). Contract: see `actionLog.ts`; add this domain's codes here only (tracer
 * SD0). A sheet-drawer tracer that needs a code missing here stops and asks the orchestrator. Messages never name an
 * enemy's HP, Stress, thresholds or Difficulty (U1).
 */
export const combatFeatureMessages = {
  /** A feature the character's sheet does not hold (class, multiclass, subclass rank, heritage, form or stance). */
  FEATURE_NOT_OWNED: "Your character doesn't have that feature.",
  /** A feature whose once-per limit is used up until the next rest, long rest, session or scene (CB p.101; Q3, Q7). */
  FEATURE_EXHAUSTED: "That feature is used up for now.",
  /** Not enough Hope, Stress slots, Favor, Focus, held dice or tokens to pay the feature's cost (CB p.90). */
  FEATURE_COST_UNPAID: "You can't pay that feature's cost right now.",
  /** A passive, out-of-combat or narrative feature used from the map (SD0 classification). */
  FEATURE_NOT_COMBAT: "That feature can't be used in combat.",
  /** A use that targets enemies without a live map (analysis section 5.4). */
  FEATURE_NEEDS_MAP: "That feature needs a live map with its targets on it.",
  /** A use that needs a state the sheet lacks: a held die, a Beastform, an active stance, a companion. */
  FEATURE_STATE_MISSING: "That feature isn't ready: something it needs is missing.",
} as const satisfies Record<string, string>;

export type CombatFeatureErrorCode = keyof typeof combatFeatureMessages;
