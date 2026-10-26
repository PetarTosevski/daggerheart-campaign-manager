// Martial stances and the Focus rules of the Martial Artist subclass (Brawler, Hope & Fear).
// Transcribed from the Martial Stances section, HF p.12 (also the Martial Stances sheet, HF p.13 and p.183).
// Only the rule text the mechanic needs (AGENTS.md). Pure data: no framework imports (bundled into Convex).

export type StanceTier = 1 | 2 | 3 | 4;

export type StanceId =
  | "favored"
  | "invigorating"
  | "quick"
  | "reliable"
  | "aggressive"
  | "anchored"
  | "defensive"
  | "otherworldly"
  | "grappling"
  | "scary"
  | "stable"
  | "vigilant"
  | "crushing"
  | "exacting"
  | "honed"
  | "isolating";

export interface StanceDef {
  readonly id: StanceId;
  readonly name: string;
  readonly tier: StanceTier;
  readonly text: string;
}

/** Page of the stance list and the Focus rules. */
export const STANCES_PAGE = "HF p.12";

/** The 16 martial stances, 4 per tier, in book order (HF p.12). */
export const STANCES: readonly StanceDef[] = [
  { id: "favored", name: "Favored", tier: 1, text: "Gain a bonus to damage rolls equal to a trait of your choice." },
  { id: "invigorating", name: "Invigorating", tier: 1, text: "On a successful attack, roll a d4. On a result of 4, gain a Focus." },
  {
    id: "quick",
    name: "Quick",
    tier: 1,
    text: "When you make an attack, you can spend a Focus or mark a Stress to target another creature within range with that attack."
  },
  { id: "reliable", name: "Reliable", tier: 1, text: "Gain a +1 bonus to your attack rolls." },
  {
    id: "aggressive",
    name: "Aggressive",
    tier: 2,
    text: "Gain a −1 penalty to your Evasion. On a successful attack, roll an additional damage die and discard the lowest result."
  },
  {
    id: "anchored",
    name: "Anchored",
    tier: 2,
    text: "Gain a +2 bonus to your damage thresholds. While in this stance, you can’t be moved against your will."
  },
  {
    id: "defensive",
    name: "Defensive",
    tier: 2,
    text: "Attack rolls targeting you from within Melee range have disadvantage unless the attacker marks a Stress to negate the disadvantage."
  },
  { id: "otherworldly", name: "Otherworldly", tier: 2, text: "On a successful attack, you can deal physical or magic damage." },
  {
    id: "grappling",
    name: "Grappling",
    tier: 3,
    text: "On a successful attack within Melee range, you can spend a Focus or mark a Stress to temporarily Restrain the target or throw the target up to Close range."
  },
  { id: "scary", name: "Scary", tier: 3, text: "On a successful attack, the target must mark a Stress." },
  { id: "stable", name: "Stable", tier: 3, text: "You can spend a Focus instead of an Armor Slot to reduce damage." },
  {
    id: "vigilant",
    name: "Vigilant",
    tier: 3,
    text: "When you are targeted by an attack, you can mark a Stress to gain a d6 bonus to your Evasion against the attack."
  },
  {
    id: "crushing",
    name: "Crushing",
    tier: 4,
    text: "When you deal Severe damage, you can spend a Hope to force the target to mark an additional Hit Point."
  },
  {
    id: "exacting",
    name: "Exacting",
    tier: 4,
    text: "When you roll a 1 on a damage die, you can treat it as the highest value on the die instead."
  },
  {
    id: "honed",
    name: "Honed",
    tier: 4,
    text: "Spend a Focus before you make an attack roll to gain a +1 bonus to your Proficiency for that attack."
  },
  {
    id: "isolating",
    name: "Isolating",
    tier: 4,
    text: "Gain advantage on attack rolls when there are no other creatures within Very Close range of you or your target."
  }
];

/** "You can hold a maximum of 6 Focus." (HF p.12) */
export const FOCUS_MAX = 6;

/** Stances chosen from Tier 1 when the Martial Artist foundation card is taken (HF p.11-12). */
export const STARTING_STANCES = 2;

/** Stances learned per level gained, from the character's tier or lower (HF p.11-12). */
export const STANCES_PER_LEVEL = 1;

/** Focus spent to shift into a known stance (HF p.12). Flow State lets a Stress pay it instead (HF p.11). */
export const SHIFT_FOCUS_COST = 1;

/**
 * Refocus (HF p.12): "Once per rest during a moment of calm, you can clear your mind and refocus your martial
 * instincts. Clear your Focus track, then roll a number of d6s equal to your Instinct and gain Focus equal to the
 * highest result rolled."
 */
export const REFOCUS = {
  per: "rest",
  trait: "instinct",
  die: 6,
  keep: "highest",
  clearsTrack: true
} as const;

/**
 * Dropping out of the active stance (HF p.12): shifting into a different stance, taking Severe damage, marking the last
 * Hit Point, or the end of the scene.
 */
export const STANCE_DROP_TRIGGERS = ["shift", "severe-damage", "last-hit-point", "scene-end"] as const;

export type StanceDropTrigger = (typeof STANCE_DROP_TRIGGERS)[number];

export function stanceById(id: string): StanceDef | undefined {
  return STANCES.find((s) => s.id === id);
}

/** Stances a character of `tier` may learn: their tier or lower (HF p.12). */
export function stancesUpToTier(tier: number): readonly StanceDef[] {
  return STANCES.filter((s) => s.tier <= tier);
}
