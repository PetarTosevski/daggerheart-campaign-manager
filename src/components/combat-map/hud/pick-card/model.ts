import type { CardUse, Cost, Gate, Step } from "@/lib/domain/card-effects/types";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { asksTriggerDamageType, swapsWithVault, withListedNumbers, type DialogRequest, type VaultPick } from "../../actions/hand/dialog";
import { areaPickOf, choicesOf, costLabel, formFor, formProblem, initialValues, rollOf, type FormValues, type HandCard, type UseForm } from "../../actions/hand/model";
import { rollProblem, type Roller, type RollValues } from "../../actions/roll-controls";
import type { PickOption, PickRowInput, PickRule, PickSelection } from "../pick";
import type { CostResource } from "../ui";

/**
 * Playing a card through the picking panel (plan combat-hud H3.1; boards CmpPicking "One target · a card", Main
 * "Picking a target"): the pure part. Every choice the classic Use dialog asks comes from the classic Hand model and
 * dialog helpers (`formFor`, `initialValues`, `formProblem`, `choicesOf`, `rollOf`, `swapsWithVault`,
 * `asksTriggerDamageType`, `withListedNumbers`): this file only turns them into the panel's rule, rider switches, footer
 * line, primary label and the `combatCards.useCard` request. No React here, so the unit tests read it directly.
 */

/** The picker's own state, kept in the session's `data` (H3.0: "keep picker state in data"). */
export type CardPickData = {
  /** The use (a grimoire's spell) being played. */
  useId: string;
  /** The classic dialog's answers (its `targets` are unused: the panel's rows pick them). */
  values: FormValues;
  /** dcm-p1r: the vault card a `swapWithVault` step brings in ("" = none picked yet). */
  swapWith: string;
  /** dcm-86z: the type of the ally's damage a "same damage" use repeats. */
  triggerType: "physical" | "magic";
};

/** One Use of one card: the session's id. One per character and card, so a grimoire keeps it across spells. */
export function cardSessionId(characterId: string, cardId: string): string {
  return `card:${characterId}:${cardId}`;
}

/** The starting answers of a use: the classic dialog's (numbers at their minimum or first listed value, default-on add-ons on). */
export function startData(use: CardUse): CardPickData {
  return { useId: use.id, values: withListedNumbers(use, initialValues(formFor(use), [])), swapWith: "", triggerType: "physical" };
}

// ---------------------------------------------------------------- the rule

/** Words for a use whose targets the player does not pick (the header's rule line). */
function noPickText(use: CardUse): string {
  const t = use.targets;
  if (areaPickOf(use)) return "Pick the square on the map next";
  if (t === undefined || t.side === "self") return "Affects you";
  if (t.side === "trigger") return "Affects the creature that set it off";
  if (t.side === "point") return "Pick the square on the map next";
  if (t.count.kind === "all") {
    const who = t.side === "enemy" ? "enemy" : t.side === "ally" ? "ally" : "creature";
    return `Every ${who} within ${RANGE_WORD[t.range] ?? t.range}`;
  }
  return "No target to pick";
}

const RANGE_WORD: Record<string, string> = {
  melee: "Melee",
  veryClose: "Very Close",
  close: "Close",
  far: "Far",
  veryFar: "Very Far",
  weapon: "your weapon’s range",
  unlimited: "any range",
};

/**
 * The panel's rule: the classic `targetAsk` when the use picks targets; otherwise a locked rule over the actor's own
 * row ("Affects you", "Every enemy within Close"), which the primary may send with no pick (`min` 0).
 */
export function ruleOf(use: CardUse, form: UseForm = formFor(use)): PickRule {
  if (form.targets) return { ...form.targets };
  return { side: "selfOrAlly", max: 1, range: "unlimited", min: 0, locked: true, text: noPickText(use) };
}

