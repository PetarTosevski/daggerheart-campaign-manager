// Witch (HF 16). Hope feature: Witch's Charm, when you or an ally fails an action roll, change it into
// a success with Fear. Settled rule: if the roll was with Hope, the Hope it gave is removed and the GM
// gains 1 Fear; a roll already with Fear changes nothing else. The dispatcher loads the latest roll of
// the chosen ally (or the Witch's own without one).
import { applyResourceDelta } from "../../characters/index";
import type { ClassFeatures } from "../types";
import { HOPE_COST, refuse } from "./shared";

export const witch: ClassFeatures = {
  classId: "witch",
  hopeFeature: {
    key: "witchsCharm",
    name: "Witch’s Charm",
    text: "When you or an ally within Far range fails an action roll, change it into a success with Fear.",
    cost: HOPE_COST,
    automation: "auto",
    target: "ally",
    use: ({ sheet, others, roll }) => {
      const ally = others[0];
      const who = ally?.sheet ?? sheet;
      if (roll?.kind !== "action" || (roll.outcome !== "failHope" && roll.outcome !== "failFear")) {
        refuse(`${ally ? `${who.name}’s` : "Your"} latest roll is not a failed action roll.`);
      }
      const withHope = roll.outcome === "failHope";
      const changed = withHope ? applyResourceDelta(who, "hope", -1) : who;
      const summary = `used Witch’s Charm: ${ally ? `${who.name}’s` : "their"} roll succeeds with Fear`;
      const next = { ...roll, outcome: "successFear" as const };
      const fear = withHope ? { fearDelta: 1 } : {};
      if (ally === undefined) return { sheet: changed, roll: next, ...fear, summary };
      return { sheet, others: withHope ? [{ characterId: ally.characterId, sheet: changed }] : [], roll: next, ...fear, summary };
    },
  },
};
