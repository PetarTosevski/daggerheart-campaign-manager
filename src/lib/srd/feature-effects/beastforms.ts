// Feature effects of the Beastforms, their attacks included (plan sheet-drawer, tracer FE-beastforms, Q10 (a)).
// Pure data: no framework imports, relative imports only (bundled into Convex). Each entry quotes its feature with the
// printed page (CB = Core Book) and uses only the vocabulary of src/lib/domain/card-effects/types.ts; a gap is a
// `manual` step plus a bead. Readings, manual steps and questions: docs/tasks/TASK-SD-FE-beastforms.md.
//
// Book rules this table follows:
// - CB p.30, Beastform: "While transformed, you can't use weapons or cast spells from domain cards, but you can still use
//   other features or abilities you have access to. … you gain the Beastform's features, add their Evasion bonus to your
//   Evasion, and use the trait specified in their statistics for your attack. … If you mark your last Hit Point, you
//   automatically drop out of this form."
// - CB p.32, Beastform Options: "Character Trait: While transformed, you gain a bonus to the listed trait. … Attack Rolls:
//   When you make an attack while transformed, you use the creature's listed range, trait, and damage dice, but you use
//   your Proficiency. … Evasion: While transformed, you add the creature's Evasion bonus to your normal Evasion. …
//   Advantages: … When you make an action or reaction roll related to one of the verbs listed for that creature
//   category, you gain advantage on that roll."
// - CB p.96, Attack Rolls: "If you succeed, make a damage roll to determine how much damage the target takes." So a
//   feature that says "make an attack" deals the form's damage on a success unless it names other damage.
//
// Shape:
// - `beastform:<form>:attack` (`beastformAttackId`): use `main`, the form's attack (a roll of the form's trait against the
//   target's Difficulty, the form's range, damage dice x Proficiency, physical); use `form`, the passive statistics
//   (trait and Evasion bonus, "can't use weapons or cast spells", advantage on attack rolls for an "attack" verb); use
//   `advantage`, a rider for rolls related to the other verbs (the player confirms, Q13). The Evolved forms (Legendary
//   Beast, Mythic Beast) have one attack use per base form (use id = the base form id) with the Evolved damage applied.
// - One entry per Beastform feature classified combat or passive (./classification.ts); the eight narrative ones
//   (Aquatic, Carrier, Massive Stride) have none.
// - Every use requires the Beastform (`inBeastform`): the features are held only while transformed (owned(), SD1).

import type { CardUse, DieSides, EndEvent, Mod, NumberSource, Requirement, Step, TargetSpec } from "../../domain/card-effects/types";
import { beastformAttackId, featureId } from "../../domain/feature-effects/ids";
import type { FeatureEffect } from "../../domain/feature-effects/types";
import type { TraitId } from "../types";

// ---------------------------------------------------------------- the forms' statistics (CB p.32-35)

/** A form's printed statistics line. `line` is quoted from the book; the numbers are its reading. */
export interface BeastformStats {
  page: number;
  line: string;
  trait: TraitId;
  traitBonus: number;
  evasion: number;
  range: "melee" | "veryClose";
  sides: DieSides;
  plus: number;
  advantages: readonly string[];
}

const s = (page: number, line: string, trait: TraitId, traitBonus: number, evasion: number, range: BeastformStats["range"], sides: DieSides, plus: number, advantages: readonly string[]): BeastformStats => ({
  page,
  line,
  trait,
  traitBonus,
  evasion,
  range,
  sides,
  plus,
  advantages,
});

