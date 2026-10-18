// Custom adversaries (D8 A5): a campaign's own stat blocks, made by "Duplicate & edit" of an SRD entry or from a
// blank block prefilled with the Core Book's improvised statistics. Pure module, bundled into Convex
// (convex/customAdversaries.ts validates with it) and used by the editor for live checks.
//
// Core Book p.208, "Improvised Statistics by Tier": "Attack Modifier +1 +2 +3 +4 / Damage Dice 1d6+2 to 1d12+4,
//   2d6+3 to 2d12+4, 3d8+3 to 3d12+5, 4d8+10 to 4d12+15 / Difficulty 11 14 17 20 / Damage Thresholds Major
//   7/Severe 12, Major 10/Severe 20, Major 20/Severe 32, Major 25/Severe 45". "You can quickly adjust a stat block
//   to a different tier by replacing its existing statistics with those listed on the Improvised Statistics by
//   Tier table … you can even improvise a completely new adversary using these statistics."
//
// ```ts
// fromSrd(bear);                 // { name: "Bear", tier: 1, type: "Bruiser", hp: 7, …, basedOn: "bear" }
// blank(2, "Standard");          // { name: "New adversary", difficulty: 14, thresholds: { major: 10, severe: 20 }, … }
// validateCustom(draft);         // the trimmed draft, or a RuleError (ENCOUNTER_RULE)
// ```

import { RuleError } from "../errors/app-error";
import { ADVERSARIES } from "../srd/adversaries";
import type { AdversaryDef, AdversaryFeatureKind, AdversaryType } from "../srd/types";

export type CustomTier = 1 | 2 | 3 | 4;

export type CustomFeature = {
  name: string;
  kind: AdversaryFeatureKind;
  text: string;
  fearCost?: number;
  countdown?: number;
};

/** The editable fields of a custom adversary (the `customAdversaries` row without its campaign, times and origin). */
export type CustomAdversaryInput = {
  name: string;
  tier: number;
  type: AdversaryType;
  hordePerHp?: number;
  description: string;
  motives: string;
  difficulty: number;
  thresholds: { major: number | null; severe: number | null };
  hp: number;
  stress: number;
  attack: { modifier: number; name: string; range: string; damage: string };
  experiences: { name: string; value: number }[];
  features: CustomFeature[];
};

/** Fields an update may change one at a time (CL3); `features` and `experiences` are sent as whole lists. */
export const CUSTOM_FIELDS = [
  "name",
  "tier",
  "type",
  "hordePerHp",
  "description",
  "motives",
  "difficulty",
  "thresholds",
  "hp",
  "stress",
  "attack",
  "experiences",
  "features",
] as const satisfies readonly (keyof CustomAdversaryInput)[];
export type CustomField = (typeof CUSTOM_FIELDS)[number];

/** Attack ranges (CB p.11). */
export const RANGES = ["Melee", "Very Close", "Close", "Far", "Very Far"] as const;

export const IMPROVISED: Record<CustomTier, { modifier: number; damage: string; damageRange: string; difficulty: number; major: number; severe: number }> = {
  1: { modifier: 1, damage: "1d6+2 phy", damageRange: "1d6+2 to 1d12+4", difficulty: 11, major: 7, severe: 12 },
  2: { modifier: 2, damage: "2d6+3 phy", damageRange: "2d6+3 to 2d12+4", difficulty: 14, major: 10, severe: 20 },
  3: { modifier: 3, damage: "3d8+3 phy", damageRange: "3d8+3 to 3d12+5", difficulty: 17, major: 20, severe: 32 },
  4: { modifier: 4, damage: "4d8+10 phy", damageRange: "4d8+10 to 4d12+15", difficulty: 20, major: 25, severe: 45 },
};

