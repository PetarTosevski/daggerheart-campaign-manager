import type { CharacterView } from "../../../convex/characters";
import { MAX_LEVEL } from "../domain/characters/index";
import { ACHIEVEMENT_LEVELS, MARK_CLEAR_LEVELS, OPTION_RULES, type MulticlassChoice, type PickChoice } from "../domain/level-up/index";
import { DOMAIN_CARDS } from "../srd/domain-cards";
import { TRAIT_IDS, type Source, type TraitId } from "../srd/types";
import { ADVANCEMENT_OPTIONS, characterSheetSchema, type AdvancementOption, type CharacterSheet } from "../validation/characters";
import * as z from "../zod";

import { parseDraft } from "./wizard-draft";

/**
 * The pure parts of the guided level-up (plan guided-level-up, GL0): the full sheet, who may level up, option names,
 * the draft's shape, its stored schema and the checks the ribbon steps on. Framework-free (no React, no "@/"), shared by
 * the website (components/party/level-up, party/[characterId]/level-up-draft.tsx and level-up-ribbon.tsx) and the
 * phone app.
 */

/** The view's sheet with every D5 default filled in, or null for a placeholder (corrupt) sheet. */
export function fullSheet(view: CharacterView): CharacterSheet | null {
  if (view.corrupt) return null;
  const parsed = characterSheetSchema.safeParse(view.sheet);
  return parsed.success ? parsed.data : null;
}

/** Whether the viewer may level the character up (the header's ▲): owner with a pending level-up, or the GM, below the top level. */
export function canLevelUp(sheet: CharacterSheet | null, canEdit: boolean, isGm: boolean): boolean {
  return sheet !== null && canEdit && sheet.level < MAX_LEVEL && (sheet.levelUpPending || isGm);
}

export const sourcesFor = (hopeAndFear: boolean): Source[] => (hopeAndFear ? ["core", "hope-and-fear"] : ["core"]);