/** Every form with its own statistics. The Evolved forms (Legendary Beast, Mythic Beast) print none: they upgrade a base form. */
export const BEASTFORM_STATS: Readonly<Record<string, BeastformStats>> = {
  // Tier 1, CB p.32
  "agile-scout": s(32, "Agility +1 | Evasion +2 Melee Agility d4 phy. Gain advantage on: deceive, locate, sneak", "agility", 1, 2, "melee", 4, 0, ["deceive", "locate", "sneak"]),
  "household-friend": s(32, "Instinct +1 | Evasion +2 Melee Instinct d6 phy. Gain advantage on: climb, locate, protect", "instinct", 1, 2, "melee", 6, 0, ["climb", "locate", "protect"]),
  "nimble-grazer": s(32, "Agility +1 | Evasion +3 Melee Agility d6 phy. Gain advantage on: leap, sneak, sprint", "agility", 1, 3, "melee", 6, 0, ["leap", "sneak", "sprint"]),
  "pack-predator": s(32, "Strength +2 | Evasion +1 Melee Strength d8+2 phy. Gain advantage on: attack, sprint, track", "strength", 2, 1, "melee", 8, 2, ["attack", "sprint", "track"]),
  "aquatic-scout": s(32, "Agility +1 | Evasion +2 Melee Agility d4 phy. Gain advantage on: navigate, sneak, swim", "agility", 1, 2, "melee", 4, 0, ["navigate", "sneak", "swim"]),
  "stalking-arachnid": s(32, "Finesse +1 | Evasion +2 Melee Finesse d6+1 phy. Gain advantage on: attack, climb, sneak", "finesse", 1, 2, "melee", 6, 1, ["attack", "climb", "sneak"]),
  // Tier 2, CB p.33
  "armored-sentry": s(33, "Strength +1 | Evasion +1 Melee Strength d8+2 phy. Gain advantage on: dig, locate, protect", "strength", 1, 1, "melee", 8, 2, ["dig", "locate", "protect"]),
  "powerful-beast": s(33, "Strength +3 | Evasion +1 Melee Strength d10+4 phy. Gain advantage on: navigate, protect, scare", "strength", 3, 1, "melee", 10, 4, ["navigate", "protect", "scare"]),
  "mighty-strider": s(33, "Agility +1 | Evasion +2 Melee Agility d8+1 phy. Gain advantage on: leap, navigate, sprint", "agility", 1, 2, "melee", 8, 1, ["leap", "navigate", "sprint"]),
  "striking-serpent": s(33, "Finesse +1 | Evasion +2 Very Close Finesse d8+4 phy. Gain advantage on: climb, deceive, sprint", "finesse", 1, 2, "veryClose", 8, 4, ["climb", "deceive", "sprint"]),
  "pouncing-predator": s(33, "Instinct +1 | Evasion +3 Melee Instinct d8+6 phy. Gain advantage on: attack, climb, sneak", "instinct", 1, 3, "melee", 8, 6, ["attack", "climb", "sneak"]),
  "winged-beast": s(33, "Finesse +1 | Evasion +3 Melee Finesse d4+2 phy. Gain advantage on: deceive, locate, scare", "finesse", 1, 3, "melee", 4, 2, ["deceive", "locate", "scare"]),
  // Tier 3, CB p.34
  "great-predator": s(34, "Strength +2 | Evasion +2 Melee Strength d12+8 phy. Gain advantage on: attack, sneak, sprint", "strength", 2, 2, "melee", 12, 8, ["attack", "sneak", "sprint"]),
  "mighty-lizard": s(34, "Instinct +2 | Evasion +1 Melee Instinct d10+7 phy. Gain advantage on: attack, sneak, track", "instinct", 2, 1, "melee", 10, 7, ["attack", "sneak", "track"]),
  "great-winged-beast": s(34, "Finesse +2 | Evasion +3 Melee Finesse d8+6 phy. Gain advantage on: deceive, distract, locate", "finesse", 2, 3, "melee", 8, 6, ["deceive", "distract", "locate"]),
  "aquatic-predator": s(34, "Agility +2 | Evasion +4 Melee Agility d10+6 phy. Gain advantage on: attack, swim, track", "agility", 2, 4, "melee", 10, 6, ["attack", "swim", "track"]),
  "legendary-hybrid": s(34, "Strength +2 | Evasion +3 Melee Strength d10+8 phy (advantages: four chosen from its two forms)", "strength", 2, 3, "melee", 10, 8, []),
  // Tier 4, CB p.35
  "massive-behemoth": s(35, "Strength +3 | Evasion +1 Melee Strength d12+12 phy. Gain advantage on: locate, protect, scare, sprint", "strength", 3, 1, "melee", 12, 12, ["locate", "protect", "scare", "sprint"]),
  "terrible-lizard": s(35, "Strength +3 | Evasion +2 Melee Strength d12+10 phy. Gain advantage on: attack, deceive, scare, track", "strength", 3, 2, "melee", 12, 10, ["attack", "deceive", "scare", "track"]),
  "mythic-aerial-hunter": s(35, "Finesse +3 | Evasion +4 Melee Finesse d10+11 phy. Gain advantage on: attack, deceive, locate, navigate", "finesse", 3, 4, "melee", 10, 11, ["attack", "deceive", "locate", "navigate"]),
  "epic-aquatic-beast": s(35, "Agility +3 | Evasion +3 Melee Agility d10+10 phy. Gain advantage on: locate, protect, scare, track", "agility", 3, 3, "melee", 10, 10, ["locate", "protect", "scare", "track"]),
  "mythic-hybrid": s(35, "Strength +3 | Evasion +2 Strength Melee d12+10 phy (advantages: five chosen from its three forms)", "strength", 3, 2, "melee", 12, 10, []),
};

/**
 * The Evolved forms (CB p.34 Legendary Beast, p.35 Mythic Beast): "Pick a Tier 1 [or Tier 2] Beastform option and become a
 * larger, more powerful version of that creature. While you're in this form, you retain all traits and features from the
 * original form and gain the following bonuses: • A +6 [+9] bonus to damage rolls • A +1 [+2] bonus to the trait used by
 * this form • A +2 [+3] bonus to Evasion [• Your damage die increases by one size (d6 becomes d8, d8 becomes d10, etc.)]"
 */
export const EVOLVED_FORMS: Readonly<Record<string, { page: number; baseTiers: readonly number[]; damage: number; trait: number; evasion: number; dieSteps: number }>> = {
  "legendary-beast": { page: 34, baseTiers: [1], damage: 6, trait: 1, evasion: 2, dieSteps: 0 },
  "mythic-beast": { page: 35, baseTiers: [1, 2], damage: 9, trait: 2, evasion: 3, dieSteps: 1 },
};

