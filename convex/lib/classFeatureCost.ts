/**
 * Paying a D5 class feature's cost (`FeatureCost`: Hope, Stress, a held die, a once-per key). Moved unchanged from
 * convex/classFeatures.ts by plan sheet-drawer, tracer SD3 (analysis section 7: "SD3 moves `classFeatures.ts`'s
 * `payCost` into `convex/lib/` unchanged, so both paths pay the same way"); the Party sheet's `classFeatures.use` and the
 * Combat Map drawer's `combatFeatures.useFeature` both pay through it.
 *
 * - A Hope feature costs 3 Hope (CB p.90): NOT_ENOUGH_HOPE below that.
 * - A held die that is not held, or a once-per key already used: CLASS_FEATURE_RULE.
 */
import { applyResourceDelta } from "../../src/lib/domain/characters/index";
import type { FeatureCost } from "../../src/lib/domain/class-features/types";
import { appError } from "../../src/lib/errors/app-error";
import type { CharacterSheet } from "../../src/lib/validation/characters";

/** The sheet with the cost paid, or a refusal. */
export function payCost(sheet: CharacterSheet, cost: FeatureCost | undefined): CharacterSheet {
  if (cost === undefined) return sheet;
  let next = sheet;
  if (cost.hope) {
    if (next.hope < cost.hope) throw appError("NOT_ENOUGH_HOPE", `This costs ${cost.hope} Hope.`);
    next = { ...next, hope: next.hope - cost.hope };
  }
  if (cost.stress) next = applyResourceDelta(next, "stress", cost.stress);
  const { heldDieId, use } = cost;
  if (heldDieId !== undefined) {
    if (!next.heldDice.some((d) => d.id === heldDieId)) throw appError("CLASS_FEATURE_RULE", "That die is not held.");
    next = { ...next, heldDice: next.heldDice.filter((d) => d.id !== heldDieId) };
  }
  if (use !== undefined) {
    if (next.featureUses.some((u) => u.key === use.key)) throw appError("CLASS_FEATURE_RULE", "Already used; it refreshes later.");
    next = { ...next, featureUses: [...next.featureUses, use] };
  }
  return next;
}