// Limits (A0's caps in convex/lib/encounters.ts, plus the ranges the form allows).
export const LIMITS = {
  name: 80,
  /** Description and Motives & Tactics. */
  text: 2000,
  /**
   * Feature text. A0's MAX_FEATURE_TEXT is 1500, but one SRD feature (Gobstalker's Tentacle Rays) is 1534 characters,
   * so a duplicate of it could never be saved; feature text takes the 2000 of the other texts.
   */
  featureText: 2000,
  featureName: 80,
  features: 20,
  experiences: 6,
  experienceName: 60,
  attackName: 80,
  damage: 40,
  hp: [1, 30],
  stress: [0, 20],
  difficulty: [1, 40],
  threshold: [1, 200],
  modifier: [-10, 20],
  experienceValue: [-10, 20],
  hordePerHp: [1, 30],
  fearCost: [1, 12],
  countdown: [1, 100],
} as const;

function fail(message: string): never {
  throw new RuleError("ENCOUNTER_RULE", message);
}

function text(value: string, max: number, what: string, required = false): string {
  const trimmed = value.trim();
  if (required && trimmed === "") fail(`Give the ${what} a name.`);
  if (trimmed.length > max) fail(`The ${what} can be at most ${max} characters.`);
  return trimmed;
}

function whole(value: number, [min, max]: readonly [number, number], what: string): number {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${what} must be a whole number from ${min} to ${max}.`);
  return value;
}

/** The draft checked and trimmed, or a RuleError (ENCOUNTER_RULE) naming the first field that is wrong. */
export function validateCustom(draft: CustomAdversaryInput): CustomAdversaryInput {
  const name = text(draft.name, LIMITS.name, "adversary", true);
  const tier = whole(draft.tier, [1, 4], "Tier");
  const hordePerHp = draft.type === "Horde" && draft.hordePerHp !== undefined ? whole(draft.hordePerHp, LIMITS.hordePerHp, "Creatures per HP") : undefined;
  const { major, severe } = draft.thresholds;
  if (major !== null) whole(major, LIMITS.threshold, "The Major threshold");
  if (severe !== null) whole(severe, LIMITS.threshold, "The Severe threshold");
  if (major !== null && severe !== null && severe <= major) fail("The Severe threshold must be higher than the Major threshold.");
  if (!(RANGES as readonly string[]).includes(draft.attack.range)) fail("Pick the attack's range.");
  if (draft.experiences.length > LIMITS.experiences) fail(`An adversary can have at most ${LIMITS.experiences} Experiences.`);
  if (draft.features.length > LIMITS.features) fail(`An adversary can have at most ${LIMITS.features} features.`);
  return {
    name,
    tier,
    type: draft.type,
    ...(hordePerHp !== undefined ? { hordePerHp } : {}),
    description: text(draft.description, LIMITS.text, "description"),
    motives: text(draft.motives, LIMITS.text, "Motives & Tactics"),
    difficulty: whole(draft.difficulty, LIMITS.difficulty, "Difficulty"),
    thresholds: { major, severe },
    hp: whole(draft.hp, LIMITS.hp, "HP"),
    stress: whole(draft.stress, LIMITS.stress, "Stress"),
    attack: {
      modifier: whole(draft.attack.modifier, LIMITS.modifier, "The attack modifier"),
      name: text(draft.attack.name, LIMITS.attackName, "attack", true),
      range: draft.attack.range,
      damage: text(draft.attack.damage, LIMITS.damage, "damage"),
    },
    experiences: draft.experiences.map((e) => ({
      name: text(e.name, LIMITS.experienceName, "Experience", true),
      value: whole(e.value, LIMITS.experienceValue, `Experience ${e.name.trim() || "value"}`),
    })),
    features: draft.features.map((f) => ({
      name: text(f.name, LIMITS.featureName, "feature", true),
      kind: f.kind,
      text: text(f.text, LIMITS.featureText, `text of ${f.name.trim() || "a feature"}`),
      ...(f.fearCost !== undefined ? { fearCost: whole(f.fearCost, LIMITS.fearCost, `The Fear cost of ${f.name.trim()}`) } : {}),
      ...(f.countdown !== undefined ? { countdown: whole(f.countdown, LIMITS.countdown, `The countdown of ${f.name.trim()}`) } : {}),
    })),
  };
}

/** The tier's improvised statistics applied to a draft (CB p.208): attack modifier, Difficulty, thresholds (Minions keep "None"). */
export function withImprovisedStats(draft: CustomAdversaryInput, tier: CustomTier): CustomAdversaryInput {
  const stats = IMPROVISED[tier];
  const thresholds = draft.type === "Minion" ? { major: null, severe: null } : { major: stats.major, severe: stats.severe };
  return { ...draft, tier, difficulty: stats.difficulty, thresholds, attack: { ...draft.attack, modifier: stats.modifier } };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/**
 * HP and Stress for a blank block. The improvised table has no HP or Stress, so they are the median of the SRD blocks
 * of that tier and type (of the tier when none has that type); a Minion has 1 HP (CB p.201).
 */
function typicalHpStress(tier: CustomTier, type: AdversaryType): { hp: number; stress: number } {
  const sameTier = ADVERSARIES.filter((a) => a.tier === tier && a.source === "core");
  const pool = sameTier.some((a) => a.type === type) ? sameTier.filter((a) => a.type === type) : sameTier;
  const hp = type === "Minion" ? 1 : (median(pool.map((a) => a.hp)) ?? 5);
  return { hp, stress: median(pool.map((a) => a.stress ?? 0)) ?? 1 };
}

/** A blank stat block of `tier` and `type`, prefilled with the improvised statistics (CB p.208). */
export function blank(tier: CustomTier, type: AdversaryType): CustomAdversaryInput {
  const stats = IMPROVISED[tier];
  const base: CustomAdversaryInput = {
    name: "New adversary",
    tier,
    type,
    ...(type === "Horde" ? { hordePerHp: 2 } : {}),
    description: "",
    motives: "",
    difficulty: stats.difficulty,
    thresholds: { major: stats.major, severe: stats.severe },
    ...typicalHpStress(tier, type),
    // Minions deal a flat value, "usually between 1 and 5" (CB p.208).
    attack: { modifier: stats.modifier, name: "Attack", range: "Melee", damage: type === "Minion" ? "1 phy" : stats.damage },
    experiences: [],
    features: [],
  };
  return withImprovisedStats(base, tier);
}

const PLAIN_COUNTDOWN = /^Countdown \((\d+)\)$/;

/**
 * A copy of an SRD stat block to edit ("Duplicate & edit"). Where the custom row is narrower than the SRD data, nothing
 * is dropped: Stress "None" becomes 0, a dice attack bonus ("+2d4") becomes 0 with the bonus kept in the attack's name,
 * and a countdown other than "Countdown (N)" (Loop, Decreasing, dice) is kept at the start of the feature's text.
 */
export function fromSrd(def: AdversaryDef): CustomAdversaryInput & { basedOn: string } {
  const diceBonus = typeof def.attack.modifier === "string";
  return {
    name: def.name,
    tier: def.tier,
    type: def.type,
    ...(def.hordePerHp !== undefined ? { hordePerHp: def.hordePerHp } : {}),
    description: def.description,
    motives: def.motives,
    difficulty: def.difficulty,
    thresholds: { ...def.thresholds },
    hp: def.hp,
    stress: def.stress ?? 0,
    attack: {
      modifier: diceBonus ? 0 : (def.attack.modifier as number),
      name: diceBonus ? `${def.attack.name} (${def.attack.modifier as string})` : def.attack.name,
      range: def.attack.range,
      damage: def.attack.damage,
    },
    experiences: def.experiences.map((e) => ({ ...e })),
    features: def.features.map((f) => {
      const plain = f.countdown === undefined ? null : PLAIN_COUNTDOWN.exec(f.countdown);
      return {
        name: f.name,
        kind: f.kind,
        text: f.countdown !== undefined && !plain ? `${f.countdown}: ${f.text}` : f.text,
        ...(f.fearCost !== undefined ? { fearCost: f.fearCost } : {}),
        ...(plain ? { countdown: Number(plain[1]) } : {}),
      };
    }),
    basedOn: def.id,
  };
}

/** The fields of `next` that differ from `prev`: what an edit sends (CL3: only the edited fields). */
export function changedFields(prev: CustomAdversaryInput, next: CustomAdversaryInput): CustomField[] {
  return CUSTOM_FIELDS.filter((field) => JSON.stringify(prev[field] ?? null) !== JSON.stringify(next[field] ?? null));
}
