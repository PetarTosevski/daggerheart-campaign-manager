import type { FunctionReturnType } from "convex/server";

import type { CardEffect, CardUse, Cost, Limit, NumberSource, Step, TargetSpec } from "@/lib/domain/card-effects/types";
import type { TraitId } from "@/lib/srd/types";

import type { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { RollValues } from "../roll-controls";

/**
 * The Hand's pure model (plan combat-actions CA6): what a card use asks before it runs, read from the card's effect
 * entry (src/lib/srd/card-effects, the same table the server runs), and how the answers become `combatCards.useCard`'s
 * `targetTokenIds` and `choices` (the flat `{id, value}` list; ids in convex/lib/cardRunner.ts `parseChoices`).
 * No React here, so the unit tests read it directly.
 */

export type HandView = FunctionReturnType<typeof api.combatCards.hand>;
export type HandCard = HandView["loadout"][number];
export type HandUse = HandCard["uses"][number];
export type UseOutcome = FunctionReturnType<typeof api.combatCards.useCard>;
export type ResolvedUse = Extract<UseOutcome, { status: "resolved" }>;
export type NeedsChoice = Extract<UseOutcome, { status: "needsChoice" }>;
export type ChoiceAsk = NeedsChoice["asks"][number];
export type CardChoice = { id: string; value: number | string | string[] | boolean };

/** A creature on the map the dialog can offer: the actor ("self"), another PC, an enemy, an ally or a neutral token. */
export type Creature = { tokenId: Id<"combatTokens">; name: string; side: "self" | "pc" | "enemy" | "ally" | "neutral" };

/** Who a use's own targets are, when the player picks them. `max` null: several, no fixed cap the client knows. */
export type TargetAsk = { side: "enemy" | "ally" | "selfOrAlly" | "any"; max: number | null; range: string };

export type RecipientKey = "picked" | "allies" | "followUp";

/** Everything a use asks before it runs. Choices that come after the roll arrive as the server's `needsChoice`. */
export type UseForm = {
  targets: TargetAsk | null;
  numbers: { id: string; label: string; min: number; max: number | null }[];
  eithers: { index: number; options: string[] }[];
  situations: string[];
  optionals: { id: string; label: string; defaultOn: boolean }[];
  recipients: { key: RecipientKey; label: string; side: TargetSpec["side"] }[];
  /** The use attacks or deals damage with "one of your active weapons" (`weapon: "either"`). */
  weapon: boolean;
  /** "an Agility or Strength Roll": the player picks the trait. */
  traits: TraitId[] | null;
  /** The card's roll has no number: the GM sets it (CB p.157). Only the GM can fill it. */
  gmDifficulty: boolean;
  /** `choose` steps asked before the roll (`timing: "beforeRoll"`). */
  choose: { stepId: string; label: string; options: { id: string; label: string }[]; count: number | null }[];
  /** The use makes an action roll: the Hand's roll-options strip applies to it (Experiences, advantage, Help; F8-I1). */
  rolls: boolean;
};

/** Optional steps the server takes unless declined (convex/lib/cardRunner.ts `DEFAULT_OPTIONALS`). */
const DEFAULT_ON: ReadonlySet<string> = new Set(["banish"]);

const RESOURCE_WORD: Record<Cost["kind"], string> = {
  hope: "Hope",
  stress: "Stress",
  hp: "Hit Point",
  armor: "Armor Slot",
  tokens: "token",
  fear: "Fear",
  gold: "handful of gold",
  either: "",
};

const fixedOf = (n: NumberSource | undefined): number | null => (n?.kind === "fixed" ? n.value : null);

/** "1 Hope", "2 Stress", "Hope": a cost as the dialog reads it. */
export function costLabel(cost: Cost): string {
  if (cost.kind === "either") return cost.options.map((o) => o.map(costLabel).join(" and ")).join(" or ");
  if (cost.kind === "gold") return `${cost.handfuls} ${RESOURCE_WORD.gold}`;
  const n = fixedOf(cost.amount);
  return n === null ? RESOURCE_WORD[cost.kind] : `${n} ${RESOURCE_WORD[cost.kind]}`;
}

function maxOf(spec: TargetSpec): number | null {
  const c = spec.count;
  if (c.kind === "one") return 1;
  if (c.kind === "upTo") return fixedOf(c.n);
  if (c.kind === "any") return fixedOf(c.max);
  return null;
}

/** The use's own target pick, or null when the player picks none (self, all in range, a point, the trigger). */
export function targetAsk(use: Pick<CardUse, "targets">): TargetAsk | null {
  const t = use.targets;
  if (t === undefined || t.side === "trigger" || t.side === "self" || t.side === "point" || t.side === "object") return null;
  if (t.count.kind === "all") return null;
  return { side: t.side, max: maxOf(t), range: t.range };
}

const RECIPIENT_LABEL: Record<RecipientKey, string> = {
  picked: "Who it affects",
  allies: "Allies it affects",
  followUp: "Other targets",
};

/** Walks every step of a use, nested ones included (optional, choose, save, check, followUp). */
function eachStep(steps: readonly Step[], visit: (step: Step) => void): void {
  for (const step of steps) {
    visit(step);
    if (step.kind === "optional" || step.kind === "followUp") eachStep(step.steps, visit);
    else if (step.kind === "choose") for (const o of step.options) eachStep(o.steps, visit);
    else if (step.kind === "save") {
      eachStep(step.onFail, visit);
      eachStep(step.onSuccess, visit);
    } else if (step.kind === "check") {
      eachStep(step.then, visit);
      eachStep(step.otherwise, visit);
    }
  }
}

/** Whether anything in the use names `weapon: "either"` (an attack roll or weapon damage on "one of your active weapons"). */
function usesEitherWeapon(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(usesEitherWeapon);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([k, v]) => (k === "weapon" && v === "either") || usesEitherWeapon(v));
}