const TIER_OF: Readonly<Record<string, number>> = Object.fromEntries(Object.entries(BEASTFORM_STATS).map(([id, st]) => [id, st.page - 31]));

/** The base forms an Evolved form can upgrade, in book order (Hybrids are not on the Tier 1-2 lists). */
export function evolvedBases(formId: string): string[] {
  const evolved = EVOLVED_FORMS[formId];
  if (!evolved) return [];
  return Object.keys(BEASTFORM_STATS).filter((id) => evolved.baseTiers.includes(TIER_OF[id] ?? 0));
}

/**
 * The extra Stress a Hybrid form costs to take (CB p.34 Legendary Hybrid: "To transform into this creature, mark an
 * additional Stress"; CB p.35 Mythic Hybrid: "mark 2 additional Stress"). The transformation itself is the Beastform class
 * feature (D5 `beastform`, FE-druid-sorcerer), which charges 1 Stress; the integrator adds these (bead in the task doc).
 */
export const HYBRID_EXTRA_STRESS: Readonly<Record<string, number>> = { "legendary-hybrid": 1, "mythic-hybrid": 2 };

/** The forms with "Fragile" (CB p.32: "When you take Major or greater damage, you drop out of Beastform"). */
export const FRAGILE_FORMS: readonly string[] = ["agile-scout", "aquatic-scout", "household-friend", "nimble-grazer"];

/**
 * The events that end a Beastform (NV5): every form on the last Hit Point (CB p.30: "If you mark your last Hit Point, you
 * automatically drop out of this form"), a Fragile form also on Major or greater damage (CB p.32). The Beastform sheet
 * effect carries these as `endsOn`; the engine watches them (SD4/SD8).
 */
export function beastformEndsOn(formId: string): EndEvent[] {
  return FRAGILE_FORMS.includes(formId) ? ["lastHp", "majorDamage"] : ["lastHp"];
}

// ---------------------------------------------------------------- helpers

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const proficiency: NumberSource = { kind: "proficiency" };
const d = (sides: DieSides, count: NumberSource = fixed(1)): NumberSource => ({ kind: "dice", dice: { count, sides } });
const hope = (n: number) => ({ kind: "hope" as const, amount: fixed(n) });
const stress = (n: number) => ({ kind: "stress" as const, amount: fixed(n) });

/** Every use needs the Beastform (CB p.30: "you gain the Beastform's features" while transformed). */
const IN_BEASTFORM: Requirement = { kind: "situation", text: "While you're in Beastform", check: { kind: "inBeastform" } };
const situation = (text: string): Requirement => ({ kind: "situation", text });

const VULNERABLE = { kind: "standard", condition: "vulnerable" } as const;
const RESTRAINED = { kind: "standard", condition: "restrained" } as const;
/** CB p.32-33: "A Poisoned creature takes 1d10 direct physical damage each time they act" (the per-act damage is the GM's; bead). */
const POISONED = { kind: "tag", tag: "Poisoned" } as const;
const POISON_TEXT = "Poisoned: the creature takes 1d10 direct physical damage each time they act (roll it when they act).";

const enemy = (range: TargetSpec["range"], count: TargetSpec["count"] = { kind: "one" }, extra: Partial<TargetSpec> = {}): TargetSpec => ({ side: "enemy", range, count, ...extra });

/** An attack roll with the form's trait against each target's Difficulty (CB p.32). */
const formRoll = (trait: TraitId) => ({ kind: "trait" as const, trait, difficulty: { kind: "target" as const } });

/** "d8+2 physical damage using your Proficiency" (`profDelta`: "a +2 bonus to your Proficiency for this attack"). */
const physical = (sides: DieSides, plus: number, profDelta = 0): Step => ({
  kind: "damage",
  to: "targets",
  when: ["hit"],
  roll: {
    kind: "dice",
    dice: { count: profDelta === 0 ? proficiency : { kind: "sum", of: [proficiency, fixed(profDelta)] }, sides, ...(plus ? { plus: fixed(plus) } : {}) },
  },
  type: "physical",
});

const temporarily = (condition: typeof VULNERABLE | typeof RESTRAINED | typeof POISONED): Step => ({ kind: "condition", to: "targets", when: ["hit"], condition, duration: "temporary" });

const formUse = (u: Omit<CardUse, "requires"> & { requires?: readonly Requirement[] }): CardUse => ({ ...u, requires: [IN_BEASTFORM, ...(u.requires ?? [])] });

const entry = (owner: string, name: string, uses: readonly CardUse[]): FeatureEffect => ({ featureId: featureId("beastform", owner, name), source: "beastform", owner, uses });

/** A rider on a successful attack against a target within Melee range (the form's attack range is its weapon range). */
const onMeleeSuccess = { kind: "whenYouAttack", result: "success", weaponRange: "melee" } as const;
const onSuccess = { kind: "whenYouAttack", result: "success" } as const;

