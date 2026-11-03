import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../convex";

export type HandCard = FunctionReturnType<typeof api.combatCards.hand>["loadout"][number];
type HandUse = HandCard["uses"][number];

/** Action uses the player can start from the phone (no reaction / passive cards). */
export function playableUses(card: Pick<HandCard, "uses" | "state">): HandUse[] {
  if (card.state === "outOfCombat") return [];
  return card.uses.filter((u) => u.activation === "action");
}

/**
 * Whether the card can fire immediately on the phone: a one-enemy target with that enemy already picked and no
 * pre-roll choices (matches CA6's "dialog only when needed"; complex cards stay on the website).
 */
export function canFireOnPhone(use: HandUse, pickedEnemy: boolean): boolean {
  const t = use.targets;
  if ((use.choices?.length ?? 0) > 0) return false;
  if (t === undefined || t === null) return true;
  if (t.side === "enemy" && t.count === "one") return pickedEnemy;
  if (t.side === "self" || t.side === "trigger") return true;
  return false;
}
