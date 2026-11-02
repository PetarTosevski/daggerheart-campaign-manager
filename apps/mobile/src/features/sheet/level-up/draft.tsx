import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";

import {
  ACHIEVEMENT_LEVELS,
  availableOptions,
  OPTION_RULES,
  validateLevelUp,
  type LevelUpChoice,
  type MulticlassChoice,
  type PickChoice,
} from "../../../../../../src/lib/domain/level-up";
import { TRAIT_IDS } from "../../../../../../src/lib/srd/types";
import { ADVANCEMENT_OPTIONS, type AdvancementOption, type CharacterSheet } from "../../../../../../src/lib/validation/characters";

import { api } from "../../../convex";
import { useIntent } from "../../trackers/intent";
import type { SheetSlotProps } from "../contract";

import { canLevelUp, fullSheet } from "./shared";

export type LevelUpTarget = "experiences" | "advancements" | "deck";
export type LevelUpStepId = LevelUpTarget | "finish";

export type LevelUpDraft = {
  picks: PickChoice[];
  experienceName: string;
  cardId: string;
  trade?: { out: string; in: string };
  multiclass?: MulticlassChoice;
};

export type LevelUpStep = { id: LevelUpStepId; label: string; done: boolean };
export type LevelUpIssue = { message: string; target: LevelUpTarget };

export type LevelUpDraftValue = {
  active: boolean;
  canStart: boolean;
  level: number;
  sheet: CharacterSheet | null;
  draft: LevelUpDraft;
  choice: LevelUpChoice;
  problems: string[];
  issues: LevelUpIssue[];
  picksUsed: number;
  steps: LevelUpStep[];
  step: LevelUpStepId;
  pending: boolean;
  error: string | null;
  start: () => void;
  cancel: () => void;
  finish: () => Promise<boolean>;
  setExperienceName: (name: string) => void;
  togglePick: (option: AdvancementOption, tier: number, on?: boolean, index?: number) => void;
  setPickTargets: (option: AdvancementOption, tier: number, targets: string[], index?: number) => void;
  setCardId: (cardId: string) => void;
  setTrade: (trade: { out: string; in: string } | null) => void;
  setMulticlass: (multiclass: MulticlassChoice | null) => void;
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

const TARGET_COUNT: Partial<Record<AdvancementOption, number>> = { traits: 2, experiences: 2, domainCard: 1 };
const PICKS_PER_LEVEL = 2;

export function advancementsChosen(draft: LevelUpDraft): boolean {
  const cost = draft.picks.reduce((sum, p) => sum + OPTION_RULES[p.option].cost, 0);
  if (cost < PICKS_PER_LEVEL) return false;
  return draft.picks.every((p) => {
    if (p.option === "multiclass") return Boolean(draft.multiclass?.classId && draft.multiclass.domainId && draft.multiclass.subclassId);
    const count = TARGET_COUNT[p.option];
    return p.option === "domainCard" || !count || (p.targets?.length ?? 0) === count;
  });
}

export function cardsChosen(draft: LevelUpDraft): boolean {
  if (!draft.cardId || (draft.trade && !(draft.trade.out && draft.trade.in))) return false;
  return draft.picks.every((p) => p.option !== "domainCard" || (p.targets?.length ?? 0) === 1);
}

const optionLabels = Object.values(OPTION_RULES).map((r) => `${r.label}:`);

export function issueTarget(message: string, sheet: Pick<CharacterSheet, "experiences">): LevelUpTarget {
  if (optionLabels.some((l) => message.startsWith(l))) return "advancements";
  if (/domain card|^Trade |deck holds|^You already have |out of reach at this level/i.test(message)) return "deck";
  if (/Experience/.test(message) || sheet.experiences.some((x) => message.startsWith(`${x.name} is already at`))) return "experiences";
  return "advancements";
}

function stepIds(level: number): LevelUpStepId[] {
  return ACHIEVEMENT_LEVELS.includes(level) ? ["experiences", "advancements", "deck", "finish"] : ["advancements", "deck", "finish"];
}

type State = { active: boolean; level: number; step: LevelUpStepId; draft: LevelUpDraft };

const LevelUpDraftContext = createContext<LevelUpDraftValue | null>(null);

export function useLevelUpDraft(): LevelUpDraftValue {
  return useContext(LevelUpDraftContext) ?? INACTIVE;
}

const storedSchema = z.object({
  v: z.literal(1),
  level: z.number(),
  step: z.enum(["experiences", "advancements", "deck", "finish"]),
  draft: z.object({
    picks: z.array(z.object({ option: z.enum(ADVANCEMENT_OPTIONS), tier: z.number(), targets: z.array(z.string()).optional() })).max(2),
    experienceName: z.string().max(200),
    cardId: z.string(),
    trade: z.object({ out: z.string(), in: z.string() }).optional(),
    multiclass: z
      .object({
        classId: z.string(),
        domainId: z.string(),
        subclassId: z.string(),
        spellcastTrait: z.enum(TRAIT_IDS).optional(),
      })
      .optional(),
  }),
});

function withOptional<K extends "trade" | "multiclass">(draft: LevelUpDraft, key: K, value: LevelUpDraft[K] | null): LevelUpDraft {
  const next = { ...draft };
  if (value) next[key] = value;
  else delete next[key];
  return next;
}

export function LevelUpDraftProvider({ slot, children }: { slot: SheetSlotProps; children?: ReactNode }) {
  const { character, canEdit, isGm, hopeAndFear } = slot;
  const characterId = character._id;
  const sheet = useMemo(() => fullSheet(character), [character]);
  const sheetLevel = sheet?.level ?? character.sheet.level;
  const canStart = canLevelUp(sheet, canEdit, isGm);
  const [state, setState] = useState<State>(() => ({ active: false, level: sheetLevel, step: "finish", draft: EMPTY_DRAFT }));
  const apply = useIntent(api.levelUp.apply);

  const active = state.active && state.level === sheetLevel && canStart;
  const level = sheetLevel + 1;
  const ids = useMemo(() => stepIds(level), [level]);

  const goTo = useCallback((step: LevelUpStepId) => {
    setState((s) => (ids.includes(step) ? { ...s, step } : s));
  }, [ids]);

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

    const edit = (fn: (d: LevelUpDraft) => LevelUpDraft) => {
      if (!active) return;
      setState((s) => ({ ...s, draft: fn(s.draft) }));
      const next = fn(draft);
      if ((state.step === "advancements" || state.step === "experiences") && !advancementsChosen(draft) && advancementsChosen(next)) goTo("deck");
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
  }, [active, apply, canStart, characterId, goTo, hopeAndFear, ids, level, sheet, sheetLevel, state]);

  return <LevelUpDraftContext.Provider value={value}>{children}</LevelUpDraftContext.Provider>;
}

/** Parses a stored draft for tests; production keeps the draft in memory for the session. */
export function parseStoredDraft(raw: string, level: number): State | null {
  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.level !== level) return null;
    return { active: true, level, step: parsed.data.step, draft: parsed.data.draft };
  } catch {
    return null;
  }
}
