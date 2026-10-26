// Leveling up (Core Book pp. 109-111). Pure module: bundled into Convex and
// used by the level-up stepper. Every level gained is one `Advancement` on the
// sheet; `applyLevelUp` appends one and `revertLevelUp` inverts the latest.
//
// Rules (CB 109-111, settled in docs/decisions-d3-d11.md):
// - Achievements at levels 2, 5 and 8: a new Experience at +2 and +1
//   Proficiency; at 5 and 8 the trait marks clear first (CB 109).
// - Two picks per level from the current tier or a lower one; Proficiency and
//   multiclass take both picks (CB 110).
// - The trait option takes two distinct unmarked traits, +1 each, and marks
//   them for the current tier (dcm-mf7). Marks are stored as the tier epoch
//   the sheet shows (`markEpoch`: 1 for tier 2, 2 for tier 3, 3 for tier 4).
// - Domain cards: the class's domains at the level or lower (the option's
//   card also capped at 4 in tier 2 and 7 in tier 3); the multiclass domain at
//   half the level rounded up; an optional trade of one owned card for one of
//   equal or lower level (CB 110-111).
// - Upgraded subclass crosses out that tier's multiclass; multiclass (level 5+,
//   once) crosses out that tier's upgraded subclass, the mastery card and the
//   other multiclass option (CB 110-111).
// - Brawler only (or a Brawler multiclass): once per tier, raise the Combo Die
//   one step, d4 → d6 → d8 → d10, in `classState.comboDie` (HF 10).
// - Multiclassing into a subclass with a Spellcast trait: the player picks it or
//   the original subclass's; forced to the new one without an original (CB 111,
//   characters/spellcast.ts). Stored on `multiclass.spellcastTrait`.
// - A multiclass foundation that grants a slot (At Ease, Battlemage) raises
//   that maximum; undoing the multiclass takes it back (characters/slots.ts).

import { CLASSES } from "../../srd/classes";
import { DOMAIN_CARDS } from "../../srd/domain-cards";
import { SUBCLASSES } from "../../srd/subclasses";
import { TRAIT_IDS, type DomainCard, type Source, type TraitId } from "../../srd/types";
import type { Advancement, AdvancementOption, AdvancementPick, CharacterSheet, SubclassRank } from "../../validation/characters";
import { MAX_LEVEL, tierForLevel } from "../characters/index";
import { FEATURE_SLOTS, gainSlotBonus, loseSlotBonus, subclassSlotKey } from "../characters/slots";
import { multiclassSpellcastProblem, resolvedMulticlassSpellcast } from "../characters/spellcast";

/** An expected level-up rule violation; Convex turns it into LEVEL_UP_RULE. */
export class LevelUpRuleError extends Error {
  override name = "LevelUpRuleError";
}

export type Tier = 2 | 3 | 4;
export const TIERS: readonly Tier[] = [2, 3, 4];

/** Levels with achievements (CB 109). */
export const ACHIEVEMENT_LEVELS: readonly number[] = [2, 5, 8];
/** Levels whose achievement clears the trait marks (CB 109). */
export const MARK_CLEAR_LEVELS: readonly number[] = [5, 8];

/** Slots per tier, the first tier that offers the option, and how many of the level's two picks it takes (CB 110). */
export const OPTION_RULES: Record<AdvancementOption, { slots: number; fromTier: Tier; cost: 1 | 2; label: string }> = {
  traits: { slots: 3, fromTier: 2, cost: 1, label: "Gain a +1 bonus to two unmarked character traits and mark them" },
  hp: { slots: 2, fromTier: 2, cost: 1, label: "Permanently gain one Hit Point slot" },
  stress: { slots: 2, fromTier: 2, cost: 1, label: "Permanently gain one Stress slot" },
  experiences: { slots: 1, fromTier: 2, cost: 1, label: "Permanently gain a +1 bonus to two Experiences" },
  domainCard: { slots: 1, fromTier: 2, cost: 1, label: "Choose an additional domain card" },
  evasion: { slots: 1, fromTier: 2, cost: 1, label: "Permanently gain a +1 bonus to your Evasion" },
  subclass: { slots: 1, fromTier: 3, cost: 1, label: "Take an upgraded subclass card" },
  proficiency: { slots: 1, fromTier: 3, cost: 2, label: "Increase your Proficiency by +1" },
  multiclass: { slots: 1, fromTier: 3, cost: 2, label: "Multiclass" },
  // HF 10, Combo Strike: "Once per tier, you can increase your Combo Die by one step as a level advancement option."
  comboDie: { slots: 1, fromTier: 2, cost: 1, label: "Increase your Combo Die by one step" },
};

