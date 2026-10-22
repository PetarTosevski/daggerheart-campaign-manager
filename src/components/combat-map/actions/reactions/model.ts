import type { FunctionReturnType } from "convex/server";

import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";

import type { api } from "../../../../../convex/_generated/api";

/**
 * Pure model of the incoming-hit prompt (plan combat-actions AA4). What a player reads comes only from
 * `adversaryActions.pending`: the hit PC their own damage, its severity against their own thresholds and what each Armor
 * Slot gives; an ally only who hit whom and their eligible cards (Q13, Q14). Never the roll or an adversary's numbers.
 */

export type HitView = FunctionReturnType<typeof api.adversaryActions.pending>[number];
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
  /** An ally with an eligible reaction card: the cards with Use, and Pass. */
  | "ally"
  /** Nothing owed: "Bandit hit Mira", waiting for the others (Q14). */
  | "waiting";

export function promptMode(view: HitView): PromptMode {
  if (!view.awaiting) return "waiting";
  if (view.role === "ally") return "ally";
  const max = view.maxSlots ?? 0;
  if (view.direct || max <= 0) return "ok";
  return max === 1 ? "armorOne" : "armorMany";
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
  if (mode === "armorMany") return "Mark any number of Armor Slots to reduce it.";
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

/** What `respond` takes (the server's `hitChoiceValidator`). */
export type HitChoice =
  | { kind: "armor"; slots?: number }
  | { kind: "noArmor" }
  | { kind: "pass" }
  | { kind: "card"; cardId: string; useId?: string };

/**
 * The optimistic `pending` after an answer (CL4): an ally's Use / Pass or the target's armor answer ends what they owe;
 * a card the target plays first (Shrug It Off) only leaves the list of cards, the armor question stays. A redirect
 * (I Am Your Shield) is the server's to show, so the ally's card answer just stops awaiting.
 */
export function afterAnswer(views: readonly HitView[], requestId: HitView["requestId"], choice: HitChoice): HitView[] {
  return views.map((v) => {
    if (v.requestId !== requestId) return v;
    if (choice.kind === "card" && v.role === "target") return { ...v, cardIds: v.cardIds.filter((id) => id !== choice.cardId) };
    return { ...v, awaiting: false };
  });
}