/** What a use asks before it runs. */
export function formFor(use: CardUse): UseForm {
  const form: UseForm = {
    targets: targetAsk(use),
    numbers: (use.choices ?? []).map((c) => ({ id: c.id, label: c.label, min: c.min, max: fixedOf(c.max) })),
    eithers: [],
    situations: (use.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : [])),
    optionals: [],
    recipients: [],
    weapon: usesEitherWeapon(use.roll) || usesEitherWeapon(use.steps),
    traits: use.roll?.kind === "trait" && Array.isArray(use.roll.trait) ? [...(use.roll.trait as readonly TraitId[])] : null,
    gmDifficulty: use.roll !== undefined && "difficulty" in use.roll && use.roll.difficulty.kind === "gm",
    choose: [],
    rolls: use.roll !== undefined,
  };
  // "either" costs are counted in the order the runner pays them: upfront costs, then the steps' costs.
  const eitherCosts: Cost[] = (use.costs ?? []).filter((c) => c.kind === "either");
  const seen = new Set<RecipientKey>();
  const addRecipient = (key: RecipientKey, side: TargetSpec["side"]) => {
    if (seen.has(key)) return;
    seen.add(key);
    form.recipients.push({ key, label: RECIPIENT_LABEL[key], side });
  };
  eachStep(use.steps, (step) => {
    if (step.kind === "pay" || step.kind === "optional") eitherCosts.push(...(step.costs ?? []).filter((c) => c.kind === "either"));
    if (step.kind === "optional") form.optionals.push({ id: step.id, label: step.label, defaultOn: DEFAULT_ON.has(step.id) });
    if (step.kind === "choose" && step.timing === "beforeRoll") {
      form.choose.push({ stepId: step.id, label: step.label, options: step.options.map((o) => ({ id: o.id, label: o.label })), count: fixedOf(step.count) ?? (step.count ? null : 1) });
    }
    if (step.kind === "followUp") addRecipient("followUp", step.targets.side);
    if ("to" in step) {
      const pickSide = "pick" in step && step.pick ? step.pick.side : undefined;
      if (step.to === "picked") addRecipient("picked", pickSide ?? "any");
      else if (step.to === "allies" || step.to === "selfAndAllies") addRecipient("allies", pickSide ?? "ally");
    }
    if (step.kind === "redirectDamage" && step.target === "picked") addRecipient("picked", step.pick?.side ?? "enemy");
  });
  form.eithers = eitherCosts.flatMap((c, index) => (c.kind === "either" ? [{ index, options: c.options.map((o) => o.map(costLabel).join(" and ")) }] : []));
  return form;
}

/** The uses the Hand can start: action uses. Reactions, riders and automatic parts run from their triggers. */
export function playableUses(card: Pick<HandCard, "uses" | "state">): HandUse[] {
  if (card.state === "outOfCombat") return [];
  return card.uses.filter((u) => u.activation === "action");
}

/** Whether the creature fits a side a card names. */
export function fitsSide(c: Creature, side: TargetSpec["side"]): boolean {
  switch (side) {
    case "self":
      return c.side === "self";
    case "enemy":
      return c.side === "enemy";
    case "ally":
      return c.side === "pc" || c.side === "ally";
    case "selfOrAlly":
      return c.side === "self" || c.side === "pc" || c.side === "ally";
    case "any":
      return true;
    case "point":
    case "object":
      return false;
  }
}

