"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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
import { cardChoiceAsks, cardChoiceProblems, cardChoicesFor, type CardChoiceAsk } from "@/lib/domain/level-up/card-choices";
import { cardsGained } from "@/lib/domain/level-up/on-choose";
import {
  EMPTY_LEVEL_UP_DRAFT,
  PICKS_PER_LEVEL,
  TARGET_COUNT,
  advancementsChosen,
  canLevelUp,
  cardsChosen,
  fullSheet,
  issueTarget,
  restoreLevelUp,
  stepIds,
  type LevelUpDraft,
  type LevelUpState,
  type LevelUpStepId,
  type LevelUpTarget,
} from "@/lib/party/level-up";
import { useIntent } from "@/lib/use-intent";
import type { AdvancementOption, CharacterSheet } from "@/lib/validation/characters";
import { prefersReducedMotion } from "@/lib/use-reduced-motion";

import { api } from "../../../../../../../convex/_generated/api";
import { useAccountDraft } from "../new/draft";

// Guided level-up (plan guided-level-up, GL0). The sheet provides one LevelUpDraft per character; the ribbon and
// the sections (Experiences, tier boxes, Domain Deck) read and change it through useLevelUpDraft(). The draft is
// submitted once, as the LevelUpChoice levelUp.apply already takes. API and target ids: docs/tasks/TASK-GL0.md. The pure
// parts (draft shape, stored schema, step checks) live in src/lib/party/level-up.ts, shared with the phone app.

// sections/identity.tsx imports these two from here.
export { advancementsChosen, cardsChosen } from "@/lib/party/level-up";

export type SheetPage = "sheet" | "story" | "domains";
export type SheetCollection = "cards" | "heritage";

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
  /** What the gained cards' "when you choose this card" uses ask (Vitality's two benefits); empty for most cards. */
  cardAsks: CardChoiceAsk[];
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
  /** Sets the options picked for a gained card's choose step (`cardAsks`). */
  setCardChoice: (cardId: string, stepId: string, optionIds: string[]) => void;
  /** Shows the step: sets the page (and Domains sub-tab), scrolls its target into view and focuses its heading. */
  goTo: (step: LevelUpStepId) => void;
};

const NO_STEPS: LevelUpStep[] = [];
const noop = () => {};

const INACTIVE: LevelUpDraftValue = {
  active: false,
  canStart: false,
  level: 0,
  sheet: null,
  draft: EMPTY_LEVEL_UP_DRAFT,
  choice: { picks: [], cardId: "" },
  problems: [],
  issues: [],
  picksUsed: 0,
  cardAsks: [],
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
  setCardChoice: noop,
  goTo: noop,
};

