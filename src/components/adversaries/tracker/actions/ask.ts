// The feature-choices dialog's pure parts (plan combat-actions AA3b; AA2c's `adversaryActions.featureAsk`, shape in
// docs/tasks/TASK-CA-AA2c.md). No React, no Convex calls.
//
// ```ts
// needsChoices(ask);                       // false: Use fires at once with the panel's targets (as before)
// const a = initialAnswers(ask, ["mira"]);  // empty picks, either costs on their first option, no optionals
// missing(ask, a);                          // ["Pick 1 for Grab"] until the GM answered what must be answered
// choiceArgs(ask, a);                       // { useId, targets, options, optionals, … } for useFeature
// askFear(ask, a);                          // the Fear useFeature will ask with the picked `either` options
// ```

import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../../../convex/_generated/api";

export type FeatureAsk = FunctionReturnType<typeof api.adversaryActions.featureAsk>;
export type TargetAsk = NonNullable<FeatureAsk["targets"]>;
export type ListKey = "targets" | "picked" | "allies" | "followUp";

/** A creature the GM may name in a list: a PC (character id) or another adversary (instance id). */
export type Creature = { id: string; name: string; kind: "pc" | "adversary" };

export type Answers = {
  targets: string[];
  picked: string[];
  allies: string[];
  followUp: string[];
  /** `choose` steps: option ids per step id. */
  options: Record<string, string[]>;
  optionals: string[];
  situations: string[];
  /** One option index per `eitherCosts` entry, in order. */
  eitherCosts: number[];
  /** Split amounts per creature id. */
  splits: Record<string, number>;
  trigger: { sourceId: string; subjectId: string; amount: string };
};

export const LIST_KEYS: readonly ListKey[] = ["targets", "picked", "allies", "followUp"];
export const LIST_LABEL: Record<ListKey, string> = { targets: "Targets", picked: "Picked creatures", allies: "Allies", followUp: "Follow-up attack targets" };

/** A list the GM picks from: not "every PC in range" and not a point, object or the adversary itself. */
export function pickable(t: TargetAsk | null): t is TargetAsk {
  return t !== null && t.count !== "all" && !["self", "point", "object"].includes(t.side);
}

/** The most picks a list takes (null: no cap). */
export function capOf(t: TargetAsk): number | null {
  return t.count === "one" ? 1 : t.count === "upTo" ? t.max : null;
}

/** The creatures a list offers: PCs for "enemy", other adversaries for "ally", both for "any". */
export function creaturesFor(t: TargetAsk, creatures: readonly Creature[], self: string): Creature[] {
  if (t.side === "enemy") return creatures.filter((c) => c.kind === "pc");
  if (t.side === "ally") return creatures.filter((c) => c.kind === "adversary" && c.id !== self);
  return creatures.filter((c) => c.id !== self);
}

/** Uses the GM can pick between (a feature with an action and a reaction use, …). */
export function pickableUses(ask: FeatureAsk): FeatureAsk["uses"] {
  return ask.uses.filter((u) => u.activation !== "passive");
}

/**
 * Whether Use must ask first. PC targets alone don't: the panel's target chips already name them (an "enemy" list).
 * Everything else the server reads from the GM does: other creature lists, choices, optional steps, situations, splits,
 * `either` costs, a hand-fired trigger's source / subject / amount, or a feature with more than one use.
 */
export function needsChoices(ask: FeatureAsk): boolean {
  const t = ask.trigger;
  return (
    ask.options.length > 0 ||
    ask.optionals.length > 0 ||
    ask.situations.length > 0 ||
    ask.splits.length > 0 ||
    ask.eitherCosts.length > 0 ||
    pickable(ask.picked) ||
    pickable(ask.allies) ||
    pickable(ask.followUp) ||
    (pickable(ask.targets) && ask.targets.side !== "enemy") ||
    (t !== null && (t.source || t.subject || t.amount)) ||
    pickableUses(ask).length > 1
  );
}