export const OPTION_ORDER: readonly AdvancementOption[] = ["traits", "hp", "stress", "experiences", "domainCard", "evasion", "subclass", "proficiency", "multiclass", "comboDie"];

/** Options only one class offers: the Brawler's Combo Die (HF 10), for a Brawler or a Brawler multiclass (which gains the class feature). */
const CLASS_ONLY: Partial<Record<AdvancementOption, string>> = { comboDie: "brawler" };

/** Whether the character's class (or multiclass) offers the option at all. */
export function offersOption(sheet: Pick<CharacterSheet, "classId" | "multiclass">, option: AdvancementOption): boolean {
  const only = CLASS_ONLY[option];
  return only === undefined || sheet.classId === only || sheet.multiclass?.classId === only;
}

/** The Combo Die's sizes: it starts as a d4 and each advancement raises it one step (HF 10). */
export const COMBO_DIE_STEPS: readonly number[] = [4, 6, 8, 10, 12];

/** The Combo Die one step up (`by` 1) or down (`by` -1), or undefined past either end. */
function comboStep(current: number | undefined, by: 1 | -1): number | undefined {
  const index = COMBO_DIE_STEPS.indexOf(current ?? COMBO_DIE_STEPS[0]!);
  return index === -1 ? undefined : COMBO_DIE_STEPS[index + by];
}

/** The highest card level the domain card option of a tier may take ("up to level 4/7", CB 110). */
export const DOMAIN_CARD_CAP: Record<Tier, number> = { 2: 4, 3: 7, 4: MAX_LEVEL };

const PICKS_PER_LEVEL = 2;
const NEW_EXPERIENCE_VALUE = 2;
const MAX = { trait: 10, experience: 10, slots: 12, evasion: 40, proficiency: 10, experiences: 12, owned: 40, loadout: 5 } as const;
const RANKS: readonly SubclassRank[] = ["foundation", "specialization", "mastery"];

/** The trait-mark epoch of a level, as the sheet reads it: 1 up to level 4, 2 for levels 5-7, 3 from level 8. */
export function markEpoch(level: number): number {
  return Math.max(1, tierForLevel(level) - 1);
}

/** Whether a trait is marked for the sheet's current tier. */
export function isMarked(sheet: Pick<CharacterSheet, "level" | "traitMarks">, trait: TraitId): boolean {
  return (sheet.traitMarks[trait] ?? 0) === markEpoch(sheet.level);
}

// ---------------------------------------------------------------- options

export type OptionSlot = {
  tier: Tier;
  option: AdvancementOption;
  slots: number;
  used: number;
  cost: 1 | 2;
  /** Why it can't be taken at the next level, or null. */
  blocked: string | null;
};

function picksOf(sheet: Pick<CharacterSheet, "advancements">): AdvancementPick[] {
  return sheet.advancements.flatMap((a) => a.picks);
}

function usedSlots(picks: readonly AdvancementPick[], tier: number, option: AdvancementOption): number {
  return picks.filter((p) => p.tier === tier && p.option === option).length;
}

type Progress = Pick<CharacterSheet, "advancements" | "subclassRank" | "multiclass">;