/** A damage die one size up (CB p.35: "d6 becomes d8, d8 becomes d10, etc."); d12 stays d12. */
function stepUp(sides: DieSides, steps: number): DieSides {
  const ladder: readonly DieSides[] = [4, 6, 8, 10, 12];
  const i = ladder.indexOf(sides);
  return i < 0 ? sides : ladder[Math.min(ladder.length - 1, i + steps)]!;
}

const label = (id: string) =>
  id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

// ---------------------------------------------------------------- attack entries

/** The form's attack: its trait against the target, its range, its dice x Proficiency (CB p.32). */
function attackUse(id: string, name: string, st: Pick<BeastformStats, "trait" | "range" | "sides" | "plus">, note?: string): CardUse {
  return formUse({
    id,
    name,
    activation: { kind: "action" },
    roll: formRoll(st.trait),
    targets: enemy(st.range),
    steps: [{ ...physical(st.sides, st.plus), ...(note ? { note } : {}) }],
  });
}

/** The form's passive statistics (CB p.30, p.32) and its advantages. */
function statUses(formId: string, st: BeastformStats): CardUse[] {
  const mods: Mod[] = [
    { kind: "trait", trait: st.trait, delta: fixed(st.traitBonus) },
    { kind: "stat", stat: "evasion", delta: fixed(st.evasion) },
    { kind: "flag", flag: "noWeaponsOrSpells" },
  ];
  // "attack" among the verbs: every attack roll is related to it (CB p.32, Advantages).
  if (st.advantages.includes("attack")) mods.push({ kind: "advantage", on: "attack" });
  const verbs = st.advantages.filter((v) => v !== "attack");
  const hybrid = HYBRID_EXTRA_STRESS[formId] !== undefined;
  const advantageText = hybrid
    ? "The roll is related to one of the advantages you chose for this form"
    : `The roll is related to one of these: ${verbs.join(", ")}`;
  return [
    formUse({ id: "form", name: `${label(formId)} (statistics)`, activation: { kind: "passive" }, mods, steps: [] }),
    formUse({
      id: "advantage",
      name: `${label(formId)} (advantage)`,
      activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "any" } },
      requires: [situation(advantageText)],
      steps: [{ kind: "modifyRoll", to: "self", change: { kind: "advantage" }, note: "Advantage on this roll (CB p.32)" }],
    }),
  ];
}

function attackEntry(formId: string): FeatureEffect {
  const evolved = EVOLVED_FORMS[formId];
  if (evolved) {
    const uses = evolvedBases(formId).map((baseId) => {
      const base = BEASTFORM_STATS[baseId]!;
      const sides = stepUp(base.sides, evolved.dieSteps);
      return attackUse(baseId, `${label(formId)}: ${label(baseId)} attack`, { trait: base.trait, range: base.range, sides, plus: base.plus + evolved.damage }, `d${sides}+${base.plus + evolved.damage} physical damage using your Proficiency`);
    });
    return { featureId: beastformAttackId(formId), source: "beastform", owner: formId, uses };
  }
  const st = BEASTFORM_STATS[formId]!;
  return {
    featureId: beastformAttackId(formId),
    source: "beastform",
    owner: formId,
    uses: [attackUse("main", `${label(formId)} attack`, st), ...statUses(formId, st)],
  };
}

/** Book order: Tier 1 (CB p.32), Tier 2 (p.33), Tier 3 (p.34), Tier 4 (p.35). */
export const BEASTFORM_IDS: readonly string[] = [
  "agile-scout",
  "aquatic-scout",
  "household-friend",
  "nimble-grazer",
  "pack-predator",
  "stalking-arachnid",
  "armored-sentry",
  "mighty-strider",
  "pouncing-predator",
  "powerful-beast",
  "striking-serpent",
  "winged-beast",
  "aquatic-predator",
  "great-predator",
  "great-winged-beast",
  "legendary-beast",
  "legendary-hybrid",
  "mighty-lizard",
  "epic-aquatic-beast",
  "massive-behemoth",
  "mythic-aerial-hunter",
  "mythic-beast",
  "mythic-hybrid",
  "terrible-lizard",
];

const ATTACKS: readonly FeatureEffect[] = BEASTFORM_IDS.map(attackEntry);

// ---------------------------------------------------------------- feature entries

// Fragile (CB p.32, Agile Scout, Aquatic Scout, Household Friend, Nimble Grazer): "When you take Major or greater damage,
// you drop out of Beastform." Two automatic uses, one per severity ("Major or greater"); the drop-out itself is the
// Beastform effect's `endsOn` (`beastformEndsOn`), shown here as the feed line.
const fragile = (formId: string): FeatureEffect =>
  entry(
    formId,
    "Fragile",
    (["major", "severe"] as const).map((severity) =>
      formUse({
        id: severity === "major" ? "main" : "severe",
        name: `Fragile (${severity === "major" ? "Major" : "Severe"} damage)`,
        activation: { kind: "auto", trigger: { kind: "whenYouTakeDamage", severity } },
        steps: [{ kind: "manual", to: "self", text: "Fragile: you took Major or greater damage and drop out of Beastform." }],
      }),
    ),
  );