/** For a use that picks no target: the actor's own row (picked when the use is on yourself), or none. */
export function selfRows(use: CardUse, form: UseForm, actorTokenId: Id<"combatTokens"> | null): { rows?: PickRowInput[]; picked?: Id<"combatTokens">[] } {
  if (form.targets || actorTokenId === null) return {};
  const self = use.targets === undefined || use.targets.side === "self";
  return { rows: [{ tokenId: actorTokenId, name: "You", side: "self", band: null, reach: "in" }], picked: self ? [actorTokenId] : [] };
}

// ---------------------------------------------------------------- riders (optional steps) and their costs

type FoundOptional = { step: Extract<Step, { kind: "optional" }>; gates: readonly Gate[] };

/** An optional step by id, at any depth, with every gate on the way to it (its own `when` included). */
export function findOptional(steps: readonly Step[], id: string, gates: readonly Gate[] = []): FoundOptional | null {
  for (const step of steps) {
    const here = [...gates, ...(step.when ?? [])];
    if (step.kind === "optional" && step.id === id) return { step, gates: here };
    const inner =
      step.kind === "optional" || step.kind === "followUp"
        ? step.steps
        : step.kind === "choose"
          ? step.options.flatMap((o) => o.steps)
          : step.kind === "save"
            ? [...step.onFail, ...step.onSuccess]
            : step.kind === "check"
              ? [...step.then, ...step.otherwise]
              : [];
    const found = inner.length > 0 ? findOptional(inner, id, here) : null;
    if (found) return found;
  }
  return null;
}

const PILL: Partial<Record<Cost["kind"], CostResource>> = { hope: "hope", stress: "stress", fear: "fear", hp: "hp", armor: "armor" };

/** A fixed cost the HUD's pill can show ("★1"), or null (a chosen amount, tokens, gold, either-or). */
export function pillOf(cost: Cost): { amount: number; resource: CostResource } | null {
  const resource = PILL[cost.kind];
  if (!resource || !("amount" in cost) || cost.amount.kind !== "fixed") return null;
  return { amount: cost.amount.value, resource };
}

/** "Spend a Hope to Restrain …" → "Restrain …" when the pill already says what it costs. */
const COST_LEAD = /^(?:you can )?(?:spend|mark)\s+(?:an?\s+(?:additional\s+)?|\d+\s+)(?:hope|stress|fear|hit points?|armor slots?)\s*(?:to\s+|:\s*)/i;

/** When an add-on applies: "If it hits, " (an attack-like gate), "On a success, ", or nothing. */
export function gateLead(gates: readonly Gate[]): string {
  if (gates.includes("hit")) return "If it hits, also ";
  if (gates.includes("success")) return "On a success, also ";
  if (gates.includes("critical")) return "On a critical, also ";
  return "";
}

