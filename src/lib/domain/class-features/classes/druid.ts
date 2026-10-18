// Druid (CB 30). Hope feature: Evolution, a Beastform without marking a Stress and +1 to a chosen trait
// until you drop out of it: an effect with an End button (plan note 11; no beastform-panel link in D5).
import { TRAIT_IDS, type TraitId } from "../../../srd/types";
import type { ClassFeatures } from "../types";
import { HOPE_COST, refuse, withEffect } from "./shared";

const isTrait = (value: string | undefined): value is TraitId => TRAIT_IDS.some((t) => t === value);

export const druid: ClassFeatures = {
  classId: "druid",
  hopeFeature: {
    key: "evolution",
    name: "Evolution",
    text: "Take a Beastform without marking a Stress; +1 to one trait until you drop out of it.",
    cost: HOPE_COST,
    automation: "assist",
    target: "self",
    use: ({ sheet, params }) => {
      const trait = params.choice;
      if (!isTrait(trait)) refuse("Choose a trait to raise.");
      return {
        sheet: withEffect(sheet, {
          id: "evolution",
          source: "Evolution",
          text: `Beastform: +1 ${trait} until you drop out of it.`,
          until: "manual",
          mods: { trait: { id: trait, delta: 1 } },
        }),
        summary: `used Evolution: Beastform, +1 ${trait}`,
      };
    },
  },
};
