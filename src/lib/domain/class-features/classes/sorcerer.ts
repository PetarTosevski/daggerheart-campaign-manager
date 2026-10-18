// Sorcerer (CB 46). Hope feature: Volatile Magic rerolls chosen damage dice of the caster's latest damage roll.
// The dispatcher loads that roll; "an attack that deals magic damage" is the player's call.
import type { ClassFeatures } from "../types";
import { dieContribution, HOPE_COST, refuse } from "./shared";

export const sorcerer: ClassFeatures = {
  classId: "sorcerer",
  hopeFeature: {
    key: "volatileMagic",
    name: "Volatile Magic",
    text: "Reroll any number of your damage dice on an attack that deals magic damage.",
    cost: HOPE_COST,
    automation: "auto",
    target: "self",
    use: ({ sheet, params, rng, roll }) => {
      if (roll?.kind !== "damage") refuse("Your latest roll is not a damage roll.");
      const indexes = [...new Set(params.dieIndexes ?? [])];
      if (indexes.length === 0) refuse("Choose the damage dice to reroll.");
      if (indexes.some((i) => roll.dice[i]?.role !== "damage" || roll.dice[i]?.dropped)) refuse("Only damage dice can be rerolled.");
      let total = roll.total;
      const dice = roll.dice.map((die, i) => {
        if (!indexes.includes(i)) return die;
        const rerolled = { ...die, value: rng(die.sides) };
        total += dieContribution(rerolled) - dieContribution(die);
        return rerolled;
      });
      return {
        sheet,
        roll: { ...roll, dice, total, manual: false },
        summary: `used Volatile Magic: rerolled ${indexes.length} damage ${indexes.length === 1 ? "die" : "dice"}, ${roll.total} → ${total}`,
      };
    },
  },
};
