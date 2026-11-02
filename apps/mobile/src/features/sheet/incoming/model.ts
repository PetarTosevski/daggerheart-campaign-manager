import type { FunctionReturnType } from "convex/server";

import { DOMAIN_CARDS } from "../../../../../../src/lib/srd/domain-cards";

import type { api } from "../../../convex";

/**
 * Pure model of the incoming-hit prompt (plan combat-actions AA4). Mirrors
 * `src/components/combat-map/actions/reactions/model.ts`.
 */

export type HitView = FunctionReturnType<typeof api.adversaryActions.pending>[number];
export type Severity = NonNullable<HitView["severity"]>;
export type ArmorStep = NonNullable<HitView["armorPreview"]>[number];

export const SEVERITY_LABEL: Record<Severity, string> = { none: "No damage", minor: "Minor", major: "Major", severe: "Severe" };

export type PromptMode = "armorOne" | "armorMany" | "ok" | "ally" | "waiting";

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

export function stepText(step: Pick<ArmorStep, "severity" | "hp">): string {
  return step.severity === "none" ? SEVERITY_LABEL.none : `${SEVERITY_LABEL[step.severity]} (${hpText(step.hp)})`;
}

export function stepFor(view: HitView, slots: number): ArmorStep | undefined {
  return view.armorPreview?.find((s) => s.slots === slots);
}

export function damageLine(view: HitView): string {
  const base = stepFor(view, 0);
  const severity = base?.severity ?? view.severity ?? "none";
  const hp = base?.hp ?? 0;
  const amount = view.damage ?? 0;
  return `${amount} damage: ${stepText({ severity, hp })}.`;
}

export function armorQuestion(view: HitView): string {
  const mode = promptMode(view);
  if (mode === "ok") return view.direct ? "Direct damage: Armor Slots can't reduce it." : "No Armor Slot to mark.";
  if (mode === "armorMany") return "Mark any number of Armor Slots to reduce it.";
  const one = stepFor(view, 1);
  if (!one) return "Mark an Armor Slot?";
  return one.severity === "none" ? "Mark an Armor Slot to take no damage?" : `Mark an Armor Slot to make it ${SEVERITY_LABEL[one.severity]}?`;
}

export function hitLine(view: Pick<HitView, "attackerLabel" | "targetName">): string {
  return `${view.attackerLabel} hit ${view.targetName}`;
}

export type ReactionCard = { cardId: string; name: string; text: string; domain: string; level: number };

const BY_ID = new Map(DOMAIN_CARDS.map((c) => [c.id, c]));

export function reactionCard(cardId: string): ReactionCard {
  const card = BY_ID.get(cardId);
  return { cardId, name: card?.name ?? cardId, text: card?.text ?? "", domain: card?.domain ?? "", level: card?.level ?? 0 };
}

const ALLY_ONLY_CARDS: ReadonlySet<string> = new Set(["i-am-your-shield"]);

export function playableCards(view: Pick<HitView, "role" | "cardIds">): string[] {
  return view.role === "target" ? view.cardIds.filter((id) => !ALLY_ONLY_CARDS.has(id)) : view.cardIds;
}

export type HitChoice =
  | { kind: "armor"; slots?: number }
  | { kind: "noArmor" }
  | { kind: "pass" }
  | { kind: "card"; cardId: string; useId?: string };

export function afterAnswer(views: readonly HitView[], requestId: HitView["requestId"], choice: HitChoice): HitView[] {
  return views.map((v) => {
    if (v.requestId !== requestId) return v;
    if (choice.kind === "card" && v.role === "target") return { ...v, cardIds: v.cardIds.filter((id) => id !== choice.cardId) };
    return { ...v, awaiting: false };
  });
}

export const HIT_RETRY_DELAYS_MS = [500, 1500, 4000] as const;
export const HIT_RETRY_STABLE_MS = 10_000;
