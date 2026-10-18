// Druid (CB 30). Hope feature: Evolution, a Beastform without marking a Stress and +1 to a chosen trait
// until you drop out of it: an effect with an End button (plan note 11; no beastform-panel link in D5).
// Class features: Beastform marks a Stress and shows the form as an effect (End = drop out of it);
// Wildtouch is text only.
import { tierForLevel } from "../../characters/index";
import { beastformsForTier, getBeastform } from "../../../srd/index";
import { TRAIT_IDS, type TraitId } from "../../../srd/types";
import type { ClassFeatures, FeatureMeta } from "../types";
import { HOPE_COST, refuse, withEffect } from "./shared";

const isTrait = (value: string | undefined): value is TraitId => TRAIT_IDS.some((t) => t === value);

const TEXT_MAX = 300;

const beastform: FeatureMeta = {
  key: "beastform",
  name: "Beastform",
  text: "Mark a Stress to transform into a creature of your tier or lower. You can't use weapons or cast spells from domain cards while transformed.",
  cost: { stress: 1 },
  automation: "assist",
  target: "self",
  inputs: [
    {
      kind: "select",
      param: "choice",
      label: "Beastform",
      required: false,
      empty: "Reminder only",
      options: (sheet) => beastformsForTier(tierForLevel(sheet.level)).map((b) => ({ value: b.id, label: `${b.name} (tier ${b.tier})` })),
    },
  ],
  use: ({ sheet, params }) => {
    // `choice`: a Beastform id; without one the effect is a plain reminder.
    const form = params.choice ? getBeastform(params.choice) : undefined;
    if (params.choice && form === undefined) refuse("Choose a Beastform.");
    if (form && form.tier > tierForLevel(sheet.level)) refuse(`${form.name} is above your tier.`);
    const base = "Can't use weapons or cast spells from domain cards; drop out at any time or when you mark your last Hit Point.";
    const parts = form
      ? [
          form.evasionBonus ? `+${form.evasionBonus} Evasion` : null,
          form.traitBonus ? `+${form.traitBonus.bonus} ${form.traitBonus.trait}` : null,
          form.attack ? `attack ${form.attack.trait} ${form.attack.range} ${form.attack.damage}` : null,
        ].filter((p): p is string => p !== null)
      : [];
    const text = form ? `${form.name}${parts.length > 0 ? `: ${parts.join(", ")}` : ""}. ${base}` : `Transformed. ${base}`;
    const mods = {
      ...(form?.evasionBonus ? { evasion: form.evasionBonus } : {}),
      ...(form?.traitBonus ? { trait: { id: form.traitBonus.trait, delta: form.traitBonus.bonus } } : {}),
    };
    return {
      sheet: withEffect(sheet, {
        id: "beastform",
        source: "Beastform",
        text: text.slice(0, TEXT_MAX),
        until: "manual",
        ...(Object.keys(mods).length > 0 ? { mods } : {}),
      }),
      summary: `marked a Stress for Beastform${form ? `: ${form.name}` : ""}`,
    };
  },
};

const wildtouch: FeatureMeta = {
  key: "wildtouch",
  name: "Wildtouch",
  text: "At will: harmless, subtle nature effects, such as making a flower grow quickly, a slight gust of wind, or starting a campfire.",
  automation: "text",
  target: "none",
};

export const druid: ClassFeatures = {
  classId: "druid",
  hopeFeature: {
    key: "evolution",
    name: "Evolution",
    text: "Take a Beastform without marking a Stress; +1 to one trait until you drop out of it.",
    cost: HOPE_COST,
    automation: "assist",
    target: "self",
    inputs: [{ kind: "select", param: "choice", label: "Trait +1", required: true, empty: "Choose a trait", options: () => TRAIT_IDS.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })) }],
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
  classActions: [beastform, wildtouch],
};
