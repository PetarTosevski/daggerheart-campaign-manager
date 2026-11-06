import type { FunctionArgs } from "convex/server";

import {
  armorCounts,
  SEVERITY_LABEL,
  stepFor,
  type FeatureView,
  type HitView,
} from "../../../../../../src/lib/combat-map/reactions";
import { cardEffect } from "../../../../../../src/lib/srd/card-effects";
import { DOMAIN_CARDS } from "../../../../../../src/lib/srd/domain-cards";
import { DOMAINS } from "../../../../../../src/lib/srd/domains";

import type { api } from "../../../convex";

/**
 * The phone's incoming-hit prompt (plan combat-actions AA4, sheet-drawer SD4, DA8, lanes-2 E2/E2.3), read only from
 * `adversaryActionsReads.pending` and answered with `adversaryActions.respond`. The shared model
 * (src/lib/combat-map/reactions.ts: armor counts and steps, damage line, feature picks and answers, grants, retry
 * timing) is the website's; this file keeps only what the phone's card adds on top of it: the after-hit mode and its
 * words, the card's heading, card colours and the ally-only check through the card effects.
 */

/** What `respond` takes: the server's `hitChoiceValidator` or a before-roll feature answer. */
export type HitChoice = FunctionArgs<typeof api.adversaryActions.respond>["choice"];

/**
 * What the card asks of this character now:
 * - `preRoll`: before the adversary's roll (SD4 Q2): before-roll features with Use, and Pass (never an armor answer;
 *   the server refuses anything but `feature` / `pass`).
 * - `afterHit`: the hit already resolved (AA2b): an after-hit card or feature (Unbreakable) with Use, or Pass.
 * - `ally`: an ally with an eligible card or feature: Use, or Pass.
 * - `afterArmor`: the hit PC answered armor (DA8): what still fits with Use, and Done (`pass`).
 * - `armorOne`: one Armor Slot to mark (CB p.114): Mark / Don't.
 * - `armorMany`: several (I Am Your Shield, CB p.341; Armor Eater's dearer steps, HF p.71): a count, or Don't.
 * - `ok`: direct damage (CB p.99) or no free slot: OK (`noArmor`).
 * - `waiting`: nothing owed (Q14).
 */
export type PromptMode = "preRoll" | "afterHit" | "ally" | "afterArmor" | "armorOne" | "armorMany" | "ok" | "waiting";

export function promptMode(view: HitView): PromptMode {
  if (!view.awaiting) return "waiting";
  if (view.preRoll === true) return "preRoll";
  if (view.afterHit === true) return "afterHit";
  if (view.role === "ally") return "ally";
  if (view.armorAnswered === true) return "afterArmor";
  const counts = armorCounts(view);
  if (view.direct === true || counts.length === 0) return "ok";
  return counts.length === 1 && counts[0] === 1 ? "armorOne" : "armorMany";
}

/** The line under it: what the armor question is, or what is left. */
export function promptQuestion(view: HitView): string | null {
  const mode = promptMode(view);
  switch (mode) {
    case "afterArmor":
      return "Armor answered. Use another reaction that fits now, in any order, or Done.";
    case "afterHit":
      return view.deathMove === true ? "The hit marked your last Hit Point. React now, or pass." : "The hit landed. React now, or pass.";
    case "ok":
      return view.direct === true ? "Direct damage: Armor Slots can't reduce it." : "No Armor Slot to mark.";
    case "armorOne": {
      const after = stepFor(view, 1);
      if (after === undefined) return "Mark an Armor Slot?";
      return after.severity === "none" ? "Mark an Armor Slot to take no damage?" : `Mark an Armor Slot to make it ${SEVERITY_LABEL[after.severity]}?`;
    }
    case "armorMany": {
      const counts = armorCounts(view);
      const single = counts.length === 1 ? stepFor(view, counts[0]) : undefined;
      if (single === undefined) return "Mark any number of Armor Slots to reduce it.";
      const what = single.severity === "none" ? "take no damage" : `make it ${SEVERITY_LABEL[single.severity]}`;
      return `Mark ${single.slots} Armor Slots to ${what}?`;
    }
    case "preRoll":
    case "ally":
    case "waiting":
      return null;
  }
}

/** The card's heading and kicker. */
export function promptTitle(view: HitView, characterName: string): { kicker: string; title: string } {
  const mode = promptMode(view);
  if (mode === "preRoll") return { kicker: "Before the roll", title: `${view.attackerLabel} attacks ${view.targetName}` };
  if (view.role === "ally") return { kicker: `${characterName} can react`, title: `${view.attackerLabel} hit ${view.targetName}` };
  return { kicker: mode === "afterHit" ? "After the hit" : "You were hit", title: `${view.attackerLabel} hit ${characterName}` };
}

const CARDS = new Map(DOMAIN_CARDS.map((card) => [card.id, card]));

/** A reaction card for display (the SRD's name, text and domain colour); an unknown id shows as itself. */
export function cardDisplay(cardId: string) {
  const card = CARDS.get(cardId);
  const domain = card ? DOMAINS.find((d) => d.id === card.domain) : undefined;
  return {
    name: card?.name ?? cardId,
    text: card?.text ?? "",
    meta: card ? `${domain?.name ?? card.domain} ${card.level}` : "",
    color: domain?.color ?? colorFallback,
  };
}

const colorFallback = "#5b2b2b";

/**
 * Whether only an ally can play the card: every reaction it has answers damage to someone else (I Am Your Shield, CB
 * p.341: "When an ally within Very Close range would take damage"). After a redirect the hit PC may still see it listed.
 */
function answersAllyOnly(cardId: string): boolean {
  const reactions = (cardEffect(cardId)?.uses ?? []).filter((use) => use.activation.kind === "reaction");
  return reactions.length > 0 && reactions.every((use) => use.activation.kind === "reaction" && use.activation.trigger.kind.startsWith("whenAlly"));
}

/** The cards this character can play on the hit now (none before the roll: those are features). */
export function cardsToPlay(view: HitView): string[] {
  if (promptMode(view) === "preRoll") return [];
  return view.role === "target" ? view.cardIds.filter((id) => !answersAllyOnly(id)) : [...view.cardIds];
}

/** The smallest count a number control takes (at least 1). */
export const numberFloor = (n: Pick<FeatureView["numbers"][number], "min">) => Math.max(1, n.min);
