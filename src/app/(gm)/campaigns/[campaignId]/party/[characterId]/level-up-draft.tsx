"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";

import { canLevelUp, fullSheet } from "@/components/party/level-up/shared";
import type { SlotProps } from "@/components/party/slots";
import {
  ACHIEVEMENT_LEVELS,
  availableOptions,
  OPTION_RULES,
  validateLevelUp,
  type LevelUpChoice,
  type MulticlassChoice,
  type PickChoice,
} from "@/lib/domain/level-up";
import { useIntent } from "@/lib/use-intent";
import { ADVANCEMENT_OPTIONS, type AdvancementOption, type CharacterSheet } from "@/lib/validation/characters";

import { api } from "../../../../../../../convex/_generated/api";

// Guided level-up (plan guided-level-up, GL0). The sheet provides one LevelUpDraft per character; the ribbon and
// the sections (Experiences, tier boxes, Domain Deck) read and change it through useLevelUpDraft(). The draft is
// submitted once, as the LevelUpChoice levelUp.apply already takes. API and target ids: docs/tasks/TASK-GL0.md.

/** Where a choice is made on the sheet; each has a target element `#lu-target-<id>`. */
export type LevelUpTarget = "experiences" | "advancements" | "deck";
/** A ribbon step: the targets in book order (CB 109-111), then the summary. */
export type LevelUpStepId = LevelUpTarget | "finish";
export type SheetPage = "sheet" | "story" | "domains";
export type SheetCollection = "cards" | "heritage";

/** The choice being built: LevelUpChoice with the Experience name always present ("" until typed). */
export type LevelUpDraft = {
  picks: PickChoice[];
  experienceName: string;
  cardId: string;
  trade?: { out: string; in: string };
  multiclass?: MulticlassChoice;
};

export type LevelUpStep = { id: LevelUpStepId; label: string; done: boolean };
/** A validateLevelUp problem with the place it is fixed. */
export type LevelUpIssue = { message: string; target: LevelUpTarget };

export type LevelUpDraftValue = {
  /** The guided mode is on (and the draft belongs to the sheet's current level). */
  active: boolean;
  /** The viewer may start a level-up (the header's ▲). */
  canStart: boolean;
  /** The new level (sheet level + 1). */
  level: number;
  /** The full sheet the draft is checked against, or null (corrupt sheet or no provider). */
  sheet: CharacterSheet | null;
  draft: LevelUpDraft;
  /** The LevelUpChoice levelUp.apply receives. */
  choice: LevelUpChoice;
  /** validateLevelUp(sheet, choice); empty when Finish may run. */
  problems: string[];
  /** The same problems, each with the target that fixes it. */
  issues: LevelUpIssue[];
  /** Picks used of the level's two (Proficiency and multiclass cost both). */
  picksUsed: number;
  steps: LevelUpStep[];
  step: LevelUpStepId;
  pending: boolean;
  error: string | null;
  start: () => void;
  cancel: () => void;
  /** Calls levelUp.apply with `choice`; true on success (the mode ends and the draft is dropped). */
  finish: () => Promise<boolean>;
  setExperienceName: (name: string) => void;
  /** Adds (on = true), removes (on = false) or toggles (on omitted) a pick of `option` in `tier`, within the rules. */
  /** Adds (on) or removes (off) a pick; `index` removes that pick of the option and tier (default: the latest). */
  togglePick: (option: AdvancementOption, tier: number, on?: boolean, index?: number) => void;
  /**
   * Sets the targets (traits, Experience ids or a card id) of the draft's pick of `option` in `tier`; `index` picks
   * which one when the level takes it more than once (0, the default, is the first).
   */
  setPickTargets: (option: AdvancementOption, tier: number, targets: string[], index?: number) => void;
  setCardId: (cardId: string) => void;
  setTrade: (trade: { out: string; in: string } | null) => void;
  setMulticlass: (multiclass: MulticlassChoice | null) => void;
  /** Shows the step: sets the page (and Domains sub-tab), scrolls its target into view and focuses its heading. */
  goTo: (step: LevelUpStepId) => void;
};

