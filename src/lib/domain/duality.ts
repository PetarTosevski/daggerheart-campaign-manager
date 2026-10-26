// Duality Dice (Core Book, "Action Rolls", pp. 94-95). Pure module: bundled into Convex.
//
// Contract (D5 T0) for every tracer that rolls or reads rolls:
// - `dualityOutcome(hope, fear)` names which die won: matching dice are a critical,
//   otherwise the higher die ("rolled with Hope" / "rolled with Fear").
// - `actionOutcome(...)` adds the Difficulty: the stored `RollRecord.outcome`.
// - `RollRecord` is the typed roll every `actionLog` row may carry
//   (convex/lib/validators/actionLog.ts mirrors it and fails typecheck if they drift).
//
// ```ts
// dualityOutcome(7, 7);               // "critical"   (CB 95: matching dice are a critical success)
// dualityOutcome(9, 4);               // "hope"
// actionOutcome(9, 4, 15, 12);        // "successHope"
// actionOutcome(3, 8, 10, 12);        // "failFear"
// actionOutcome(3, 8, 10, undefined); // "successFear" (no Difficulty: the GM rules; only Hope/Fear matters)
// ```

/** Which Duality Die decided the roll. */
export type DualityResult = "critical" | "hope" | "fear";

/**
 * Matching dice are a critical success; otherwise the higher die: Hope means
 * "rolled with Hope", Fear "rolled with Fear" (CB 94-95).
 */
export function dualityOutcome(hope: number, fear: number): DualityResult {
  if (hope === fear) return "critical";
  return hope > fear ? "hope" : "fear";
}

/** The outcome stored on a roll: success or failure against the Difficulty, with Hope or Fear; `none` for rolls without Duality Dice. */
export type RollOutcome = "critical" | "successHope" | "successFear" | "failHope" | "failFear" | "none";

/**
 * The outcome of an action or reaction roll. A critical always succeeds (CB 95).
 * Without a Difficulty (the GM keeps it secret) the roll counts as a success:
 * the GM rules on it, and only Hope or Fear matters to the app.
 */
export function actionOutcome(hope: number, fear: number, total: number, difficulty: number | undefined): RollOutcome {
  const result = dualityOutcome(hope, fear);
  if (result === "critical") return "critical";
  const success = difficulty === undefined || total >= difficulty;
  if (result === "hope") return success ? "successHope" : "failHope";
  return success ? "successFear" : "failFear";
}

export type RollKind = "action" | "reaction" | "damage" | "free";

/** What a die did in the roll. `dropped` marks a die that didn't count (cancelled advantage, the lower Help die). */
export type DieRole = "hope" | "fear" | "advantage" | "disadvantage" | "help" | "extra" | "damage";

export type RolledDie = { sides: number; value: number; role: DieRole; dropped?: boolean };

/** A roll as `actionLog.roll` stores it. `manual` marks physical dice typed in by the player (decision 1). */
export type RollRecord = {
  kind: RollKind;
  dice: RolledDie[];
  modifier: number;
  total: number;
  difficulty?: number;
  outcome: RollOutcome;
  manual: boolean;
};