export const traitLabel = (t: TraitId | string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Short option names for buttons and the tier grid. */
export const OPTION_SHORT: Record<AdvancementOption, string> = {
  traits: "+1 to two unmarked traits",
  hp: "+1 Hit Point slot",
  stress: "+1 Stress slot",
  experiences: "+1 to two Experiences",
  domainCard: "Extra domain card",
  evasion: "+1 Evasion",
  subclass: "Upgraded subclass card",
  proficiency: "+1 Proficiency (both picks)",
  multiclass: "Multiclass (both picks)",
  comboDie: "Combo Die one step larger",
};

/** The board's option text in the tier boxes (Party.dc.html baseOpts / highOpts). */
export const OPTION_TEXT: Record<AdvancementOption, string> = {
  traits: "Gain a +1 bonus to two unmarked character traits and mark them.",
  hp: "Permanently gain one Hit Point slot.",
  stress: "Permanently gain one Stress slot.",
  experiences: "Permanently gain a +1 bonus to two Experiences.",
  domainCard: "Choose an additional domain card of your level or lower from a domain you have access to.",
  evasion: "Permanently gain a +1 bonus to your Evasion.",
  subclass: "Take an upgraded subclass card. Then cross out the multiclass option for this tier.",
  proficiency: "Increase your Proficiency by +1.",
  multiclass:
    "Multiclass: Choose an additional class for your character, then cross out an unused “Take an upgraded subclass card” and the other multiclass option on this sheet.",
  comboDie: "Increase your Combo Die by one step.",
};

// ---------------------------------------------------------------- the draft

/** Where a choice is made on the sheet; each has a target element `#lu-target-<id>`. */
export type LevelUpTarget = "experiences" | "advancements" | "deck";
/** A ribbon step: the targets in book order (CB 109-111), then the summary. */
export type LevelUpStepId = LevelUpTarget | "finish";

/** The choice being built: LevelUpChoice with the Experience name always present ("" until typed). */
export type LevelUpDraft = {
  picks: PickChoice[];
  experienceName: string;
  cardId: string;
  trade?: { out: string; in: string };
  multiclass?: MulticlassChoice;
  /** Plan lanes-2 E8.4 (dcm-txlu): the picks of gained cards' "when you choose this card" uses (Vitality, CB p.330). */
  cardChoices?: Record<string, Record<string, string[]>>;
};

export const EMPTY_LEVEL_UP_DRAFT: LevelUpDraft = { picks: [], experienceName: "", cardId: "" };

/** How many targets a pick takes (CB 110): two traits, two Experiences, one card. */
export const TARGET_COUNT: Partial<Record<AdvancementOption, number>> = { traits: 2, experiences: 2, domainCard: 1 };

/** Advancement picks per level (CB 110). */
export const PICKS_PER_LEVEL = 2;

/**
 * Both picks are taken and every chooser that lives in the tier boxes or Experiences is filled (the domainCard pick's
 * card is chosen in the deck). Used to move on to the Domain Deck once the advancements are done.
 */
export function advancementsChosen(draft: LevelUpDraft): boolean {
  const cost = draft.picks.reduce((sum, p) => sum + OPTION_RULES[p.option].cost, 0);
  if (cost < PICKS_PER_LEVEL) return false;
  return draft.picks.every((p) => {
    if (p.option === "multiclass") return Boolean(draft.multiclass?.classId && draft.multiclass.domainId && draft.multiclass.subclassId);
    const count = TARGET_COUNT[p.option];
    return p.option === "domainCard" || !count || (p.targets?.length ?? 0) === count;
  });
}

/**
 * The level-up draft as saved on the account (config N4 b, `drafts` kind `levelUp`, schemaVersion 1 in the envelope;
 * `parseDraft` checks both). A draft that fails it is ignored: the mode starts off.
 */
export const levelUpDraftSchema = z.object({
  /** The sheet level the draft was started at; at a different level it is ignored. */
  level: z.number(),
  step: z.enum(["experiences", "advancements", "deck", "finish"]),
  draft: z.object({
    picks: z.array(z.object({ option: z.enum(ADVANCEMENT_OPTIONS), tier: z.number(), targets: z.array(z.string()).optional() })).max(2),
    experienceName: z.string().max(200),
    cardId: z.string(),
    trade: z.object({ out: z.string(), in: z.string() }).optional(),
    multiclass: z.object({ classId: z.string(), domainId: z.string(), subclassId: z.string(), spellcastTrait: z.enum(TRAIT_IDS).optional() }).optional(),
    cardChoices: z.record(z.string(), z.record(z.string(), z.array(z.string()).max(4))).optional(),
  }),
});

/** The guided mode's state: on or off, the level it belongs to, the ribbon step and the draft. */
export type LevelUpState = { active: boolean; level: number; step: LevelUpStepId; draft: LevelUpDraft };

/**
 * The state from the account's draft (`drafts.get`'s answer, undefined while it loads): active at the stored step when
 * it parses and was started at `level`, else inactive. A stale or bad draft is left on the account; the next start
 * replaces it, and an unchanged draft expires (`draftsRetention`).
 */
export function restoreLevelUp(stored: unknown, level: number): LevelUpState {
  const parsed = parseDraft(stored, levelUpDraftSchema);
  if (parsed === null || parsed.level !== level) return { active: false, level, step: "finish", draft: EMPTY_LEVEL_UP_DRAFT };
  return { active: true, level, step: parsed.step, draft: parsed.draft };
}

/** The step list for a new level: the Experience only at achievement levels (CB 109). */
export function stepIds(level: number): LevelUpStepId[] {
  return ACHIEVEMENT_LEVELS.includes(level) ? ["experiences", "advancements", "deck", "finish"] : ["advancements", "deck", "finish"];
}

const optionLabels = Object.values(OPTION_RULES).map((r) => `${r.label}:`);

/** Where a validateLevelUp message is fixed: slot problems at the tier boxes, cards in the deck, Experiences in their box. */
export function issueTarget(message: string, sheet: Pick<CharacterSheet, "experiences">): LevelUpTarget {
  if (optionLabels.some((l) => message.startsWith(l))) return "advancements";
  if (/domain card|^Trade |deck holds|^You already have |out of reach at this level/i.test(message)) return "deck";
  if (/Experience/.test(message) || sheet.experiences.some((x) => message.startsWith(`${x.name} is already at`))) return "experiences";
  return "advancements";
}

/** The level's card and every extra domainCard pick's card are chosen, and no exchange is half set up. */
export function cardsChosen(draft: LevelUpDraft): boolean {
  if (!draft.cardId || (draft.trade && !(draft.trade.out && draft.trade.in))) return false;
  return draft.picks.every((p) => p.option !== "domainCard" || (p.targets?.length ?? 0) === 1);
}

// ---------------------------------------------------------------- the ribbon's words

/** A domain card's name by id (the id itself when unknown). */
export const cardName = (id: string) => DOMAIN_CARDS.find((c) => c.id === id)?.name ?? id;

/** The tier achievements of the new level (CB 109), as the old stepper said them. */
export function achievementText(level: number): string {
  if (!ACHIEVEMENT_LEVELS.includes(level)) return `No achievements at level ${level}. Take two advancements and the level's domain card.`;
  const clear = MARK_CLEAR_LEVELS.includes(level) ? "; the marks on your traits clear first, so you can raise them again." : ".";
  return `Level ${level} achievements: a new Experience at +2 and +1 Proficiency${clear}`;
}

/** A pick's targets in words (": Agility, Finesse"), or "" when it has none. */
export function targetNames(pick: PickChoice, sheet: CharacterSheet): string {
  const names = (pick.targets ?? []).map((t) =>
    pick.option === "traits" ? traitLabel(t) : pick.option === "experiences" ? (sheet.experiences.find((x) => x.id === t)?.name ?? t) : cardName(t),
  );
  return names.length > 0 ? `: ${names.join(", ")}` : "";
}