// Bird's-Eye View (CB p.33 Winged Beast, p.34 Great Winged Beast): "You can fly at will. Once per rest while you are
// airborne, you can ask the GM a question about the scene below you without needing to roll. The first time a character
// makes a roll to act on this information, they gain advantage on the roll." Flying is the drawer's toggle (Q16); the
// question is the GM's answer (text).
const birdsEyeView = (formId: string): FeatureEffect =>
  entry(formId, "Bird’s-Eye View", [
    formUse({ id: "main", name: "Bird’s-Eye View (fly at will)", activation: { kind: "passive" }, mods: [], steps: [] }),
    formUse({
      id: "question",
      name: "Bird’s-Eye View (ask the GM)",
      activation: { kind: "action" },
      requires: [{ kind: "situation", text: "While you are airborne", check: { kind: "flying" } }],
      limit: { per: "rest" },
      steps: [
        {
          kind: "manual",
          to: "self",
          text: "Ask the GM a question about the scene below you without rolling. The first time a character makes a roll to act on this information, they gain advantage on the roll.",
        },
      ],
    }),
  ]);

/** "You gain a +N bonus to your damage thresholds" (Thick Hide, Physical Defense, Undaunted) or a penalty (Hollow Bones). */
const thresholds = (formId: string, name: string, delta: number): FeatureEffect =>
  entry(formId, name, [
    formUse({
      id: "main",
      name,
      activation: { kind: "passive" },
      mods: [
        { kind: "stat", stat: "majorThreshold", delta: fixed(delta) },
        { kind: "stat", stat: "severeThreshold", delta: fixed(delta) },
      ],
      steps: [],
    }),
  ]);

/** Vicious Maul (CB p.34): a Hope on a successful attack for Vulnerable and +1 Proficiency on this attack. */
const viciousMaul = (formId: string, temporary: boolean): FeatureEffect =>
  entry(formId, "Vicious Maul", [
    formUse({
      id: "main",
      name: "Vicious Maul",
      activation: { kind: "rider", trigger: onSuccess },
      costs: [hope(1)],
      steps: [
        temporary
          ? temporarily(VULNERABLE)
          : // Aquatic Predator prints "make them Vulnerable" without "temporarily" and no end (question Q-FB2).
            { kind: "condition", to: "targets", when: ["hit"], condition: VULNERABLE, duration: "manual", endsWhen: "No end is printed (CB p.34); the GM clears it" },
        { kind: "modifyDamage", to: "targets", change: { kind: "proficiency", delta: 1 }, note: "+1 Proficiency for this attack" },
      ],
    }),
  ]);

/** Evolved (CB p.34, p.35): per base form, "+N to the trait used by this form" and "+N to Evasion" (damage: the attack entry). */
const evolvedEntry = (formId: string): FeatureEffect => {
  const evolved = EVOLVED_FORMS[formId]!;
  return entry(
    formId,
    "Evolved",
    evolvedBases(formId).map((baseId) =>
      formUse({
        id: baseId,
        name: `Evolved: ${label(baseId)}`,
        activation: { kind: "passive" },
        mods: [
          { kind: "trait", trait: BEASTFORM_STATS[baseId]!.trait, delta: fixed(evolved.trait) },
          { kind: "stat", stat: "evasion", delta: fixed(evolved.evasion) },
        ],
        steps: [],
      }),
    ),
  );
};

// Hybrid Features (CB p.34 Legendary Hybrid, p.35 Mythic Hybrid): "To transform into this creature, mark an additional
// Stress [2 additional Stress]. Choose any two [three] Beastform options from Tiers 1–2 [1–3]. Choose a total of four
// [five] advantages and two [three] features from those options." The extra Stress is paid at the transformation
// (`HYBRID_EXTRA_STRESS`); the chosen features are their own entries, held through the Beastform state (beads).
const hybridEntry = (formId: string): FeatureEffect =>
  entry(formId, "Hybrid Features", [formUse({ id: "main", name: "Hybrid Features", activation: { kind: "passive" }, mods: [], steps: [] })]);