/** Nothing chosen yet; the panel's picked PCs carry over into an "enemy" targets list (capped). */
export function initialAnswers(ask: FeatureAsk, panelTargets: readonly string[]): Answers {
  const targets = ask.targets && pickable(ask.targets) && ask.targets.side !== "ally" ? panelTargets.slice(0, capOf(ask.targets) ?? undefined) : [];
  return {
    targets,
    picked: [],
    allies: [],
    followUp: [],
    options: {},
    optionals: [],
    situations: [],
    eitherCosts: ask.eitherCosts.map(() => 0),
    splits: {},
    trigger: { sourceId: "", subjectId: "", amount: "" },
  };
}

/** Toggles a pick in a list with a cap: a one-pick list swaps, a full list ignores another pick. */
export function pick(list: readonly string[], id: string, cap: number | null): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  if (cap === 1) return [id];
  if (cap !== null && list.length >= cap) return [...list];
  return [...list, id];
}

/** What the GM still has to answer before Use (the server would refuse or guess otherwise). */
export function missing(ask: FeatureAsk, a: Answers): string[] {
  const out: string[] = [];
  for (const key of LIST_KEYS) {
    const t = ask[key];
    if (pickable(t) && t.count === "one" && a[key].length === 0) out.push(`Pick one for ${LIST_LABEL[key].toLowerCase()}`);
  }
  for (const o of ask.options) {
    if (o.count !== null && (a.options[o.id]?.length ?? 0) !== Math.min(o.count, o.options.length)) out.push(`Pick ${o.count} for ${o.label}`);
  }
  if (ask.trigger?.amount && !(Number(a.trigger.amount) >= 0 && a.trigger.amount.trim() !== "")) out.push("Enter the trigger amount");
  return out;
}

/** The Fear useFeature will ask: the server's total with each `either` cost's picked option instead of its first. */
export function askFear(ask: FeatureAsk, a: Answers): number {
  let fear = ask.fear.total;
  ask.eitherCosts.forEach((entry, i) => {
    const first = entry.options[0]?.fear ?? 0;
    const chosen = entry.options.find((o) => o.index === a.eitherCosts[i])?.fear ?? first;
    fear += chosen - first;
  });
  return fear;
}

/** The answers as useFeature's arguments (empty lists left out, so the server keeps its defaults). */
export function choiceArgs(ask: FeatureAsk, a: Answers, panelTargets: readonly string[]) {
  const list = (key: ListKey) => (pickable(ask[key]) && a[key].length > 0 ? { [key]: a[key] } : {});
  const targets = pickable(ask.targets) ? a.targets : [...panelTargets];
  const options = ask.options.map((o) => ({ id: o.id, values: a.options[o.id] ?? [] })).filter((o) => o.values.length > 0);
  const among = new Set(ask.splits.flatMap((s) => (s.among === "targets" ? targets : LIST_KEYS.includes(s.among as ListKey) ? a[s.among as ListKey] : [])));
  const splits = Object.entries(a.splits)
    .filter(([id, amount]) => among.has(id) && amount > 0)
    .map(([id, amount]) => ({ id, amount }));
  const t = ask.trigger;
  const trigger =
    t && (t.source || t.subject || t.amount)
      ? {
          ...(t.source && a.trigger.sourceId ? { sourceId: a.trigger.sourceId } : {}),
          ...(t.subject && a.trigger.subjectId ? { subjectId: a.trigger.subjectId } : {}),
          ...(t.amount && a.trigger.amount.trim() !== "" ? { amount: Number(a.trigger.amount) } : {}),
        }
      : null;
  return {
    useId: ask.useId,
    targets,
    ...list("picked"),
    ...list("allies"),
    ...list("followUp"),
    ...(options.length ? { options } : {}),
    ...(a.optionals.length ? { optionals: a.optionals } : {}),
    ...(a.situations.length ? { situations: a.situations } : {}),
    ...(ask.eitherCosts.length ? { eitherCosts: a.eitherCosts } : {}),
    ...(splits.length ? { splits } : {}),
    ...(trigger && Object.keys(trigger).length ? { trigger } : {}),
  };
}
