// Druid (CB 30). Hope feature: Evolution, a Beastform without marking a Stress and +1 to a chosen trait
// until you drop out of it: an effect with an End button (plan note 11; no beastform-panel link in D5).
// Class features: Beastform marks a Stress and shows the form as an effect (End = drop out of it);
// Wildtouch is text only.
// DA9 (plan drawer-answers, dcm-bxp.99.19.6, dcm-bxp.99.19.19): the Beastform effect carries no mods (B1: the drawer's
// table owns the form's trait and Evasion); its text names the form as `beastformLabel` (an Evolved form's base, a
// Hybrid's chosen features) so `owned()` holds the right features; a Hybrid marks its additional Stress here.
import { applyResourceDelta, tierForLevel } from "../../characters/index";
import { beastformChoice, beastformLabel, hybridPick, isEvolvedForm, isHybridForm, parseBeastformChoice, type BeastformHolding } from "../../feature-effects/owned";
import { HYBRID } from "../../../frames/extras/beastform";
import { BEASTFORMS } from "../../../srd/beastforms";
import { BEASTFORM_STATS, EVOLVED_FORMS, HYBRID_EXTRA_STRESS, evolvedBases } from "../../../srd/feature-effects/beastforms";
import { TRAIT_IDS, type TraitId } from "../../../srd/types";
import type { ClassFeatures, FeatureMeta } from "../types";
import { HOPE_COST, refuse, withEffect } from "./shared";

// CL9: the SRD leaf module, not the srd barrel.
const getBeastform = (id: string) => BEASTFORMS.find((b) => b.id === id);
const beastformsForTier = (tier: number) => BEASTFORMS.filter((b) => b.tier <= tier);

const isTrait = (value: string | undefined): value is TraitId => TRAIT_IDS.some((t) => t === value);

const TEXT_MAX = 300;

/** The plain forms an Evolved form can upgrade or a Hybrid can draw on (not themselves Evolved or Hybrid). */
const plainForm = (id: string) => !isEvolvedForm(id) && !isHybridForm(id);

/** The Beastform select (the Party sheet's panel): every form of your tier or lower, an Evolved form once per base form. */
function formOptions(tier: number): { value: string; label: string }[] {
  return beastformsForTier(tier).flatMap((b) => {
    if (!isEvolvedForm(b.id)) return [{ value: b.id, label: `${b.name} (tier ${b.tier})` }];
    return evolvedBases(b.id).map((baseId) => ({
      value: beastformChoice({ formId: b.id, baseFormId: baseId }),
      label: `${b.name}: ${getBeastform(baseId)?.name ?? baseId} (tier ${b.tier})`,
    }));
  });
}

/** Refuses a choice that breaks the Evolved or Hybrid rules (CB p.34-35); a plain Hybrid without picks is allowed. */
function checkHolding(holding: BeastformHolding, form: { id: string; name: string }): void {
  if (isEvolvedForm(form.id)) {
    // CB p.34: "Pick a Tier 1 Beastform option"; CB p.35: "Pick a Tier 1 or Tier 2 Beastform option".
    if (!holding.baseFormId || !evolvedBases(form.id).includes(holding.baseFormId)) refuse(`Choose which form ${form.name} upgrades.`);
    return;
  }
  if (holding.baseFormId) refuse("Only an Evolved form upgrades another form.");
  const picks = holding.hybridFeatures ?? [];
  if (picks.length === 0) return;
  const rules = HYBRID[form.id];
  if (!rules) refuse(`${form.name} has no Hybrid features to choose.`);
  // CB p.34: "Choose any two Beastform options from Tiers 1–2. Choose a total of four advantages and two features from
  // those options." CB p.35: three options from Tiers 1-3, three features.
  const found = picks.map(hybridPick);
  const sources = new Set(found.map((p) => p?.form.id));
  if (
    found.some((p) => p === undefined || p.form.tier > rules.maxTier || !plainForm(p.form.id)) ||
    new Set(picks).size !== picks.length ||
    picks.length !== rules.features ||
    sources.size > rules.sources
  ) {
    refuse(`Choose ${rules.features} features from at most ${rules.sources} forms of Tiers 1–${rules.maxTier}.`);
  }
}

/** What the effect text shows of the form's statistics (the drawer's table is the source: BEASTFORM_STATS, EVOLVED_FORMS). */
function statText(holding: BeastformHolding): string {
  const evolved = EVOLVED_FORMS[holding.formId];
  const stats = BEASTFORM_STATS[evolved ? (holding.baseFormId ?? "") : holding.formId];
  if (!stats) return "";
  const trait = stats.traitBonus + (evolved?.trait ?? 0);
  const evasion = stats.evasion + (evolved?.evasion ?? 0);
  const plus = stats.plus + (evolved?.damage ?? 0);
  return `+${evasion} Evasion, +${trait} ${stats.trait}, attack ${stats.trait} ${stats.range} d${stats.sides}${plus ? `+${plus}` : ""} phy`;
}

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
      options: (sheet) => formOptions(tierForLevel(sheet.level)),
    },
  ],
  use: ({ sheet, params }) => {
    // `choice`: `parseBeastformChoice` (a form id, an Evolved form with its base, a Hybrid with its picks); without one
    // the effect is a plain reminder. B1 (user 2026-10-29, dcm-bxp.99.19.19): the effect carries no mods; the drawer's
    // table adds the form's trait and Evasion (`passiveMods`, `derivedDefense`, `derivedTraits`).
    const holding = params.choice ? parseBeastformChoice(params.choice) : null;
    const form = holding ? getBeastform(holding.formId) : undefined;
    if (params.choice && (holding === null || form === undefined)) refuse("Choose a Beastform.");
    if (form && form.tier > tierForLevel(sheet.level)) refuse(`${form.name} is above your tier.`);
    if (holding && form) checkHolding(holding, form);
    const base = "Can't use weapons or cast spells from domain cards; drop out at any time or when you mark your last Hit Point.";
    const stats = holding ? statText(holding) : "";
    const text = holding && form ? `${beastformLabel(holding)}${stats ? `: ${stats}` : ""}. ${base}` : `Transformed. ${base}`;
    // CB p.34 Legendary Hybrid: "To transform into this creature, mark an additional Stress"; CB p.35 Mythic Hybrid: "mark 2
    // additional Stress" (dcm-bxp.99.19.6 (4)). Through Evolution too (no Stress for the Beastform itself, CB p.30).
    const extra = form ? (HYBRID_EXTRA_STRESS[form.id] ?? 0) : 0;
    const paid = extra > 0 ? applyResourceDelta(sheet, "stress", extra) : sheet;
    return {
      sheet: withEffect(paid, { id: "beastform", source: "Beastform", text: text.slice(0, TEXT_MAX), until: "manual" }),
      summary: `marked a Stress for Beastform${holding ? `: ${beastformLabel(holding)}` : ""}${extra > 0 ? `, and ${extra} additional Stress` : ""}`,
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