/** Why `option` of `tier` is crossed out by earlier advancements, or null. */
function crossedOut(sheet: Progress, tier: number, option: AdvancementOption): string | null {
  const picks = picksOf(sheet);
  if (option === "subclass") {
    if (usedSlots(picks, tier, "multiclass") > 0) return "Multiclassing in this tier crossed it out.";
    if (sheet.subclassRank === "mastery") return "Your subclass is already at mastery.";
    if (sheet.multiclass && sheet.subclassRank === "specialization") return "Multiclassing crossed out the mastery card.";
  }
  if (option === "multiclass") {
    if (sheet.multiclass || picks.some((p) => p.option === "multiclass")) return "You can multiclass only once.";
    if (usedSlots(picks, tier, "subclass") > 0) return "The upgraded subclass in this tier crossed it out.";
  }
  return null;
}

/** Every option of every tier, with its slots and whether it can be taken at the next level. */
export function availableOptions(sheet: Pick<CharacterSheet, "level" | "classId"> & Progress): OptionSlot[] {
  const next = sheet.level + 1;
  const reached = next > MAX_LEVEL ? 0 : tierForLevel(next);
  const picks = picksOf(sheet);
  const out: OptionSlot[] = [];
  for (const tier of TIERS) {
    for (const option of OPTION_ORDER) {
      const rule = OPTION_RULES[option];
      if (tier < rule.fromTier || !offersOption(sheet, option)) continue;
      const used = usedSlots(picks, tier, option);
      const blocked =
        tier > reached
          ? `Reach level ${({ 2: 2, 3: 5, 4: 8 } as const)[tier]} to unlock.`
          : used >= rule.slots
            ? "All its slots are marked."
            : crossedOut(sheet, tier, option);
      out.push({ tier, option, slots: rule.slots, used, cost: rule.cost, blocked });
    }
  }
  return out;
}

// ---------------------------------------------------------------- cards

const cardById = (id: string): DomainCard | undefined => DOMAIN_CARDS.find((c) => c.id === id);

type CardAccess = Pick<CharacterSheet, "classId" | "multiclass">;

/** The highest level of `card` the character may take at `level` under `cap`, or 0 when its domain is out of reach. */
function cardLimit(sheet: CardAccess, domain: string, level: number, cap: number): number {
  const cls = CLASSES.find((c) => c.id === sheet.classId);
  if (cls?.domains.some((d) => d === domain)) return Math.min(level, cap);
  if (sheet.multiclass?.domainId === domain) return Math.min(Math.ceil(level / 2), cap);
  return 0;
}