const upper = (s: string) => (s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Whether the steps hand something to the creature the player picks (`to: "picked"`), at any depth. */
function namesPicked(steps: readonly Step[]): boolean {
  return steps.some((s) => ("to" in s && s.to === "picked") || (s.kind === "redirectDamage" && s.target === "picked") || ("steps" in s && Array.isArray(s.steps) && namesPicked(s.steps as readonly Step[])));
}

export type Rider = PickOption & {
  /** The rider's own creature pick (its steps act on `picked`): its short verb for the ring label ("Restrain"). */
  picks?: string;
  /** Its fixed costs, and whether they wait for a hit / success (`gated`: the footer says "if it hits"). */
  costs: { amount: number; resource: CostResource }[];
  gated: boolean;
};

/**
 * The use's optional add-ons as rider switches (HANDOFF "Riders and options"): the label says when it applies ("If it
 * hits, also …"), a fixed cost becomes the pill, a default-on add-on starts on (the runner's own default, Banish).
 */
export function ridersOf(use: CardUse, form: UseForm = formFor(use)): Rider[] {
  return form.optionals.map((o) => {
    const found = findOptional(use.steps, o.id);
    const costs = (found?.step.costs ?? []).flatMap((c) => {
      const pill = pillOf(c);
      return pill ? [pill] : [];
    });
    const unpilled = (found?.step.costs ?? []).filter((c) => pillOf(c) === null);
    const lead = gateLead(found?.gates ?? []);
    const bare = costs.length > 0 && unpilled.length === 0 ? o.label.replace(COST_LEAD, "") : o.label;
    const label = lead ? `${lead}${bare}` : upper(bare);
    const verb = /^([a-z]+)/i.exec(bare)?.[1];
    const picks = found && namesPicked(found.step.steps) ? upper(verb ?? "Affected") : undefined;
    return {
      id: o.id,
      label,
      ...(unpilled.length > 0 ? { note: unpilled.map(costLabel).join(", ") } : {}),
      ...(costs.length === 1 ? { cost: costs[0]! } : {}),
      ...(o.defaultOn ? { defaultOn: true } : {}),
      ...(picks ? { picks } : {}),
      costs,
      gated: lead !== "",
    };
  });
}

/** The rider switches with the creature a rider names ringed under its token ("Restrain"), once one is picked. */
export function riderOptions(riders: readonly Rider[], data: CardPickData): PickOption[] {
  const picked = data.values.recipients.picked ?? [];
  return riders.map((r) => {
    const option: PickOption = {
      id: r.id,
      label: r.label,
      ...(r.note !== undefined ? { note: r.note } : {}),
      ...(r.cost ? { cost: r.cost } : {}),
      ...(r.defaultOn ? { defaultOn: true } : {}),
    };
    return r.picks && picked.length === 1 ? { ...option, tokenId: picked[0] as Id<"combatTokens">, ringLabel: r.picks } : option;
  });
}

// ---------------------------------------------------------------- the footer and the primary

const VERB: Record<CostResource, string> = { hope: "Spends", fear: "Spends", stress: "Marks", hp: "Marks", armor: "Marks" };

function costText(amount: number, resource: CostResource, hopeLeft: number | null): string {
  if (resource === "hope" && hopeLeft !== null && amount === hopeLeft) return amount === 1 ? "Spends your last Hope" : `Spends all ${amount} of your Hope`;
  const noun = resource === "hp" ? (amount === 1 ? "Hit Point" : "Hit Points") : resource === "armor" ? (amount === 1 ? "Armor Slot" : "Armor Slots") : resource === "hope" ? "Hope" : resource === "fear" ? "Fear" : "Stress";
  return `${VERB[resource]} ${amount} ${noun}`;
}

/** The fixed costs the caster pays up front (the use's `costs`, paid by the caster), by resource. */
export function upfront(use: CardUse): Map<CostResource, number> {
  const out = new Map<CostResource, number>();
  if (use.paidBy !== undefined && use.paidBy !== "self") return out;
  for (const c of use.costs ?? []) {
    const pill = pillOf(c);
    if (pill) out.set(pill.resource, (out.get(pill.resource) ?? 0) + pill.amount);
  }
  return out;
}

/**
 * The footer line (HANDOFF: "what you'll pay"): the up-front costs, then the riders that are on ("if it hits" for the
 * gated ones). "Spends your last Hope" when it takes every Hope the caster has. Null when the use costs nothing.
 */
export function payLine(use: CardUse, riders: readonly Rider[], selection: Pick<PickSelection, "options">, hope: number | null): string | null {
  const now = upfront(use);
  const later = new Map<CostResource, number>();
  for (const r of riders) {
    if (!selection.options[r.id]) continue;
    for (const c of r.costs) {
      const into = r.gated ? later : now;
      into.set(c.resource, (into.get(c.resource) ?? 0) + c.amount);
    }
  }
  const hopeNow = now.get("hope") ?? 0;
  const parts = [...now].map(([res, n]) => costText(n, res, res === "hope" ? hope : null));
  const lead = [...later].map(([res, n]) => costText(n, res, res === "hope" && hope !== null ? hope - hopeNow : null));
  if (lead.length > 0) parts.push(`${lead.join(" · ")} if it hits`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "Cast" for a spell or a grimoire, "Use" for an ability. */
export function verbOf(card: Pick<HandCard, "type">): string {
  return card.type === "ability" ? "Use" : "Cast";
}

/**
 * The one primary (HANDOFF "names the action"): "Cast on Lieutenant", "Cast on Lieutenant and Bandit", "Cast on 3
 * targets", "Cast Vicious Entangle" (no target to pick), "Place Mysterious Mist" (an area: the map asks for its square next).
 */
export function primaryLabel(card: Pick<HandCard, "type">, use: CardUse, form: UseForm, selection: Pick<PickSelection, "targets">): string {
  const verb = verbOf(card);
  const area = areaPickOf(use);
  if (area) return `Place ${area.label}`;
  const t = selection.targets;
  if (!form.targets || t.length === 0) return `${verb} ${use.name}`;
  const name = (row: (typeof t)[number]) => (row.side === "self" ? "yourself" : row.name);
  if (t.length === 1) return `${verb} on ${name(t[0]!)}`;
  if (t.length === 2) return `${verb} on ${name(t[0]!)} and ${name(t[1]!)}`;
  return `${verb} on ${t.length} targets`;
}

export type BlockContext = {
  gm: boolean;
  /** The acting character's Hope and Experiences (null while unknown: no client-side shortfall then). */
  roller: Roller | null;
  rollOptions: RollValues;
  vault: readonly VaultPick[];
};

/**
 * Why the primary can't send yet, beyond too few targets (CmpBlocked layer 1): the classic dialog's checks (a
 * situation to confirm, a choice before the roll, the GM's Difficulty, the vault card), then the up-front Hope ("Needs 1
 * Hope · you have 0") and the roll options' Hope. Hope a rider pays after the roll is never blocked here: Hope gained on
 * that roll may pay it (R8, CB p.90).
 */
export function blockedOf(use: CardUse, form: UseForm, data: CardPickData, selection: Pick<PickSelection, "targetIds">, ctx: BlockContext): string | null {
  const values: FormValues = { ...data.values, targets: form.targets ? selection.targetIds : [] };
  if (form.targets && selection.targetIds.length === 0) return null; // the panel says "Pick a target first"
  const problem = formProblem(form, values);
  if (problem) return problem.replace(/\.$/, "");
  if (form.gmDifficulty && ctx.gm && data.values.difficulty === undefined) return "Set the Difficulty";
  if (swapsWithVault(use) && data.swapWith === "") return ctx.vault.length > 0 ? "Pick a vault card" : "No vault card to swap in";
  const need = upfront(use).get("hope") ?? 0;
  const hope = ctx.roller?.hope ?? null;
  if (hope !== null && need > hope) return `Needs ${need} Hope · you have ${hope}`;
  return form.rolls ? rollProblem(ctx.roller, ctx.rollOptions) : null;
}

/**
 * The `combatCards.useCard` request of the panel's answers: the picked rows as targets, the classic `choicesOf` (the
 * rider switches as its optionals), the trigger's damage type (Encore), the classic `rollOf` (trait, the GM's Difficulty,
 * the Hand's roll options) and the vault card to swap in (dcm-p1r).
 */
export function requestOf(cardId: string, use: CardUse, form: UseForm, data: CardPickData, selection: Pick<PickSelection, "targetIds" | "options">, ctx: Pick<BlockContext, "gm" | "rollOptions">): DialogRequest {
  const optionals = Object.fromEntries(form.optionals.map((o) => [o.id, selection.options[o.id] ?? o.defaultOn]));
  const values: FormValues = { ...data.values, targets: form.targets ? selection.targetIds : [], optionals };
  const roll = rollOf(form, values, ctx.gm, ctx.rollOptions);
  return {
    cardId,
    spell: use.id,
    targetTokenIds: form.targets ? [...selection.targetIds] : [],
    choices: [...choicesOf(form, values), ...(asksTriggerDamageType(use) ? [{ id: "triggerDamageType", value: data.triggerType }] : [])],
    ...(roll ? { roll } : {}),
    ...(swapsWithVault(use) && data.swapWith !== "" ? { swapWith: data.swapWith } : {}),
  };
}