/**
 * Whether Use needs the dialog: a grimoire spell to pick, a number, a cost option, a situation to confirm, an optional
 * part, creatures beyond one enemy target, a weapon or trait, or the GM's Difficulty. A one-enemy card with an enemy
 * already picked on the map fires at once (CA6: "a dialog only when the card needs a choice"), whether or not it rolls:
 * the roll options live in the Hand's strip (F8-I1, dcm-bxp.99.28, user answer 2026-10-23: "a rolling card with an
 * enemy picked and nothing else to ask fires at once").
 */
export function needsDialog(form: UseForm, opts: { spells: number; pickedEnemies: number; gm: boolean }): boolean {
  if (opts.spells > 1) return true;
  if (form.numbers.length || form.eithers.length || form.situations.length || form.optionals.length || form.recipients.length || form.choose.length) return true;
  if (form.weapon || form.traits || (form.gmDifficulty && opts.gm)) return true;
  if (form.targets === null) return false;
  return !(form.targets.side === "enemy" && form.targets.max === 1 && opts.pickedEnemies > 0);
}

/** The dialog's answers. */
export type FormValues = {
  targets: readonly string[];
  numbers: Readonly<Record<string, number>>;
  eithers: Readonly<Record<number, number>>;
  situations: readonly string[];
  optionals: Readonly<Record<string, boolean>>;
  recipients: Readonly<Partial<Record<RecipientKey, readonly string[]>>>;
  weapon?: "primary" | "secondary";
  trait?: TraitId;
  difficulty?: number;
  options: Readonly<Record<string, readonly string[]>>;
};

/** The starting answers: numbers at their minimum, default-on optionals on, the picked enemies as targets. */
export function initialValues(form: UseForm, pickedEnemies: readonly string[]): FormValues {
  const enemiesFit = form.targets !== null && (form.targets.side === "enemy" || form.targets.side === "any");
  const targets = enemiesFit && pickedEnemies.length > 0 ? pickedEnemies.slice(-(form.targets?.max ?? pickedEnemies.length)) : [];
  return {
    targets,
    numbers: Object.fromEntries(form.numbers.map((n) => [n.id, n.min])),
    eithers: Object.fromEntries(form.eithers.map((e) => [e.index, 0])),
    situations: [],
    optionals: Object.fromEntries(form.optionals.map((o) => [o.id, o.defaultOn])),
    recipients: {},
    ...(form.weapon ? { weapon: "primary" as const } : {}),
    ...(form.traits ? { trait: form.traits[0] } : {}),
    options: {},
  };
}

/** What still blocks Use in the dialog (a missing target, an unconfirmed situation), or null when it can fire. */
export function formProblem(form: UseForm, values: FormValues): string | null {
  if (form.targets && values.targets.length === 0) return "Pick a target.";
  if (form.situations.some((s) => !values.situations.includes(s))) return "Confirm the card's situation.";
  for (const c of form.choose) if ((values.options[c.stepId] ?? []).length === 0) return `Choose: ${c.label}`;
  return null;
}

/** The `choices` list `combatCards.useCard` takes, from the dialog's answers. */
export function choicesOf(form: UseForm, values: FormValues): CardChoice[] {
  const out: CardChoice[] = [];
  for (const n of form.numbers) out.push({ id: `n:${n.id}`, value: values.numbers[n.id] ?? n.min });
  for (const e of form.eithers) out.push({ id: `either:${e.index}`, value: values.eithers[e.index] ?? 0 });
  if (form.situations.length > 0) out.push({ id: "situations", value: form.situations.filter((s) => values.situations.includes(s)) });
  for (const o of form.optionals) out.push({ id: `optional:${o.id}`, value: values.optionals[o.id] ?? o.defaultOn });
  for (const r of form.recipients) {
    const picked = values.recipients[r.key] ?? [];
    if (picked.length > 0) out.push({ id: r.key, value: [...picked] });
  }
  for (const c of form.choose) {
    const picked = values.options[c.stepId] ?? [];
    if (picked.length > 0) out.push({ id: `opt:${c.stepId}`, value: [...picked] });
  }
  if (form.weapon && values.weapon) out.push({ id: "weapon", value: values.weapon });
  return out;
}

export type RollAnswers = {
  trait?: TraitId;
  difficulty?: number;
  experienceIds?: string[];
  advantage?: number;
  disadvantage?: number;
  help?: number;
};

/**
 * `combatCards.useCard`'s `roll`, or undefined when nothing is set: the dialog's trait and (GM only) Difficulty, plus the
 * Hand's roll-options strip (Experiences, advantage or disadvantage, Help; F8-I1) when the use rolls. A quick use (no
 * dialog) passes no dialog answers.
 */
