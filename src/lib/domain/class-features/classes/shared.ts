// Helpers the class modules share (D5 T8a). Pure: bundled into Convex.

import { RuleError } from "../../../errors/app-error";
import type { CharacterSheet, Effect } from "../../../validation/characters";
import type { DieRole, RolledDie, RollRecord } from "../../duality";
import type { FeatureMeta, FeatureUseResult } from "../types";

/** Every Hope feature costs 3 Hope (CB 27). */
export const HOPE_COST = { hope: 3 } as const;

/** An expected refusal (the dispatcher sends it as CLASS_FEATURE_RULE). */
export function refuse(message: string): never {
  throw new RuleError("CLASS_FEATURE_RULE", message);
}

/** The sheet with `effect` added, replacing an earlier effect with the same id (a feature never stacks with itself). */
export function withEffect(sheet: CharacterSheet, effect: Effect): CharacterSheet {
  return { ...sheet, effects: [...sheet.effects.filter((e) => e.id !== effect.id), effect] };
}

/** An `assist` Hope feature: the dispatcher pays the cost, the sheet is unchanged, the text is the reminder. */
export function assistFeature(key: string, name: string, text: string, target: FeatureMeta["target"] = "none"): FeatureMeta {
  return {
    key,
    name,
    text,
    cost: HOPE_COST,
    automation: "assist",
    target,
    use: ({ sheet }): FeatureUseResult => ({ sheet, summary: `used ${name}` }),
  };
}

/** What a die adds to a roll's total: nothing when dropped, minus its value for disadvantage. */
export function dieContribution(die: RolledDie): number {
  if (die.dropped) return 0;
  return die.role === "disadvantage" ? -die.value : die.value;
}

/** The roll's Hope or Fear die value. */
export function dualityDie(roll: RollRecord, role: Extract<DieRole, "hope" | "fear">): number | undefined {
  return roll.dice.find((d) => d.role === role && !d.dropped)?.value;
}

/**
 * What an action roll's outcome gave (CB 94-95): with Hope +1 Hope, a critical
 * also clears a Stress, with Fear the GM gains 1 Fear. Reaction and damage
 * rolls give nothing (CB 99).
 */
export function rollGains(roll: Pick<RollRecord, "kind" | "outcome">): { hope: number; stress: number; fear: number } {
  if (roll.kind !== "action") return { hope: 0, stress: 0, fear: 0 };
  switch (roll.outcome) {
    case "critical":
      return { hope: 1, stress: -1, fear: 0 };
    case "successHope":
    case "failHope":
      return { hope: 1, stress: 0, fear: 0 };
    case "successFear":
    case "failFear":
      return { hope: 0, stress: 0, fear: 1 };
    case "none":
      return { hope: 0, stress: 0, fear: 0 };
  }
}

/** A failed action or reaction roll (CB 95). */
export function isFailure(roll: RollRecord): boolean {
  return roll.outcome === "failHope" || roll.outcome === "failFear";
}
