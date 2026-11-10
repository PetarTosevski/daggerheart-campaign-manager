// Character rules from the Core Book, chapter 1 (creation) and chapter 2
// (damage thresholds, armor). Pure module: bundled into Convex.

import type { RuleModes } from "../../rules/registry";
import type { TraitId } from "../../srd/types";
import type { Condition } from "../../validation/characters";

/** Trait modifiers distributed at creation: "+2, +1, +1, 0, 0, −1" (Core p.17). */
export const TRAIT_POOL: readonly number[] = [2, 1, 1, 0, 0, -1];

export const STARTING_STRESS = 6; // "Every class starts with 6 Stress."
export const STARTING_HOPE = 2; // "You start with 2 Hope."
export const BASE_HOPE_MAX = 6; // "to a maximum of 6"; each scar removes one slot
export const STARTING_PROFICIENCY = 1; // "At Level 1, your Proficiency is 1."
export const STARTING_EXPERIENCE_VALUE = 2; // two Experiences at +2
export const STARTING_DOMAIN_CARDS = 2;
export const MAX_LEVEL = 10;

/** True when the six values are exactly the creation pool, in any order. */
export function isValidTraitSpread(traits: Record<TraitId, number>): boolean {
  const values = Object.values(traits).slice().sort((a, b) => a - b);
  const pool = TRAIT_POOL.slice().sort((a, b) => a - b);
  return values.length === pool.length && values.every((v, i) => v === pool[i]);
}

/**
 * Hope slots left: 6, plus a seventh from Light in the Dark (`hopeSlotBonus`,
 * CB 40, dcm-bxp.14), minus one per scar (CB 18 and 90: "a maximum of 6"; CB 106, scars).
 */
export function hopeMax(scars: number, hopeSlotBonus = 0): number {
  return Math.max(0, BASE_HOPE_MAX + hopeSlotBonus - scars);
}

/** The most scars a sheet can hold: one per Hope slot, Light in the Dark's included (CB 40, 106). */
export function scarsMax(hopeSlotBonus = 0): number {
  return BASE_HOPE_MAX + hopeSlotBonus;
}

/** Tier of a level: 1 (level 1), 2 (2–4), 3 (5–7), 4 (8–10). */
export function tierForLevel(level: number): 1 | 2 | 3 | 4 {
  if (level >= 8) return 4;
  if (level >= 5) return 3;
  if (level >= 2) return 2;
  return 1;
}

export type Thresholds = { major: number; severe: number };

/**
 * Damage thresholds: the armor's base thresholds plus the character's level;
 * unarmored, Major = level and Severe = 2 × level (Core p.18, "Unarmored").
 * `bonus` adds permanent modifiers to both values.
 */
export function damageThresholds(level: number, armorBase: Thresholds | null, bonus = 0): Thresholds {
  if (!armorBase) return { major: level + bonus, severe: level * 2 + bonus };
  return { major: armorBase.major + level + bonus, severe: armorBase.severe + level + bonus };
}

export type Severity = "none" | "minor" | "major" | "severe";

/** Severity of incoming damage against the thresholds. */
export function damageSeverity(damage: number, t: Thresholds): Severity {
  if (damage <= 0) return "none";
  if (damage >= t.severe) return "severe";
  if (damage >= t.major) return "major";
  return "minor";
}

const MARKS: Record<Severity, number> = { none: 0, minor: 1, major: 2, severe: 3 };
const ORDER: Severity[] = ["none", "minor", "major", "severe"];

/**
 * The PC rule modes these helpers read (plan rule-switches, tracer RDM): D4 `stressOverflow`, D5
 * `fullStressVulnerable` and the optional `massiveDamage`. A missing field is the Book behaviour (Massive off), so `{}`
 * is today's rules; `ruleModesOf(campaign)` can be passed as it is.
 */
export type PcDamageRules = Partial<Pick<RuleModes, "stressOverflow" | "fullStressVulnerable" | "massiveDamage">>;