const FEATURES: readonly FeatureEffect[] = [
  // ---- Tier 1 (CB p.32)
  // Agile (Agile Scout): "Your movement is silent, and you can spend a Hope to move up to Far range without rolling."
  entry("agile-scout", "Agile", [
    formUse({
      id: "main",
      name: "Agile",
      activation: { kind: "action" },
      costs: [hope(1)],
      steps: [{ kind: "move", to: "self", mode: "move", range: "far", relativeTo: "self", note: "Move up to Far range without rolling (your movement is silent)" }],
    }),
  ]),
  fragile("agile-scout"),
  fragile("aquatic-scout"),
  // Companion (Household Friend): "When you Help an Ally, you can roll a d8 as your advantage die."
  entry("household-friend", "Companion", [
    formUse({ id: "main", name: "Companion", activation: { kind: "passive" }, mods: [{ kind: "set", stat: "helpDie", to: fixed(8) }], steps: [] }),
  ]),
  fragile("household-friend"),
  // Elusive Prey (Nimble Grazer): "When an attack roll against you would succeed, you can mark a Stress and roll a d4. Add
  // the result to your Evasion against this attack."
  entry("nimble-grazer", "Elusive Prey", [
    formUse({
      id: "main",
      name: "Elusive Prey",
      activation: { kind: "reaction", trigger: { kind: "whenAttacked", stage: "succeeded" } },
      costs: [stress(1)],
      steps: [{ kind: "modifyRoll", to: "self", change: { kind: "evasion", amount: d(4) }, note: "+d4 to your Evasion against this attack" }],
    }),
  ]),
  fragile("nimble-grazer"),
  // Hobbling Strike (Pack Predator): "When you succeed on an attack against a target within Melee range, you can mark a
  // Stress to make the target temporarily Vulnerable."
  entry("pack-predator", "Hobbling Strike", [
    formUse({ id: "main", name: "Hobbling Strike", activation: { kind: "rider", trigger: onMeleeSuccess }, costs: [stress(1)], steps: [temporarily(VULNERABLE)] }),
  ]),
  // Pack Hunting (Pack Predator): "When you succeed on an attack against the same target as an ally who acts immediately
  // before you, add a d8 to your damage roll." The engine does not track who acted last: the player confirms (Q13).
  entry("pack-predator", "Pack Hunting", [
    formUse({
      id: "main",
      name: "Pack Hunting",
      activation: { kind: "rider", trigger: onSuccess },
      requires: [situation("An ally who acted immediately before you attacked the same target")],
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: d(8) }, note: "+d8 to your damage roll" }],
    }),
  ]),
  // Venomous Bite (Stalking Arachnid): "When you succeed on an attack against a target within Melee range, the target
  // becomes temporarily Poisoned. A Poisoned creature takes 1d10 direct physical damage each time they act."
  entry("stalking-arachnid", "Venomous Bite", [
    formUse({
      id: "main",
      name: "Venomous Bite",
      activation: { kind: "auto", trigger: onMeleeSuccess },
      steps: [temporarily(POISONED), { kind: "manual", to: "targets", text: POISON_TEXT }],
    }),
  ]),
  // Webslinger (Stalking Arachnid): "You can create a strong web material useful for both adventuring and battle. The web
  // is resilient enough to support one creature. You can temporarily Restrain a target within Close range by succeeding
  // on a Finesse Roll against them." The web's other uses are text.
  entry("stalking-arachnid", "Webslinger", [
    formUse({
      id: "main",
      name: "Webslinger",
      activation: { kind: "action" },
      roll: { kind: "trait", trait: "finesse", difficulty: { kind: "target" } },
      targets: enemy("close"),
      steps: [temporarily(RESTRAINED)],
    }),
  ]),

  // ---- Tier 2 (CB p.33)
  // Armored Shell (Armored Sentry): "Your hardened exterior gives you resistance to physical damage. Additionally, mark an
  // Armor Slot to retract into your shell. While in your shell, physical damage is reduced by a number equal to your Armor
  // Score (after applying resistance), but you can't perform other actions without leaving this form."
  entry("armored-sentry", "Armored Shell", [
    formUse({ id: "main", name: "Armored Shell", activation: { kind: "passive" }, mods: [{ kind: "resistance", type: "physical", level: "resistant" }], steps: [] }),
    formUse({
      id: "retract",
      name: "Armored Shell (retract)",
      activation: { kind: "action" },
      costs: [{ kind: "armor", amount: fixed(1) }],
      steps: [
        {
          kind: "effect",
          to: "self",
          label: "In your shell: physical damage reduced by your Armor Score; no other actions without leaving this form",
          mods: [{ kind: "flag", flag: "cannotAct" }],
          duration: "manual",
          endsWhen: "You leave your shell (End)",
          option: "retracted",
        },
      ],
    }),
    formUse({
      id: "shell",
      name: "Armored Shell (in your shell)",
      activation: { kind: "auto", trigger: { kind: "whenYouWouldTakeDamage", damageType: "physical" } },
      requires: [{ kind: "situation", text: "While in your shell", check: { kind: "featureEffect", featureId: "beastform:armored-sentry:armored-shell", option: "retracted" } }],
      // No number source reads the Armor Score (bead): the reduction is the table's.
      steps: [{ kind: "manual", to: "self", text: "In your shell: reduce this physical damage by your Armor Score (after applying resistance)." }],
    }),
  ]),
  // Cannonball (Armored Sentry): "Mark a Stress to allow an ally to throw or launch you at an adversary. To do so, the ally
  // makes an attack roll using Agility or Strength (their choice) against a target within Close range. On a success, the
  // adversary takes d12+2 physical damage using the thrower's Proficiency. You can spend a Hope to target an additional
  // adversary within Very Close range of the first. The second target takes half the damage dealt to the first target."
  // The ally's roll and Proficiency are not the actor's (question Q-FB3): the Stress and Hope are paid here, the throw is
  // the table's.
  entry("armored-sentry", "Cannonball", [
    formUse({
      id: "main",
      name: "Cannonball",
      activation: { kind: "action" },
      costs: [stress(1)],
      targets: { side: "ally", range: "unlimited", count: { kind: "one" }, excludeSelf: true },
      steps: [
        {
          kind: "manual",
          to: "targets",
          text: "Your ally throws you: they make an attack roll using Agility or Strength (their choice) against a target within Close range. On a success, the adversary takes d12+2 physical damage using the thrower's Proficiency.",
        },
        {
          kind: "optional",
          id: "second",
          label: "Spend a Hope to target an additional adversary within Very Close range of the first",
          costs: [hope(1)],
          steps: [{ kind: "manual", to: "self", text: "The second adversary, within Very Close range of the first, takes half the damage dealt to the first target." }],
        },
      ],
    }),
  ]),
  // Trample (Mighty Strider): "Mark a Stress to move up to Close range in a straight line and make an attack against all
  // targets within Melee range of the line. Targets you succeed against take d8+1 physical damage using your Proficiency
  // and are temporarily Vulnerable."
  entry("mighty-strider", "Trample", [
    formUse({
      id: "main",
      name: "Trample",
      activation: { kind: "action" },
      costs: [stress(1)],
      roll: formRoll("agility"),
      targets: enemy("close", { kind: "all" }, { area: "path" }),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "close", relativeTo: "self", note: "Move up to Close range in a straight line" },
        physical(8, 1),
        temporarily(VULNERABLE),
      ],
    }),
  ]),
  // Fleet (Pouncing Predator): "Spend a Hope to move up to Far range without rolling."
  entry("pouncing-predator", "Fleet", [
    formUse({
      id: "main",
      name: "Fleet",
      activation: { kind: "action" },
      costs: [hope(1)],
      steps: [{ kind: "move", to: "self", mode: "move", range: "far", relativeTo: "self", note: "Move up to Far range without rolling" }],
    }),
  ]),
  // Takedown (Pouncing Predator): "Mark a Stress to move into Melee range of a target and make an attack roll against
  // them. On a success, you gain a +2 bonus to your Proficiency for this attack and the target must mark a Stress." The
  // attack is the form's (Instinct, d8+6, CB p.33; damage on a success, CB p.96); the card prints no range for the target.
  entry("pouncing-predator", "Takedown", [
    formUse({
      id: "main",
      name: "Takedown",
      activation: { kind: "action" },
      costs: [stress(1)],
      roll: formRoll("instinct"),
      targets: enemy("unlimited"),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "melee", relativeTo: "target", note: "Move into Melee range of the target" },
        physical(8, 6, 2),
        { kind: "markStress", to: "targets", when: ["hit"], amount: fixed(1) },
      ],
    }),
  ]),
  // Rampage (Powerful Beast): "When you roll a 1 on a damage die, you can roll a d10 and add the result to the damage roll.
  // Additionally, before you make an attack roll, you can mark a Stress to gain a +1 bonus to your Proficiency for that
  // attack."
  entry("powerful-beast", "Rampage", [
    formUse({
      id: "main",
      name: "Rampage (a 1 on a damage die)",
      activation: { kind: "rider", trigger: onSuccess },
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "ones", add: { count: fixed(1), sides: 10 } }, note: "Each damage die that rolls a 1: add a d10" }],
    }),
    formUse({
      id: "proficiency",
      name: "Rampage (+1 Proficiency)",
      activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } },
      costs: [stress(1)],
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "proficiency", delta: 1 }, note: "+1 Proficiency for this attack" }],
    }),
  ]),
  // Thick Hide (Powerful Beast): "You gain a +2 bonus to your damage thresholds."
  thresholds("powerful-beast", "Thick Hide", 2),
  // Venomous Strike (Striking Serpent): "Make an attack against any number of targets within Very Close range. On a
  // success, a target is temporarily Poisoned. A Poisoned creature takes 1d10 direct physical damage each time they act."
  // The attack is the form's (Finesse, d8+4, CB p.33; damage on a success, CB p.96).
  entry("striking-serpent", "Venomous Strike", [
    formUse({
      id: "main",
      name: "Venomous Strike",
      activation: { kind: "action" },
      roll: formRoll("finesse"),
      targets: enemy("veryClose", { kind: "any" }),
      steps: [physical(8, 4), temporarily(POISONED), { kind: "manual", to: "targets", when: ["hit"], text: POISON_TEXT }],
    }),
  ]),
  // Warning Hiss (Striking Serpent): "Mark a Stress to force any number of targets within Melee range to move back to Very
  // Close range."
  entry("striking-serpent", "Warning Hiss", [
    formUse({
      id: "main",
      name: "Warning Hiss",
      activation: { kind: "action" },
      costs: [stress(1)],
      targets: { side: "any", range: "melee", count: { kind: "any" }, excludeSelf: true },
      steps: [{ kind: "move", to: "targets", mode: "knockBack", range: "veryClose", relativeTo: "self", note: "Move back to Very Close range" }],
    }),
  ]),
  birdsEyeView("winged-beast"),
  // Hollow Bones (Winged Beast): "You gain a −2 penalty to your damage thresholds."
  thresholds("winged-beast", "Hollow Bones", -2),

  // ---- Tier 3 (CB p.34)
  // Vicious Maul (Aquatic Predator): "When you succeed on an attack against a target, you can spend a Hope to make them
  // Vulnerable and gain a +1 bonus to your Proficiency for this attack."
  viciousMaul("aquatic-predator", false),
  // Vicious Maul (Great Predator): "When you succeed on an attack against a target, you can spend a Hope to make them
  // temporarily Vulnerable and gain a +1 bonus to your Proficiency for this attack."
  viciousMaul("great-predator", true),
  birdsEyeView("great-winged-beast"),
  evolvedEntry("legendary-beast"),
  hybridEntry("legendary-hybrid"),
  // Physical Defense (Mighty Lizard): "You gain a +3 bonus to your damage thresholds."
  thresholds("mighty-lizard", "Physical Defense", 3),
  // Snapping Strike (Mighty Lizard): "When you succeed on an attack against a target within Melee range, you can spend a
  // Hope to clamp that opponent in your jaws, making them temporarily Restrained and Vulnerable."
  entry("mighty-lizard", "Snapping Strike", [
    formUse({
      id: "main",
      name: "Snapping Strike",
      activation: { kind: "rider", trigger: onMeleeSuccess },
      costs: [hope(1)],
      steps: [temporarily(RESTRAINED), temporarily(VULNERABLE)],
    }),
  ]),

  // ---- Tier 4 (CB p.35)
  // Ocean Master (Epic Aquatic Beast): "You can breathe and move naturally underwater. When you succeed on an attack
  // against a target within Melee range, you can temporarily Restrain them." Underwater is text.
  entry("epic-aquatic-beast", "Ocean Master", [
    formUse({ id: "main", name: "Ocean Master", activation: { kind: "rider", trigger: onMeleeSuccess }, steps: [temporarily(RESTRAINED)] }),
  ]),
  // Unyielding (Epic Aquatic Beast): "When you would mark an Armor Slot, roll a d6. On a result of 5 or higher, reduce the
  // severity by one threshold without marking an Armor Slot." Read as: the slot's reduction stands and, on a 5+, the slot
  // marked for it is cleared again.
  entry("epic-aquatic-beast", "Unyielding", [
    formUse({
      id: "main",
      name: "Unyielding",
      activation: { kind: "auto", trigger: { kind: "whenArmorSlotMarked", who: "self" } },
      steps: [
        {
          kind: "check",
          dice: { count: fixed(1), sides: 6 },
          test: { kind: "anyAtLeast", value: 5 },
          then: [{ kind: "clear", to: "self", track: "armor", amount: fixed(1), note: "5 or higher: the severity drops by one threshold without marking an Armor Slot" }],
          otherwise: [],
        },
      ],
    }),
  ]),
  // Demolish (Massive Behemoth): "Spend a Hope to move up to Far range in a straight line and make an attack against all
  // targets within Melee range of the line. Targets you succeed against take d8+10 physical damage using your Proficiency
  // and are temporarily Vulnerable."
  entry("massive-behemoth", "Demolish", [
    formUse({
      id: "main",
      name: "Demolish",
      activation: { kind: "action" },
      costs: [hope(1)],
      roll: formRoll("strength"),
      targets: enemy("far", { kind: "all" }, { area: "path" }),
      steps: [
        { kind: "move", to: "self", mode: "move", range: "far", relativeTo: "self", note: "Move up to Far range in a straight line" },
        physical(8, 10),
        temporarily(VULNERABLE),
      ],
    }),
  ]),
  // Undaunted (Massive Behemoth): "You gain a +2 bonus to all your damage thresholds."
  thresholds("massive-behemoth", "Undaunted", 2),
  // Deadly Raptor (Mythic Aerial Hunter): "You can fly at will and move up to Far range as part of your action. When you
  // move in a straight line into Melee range of a target from at least Close range and make an attack against that target
  // in the same action, you can reroll all damage dice that rolled a result lower than your Proficiency."
  entry("mythic-aerial-hunter", "Deadly Raptor", [
    formUse({ id: "main", name: "Deadly Raptor (fly; move up to Far as part of your action)", activation: { kind: "passive" }, mods: [], steps: [] }),
    formUse({
      id: "reroll",
      name: "Deadly Raptor (reroll)",
      activation: { kind: "rider", trigger: onSuccess },
      requires: [situation("You moved in a straight line into Melee range of this target from at least Close range in this action")],
      steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "rerollChosen", below: proficiency }, note: "Reroll all damage dice lower than your Proficiency" }],
    }),
  ]),
  evolvedEntry("mythic-beast"),
  hybridEntry("mythic-hybrid"),
  // Devastating Strikes (Terrible Lizard): "When you deal Severe damage to a target within Melee range, you can mark a
  // Stress to force them to mark an additional Hit Point."
  entry("terrible-lizard", "Devastating Strikes", [
    formUse({
      id: "main",
      name: "Devastating Strikes",
      activation: { kind: "rider", trigger: { kind: "whenTargetMarksHp", severity: "severe" } },
      requires: [situation("The target is within Melee range")],
      costs: [stress(1)],
      steps: [{ kind: "markHp", to: "targets", amount: fixed(1), note: "The target marks an additional Hit Point" }],
    }),
  ]),
];

export const BEASTFORM_EFFECTS: readonly FeatureEffect[] = [...ATTACKS, ...FEATURES];
