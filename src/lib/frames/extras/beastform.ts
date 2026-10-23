// Druid Beastform (Core Book pp.31–35): the active form, if any. Marking the
// Stress (or spending 3 Hope for Evolution) is applied to the sheet in D5.

import { z } from "zod";

import { RuleError } from "../../errors/app-error";

import { BEASTFORMS } from "../../srd/beastforms";
import type { Beastform, Feature, Range, TraitId } from "../../srd/types";
import { formatDamage, parseDamage, stepDie, traitIdSchema } from "./common";

/** "Evolved" upgrade forms (pp.34–35): pick a lower-tier form and gain bonuses. */
export const EVOLVED: Record<string, { baseTiers: readonly number[]; damage: number; trait: number; evasion: number; dieSteps: number }> = {
  "legendary-beast": { baseTiers: [1], damage: 6, trait: 1, evasion: 2, dieSteps: 0 },
  "mythic-beast": { baseTiers: [1, 2], damage: 9, trait: 2, evasion: 3, dieSteps: 1 },
};

/** Hybrid forms (pp.34–35): "Choose any two Beastform options from Tiers 1–2. Choose a total of four advantages and two features". */
export const HYBRID: Record<string, { maxTier: number; sources: number; advantages: number; features: number }> = {
  "legendary-hybrid": { maxTier: 2, sources: 2, advantages: 4, features: 2 },
  "mythic-hybrid": { maxTier: 3, sources: 3, advantages: 5, features: 3 },
};

const id = z.string().min(1).max(60);

export const beastformStateSchema = z.object({
  formId: id.nullable(),
  /** The lower-tier form an Evolved form upgrades. */
  baseFormId: id.optional(),
  hybrid: z
    .object({
      sources: z.array(id).max(3),
      advantages: z.array(z.string().min(1).max(60)).max(5),
      features: z.array(z.string().min(1).max(60)).max(3),
    })
    .optional(),
  /** Druid Evolution: "choose one trait to raise by +1 until you drop out of that Beastform". */
  evolutionTrait: traitIdSchema.optional(),
});
export type BeastformState = z.infer<typeof beastformStateSchema>;

export const INITIAL_BEASTFORM: BeastformState = { formId: null };

const formById = (formId: string) => BEASTFORMS.find((b) => b.id === formId);

/** Throws a readable Error when the choice breaks a Beastform rule at this character tier. */
export function validateBeastform(state: BeastformState, tier: number): void {
  if (state.formId === null) {
    if (state.baseFormId || state.hybrid || state.evolutionTrait) throw new RuleError("EXTRA_RULE", "Choose a form first.");
    return;
  }
  const form = formById(state.formId);
  if (!form) throw new RuleError("EXTRA_RULE", "Unknown Beastform.");
  if (form.tier > tier) throw new RuleError("EXTRA_RULE", `${form.name} needs Tier ${form.tier}; you can take forms of your tier or lower.`);

  const evolved = EVOLVED[form.id];
  if (evolved) {
    const base = state.baseFormId ? formById(state.baseFormId) : undefined;
    if (!base || !evolved.baseTiers.includes(base.tier) || EVOLVED[base.id] || HYBRID[base.id]) {
      throw new RuleError("EXTRA_RULE", `${form.name} upgrades a Tier ${evolved.baseTiers.join(" or ")} form; choose which.`);
    }
  } else if (state.baseFormId) {
    throw new RuleError("EXTRA_RULE", "Only an Evolved form upgrades another form.");
  }

  const hybrid = HYBRID[form.id];
  if (hybrid) {
    const h = state.hybrid;
    if (!h) throw new RuleError("EXTRA_RULE", `${form.name} combines ${hybrid.sources} forms; choose them.`);
    const sources = h.sources.map(formById);
    if (
      sources.length !== hybrid.sources ||
      new Set(h.sources).size !== h.sources.length ||
      sources.some((s) => !s || s.tier > hybrid.maxTier || EVOLVED[s.id] || HYBRID[s.id])
    ) {
      throw new RuleError("EXTRA_RULE", `Choose ${hybrid.sources} different forms from Tiers 1–${hybrid.maxTier}.`);
    }
    const advantages = new Set(sources.flatMap((s) => s!.advantages));
    const features = new Set(sources.flatMap((s) => s!.features.map((f) => f.name)));
    if (h.advantages.length !== hybrid.advantages || new Set(h.advantages).size !== h.advantages.length || h.advantages.some((a) => !advantages.has(a))) {
      throw new RuleError("EXTRA_RULE", `Choose ${hybrid.advantages} advantages from those forms.`);
    }
    if (h.features.length !== hybrid.features || new Set(h.features).size !== h.features.length || h.features.some((f) => !features.has(f))) {
      throw new RuleError("EXTRA_RULE", `Choose ${hybrid.features} features from those forms.`);
    }
  } else if (state.hybrid) {
    throw new RuleError("EXTRA_RULE", "Only a Hybrid form combines other forms.");
  }
}

export type ResolvedBeastform = {
  form: Beastform;
  name: string;
  examples: string;
  traitBonus: { trait: TraitId; bonus: number } | null;
  evasionBonus: number;
  attack: { range: Range; trait: TraitId; damage: string } | null;
  advantages: string[];
  features: Feature[];
  evolutionTrait: TraitId | null;
};

/** The active form's statistics with Evolved bonuses and Hybrid choices applied, or null. */
export function resolveBeastform(state: BeastformState): ResolvedBeastform | null {
  if (!state.formId) return null;
  const form = formById(state.formId);
  if (!form) return null;
  const evolutionTrait = state.evolutionTrait ?? null;

  const evolved = EVOLVED[form.id];
  const base = state.baseFormId ? formById(state.baseFormId) : undefined;
  if (evolved && base) {
    const dmg = base.attack ? parseDamage(base.attack.damage) : null;
    return {
      form,
      name: `${form.name}: ${base.name}`,
      examples: base.examples,
      traitBonus: base.traitBonus ? { trait: base.traitBonus.trait, bonus: base.traitBonus.bonus + evolved.trait } : null,
      evasionBonus: (base.evasionBonus ?? 0) + evolved.evasion,
      attack:
        base.attack && dmg
          ? {
              ...base.attack,
              damage: formatDamage({ ...dmg, sides: stepDie(dmg.sides, evolved.dieSteps), bonus: dmg.bonus + evolved.damage }),
            }
          : base.attack,
      advantages: [...base.advantages],
      features: [...base.features, ...form.features],
      evolutionTrait,
    };
  }

  const hybrid = HYBRID[form.id];
  if (hybrid && state.hybrid) {
    const sources = state.hybrid.sources.map(formById).filter((s): s is Beastform => !!s);
    const chosen = new Set(state.hybrid.features);
    return {
      form,
      name: `${form.name} (${sources.map((s) => s.name).join(" + ")})`,
      examples: form.examples,
      traitBonus: form.traitBonus,
      evasionBonus: form.evasionBonus ?? 0,
      attack: form.attack,
      advantages: [...state.hybrid.advantages],
      features: [...form.features, ...sources.flatMap((s) => s.features.filter((f) => chosen.has(f.name)))],
      evolutionTrait,
    };
  }

  return {
    form,
    name: form.name,
    examples: form.examples,
    traitBonus: form.traitBonus,
    evasionBonus: form.evasionBonus ?? 0,
    attack: form.attack,
    advantages: [...form.advantages],
    features: [...form.features],
    evolutionTrait,
  };
}