/**
 * Massive damage (CB p.91, "OPTIONAL RULE: MASSIVE DAMAGE": "your table can implement a Massive threshold. If you ever
 * take damage equal to double your Severe threshold, you mark 4 Hit Points"): with the rule on, damage at or above
 * twice the Severe threshold.
 */
export function isMassiveDamage(damage: number, t: Pick<Thresholds, "severe">, rules: PcDamageRules = {}): boolean {
  return rules.massiveDamage === true && t.severe > 0 && damage >= 2 * t.severe;
}

/**
 * Hit Points to mark: Minor 1, Major 2, Severe 3. Marking an Armor Slot
 * reduces the severity by one threshold ("Severe to Major, Major to Minor, or
 * Minor to None"); one slot per attack. With Massive Damage on (CB p.91) damage
 * at twice the Severe threshold marks 4; the Massive threshold sits above Severe,
 * so an Armor Slot reduces it to Severe (3). `massive` is set (true) only for
 * Massive damage, so the Book's result is unchanged.
 */
export function hitPointsToMark(
  damage: number,
  t: Thresholds,
  useArmorSlot = false,
  rules: PcDamageRules = {},
): { severity: Severity; marks: number; massive?: true } {
  if (isMassiveDamage(damage, t, rules)) return { severity: "severe", marks: useArmorSlot ? 3 : 4, massive: true };
  let severity = damageSeverity(damage, t);
  if (useArmorSlot && severity !== "none") severity = ORDER[ORDER.indexOf(severity) - 1];
  return { severity, marks: MARKS[severity] };
}

/**
 * Marks Stress ("Marking Stress", Core ch. 3): "If you're ever forced to mark
 * 1 or more Stress but your slots are already full, you must instead mark 1
 * Hit Point" — one Hit Point in total, however much Stress overflowed. Marking
 * the last Stress slot makes the character Vulnerable until they clear one.
 *
 * Rule switches (tracer RDM): D4 Manual drops the extra Stress and marks no HP
 * (`overflow: true` says it happened); D5 Manual never sets `vulnerable`
 * (`full: true` says the track is full). Both fields are only set under their
 * Manual mode, so the Book's result is unchanged.
 */
export function markStress(
  current: { stress: number; stressMax: number; hp: number; hpMax: number },
  amount: number,
  rules: PcDamageRules = {},
): { stress: number; hp: number; vulnerable: boolean; overflow?: true; full?: true } {
  const free = Math.max(0, current.stressMax - current.stress);
  const toStress = Math.min(free, Math.max(0, amount));
  const overflow = amount - toStress > 0;
  const stress = current.stress + toStress;
  const full = stress >= current.stressMax;
  const overflowManual = rules.stressOverflow === "manual";
  const fullManual = rules.fullStressVulnerable === "manual";
  return {
    stress,
    hp: overflow && !overflowManual ? Math.min(current.hpMax, current.hp + 1) : current.hp,
    vulnerable: full && !fullManual,
    ...(overflow && overflowManual ? { overflow: true as const } : {}),
    ...(full && fullManual ? { full: true as const } : {}),
  };
}

/**
 * The PC's Vulnerable from a full Stress track (CB p.92: "When you mark your last Stress, you become Vulnerable … until
 * you clear at least 1 Stress"). D5 Manual: never (the GM adds Vulnerable by hand).
 */
export function pcVulnerableFromStress(sheet: { stress: number; stressMax: number }, rules: PcDamageRules = {}): boolean {
  return rules.fullStressVulnerable !== "manual" && sheet.stressMax > 0 && sheet.stress >= sheet.stressMax;
}

/**
 * Full Stress makes a PC Vulnerable at the moment the track fills, on every write (the GM's +, a card cost, a feature,
 * a hit), and clearing a Stress ends it (CB p.92: "When you mark your last Stress, you become Vulnerable … until you
 * clear at least 1 Stress"). Only the change of state acts, so a GM who removes Vulnerable by hand while the track stays
 * full isn't overruled, and a Vulnerable a card or feature gave (a sheet effect labelled "vulnerable") outlives the
 * Stress. D5 Manual never calls this (convex/lib/characterSheet.ts `saveSheet`).
 */