const EMPTY_DRAFT: LevelUpDraft = { picks: [], experienceName: "", cardId: "" };
const NO_STEPS: LevelUpStep[] = [];
const noop = () => {};

const INACTIVE: LevelUpDraftValue = {
  active: false,
  canStart: false,
  level: 0,
  sheet: null,
  draft: EMPTY_DRAFT,
  choice: { picks: [], cardId: "" },
  problems: [],
  issues: [],
  picksUsed: 0,
  steps: NO_STEPS,
  step: "finish",
  pending: false,
  error: null,
  start: noop,
  cancel: noop,
  finish: () => Promise.resolve(false),
  setExperienceName: noop,
  togglePick: noop,
  setPickTargets: noop,
  setCardId: noop,
  setTrade: noop,
  setMulticlass: noop,
  goTo: noop,
};

/** Page, sub-tab and target element of each step. */
const NAV: Record<LevelUpStepId, { page?: SheetPage; collection?: SheetCollection; id: string }> = {
  experiences: { page: "sheet", id: "lu-target-experiences" },
  advancements: { page: "story", id: "lu-target-advancements" },
  deck: { page: "domains", collection: "cards", id: "lu-target-deck" },
  finish: { id: "lu-ribbon-summary" },
};

/** How many targets a pick takes (CB 110): two traits, two Experiences, one card. */
const TARGET_COUNT: Partial<Record<AdvancementOption, number>> = { traits: 2, experiences: 2, domainCard: 1 };

const PICKS_PER_LEVEL = 2;

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

const storageKey = (characterId: string) => `dcm:level-up-draft:${characterId}`;

const storedSchema = z.object({
  v: z.literal(1),
  /** The sheet level the draft was started at; a different level drops it. */
  level: z.number(),
  step: z.enum(["experiences", "advancements", "deck", "finish"]),
  draft: z.object({
    picks: z.array(z.object({ option: z.enum(ADVANCEMENT_OPTIONS), tier: z.number(), targets: z.array(z.string()).optional() })).max(2),
    experienceName: z.string().max(200),
    cardId: z.string(),
    trade: z.object({ out: z.string(), in: z.string() }).optional(),
    multiclass: z.object({ classId: z.string(), domainId: z.string(), subclassId: z.string() }).optional(),
  }),
});

type State = { active: boolean; level: number; step: LevelUpStepId; draft: LevelUpDraft };

/** The stored draft for the character at `level`, or an inactive state; a draft from another level is removed. */
function restore(characterId: string, level: number): State {
  const inactive: State = { active: false, level, step: "finish", draft: EMPTY_DRAFT };
  try {
    const raw = window.sessionStorage.getItem(storageKey(characterId));
    if (raw === null) return inactive;
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.level !== level) {
      window.sessionStorage.removeItem(storageKey(characterId));
      return inactive;
    }
    return { active: true, level, step: parsed.data.step, draft: parsed.data.draft };
  } catch {
    return inactive;
  }
}

