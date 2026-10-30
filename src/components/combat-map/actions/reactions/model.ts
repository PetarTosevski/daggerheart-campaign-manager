import type { FunctionReturnType } from "convex/server";

import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";

import type { api } from "../../../../../convex/_generated/api";

/**
 * Pure model of the incoming-hit prompt (plan combat-actions AA4). What a player reads comes only from
 * `adversaryActions.pending`: the hit PC their own damage, its severity against their own thresholds and what each Armor
 * Slot gives; an ally only who hit whom and their eligible cards (Q13, Q14). Never the roll or an adversary's numbers.
 */

export type HitView = FunctionReturnType<typeof api.adversaryActions.pending>[number];
/** SD4: a feature answer as the server describes it (name, text, what its Use asks). */
export type FeatureView = NonNullable<HitView["features"]>[number];
export type Severity = NonNullable<HitView["severity"]>;
export type ArmorStep = NonNullable<HitView["armorPreview"]>[number];

export const SEVERITY_LABEL: Record<Severity, string> = { none: "No damage", minor: "Minor", major: "Major", severe: "Severe" };

/** What the prompt asks of this character right now. */
export type PromptMode =
  /** The hit PC with exactly one Armor Slot to mark (CB p.114: "you can only mark 1 Armor Slot"): Mark / Don't. */
  | "armorOne"
  /** The hit PC who may mark several (I Am Your Shield, CB p.341: "any number of Armor Slots"): pick a count. */
  | "armorMany"
  /** The hit PC with no slot to mark, or direct damage (CB p.99): OK only. */
  | "ok"
  /** An ally with an eligible reaction card or feature: the answers with Use, and Pass. */
  | "ally"
  /** SD4 (Q2): before the adversary's roll: the before-roll features with Use, and Pass. */
  | "preRoll"
  /**
   * The hit PC marked an Armor Slot, said Don't / OK (A1) or (DA8) used a slot substitute such as Stable; every card or feature that still
   * fits the hit (DA8, user 2026-10-30, CB p.107: in the order the player picks) with Use, and Done.
   */
  | "afterArmor"
  /** Nothing owed: "Bandit hit Mira", waiting for the others (Q14). */
  | "waiting";

export function promptMode(view: HitView): PromptMode {
  if (!view.awaiting) return "waiting";
  if (view.preRoll) return "preRoll";
  if (view.role === "ally") return "ally";
  if (view.armorAnswered) return "afterArmor";
  const max = view.maxSlots ?? 0;
  if (view.direct || max <= 0) return "ok";
  return max === 1 ? "armorOne" : "armorMany";
}

/**
 * The slot counts the hit PC may mark (1..maxSlots). E2 (dcm-s77): when the attacker makes slots dearer (Armor Eater,
 * HF p.71: "must mark an additional Armor Slot to reduce the severity") the server lists only whole steps in the preview
 * (0, 2, 4), so a count that buys nothing isn't offered.
 */
export function armorCounts(view: Pick<HitView, "maxSlots" | "armorPreview">): number[] {
  const listed = (view.armorPreview ?? []).map((s) => s.slots).filter((n) => n > 0);
  if (listed.length > 0) return listed;
  return Array.from({ length: view.maxSlots ?? 0 }, (_, i) => i + 1);
}

function hpText(hp: number): string {
  return `${hp} HP`;
}

/** One step of the armor preview in words: "Minor (1 HP)", "No damage". */
export function stepText(step: Pick<ArmorStep, "severity" | "hp">): string {
  return step.severity === "none" ? SEVERITY_LABEL.none : `${SEVERITY_LABEL[step.severity]} (${hpText(step.hp)})`;
}

/** The step for `slots` marked (the server lists 0..maxSlots). */
export function stepFor(view: HitView, slots: number): ArmorStep | undefined {
  return view.armorPreview?.find((s) => s.slots === slots);
}

/** The hit PC's headline: "14 damage: Major (2 HP)." */
export function damageLine(view: HitView): string {
  const base = stepFor(view, 0);
  const severity = base?.severity ?? view.severity ?? "none";
  const hp = base?.hp ?? 0;
  const amount = view.damage ?? 0;
  return `${amount} damage: ${stepText({ severity, hp })}.`;
}

/** The hit PC's question, e.g. "Mark an Armor Slot to make it Minor?" (CB p.114). */
export function armorQuestion(view: HitView): string {
  const mode = promptMode(view);
  if (mode === "ok") return view.direct ? "Direct damage: Armor Slots can't reduce it." : "No Armor Slot to mark.";
  if (mode === "armorMany") {
    // E2 (dcm-s77): one dearer step ("Mark 2 Armor Slots to make it Minor?").
    const counts = armorCounts(view);
    const only = counts.length === 1 ? stepFor(view, counts[0]!) : undefined;
    if (only) return only.severity === "none" ? `Mark ${only.slots} Armor Slots to take no damage?` : `Mark ${only.slots} Armor Slots to make it ${SEVERITY_LABEL[only.severity]}?`;
    return "Mark any number of Armor Slots to reduce it.";
  }
  const one = stepFor(view, 1);
  if (!one) return "Mark an Armor Slot?";
  return one.severity === "none" ? "Mark an Armor Slot to take no damage?" : `Mark an Armor Slot to make it ${SEVERITY_LABEL[one.severity]}?`;
}