export function withStressVulnerable<T extends { stress: number; stressMax: number; conditions?: Condition[]; effects?: readonly { text: string }[] }>(
  previous: { stress: number; stressMax: number } | null,
  next: T,
): T {
  const full = (t: { stress: number; stressMax: number }) => t.stressMax > 0 && t.stress >= t.stressMax;
  const was = previous !== null && full(previous);
  const is = full(next);
  const conditions = next.conditions ?? [];
  const has = conditions.includes("vulnerable");
  if (is && !was && !has) return { ...next, conditions: [...conditions, "vulnerable"] };
  const sourced = (next.effects ?? []).some((e) => e.text.split("; ")[0] === "vulnerable");
  if (was && !is && has && !sourced) return { ...next, conditions: conditions.filter((c) => c !== "vulnerable") };
  return next;
}

const MODIFIER = /([+\-−]\d+) to (Evasion|Armor Score)(?! while)/g;

/**
 * Permanent Evasion and Armor Score modifiers from equipped items' features,
 * e.g. "Heavy: −1 to Evasion", "+1 to Armor Score". Conditional modifiers
 * ("… while it's active") are left to the player.
 */
export function equipmentModifiers(featureTexts: readonly (string | undefined)[]): { evasion: number; armorScore: number } {
  let evasion = 0;
  let armorScore = 0;
  for (const text of featureTexts) {
    if (!text) continue;
    for (const m of text.matchAll(MODIFIER)) {
      const value = Number(m[1].replace("−", "-"));
      if (m[2] === "Evasion") evasion += value;
      else armorScore += value;
    }
  }
  return { evasion, armorScore };
}

export type Resource = "hp" | "stress" | "hope" | "scars";
type Tracks = {
  hp: number;
  hpMax: number;
  stress: number;
  stressMax: number;
  hope: number;
  scars: number;
  hopeSlotBonus?: number;
  conditions?: readonly Condition[];
};

/**
 * Marks or clears a resource track by `delta` (used by the server's
 * adjustResource and optimistic UI updates). Hope stops at `hopeMax`;
 * clearing a Hit Point wakes an Unconscious character (CB 106, Avoid Death).
 */
export function applyResourceDelta<T extends Tracks>(sheet: T, resource: Resource, delta: number, rules: PcDamageRules = {}): T {
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
  const max = (scars: number) => hopeMax(scars, sheet.hopeSlotBonus ?? 0);
  const next = { ...sheet };
  if (resource === "hp") {
    next.hp = clamp(sheet.hp + delta, sheet.hpMax);
    if (next.hp < sheet.hp && sheet.conditions?.includes("unconscious")) {
      Object.assign(next, { conditions: sheet.conditions.filter((c) => c !== "unconscious") });
    }
  }
  if (resource === "stress") {
    if (delta > 0) {
      const marked = markStress(sheet, delta, rules);
      next.stress = marked.stress;
      next.hp = marked.hp;
    } else next.stress = clamp(sheet.stress + delta, sheet.stressMax);
  }
  if (resource === "hope") next.hope = clamp(sheet.hope + delta, max(sheet.scars));
  if (resource === "scars") {
    next.scars = clamp(sheet.scars + delta, scarsMax(sheet.hopeSlotBonus ?? 0));
    next.hope = Math.min(next.hope, max(next.scars));
  }
  return next;
}

// ---------------------------------------------------------------- C4 Unconscious (rule switch, plan rule-switches WD)

/**
 * C4 Unconscious (CB p.106, Avoid Death: "Your character can't move or act while unconscious, they can't be targeted by
 * an attack, and they return to consciousness when an ally clears 1 or more of their marked Hit Points or when the party
 * finishes a long rest"). Book: the app refuses acting, wakes on an HP clear and on a long rest. Manual (Q8 a): the
 * badge only; no refusal, no automatic waking, the GM gets a note.
 */