/** Domain cards the character may take at `level` (cap: the option's tier cap), not already owned. */
export function cardsWithin(sheet: CardAccess & Pick<CharacterSheet, "domainCards">, level: number, cap: number, sources: readonly Source[]): DomainCard[] {
  return DOMAIN_CARDS.filter(
    (c) => sources.includes(c.source) && !sheet.domainCards.owned.includes(c.id) && c.level <= cardLimit(sheet, c.domain, level, cap),
  ).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/** The domains whose cards the character may take: the class's domains, then the multiclass domain (CB 110). */
export function deckDomains(sheet: CardAccess): string[] {
  const cls = CLASSES.find((c) => c.id === sheet.classId);
  const domains: string[] = [...(cls?.domains ?? [])];
  if (sheet.multiclass && !domains.includes(sheet.multiclass.domainId)) domains.push(sheet.multiclass.domainId);
  return domains;
}

/** The lowest character level at which `card` comes within reach, or null when its domain is out of reach. */
export function unlockLevel(sheet: CardAccess, card: Pick<DomainCard, "domain" | "level">): number | null {
  for (let level = 1; level <= MAX_LEVEL; level++) if (card.level <= cardLimit(sheet, card.domain, level, MAX_LEVEL)) return level;
  return null;
}

/** Domain cards a sheet may own: level + 1, plus one per "additional domain card" advancement (the board's count). */
export function cardsAllowed(sheet: Pick<CharacterSheet, "level"> & { advancements?: readonly Advancement[] }): number {
  return sheet.level + 1 + (sheet.advancements ?? []).flatMap((a) => a.picks).filter((p) => p.option === "domainCard").length;
}

export type CardTakeProblem = { reason: "unknown" | "owned" | "locked" | "full"; message: string };

/**
 * Why the character can't take card `id` from the Domain Deck now, or null: an unknown card or one from a source the
 * campaign doesn't use, an owned card, a card outside their domains or above their reach (cardLimit, no tier cap),
 * or no picks left (owned >= cardsAllowed). The server's takeCard and the sheet's deck both decide with it.
 */
export function cardTakeProblem(
  sheet: CardAccess & Pick<CharacterSheet, "domainCards" | "level"> & { advancements?: readonly Advancement[] },
  id: string,
  sources: readonly Source[],
): CardTakeProblem | null {
  const card = cardById(id);
  if (!card || !sources.includes(card.source)) return { reason: "unknown", message: "Unknown domain card." };
  if (sheet.domainCards.owned.includes(id)) return { reason: "owned", message: `You already have ${card.name}.` };
  if (card.level > cardLimit(sheet, card.domain, sheet.level, MAX_LEVEL)) return { reason: "locked", message: `${card.name} is out of reach at this level.` };
  if (sheet.domainCards.owned.length >= cardsAllowed(sheet)) return { reason: "full", message: "No picks left: you already have every card your level allows." };
  return null;
}

function cardProblem(sheet: CardAccess & Pick<CharacterSheet, "domainCards">, id: string, level: number, cap: number, sources: readonly Source[]): string | null {
  const card = cardById(id);
  if (!card || !sources.includes(card.source)) return "Unknown domain card.";
  if (sheet.domainCards.owned.includes(id)) return `You already have ${card.name}.`;
  if (card.level > cardLimit(sheet, card.domain, level, cap)) return `${card.name} is out of reach at this level.`;
  return null;
}

// ---------------------------------------------------------------- choice

export type PickChoice = { option: AdvancementOption; tier: number; targets?: string[] };

/** `spellcastTrait`: which Spellcast trait to roll with when both subclasses have one (CB 111). */
export type MulticlassChoice = { classId: string; domainId: string; subclassId: string; spellcastTrait?: TraitId };

/** What the player chooses for one level. */
export type LevelUpChoice = {
  picks: PickChoice[];
  /** The achievement Experience (levels 2, 5, 8). */
  experienceName?: string;
  /** The level's domain card (CB 111). */
  cardId: string;
  /** Optional trade of one owned card for one of equal or lower level. */
  trade?: { out: string; in: string };
  /** Needed with the multiclass pick. */
  multiclass?: MulticlassChoice;
};

export type LevelUpContext = { allowExpansion: boolean };

/** The card sources a campaign uses: the core set, plus Hope & Fear when the campaign enables it. */
export const sourcesFor = (ctx: LevelUpContext): Source[] => (ctx.allowExpansion ? ["core", "hope-and-fear"] : ["core"]);

/** Multiclass options for a class: other classes, their domains the character lacks, and their subclasses. */
export function multiclassProblem(sheet: Pick<CharacterSheet, "classId" | "subclassId">, choice: MulticlassChoice | undefined, ctx: LevelUpContext): string | null {
  if (!choice) return "Choose the class to multiclass into.";
  const sources = sourcesFor(ctx);
  const own = CLASSES.find((c) => c.id === sheet.classId);
  const cls = CLASSES.find((c) => c.id === choice.classId);
  if (!cls || !sources.includes(cls.source)) return "Unknown class.";
  if (cls.id === sheet.classId) return "Multiclass into a different class.";
  if (!cls.domains.some((d) => d === choice.domainId)) return "Choose one of that class's domains.";
  if (own?.domains.some((d) => d === choice.domainId)) return "Choose a domain you don't already have.";
  const sub = SUBCLASSES.find((s) => s.id === choice.subclassId);
  if (!sub || sub.classId !== cls.id || !sources.includes(sub.source)) return "Choose a foundation card from that class's subclasses.";
  return multiclassSpellcastProblem(sheet.subclassId, sub.id, choice.spellcastTrait);
}

type Planned = { picks: AdvancementPick[]; problems: string[] };

/** Checks the picks and gives each its slot. */
function planPicks(sheet: CharacterSheet, choice: LevelUpChoice, level: number, ctx: LevelUpContext): Planned {
  const problems: string[] = [];
  const tier = tierForLevel(level);
  const epoch = markEpoch(level);
  const marksClear = MARK_CLEAR_LEVELS.includes(level);
  const cost = choice.picks.reduce((sum, p) => sum + (OPTION_RULES[p.option]?.cost ?? 1), 0);
  if (cost !== PICKS_PER_LEVEL) problems.push("Choose two advancements (Proficiency and multiclass take both).");

  const history = picksOf(sheet);
  const picks: AdvancementPick[] = [];
  const traitBumps = new Map<string, number>();
  const expBumps = new Map<string, number>();
  let hp = sheet.hpMax;
  let stress = sheet.stressMax;
  let evasion = sheet.evasion;
  let proficiency = sheet.proficiency + (ACHIEVEMENT_LEVELS.includes(level) ? 1 : 0);
  let rank = RANKS.indexOf(sheet.subclassRank);
  let combo: number | undefined = sheet.classState.comboDie;

  for (const p of choice.picks) {
    const rule = OPTION_RULES[p.option];
    if (!Number.isInteger(p.tier) || p.tier < rule.fromTier || p.tier > tier) {
      problems.push(`${rule.label}: not offered in tier ${p.tier} at level ${level}.`);
      continue;
    }
    const slot = usedSlots(history, p.tier, p.option) + usedSlots(picks, p.tier, p.option);
    if (slot >= rule.slots) {
      problems.push(`${rule.label}: every slot in tier ${p.tier} is marked.`);
      continue;
    }
    const crossed = crossedOut(sheet, p.tier, p.option);
    if (crossed) problems.push(crossed);
    const targets = p.targets ?? [];
    const pick: AdvancementPick = { option: p.option, tier: p.tier, slot };

    switch (p.option) {
      case "traits": {
        const valid = targets.length === 2 && new Set(targets).size === 2 && targets.every((t) => (TRAIT_IDS as readonly string[]).includes(t));
        if (!valid) {
          problems.push("Choose two different character traits.");
          break;
        }
        for (const t of targets) {
          const marked = !marksClear && (sheet.traitMarks[t] ?? 0) === epoch;
          if (marked || traitBumps.has(t)) problems.push(`${t} is marked this tier.`);
          traitBumps.set(t, (traitBumps.get(t) ?? 0) + 1);
          if (sheet.traits[t as TraitId] + 1 > MAX.trait) problems.push(`${t} is already at +${MAX.trait}.`);
        }
        pick.targets = targets;
        break;
      }
      case "experiences": {
        const ids = new Set(sheet.experiences.map((e) => e.id));
        if (targets.length !== 2 || new Set(targets).size !== 2 || !targets.every((t) => ids.has(t))) {
          problems.push("Choose two different Experiences.");
          break;
        }
        for (const t of targets) expBumps.set(t, (expBumps.get(t) ?? 0) + 1);
        pick.targets = targets;
        break;
      }
      case "domainCard": {
        const [cardId] = targets;
        const problem = targets.length === 1 && cardId ? cardProblem(withMulticlass(sheet, choice), cardId, level, DOMAIN_CARD_CAP[p.tier as Tier], sourcesFor(ctx)) : "Choose a domain card.";
        if (problem) problems.push(problem);
        pick.targets = targets;
        break;
      }
      case "hp":
        hp += 1;
        break;
      case "stress":
        stress += 1;
        break;
      case "evasion":
        evasion += 1;
        break;
      case "proficiency":
        proficiency += 1;
        break;
      case "subclass":
        rank += 1;
        if (rank > 2) problems.push("Your subclass is already at mastery.");
        else if (rank === 2 && sheet.multiclass) problems.push("Multiclassing crossed out the mastery card.");
        break;
      case "multiclass": {
        if (level < 5) problems.push("Multiclassing starts at level 5.");
        const problem = multiclassProblem(sheet, choice.multiclass, ctx);
        if (problem) problems.push(problem);
        // The new foundation's slot (At Ease, Battlemage) counts toward the 12-slot cap.
        const bonus = choice.multiclass ? FEATURE_SLOTS[subclassSlotKey(choice.multiclass.subclassId)] : undefined;
        if (bonus && "hp" in bonus) hp += bonus.hp;
        if (bonus && "stress" in bonus) stress += bonus.stress;
        break;
      }
      case "comboDie":
        if (!offersOption(sheet, "comboDie")) problems.push("Only a Brawler has a Combo Die.");
        combo = comboStep(combo, 1);
        if (combo === undefined) problems.push("Your Combo Die is at its largest.");
        break;
    }
    picks.push(pick);
  }

  for (const [id, n] of expBumps) {
    const exp = sheet.experiences.find((e) => e.id === id);
    if (exp && exp.value + n > MAX.experience) problems.push(`${exp.name} is already at +${MAX.experience}.`);
  }
  if (hp > MAX.slots) problems.push(`Hit Points stop at ${MAX.slots} slots.`);
  if (stress > MAX.slots) problems.push(`Stress stops at ${MAX.slots} slots.`);
  if (evasion > MAX.evasion) problems.push("Evasion is at its maximum.");
  if (proficiency > MAX.proficiency) problems.push("Proficiency is at its maximum.");
  return { picks, problems };
}

function withMulticlass(sheet: CharacterSheet, choice: LevelUpChoice): CharacterSheet {
  const takes = choice.picks.some((p) => p.option === "multiclass");
  return takes && choice.multiclass ? { ...sheet, multiclass: choice.multiclass } : sheet;
}

function newCards(choice: LevelUpChoice): string[] {
  const optionCards = choice.picks.filter((p) => p.option === "domainCard").flatMap((p) => p.targets ?? []);
  return [choice.cardId, ...optionCards];
}

/** Every reason the choice can't be applied to the sheet at its next level (empty when it can). */
export function validateLevelUp(sheet: CharacterSheet, choice: LevelUpChoice, ctx: LevelUpContext): string[] {
  const level = sheet.level + 1;
  if (level > MAX_LEVEL) return [`Level ${MAX_LEVEL} is the highest level.`];
  const sources = sourcesFor(ctx);
  const { problems } = planPicks(sheet, choice, level, ctx);

  if (ACHIEVEMENT_LEVELS.includes(level)) {
    const name = choice.experienceName?.trim() ?? "";
    if (name.length === 0 || name.length > 80) problems.push("Name the new Experience (up to 80 characters).");
    if (sheet.experiences.length >= MAX.experiences) problems.push(`A sheet holds at most ${MAX.experiences} Experiences.`);
  }

  const reach = withMulticlass(sheet, choice);
  const cardProblemText = choice.cardId ? cardProblem(reach, choice.cardId, level, MAX_LEVEL, sources) : "Choose the level's domain card.";
  if (cardProblemText) problems.push(cardProblemText);
  const cards = newCards(choice);
  if (new Set(cards).size !== cards.length) problems.push("Choose different domain cards.");

  if (choice.trade) {
    const out = cardById(choice.trade.out);
    const into = cardById(choice.trade.in);
    if (!out || !sheet.domainCards.owned.includes(out.id)) problems.push("Trade out a card you have.");
    else if (!into) problems.push("Unknown domain card.");
    else {
      const problem = cardProblem(reach, into.id, level, MAX_LEVEL, sources);
      if (problem) problems.push(problem);
      if (into.level > out.level) problems.push(`Trade ${out.name} for a card of level ${out.level} or lower.`);
      if (cards.includes(into.id)) problems.push("Choose different domain cards.");
    }
  }
  if (sheet.domainCards.owned.length + cards.length > MAX.owned) problems.push(`A deck holds at most ${MAX.owned} cards.`);
  return problems;
}

// ---------------------------------------------------------------- apply / revert

/** Adds an owned card: into the loadout while it has room (fewer than 5), else into the vault. */
export function addCard(cards: CharacterSheet["domainCards"], id: string): CharacterSheet["domainCards"] {
  return { owned: [...cards.owned, id], loadout: cards.loadout.length < MAX.loadout ? [...cards.loadout, id] : cards.loadout };
}

function swapCard(cards: CharacterSheet["domainCards"], from: string, to: string): CharacterSheet["domainCards"] {
  const swap = (list: string[]) => list.map((c) => (c === from ? to : c));
  return { owned: swap(cards.owned), loadout: swap(cards.loadout) };
}

function bumpExperiences(sheet: CharacterSheet, ids: readonly string[], delta: number): CharacterSheet["experiences"] {
  return sheet.experiences.map((e) => (ids.includes(e.id) ? { ...e, value: e.value + delta } : e));
}

/**
 * Raises the sheet one level with the choice: achievements first (marks clear
 * at 5 and 8), then the picks, the level's card and the trade. Appends the
 * advancement (stamped with `ctx.at` when given) and clears `levelUpPending`.
 * Throws `LevelUpRuleError`.
 */
export function applyLevelUp(sheet: CharacterSheet, choice: LevelUpChoice, ctx: LevelUpContext & { newId: () => string; at?: number }): CharacterSheet {
  const problems = validateLevelUp(sheet, choice, ctx);
  if (problems.length > 0) throw new LevelUpRuleError(problems[0]);
  const level = sheet.level + 1;
  const epoch = markEpoch(level);
  const { picks } = planPicks(sheet, choice, level, ctx);
  let next: CharacterSheet = { ...sheet, level, traits: { ...sheet.traits }, traitMarks: { ...sheet.traitMarks } };
  const advancement: Advancement = { level, picks, cardId: choice.cardId, ...(ctx.at === undefined ? {} : { at: ctx.at }) };

  if (ACHIEVEMENT_LEVELS.includes(level)) {
    const id = ctx.newId();
    next.experiences = [...next.experiences, { id, name: choice.experienceName!.trim(), value: NEW_EXPERIENCE_VALUE }];
    next.proficiency += 1;
    advancement.experienceId = id;
  }
  if (MARK_CLEAR_LEVELS.includes(level)) {
    next.traitMarks = Object.fromEntries(Object.entries(next.traitMarks).filter(([, e]) => e >= epoch));
  }

  for (const pick of picks) {
    const targets = pick.targets ?? [];
    switch (pick.option) {
      case "traits":
        for (const t of targets) {
          next.traits[t as TraitId] += 1;
          next.traitMarks[t] = epoch;
        }
        break;
      case "hp":
        next.hpMax += 1;
        break;
      case "stress":
        next.stressMax += 1;
        break;
      case "experiences":
        next.experiences = bumpExperiences(next, targets, 1);
        break;
      case "evasion":
        next.evasion += 1;
        break;
      case "proficiency":
        next.proficiency += 1;
        break;
      case "subclass":
        next.subclassRank = RANKS[RANKS.indexOf(next.subclassRank) + 1] ?? next.subclassRank;
        break;
      case "multiclass":
        {
          const { classId, domainId, subclassId, spellcastTrait } = choice.multiclass!;
          const trait = resolvedMulticlassSpellcast(next.subclassId, subclassId, spellcastTrait);
          next.multiclass = { classId, domainId, subclassId, ...(trait ? { spellcastTrait: trait } : {}) };
        }
        next = gainSlotBonus(next, subclassSlotKey(next.multiclass.subclassId));
        break;
      case "comboDie":
        next.classState = { ...next.classState, comboDie: comboStep(next.classState.comboDie, 1)! };
        break;
      case "domainCard":
        break;
    }
  }

  for (const id of newCards(choice)) next.domainCards = addCard(next.domainCards, id);
  if (choice.trade) {
    next.domainCards = swapCard(next.domainCards, choice.trade.out, choice.trade.in);
    advancement.tradeOut = choice.trade.out;
    advancement.tradeIn = choice.trade.in;
  }
  next = { ...next, advancements: [...sheet.advancements, advancement], levelUpPending: false };
  return next;
}

/**
 * Undoes the latest advancement exactly: the trade, the cards, each pick's
 * bonus and marks, the achievement (restoring the marks it cleared), the level.
 * Sets `levelUpPending` again so the level can be redone. Throws
 * `LevelUpRuleError` when there is none or the level was corrected by hand.
 */
export function revertLevelUp(sheet: CharacterSheet): CharacterSheet {
  const advancement = sheet.advancements.at(-1);
  if (!advancement) throw new LevelUpRuleError("There is no level-up to undo.");
  if (advancement.level !== sheet.level) throw new LevelUpRuleError(`The level was set by hand; correct it back to ${advancement.level} first.`);
  const level = advancement.level;
  const rest = sheet.advancements.slice(0, -1);
  let next: CharacterSheet = { ...sheet, traits: { ...sheet.traits }, traitMarks: { ...sheet.traitMarks } };

  if (advancement.tradeIn && advancement.tradeOut) next.domainCards = swapCard(next.domainCards, advancement.tradeIn, advancement.tradeOut);
  const gained = [advancement.cardId, ...advancement.picks.filter((p) => p.option === "domainCard").flatMap((p) => p.targets ?? [])];
  next.domainCards = { owned: next.domainCards.owned.filter((c) => !gained.includes(c)), loadout: next.domainCards.loadout.filter((c) => !gained.includes(c)) };

  for (const pick of [...advancement.picks].reverse()) {
    const targets = pick.targets ?? [];
    switch (pick.option) {
      case "traits":
        for (const t of targets) {
          next.traits[t as TraitId] -= 1;
          delete next.traitMarks[t];
        }
        break;
      case "hp":
        next.hpMax -= 1;
        next.hp = Math.min(next.hp, next.hpMax);
        break;
      case "stress":
        next.stressMax -= 1;
        next.stress = Math.min(next.stress, next.stressMax);
        break;
      case "experiences":
        next.experiences = bumpExperiences(next, targets, -1);
        break;
      case "evasion":
        next.evasion -= 1;
        break;
      case "proficiency":
        next.proficiency -= 1;
        break;
      case "subclass":
        next.subclassRank = RANKS[RANKS.indexOf(next.subclassRank) - 1] ?? "foundation";
        break;
      case "multiclass":
        if (next.multiclass) next = loseSlotBonus(next, subclassSlotKey(next.multiclass.subclassId));
        delete next.multiclass;
        break;
      case "comboDie": {
        // Back one step; back at the starting d4 the field goes, as before the first advancement.
        const { comboDie, ...state } = next.classState;
        const lower = comboStep(comboDie, -1);
        next.classState = lower === undefined || lower === COMBO_DIE_STEPS[0] ? state : { ...state, comboDie: lower };
        break;
      }
      case "domainCard":
        break;
    }
  }

  if (ACHIEVEMENT_LEVELS.includes(level)) {
    next.proficiency -= 1;
    next.experiences = next.experiences.filter((e) => e.id !== advancement.experienceId);
  }
  if (MARK_CLEAR_LEVELS.includes(level)) {
    // Restore the marks this achievement cleared: the trait picks of the previous tier.
    const previous = markEpoch(level - 1);
    for (const a of rest) {
      if (markEpoch(a.level) !== previous) continue;
      for (const p of a.picks) if (p.option === "traits") for (const t of p.targets ?? []) next.traitMarks[t] = previous;
    }
  }
  return { ...next, level: level - 1, advancements: rest, levelUpPending: true };
}

/** The picks taken from one tier's option, oldest first (the tier grid's history). */
export function picksFor(sheet: Pick<CharacterSheet, "advancements">, tier: number, option: AdvancementOption): { level: number; pick: AdvancementPick }[] {
  return sheet.advancements.flatMap((a) => a.picks.filter((p) => p.tier === tier && p.option === option).map((pick) => ({ level: a.level, pick })));
}