/** Page, sub-tab and target element of each step. */
const NAV: Record<LevelUpStepId, { page?: SheetPage; collection?: SheetCollection; id: string }> = {
  experiences: { page: "sheet", id: "lu-target-experiences" },
  advancements: { page: "story", id: "lu-target-advancements" },
  deck: { page: "domains", collection: "cards", id: "lu-target-deck" },
  finish: { id: "lu-ribbon-summary" },
};

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
  // Config N4 b: the unconfirmed picks are saved on the account (another tab or device picks them up). Only a viewer
  // who may level this character reads it (drafts.get needs edit on the character).
  const account = useAccountDraft({ kind: "levelUp", characterId }, { enabled: canStart });
  const fromAccount = useMemo(() => restoreLevelUp(account.stored, sheetLevel), [account.stored, sheetLevel]);
  // The state since the viewer's first change; until then the account's draft is the state (no copy in an effect).
  const [local, setLocal] = useState<LevelUpState | null>(null);
  // The latest committed state, read by handlers that run before the next render (two changes in one event).
  const latest = useRef<LevelUpState | null>(null);
  const state = local ?? fromAccount;
  const [focusRequest, setFocusRequest] = useState<{ step: LevelUpStepId; n: number } | null>(null);
  const apply = useIntent(api.levelUp.apply);

  // A draft belongs to the level it was started at; a level change (undo, GM correction, finish) ends it.
  const active = state.active && state.level === sheetLevel && canStart;
  const level = sheetLevel + 1;
  const ids = useMemo(() => stepIds(level), [level]);
  const { save: saveDraft, clear: clearDraft } = account;

  /** Sets the state and, while it is a live draft, saves it on the account (from the change handler, rule 13). */
  const commit = useCallback(
    (next: LevelUpState, typed = false) => {
      latest.current = next;
      setLocal(next);
      if (next.active && next.level === sheetLevel && canStart) saveDraft({ level: next.level, step: next.step, draft: next.draft }, { typed });
    },
    [canStart, saveDraft, sheetLevel],
  );

  /** Ends the mode and deletes the account's draft (Cancel, or a level-up applied). */
  const end = useCallback(() => {
    const next: LevelUpState = { ...(latest.current ?? fromAccount), active: false, draft: EMPTY_LEVEL_UP_DRAFT };
    latest.current = next;
    setLocal(next);
    clearDraft();
  }, [clearDraft, fromAccount]);

  // After a goTo has rendered the step's page, bring its target into view and focus its heading.
  useEffect(() => {
    if (focusRequest) focusTarget(focusRequest.step);
  }, [focusRequest]);

  const goTo = useCallback(
    (step: LevelUpStepId) => {
      const nav = NAV[step];
      if (nav.page) navigate(nav.page, nav.collection);
      const s = latest.current ?? fromAccount;
      if (ids.includes(step) && s.step !== step) commit({ ...s, step });
      setFocusRequest((r) => ({ step, n: (r?.n ?? 0) + 1 }));
    },
    [commit, fromAccount, ids, navigate],
  );

  const value = useMemo<LevelUpDraftValue>(() => {
    const draft = active ? state.draft : EMPTY_LEVEL_UP_DRAFT;
    const achievement = ACHIEVEMENT_LEVELS.includes(level);
    const takesMulticlass = draft.picks.some((p) => p.option === "multiclass");
    // dcm-txlu: the gained cards' choosing picks (Vitality's two benefits), asked here and sent as `cardChoices`.
    const gained = cardsGained({ cardId: draft.cardId, picks: draft.picks, ...(draft.trade?.in ? { tradeIn: draft.trade.in } : {}) });
    const cardAsks = active ? cardChoiceAsks(gained) : [];
    const cardChoices = cardChoicesFor(cardAsks, draft.cardChoices ?? {});
    const choice: LevelUpChoice = {
      picks: draft.picks.map(({ option, tier, targets }) => (targets ? { option, tier, targets } : { option, tier })),
      cardId: draft.cardId,
      ...(achievement ? { experienceName: draft.experienceName.trim() } : {}),
      ...(draft.trade?.out && draft.trade.in ? { trade: draft.trade } : {}),
      ...(takesMulticlass && draft.multiclass ? { multiclass: draft.multiclass } : {}),
      ...(Object.keys(cardChoices).length > 0 ? { cardChoices } : {}),
    };
    const ruleProblems = active && sheet ? validateLevelUp(sheet, choice, { allowExpansion: hopeAndFear }) : [];
    const cardProblems = active && sheet ? cardChoiceProblems(cardAsks, cardChoices) : [];
    const problems = [...ruleProblems, ...cardProblems];
    const issues = sheet
      ? [...ruleProblems.map((message) => ({ message, target: issueTarget(message, sheet) })), ...cardProblems.map((message) => ({ message, target: "deck" as const }))]
      : [];
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
    const edit = (fn: (d: LevelUpDraft) => LevelUpDraft, typed = false) => {
      if (!active) return;
      const s = latest.current ?? state;
      const next = fn(s.draft);
      commit({ ...s, draft: next }, typed);
      // The edit that completes the advancements takes the player on to the Domain Deck (user request 2026-10-18).
      if ((s.step === "advancements" || s.step === "experiences") && !advancementsChosen(s.draft) && advancementsChosen(next)) goTo("deck");
      // Choosing the last card in the deck goes on to the summary (user request 2026-10-18).
      else if (s.step === "deck" && advancementsChosen(next) && !cardsChosen(s.draft) && cardsChosen(next)) goTo("finish");
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
      cardAsks,
      steps,
      step: active ? state.step : "finish",
      pending: apply.pending,
      error: apply.error,
      start: () => {
        if (!canStart) return;
        apply.clearError();
        const first = ids[0] ?? "finish";
        commit({ active: true, level: sheetLevel, step: first, draft: EMPTY_LEVEL_UP_DRAFT });
        const nav = NAV[first];
        if (nav.page) navigate(nav.page, nav.collection);
        setFocusRequest((r) => ({ step: first, n: (r?.n ?? 0) + 1 }));
      },
      cancel: () => {
        apply.clearError();
        end();
      },
      finish: async () => {
        if (!active || problems.length > 0) return false;
        const result = await apply.fire({ characterId, choice });
        if (!result) return false;
        end();
        return true;
      },
      setExperienceName: (name) => edit((d) => ({ ...d, experienceName: name.slice(0, 200) }), true),
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
      setCardChoice: (cardId, stepId, optionIds) =>
        edit((d) => ({ ...d, cardChoices: { ...d.cardChoices, [cardId]: { ...d.cardChoices?.[cardId], [stepId]: [...new Set(optionIds)].slice(0, 4) } } })),
      goTo,
    };
  }, [active, apply, canStart, characterId, commit, end, goTo, hopeAndFear, ids, level, navigate, sheet, sheetLevel, state]);

  return (
    <LevelUpDraftContext.Provider value={value}>
      {children}
      <LevelUpCardChoices />
    </LevelUpDraftContext.Provider>
  );
}

/**
 * Plan lanes-2 E8.4 (dcm-txlu; user 2026-10-31: plain minimal UI, a later redesign restyles it): the picks a gained card
 * asks when it is chosen (Vitality, CB p.330: "permanently gain two of the following benefits"), as check boxes, shown
 * from the Domain card step on while such a card is in the draft. Renders nothing otherwise.
 */
export function LevelUpCardChoices() {
  const lu = useLevelUpDraft();
  if (!lu.active || lu.cardAsks.length === 0 || (lu.step !== "deck" && lu.step !== "finish")) return null;
  return (
    <section className="lu-ribbon lu-card-choices" aria-label="Card choices">
      {lu.cardAsks.map((ask) => {
        const picked = lu.choice.cardChoices?.[ask.cardId]?.[ask.stepId] ?? [];
        const full = picked.length >= ask.count;
        return (
          <fieldset key={`${ask.cardId}:${ask.stepId}`} className="lu-rb-summary">
            <legend className="lu-rb-sub">
              {ask.name}: {ask.label} (choose {ask.count})
            </legend>
            {ask.options.map((o) => {
              const on = picked.includes(o.id);
              return (
                <label key={o.id} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && full}
                    onChange={(e) => lu.setCardChoice(ask.cardId, ask.stepId, e.target.checked ? [...picked, o.id] : picked.filter((id) => id !== o.id))}
                  />{" "}
                  {o.label}
                </label>
              );
            })}
          </fieldset>
        );
      })}
    </section>
  );
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
  // jsdom has no layout, so no scrollIntoView.
  target.scrollIntoView?.({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
}