/** The step list for a new level: the Experience only at achievement levels (CB 109). */
function stepIds(level: number): LevelUpStepId[] {
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

const LevelUpDraftContext = createContext<LevelUpDraftValue | null>(null);

/** The level-up draft; outside the provider (or for viewers who cannot level) an inactive value whose actions do nothing. */
export function useLevelUpDraft(): LevelUpDraftValue {
  return useContext(LevelUpDraftContext) ?? INACTIVE;
}

/** Holds the character's level-up draft. `navigate` switches the sheet's page tab and Domains sub-tab. */
export function LevelUpDraftProvider({
  slot,
  navigate = noop,
  children,
}: {
  slot: SlotProps;
  navigate?: (page: SheetPage, collection?: SheetCollection) => void;
  children?: ReactNode;
}) {
  const { character, canEdit, isGm, hopeAndFear } = slot;
  const characterId = character._id;
  const sheet = useMemo(() => fullSheet(character), [character]);
  const sheetLevel = sheet?.level ?? character.sheet.level;
  const canStart = canLevelUp(sheet, canEdit, isGm);
  const [state, setState] = useState<State>(() => restore(characterId, sheetLevel));
  const [focusRequest, setFocusRequest] = useState<{ step: LevelUpStepId; n: number } | null>(null);
  const apply = useIntent(api.levelUp.apply);

  // A draft belongs to the level it was started at; a level change (undo, GM correction, finish) ends it.
  const active = state.active && state.level === sheetLevel && canStart;
  const level = sheetLevel + 1;
  const ids = useMemo(() => stepIds(level), [level]);

  // sessionStorage is the outside system kept in step with the draft (so a reload keeps it).
  useEffect(() => {
    try {
      if (active) window.sessionStorage.setItem(storageKey(characterId), JSON.stringify({ v: 1, level: state.level, step: state.step, draft: state.draft }));
      else window.sessionStorage.removeItem(storageKey(characterId));
    } catch {
      // Storage blocked (private mode, previews): the draft lives for this page only.
    }
  }, [active, characterId, state]);

  // After a goTo has rendered the step's page, bring its target into view and focus its heading.
  useEffect(() => {
    if (focusRequest) focusTarget(focusRequest.step);
  }, [focusRequest]);

  const goTo = useCallback(
    (step: LevelUpStepId) => {
      const nav = NAV[step];
      if (nav.page) navigate(nav.page, nav.collection);
      setState((s) => (ids.includes(step) ? { ...s, step } : s));
      setFocusRequest((r) => ({ step, n: (r?.n ?? 0) + 1 }));
    },
    [ids, navigate],
  );

  const value = useMemo<LevelUpDraftValue>(() => {
    const draft = active ? state.draft : EMPTY_DRAFT;
    const achievement = ACHIEVEMENT_LEVELS.includes(level);
    const takesMulticlass = draft.picks.some((p) => p.option === "multiclass");
    const choice: LevelUpChoice = {
      picks: draft.picks.map(({ option, tier, targets }) => (targets ? { option, tier, targets } : { option, tier })),
      cardId: draft.cardId,
      ...(achievement ? { experienceName: draft.experienceName.trim() } : {}),
      ...(draft.trade?.out && draft.trade.in ? { trade: draft.trade } : {}),
      ...(takesMulticlass && draft.multiclass ? { multiclass: draft.multiclass } : {}),
    };
    const problems = active && sheet ? validateLevelUp(sheet, choice, { allowExpansion: hopeAndFear }) : [];
    const issues = sheet ? problems.map((message) => ({ message, target: issueTarget(message, sheet) })) : [];
    const stepOf = (target: LevelUpTarget): LevelUpStepId => (ids.includes(target) ? target : "advancements");
    const picksUsed = draft.picks.reduce((sum, p) => sum + OPTION_RULES[p.option].cost, 0);
    const label: Record<LevelUpStepId, string> = {
      experiences: "New Experience",
      advancements: `Advancements (${picksUsed}/${PICKS_PER_LEVEL})`,
      deck: "Domain card",
      finish: "Finish",
    };
    const steps = active
      ? ids.map((id) => ({ id, label: label[id], done: id === "finish" ? problems.length === 0 : !issues.some((i) => stepOf(i.target) === id) }))
      : NO_STEPS;

    /** Changes the draft while the mode is on. */
    const edit = (fn: (d: LevelUpDraft) => LevelUpDraft) => {
      if (!active) return;
      setState((s) => ({ ...s, draft: fn(s.draft) }));
      // The edit that completes the advancements takes the player on to the Domain Deck (user request 2026-10-18).
      const next = fn(draft);
      if ((state.step === "advancements" || state.step === "experiences") && !advancementsChosen(draft) && advancementsChosen(next)) goTo("deck");
      // Choosing the last card in the deck goes on to the summary (user request 2026-10-18).
      else if (state.step === "deck" && advancementsChosen(next) && !cardsChosen(draft) && cardsChosen(next)) goTo("finish");
    };
    const same = (option: AdvancementOption, tier: number) => (p: PickChoice) => p.option === option && p.tier === tier;

    return {
      active,
      canStart,
      level,
      sheet,
      draft,
      choice,
      problems,
      issues,
      picksUsed,
      steps,
      step: active ? state.step : "finish",
      pending: apply.pending,
      error: apply.error,
      start: () => {
        if (!canStart) return;
        apply.clearError();
        const first = ids[0] ?? "finish";
        setState({ active: true, level: sheetLevel, step: first, draft: EMPTY_DRAFT });
        const nav = NAV[first];
        if (nav.page) navigate(nav.page, nav.collection);
        setFocusRequest((r) => ({ step: first, n: (r?.n ?? 0) + 1 }));
      },
      cancel: () => {
        apply.clearError();
        setState((s) => ({ ...s, active: false, draft: EMPTY_DRAFT }));
      },
      finish: async () => {
        if (!active || problems.length > 0) return false;
        const result = await apply.fire({ characterId, choice });
        if (!result) return false;
        setState((s) => ({ ...s, active: false, draft: EMPTY_DRAFT }));
        return true;
      },
      setExperienceName: (name) => edit((d) => ({ ...d, experienceName: name.slice(0, 200) })),
      togglePick: (option, tier, on, which) =>
        edit((d) => {
          const matches = d.picks.map((p, i) => (same(option, tier)(p) ? i : -1)).filter((i) => i !== -1);
          // Unticking a box removes that box's pick (with its chosen targets), not just the latest one.
          const index = which !== undefined && on === false ? (matches[which] ?? -1) : (matches.at(-1) ?? -1);
          if (!(on ?? index === -1)) return index === -1 ? d : { ...d, picks: d.picks.filter((_, i) => i !== index) };
          const slotInfo = sheet ? availableOptions(sheet).find((o) => o.option === option && o.tier === tier) : undefined;
          const cost = d.picks.reduce((sum, p) => sum + OPTION_RULES[p.option].cost, 0);
          const takenNow = d.picks.filter(same(option, tier)).length;
          if (!slotInfo || slotInfo.blocked !== null || cost + slotInfo.cost > PICKS_PER_LEVEL || slotInfo.used + takenNow >= slotInfo.slots) return d;
          return { ...d, picks: [...d.picks, TARGET_COUNT[option] ? { option, tier, targets: [] } : { option, tier }] };
        }),
      setPickTargets: (option, tier, targets, index = 0) =>
        edit((d) => {
          const at = d.picks.map((p, i) => (same(option, tier)(p) ? i : -1)).filter((i) => i !== -1)[index];
          const count = TARGET_COUNT[option];
          if (at === undefined || !count) return d;
          return { ...d, picks: d.picks.map((p, i) => (i === at ? { ...p, targets: [...new Set(targets)].slice(0, count) } : p)) };
        }),
      setCardId: (cardId) => edit((d) => ({ ...d, cardId })),
      setTrade: (trade) => edit((d) => withOptional(d, "trade", trade)),
      setMulticlass: (multiclass) => edit((d) => withOptional(d, "multiclass", multiclass)),
      goTo,
    };
  }, [active, apply, canStart, characterId, goTo, hopeAndFear, ids, level, navigate, sheet, sheetLevel, state]);

  return <LevelUpDraftContext.Provider value={value}>{children}</LevelUpDraftContext.Provider>;
}

/** The draft with an optional field set, or removed when `value` is null. */
function withOptional<K extends "trade" | "multiclass">(draft: LevelUpDraft, key: K, value: LevelUpDraft[K] | null): LevelUpDraft {
  const next = { ...draft };
  if (value) next[key] = value;
  else delete next[key];
  return next;
}

/** Scrolls the step's target into view and focuses its heading; with no target, focuses the page tab. */
function focusTarget(step: LevelUpStepId) {
  const nav = NAV[step];
  const target = document.getElementById(nav.id);
  if (!target) {
    document.getElementById(nav.page ? `tab-${nav.page}` : "lu-ribbon-title")?.focus();
    return;
  }
  const heading = target.matches("h1, h2, h3, h4") ? target : target.querySelector<HTMLElement>("h1, h2, h3, h4");
  const focusable = heading ?? target;
  if (!focusable.hasAttribute("tabindex")) focusable.setAttribute("tabindex", "-1");
  focusable.focus({ preventScroll: true });
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  // jsdom has no layout, so no scrollIntoView.
  target.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
}