export type UnconsciousMode = RuleModes["unconscious"];

const isUnconscious = (sheet: { conditions?: readonly Condition[] }) => sheet.conditions?.includes("unconscious") === true;

/** Whether the condition stops the character acting (rolls, features, downtime moves): Book only. */
export function unconsciousBlocksActing(sheet: { conditions?: readonly Condition[] }, mode: UnconsciousMode = "book"): boolean {
  return mode === "book" && isUnconscious(sheet);
}

/**
 * Whether an adversary attack must refuse this PC as a target ("they can't be targeted by an attack", CB p.106): Book
 * only. The hook for tracer WF (Q8 a), which wires it into the adversary attack paths.
 */
export function isUntargetableUnconscious(sheet: { conditions?: readonly Condition[] }, mode: UnconsciousMode = "book"): boolean {
  return mode === "book" && isUnconscious(sheet);
}

/**
 * C4 Manual: undoes an automatic wake-up. When `before` was unconscious, `after` is not and its Hit Points went down (the
 * wake of `applyResourceDelta`, CB p.106), Manual puts the condition back and says so (`woke: true`, the GM is asked);
 * Book keeps `after`. Any other change (the GM clearing the condition by hand) is kept in both modes.
 */
export function keepUnconscious<T extends { hp: number; conditions: readonly Condition[] }>(
  before: { hp: number; conditions?: readonly Condition[] },
  after: T,
  mode: UnconsciousMode,
): { sheet: T; woke: boolean } {
  if (mode !== "manual" || !isUnconscious(before) || isUnconscious(after) || after.hp >= before.hp) return { sheet: after, woke: false };
  return { sheet: { ...after, conditions: [...after.conditions, "unconscious"] }, woke: true };
}

/** The object pronoun of a "she/her"-style pronouns field ("her", "him", "them"), or "them" for anything else. */
export function objectPronoun(pronouns: string | undefined): string {
  const parts = (pronouns ?? "").split("/").map((p) => p.trim().toLowerCase());
  const object = parts[1];
  return parts.length === 2 && object !== undefined && /^[a-z]{2,8}$/.test(object) ? object : "them";
}

/** C4 Manual: the GM's note when a Hit Point cleared on an unconscious PC (CB p.106: an ally's clear wakes them). */
export const hpClearedWakeNote = (name: string, pronouns?: string) => `${name} had a Hit Point cleared: wake ${objectPronoun(pronouns)}?`;
/** C4 Manual: the GM's note for an unconscious PC at the end of a long rest (CB p.106). */
export const longRestWakeNote = (name: string) => `Long rest: wake ${name}?`;

// ---------------------------------------------------------------- gold (CB 104)

/** "10 handfuls to 1 bag, and 10 bags to 1 chest": a category holds at most 9 marks. */
export const MAX_HANDFULS = 9;
export const MAX_BAGS = 9;
/**
 * Gold coins, an optional rule (CB p.104, plan rule-switches OSC, Q12 a): "you can add coins as your lowest
 * denomination. Following the established pattern, 10 coins equal 1 handful." So at most 9 coins.
 */
export const MAX_COINS = 9;

/** `coins` exists only once the Gold coins rule has been used (a widened field: unset reads as 0). */
export type Gold = { handfuls: number; bags: number; chest: boolean; coins?: number };
export type GoldCoin = "coins" | "handfuls" | "bags";

/**
 * Adds `delta` coins, handfuls or bags (CB 104): "When you have marked all of the slots in a category and you gain another
 * gold reward in that category, you mark a slot in the following category and clear all the slots in the current one"
 * (9 handfuls + 1 = 1 bag, 9 bags + 1 = 1 chest; with the Gold coins rule, 9 coins + 1 = 1 handful). "If you ever have
 * more than 1 chest, you'll need to store some of your gold before you can take more": returns null when the gain would
 * need a second chest. Spending stops at 0 (the book doesn't break a bag into handfuls, nor a handful into coins).
 * Counts stored above 9 before this rule are clamped first. A handful or bag change keeps the stored coins as they are
 * (with the rule off they are never changed); the caller refuses `coins` while the rule is off.
 */