export function rollOf(form: Pick<UseForm, "rolls">, values: Pick<FormValues, "trait" | "difficulty"> | null, gm: boolean, rollOptions: RollValues): RollAnswers | undefined {
  const roll: RollAnswers = {
    ...(values?.trait ? { trait: values.trait } : {}),
    ...(gm && values?.difficulty !== undefined ? { difficulty: values.difficulty } : {}),
  };
  if (form.rolls) {
    if (rollOptions.experienceIds.length > 0) roll.experienceIds = [...rollOptions.experienceIds];
    if (rollOptions.edge > 0) roll.advantage = rollOptions.edge;
    if (rollOptions.edge < 0) roll.disadvantage = -rollOptions.edge;
    if (rollOptions.help > 0) roll.help = rollOptions.help;
  }
  return Object.keys(roll).length > 0 ? roll : undefined;
}

/** Whether a use request carried any of the strip's roll options (so the strip clears once it lands; F8-I1). */
export function usedRollOptions(request: { roll?: RollAnswers }): boolean {
  const r = request.roll;
  return r !== undefined && ((r.experienceIds?.length ?? 0) > 0 || (r.advantage ?? 0) > 0 || (r.disadvantage ?? 0) > 0 || (r.help ?? 0) > 0);
}

/** The server's after-the-roll asks answered: `opt:<step>` for a choose step, `split:<tokenId>` for a damage share. */
export function answerChoices(asks: readonly ChoiceAsk[], options: Readonly<Record<string, readonly string[]>>, splits: Readonly<Record<string, number>>): CardChoice[] {
  const out: CardChoice[] = [];
  for (const a of asks) {
    if (a.kind === "choose") {
      const picked = options[a.stepId] ?? [];
      if (picked.length > 0) out.push({ id: `opt:${a.stepId}`, value: [...picked] });
    } else {
      for (const tokenId of a.tokenIds) out.push({ id: `split:${tokenId}`, value: splits[tokenId] ?? 0 });
    }
  }
  return out;
}

/** "Recall: 2 Stress", "Recall: free" (a 0-cost card, or any card while the GM's rest is open; CB p.101, p.105). */
export function recallLabel(recallCost: number, restOpen: boolean): string {
  return restOpen || recallCost === 0 ? "Recall: free" : `Recall: ${recallCost} Stress`;
}

/** The loadout holds at most 5 cards (CB p.101). */
export const LOADOUT_MAX = 5;

/** "Melee", "Very Close", "Far", "Weapon range", "Any range": a use's range as the card face reads it. */
export const RANGE_LABEL: Record<string, string> = {
  melee: "Melee",
  veryClose: "Very Close",
  close: "Close",
  far: "Far",
  veryFar: "Very Far",
  weapon: "Weapon range",
  unlimited: "Any range",
};

const PER_LABEL: Record<Limit["per"], string> = { rest: "rest", longRest: "long rest", session: "session", scene: "scene" };

/** "Once per rest", "3× per scene", "Once per long rest on a success" (CB p.101). */
export function limitLabel(limit: Limit): string {
  const times = limit.times ?? 1;
  const on = limit.consumedOn === "success" ? " on a success" : limit.consumedOn === "failure" ? " on a failure" : "";
  return `${times === 1 ? "Once" : `${times}×`} per ${PER_LABEL[limit.per]}${on}`;
}

/** A badge on a card face: a cost (gold), a limit (blue) or how it is used (passive, reaction, out of combat). */
export type Badge = { kind: "cost" | "limit" | "how"; text: string };

/**
 * The card face's cost and limit badges, from its effect entry: the single action use's upfront costs (and a cost
 * paid on a success, as "On a success: 1 Hope"), its limit; a grimoire shows its spell count instead.
 */
export function cardBadges(card: Pick<HandCard, "state" | "uses">, effect: CardEffect | undefined): Badge[] {
  if (card.state === "outOfCombat") return [{ kind: "how", text: "Out of combat" }];
  if (card.state === "passive") return [{ kind: "how", text: "Passive" }];
  const playable = playableUses(card);
  if (playable.length === 0) {
    const kind = card.uses.find((u) => u.activation !== "passive")?.activation;
    return [{ kind: "how", text: kind === "reaction" ? "Reaction" : kind === "rider" ? "With an attack" : "Automatic" }];
  }
  if (playable.length > 1) return [{ kind: "how", text: `${playable.length} spells` }];
  const use = effect?.uses.find((u) => u.id === playable[0]!.useId);
  if (!use) return [];
  const badges: Badge[] = (use.costs ?? []).map((c) => ({ kind: "cost", text: costLabel(c) }));
  for (const step of use.steps) {
    if (step.kind === "pay") {
      const when = step.when?.includes("success") ? "On a success: " : "";
      badges.push(...step.costs.map((c) => ({ kind: "cost" as const, text: `${when}${costLabel(c)}` })));
    }
  }
  if (use.limit) badges.push({ kind: "limit", text: limitLabel(use.limit) });
  return badges;
}