/** The headline every role can see: "Bandit hit Mira". */
export function hitLine(view: Pick<HitView, "attackerLabel" | "targetName">): string {
  return `${view.attackerLabel} hit ${view.targetName}`;
}

export type ReactionCard = { cardId: string; name: string; text: string; domain: string; level: number };

const BY_ID = new Map(DOMAIN_CARDS.map((c) => [c.id, c]));

/** A reaction card's display fields (SRD leaf module, CL9); an unknown id keeps its id as the name. */
export function reactionCard(cardId: string): ReactionCard {
  const card = BY_ID.get(cardId);
  return { cardId, name: card?.name ?? cardId, text: card?.text ?? "", domain: card?.domain ?? "", level: card?.level ?? 0 };
}

/**
 * Cards that only answer a hit on someone else (I Am Your Shield, CB p.341: "When an ally … would take damage"). After
 * the redirect the server still lists the played card on the new target's responder entry; the target can't play it.
 */
const ALLY_ONLY_CARDS: ReadonlySet<string> = new Set(["i-am-your-shield"]);

/** The reaction cards this character can still play on this hit. */
export function playableCards(view: Pick<HitView, "role" | "cardIds">): string[] {
  return view.role === "target" ? view.cardIds.filter((id) => !ALLY_ONLY_CARDS.has(id)) : view.cardIds;
}

/** One choice of a feature answer (`useFeature`'s ids: `n:<id>`, `opt:<step>`, `optional:<step>`, `situations`). */
export type FeatureChoice = { id: string; value: number | string | string[] | boolean };

/** What `respond` takes (the server's `hitChoiceValidator`, and SD4's feature answer). */
export type HitChoice =
  | { kind: "armor"; slots?: number }
  | { kind: "noArmor" }
  | { kind: "pass" }
  | { kind: "card"; cardId: string; useId?: string }
  | { kind: "feature"; featureId: string; useId?: string; choices: FeatureChoice[] };

/** What the player set on a feature answer's controls, before it becomes the choice list. */
export type FeaturePicks = {
  numbers: Record<string, number>;
  options: Record<string, string>;
  optionals: Record<string, boolean>;
  situations: Record<string, boolean>;
};

/**
 * A feature's controls at their defaults: the smallest counts, the first option of each pick, optional steps off except
 * the `defaultOn` ones (DA8: Draining Bane's "Clear a Stress" is ticked, user answer 2026-10-29).
 */
export function defaultPicks(feature: FeatureView): FeaturePicks {
  return {
    numbers: Object.fromEntries(feature.numbers.map((n) => [n.id, Math.max(1, n.min)])),
    options: Object.fromEntries(feature.options.flatMap((o) => (o.options[0] ? [[o.id, o.options[0].id]] : []))),
    optionals: Object.fromEntries(feature.optionals.flatMap((o) => (o.defaultOn ? [[o.id, true]] : []))),
    situations: {},
  };
}

/** Whether every situation the feature asks about is confirmed (Q13: the player confirms it). */
export function situationsConfirmed(feature: FeatureView, picks: FeaturePicks): boolean {
  return feature.situations.every((text) => picks.situations[text] === true);
}

/** The `respond` choice of a feature answer with the player's picks. */
export function featureChoice(feature: FeatureView, picks: FeaturePicks): HitChoice {
  const choices: FeatureChoice[] = [
    ...feature.numbers.map((n) => ({ id: `n:${n.id}`, value: picks.numbers[n.id] ?? Math.max(1, n.min) })),
    ...feature.options.flatMap((o) => (picks.options[o.id] ? [{ id: `opt:${o.id}`, value: [picks.options[o.id]!] }] : [])),
    ...feature.optionals.map((o) => ({ id: `optional:${o.id}`, value: picks.optionals[o.id] === true })),
    ...(feature.situations.length > 0 ? [{ id: "situations", value: feature.situations.filter((t) => picks.situations[t] === true) }] : []),
  ];
  return { kind: "feature", featureId: feature.featureId, useId: feature.useId, choices };
}

/**
 * The optimistic `pending` after an answer (CL4): an ally's Use / Pass ends what they owe; a card or feature the target
 * plays leaves its list, the armor question stays until answered; a marked slot (DA8) or Don't / OK (A1, user answer
 * 2026-10-30) leaves the cards and features still listed (the server then lists what fits now) or, with none, ends what
 * they owe; Done ends it. A
 * redirect (I Am Your Shield) is the server's to show, so the ally's card answer just stops awaiting.
 */
export function afterAnswer(views: readonly HitView[], requestId: HitView["requestId"], choice: HitChoice): HitView[] {
  return views.map((v) => {
    if (v.requestId !== requestId) return v;
    if (v.role !== "target" || v.preRoll || v.afterHit || choice.kind === "pass") return { ...v, awaiting: false };
    const cardIds = choice.kind === "card" ? v.cardIds.filter((id) => id !== choice.cardId) : v.cardIds;
    const features = choice.kind === "feature" ? (v.features ?? []).filter((f) => f.featureId !== choice.featureId) : (v.features ?? []);
    const armorAnswered = v.armorAnswered === true || choice.kind === "armor" || choice.kind === "noArmor";
    const left = cardIds.length + features.length > 0;
    return { ...v, cardIds, features, ...(armorAnswered ? { armorAnswered: true } : {}), awaiting: !armorAnswered || left };
  });
}