export function addGold(gold: Gold, coin: GoldCoin, delta: number): Gold | null {
  let handfuls = Math.min(gold.handfuls, MAX_HANDFULS);
  let bags = Math.min(gold.bags, MAX_BAGS);
  let chest = gold.chest;
  const keep = gold.coins === undefined ? {} : { coins: Math.min(gold.coins, MAX_COINS) };
  if (coin === "coins") {
    const total = (keep.coins ?? 0) + delta;
    if (total < 0) return { handfuls, bags, chest, coins: 0 };
    const carry = Math.floor(total / 10);
    const rest: Gold = { handfuls, bags, chest, coins: total % 10 };
    return carry === 0 ? rest : addGold(rest, "handfuls", carry);
  }
  if (coin === "handfuls") {
    const total = handfuls + delta;
    if (total < 0) return { handfuls: 0, bags, chest, ...keep };
    handfuls = total % 10;
    bags += Math.floor(total / 10);
  } else {
    bags = Math.max(0, bags + delta);
  }
  if (bags > MAX_BAGS) {
    const chests = Math.floor(bags / 10) + (chest ? 1 : 0);
    if (chests > 1) return null;
    chest = true;
    bags %= 10;
  }
  return { handfuls, bags, chest, ...keep };
}

// ---------------------------------------------------------------- shared domain cards (CB p.21)

/**
 * Shared domain cards, an optional rule (CB p.21, plan rule-switches OSC; Q16 as the user changed it 2026-11-05): "If a
 * fellow player's class has the same domain as yours, we encourage you to coordinate with them and choose different
 * cards … However, if the GM and players agree, feel free to make an exception." A three-way setting:
 * - `allow`: no check;
 * - `warn` (the default, every campaign): a picker shows "Mira already has this card" and still allows it;
 * - `refuse` (not in the books): the card can't be taken while another character of the campaign holds it.
 */
export type SharedCardsMode = RuleModes["sharedDomainCards"];

/** One character of the campaign: its name and every domain card it holds (loadout or vault). */
export type CardHolder = { id: string; name: string; cards: readonly string[] };

/** The names of the characters holding each card: every character of the campaign but `exceptId` (the one choosing). */
export function cardHolders(party: readonly CardHolder[], exceptId?: string): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const c of party) {
    if (c.id === exceptId) continue;
    for (const card of new Set(c.cards)) out.set(card, [...(out.get(card) ?? []), c.name]);
  }
  return out;
}

/** "Mira", "Mira and Brin", "Mira, Brin and Kael". */
function namesText(names: readonly string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}

const has = (names: readonly string[]) => (names.length > 1 ? "have" : "has");

/** "Mira already has this card" ("Mira and Brin already have this card") when another character holds it, unless the mode is `allow`. */
export function sharedCardNote(mode: SharedCardsMode, holders: ReadonlyMap<string, readonly string[]>, cardId: string): string | null {
  const names = holders.get(cardId);
  if (mode === "allow" || !names || names.length === 0) return null;
  return `${namesText(names)} already ${has(names)} this card`;
}

/** Under `refuse`, why the first of `cardIds` another character holds can't be taken; null otherwise. `nameOf` names a card. */
export function sharedCardRefusal(
  mode: SharedCardsMode,
  holders: ReadonlyMap<string, readonly string[]>,
  cardIds: readonly string[],
  nameOf: (cardId: string) => string = (id) => id,
): string | null {
  if (mode !== "refuse") return null;
  for (const id of cardIds) {
    const names = holders.get(id);
    if (names && names.length > 0) return `${namesText(names)} already ${has(names)} ${nameOf(id)}, and this campaign doesn't share domain cards.`;
  }
  return null;
}
