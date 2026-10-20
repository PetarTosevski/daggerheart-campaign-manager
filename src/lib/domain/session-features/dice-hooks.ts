// What the session features add to the dice box, through class-features/hooks.ts (`rollOptions`,
// `afterDualityRoll`). Pure: bundled into Convex.
import type { DualityRollResult, FeatureScope, HookRollKind, RollOption, RollPrompt } from "../class-features/types";
import type { CharacterSheet } from "../../validation/characters";
import { EVERYTHING } from "./holders";
import { lunarBonuses } from "./lunar";
import { canStore } from "./slayer";

/** The key of the Waxing moon's auto damage option. */
export const WAXING_MOON_OPTION = "waxingMoon";

/** Waxing moon (HF 17, "+2 to damage rolls"): an auto option on every damage roll, any damage type; none otherwise. */
export function waxingMoonOption(sheet: CharacterSheet, kind: HookRollKind, scope: FeatureScope = EVERYTHING): RollOption[] {
  const bonus = lunarBonuses(sheet, scope).damage;
  if (kind !== "damage" || bonus === 0) return [];
  return [{ key: WAXING_MOON_OPTION, label: `Waxing Moon +${bonus}`, effect: { kind: "modifier", value: bonus }, auto: true }];
}

/** The prompt key (and `featureKey`) of the Slayer choice; F2 answers "store" with `storeSlayerDie`, "hope" with nothing. */
export const SLAYER_STORE_PROMPT = "slayerStore";

/**
 * U2: after an action roll with Hope (critical included, K5), a Slayer holder whose pool is below Proficiency is
 * asked "Take the Hope or store a Slayer Die?". `sheet` is the sheet after the roll's gains.
 */
export function slayerStorePrompt(sheet: CharacterSheet, { roll }: DualityRollResult): RollPrompt[] {
  if (!canStore(sheet, roll.outcome, roll.kind)) return [];
  return [
    {
      key: SLAYER_STORE_PROMPT,
      featureKey: SLAYER_STORE_PROMPT,
      text: "Take the Hope or store a Slayer Die?",
      choices: [
        { key: "hope", label: "Take the Hope" },
        { key: "store", label: "Store a Slayer Die" },
      ],
    },
  ];
}
