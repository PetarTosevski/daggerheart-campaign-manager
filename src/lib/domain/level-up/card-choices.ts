// The picks a level-up must ask for a gained card's "when you choose this card" use (plan lanes-2 E8.4, dcm-txlu).
// Pure module: the level-up draft (level-up-draft.tsx) lists them and sends `LevelUpChoice.cardChoices`; the server
// (convex/levelUp.ts `withChosenCards`) runs the use with them and refuses a missing pick with LEVEL_UP_RULE.
//
// Vitality (Blade 5, CB p.330): "When you choose this card, permanently gain two of the following benefits: • One Stress
// slot • One Hit Point slot • +2 bonus to your damage thresholds Then place this card in your vault permanently."
//
// ```ts
// const asks = cardChoiceAsks(cardsGained(...));            // [{ cardId: "vitality", stepId: "benefits", count: 2, ... }]
// cardChoiceProblems(asks, { vitality: { benefits: ["hp"] } }); // ["Vitality: choose 2 (Two benefits)."]
// ```

import type { CardEffect, CardUse, Step } from "../card-effects/types";
import { cardEffect } from "../../srd/card-effects/index";

/** One `choose` step of a gained card's choosing use the player answers. */
export type CardChoiceAsk = {
  cardId: string;
  /** The use's name (the card's, e.g. "Vitality"). */
  name: string;
  stepId: string;
  label: string;
  /** How many options to pick (a fixed count; anything else reads as 1). */
  count: number;
  distinct: boolean;
  options: { id: string; label: string }[];
};

/** The card's `whenYouChooseThisCard` use, as feature-effects/run.ts `onChooseUse` finds it. */
function choosingUse(effect: Pick<CardEffect, "uses">): CardUse | undefined {
  return effect.uses.find((u) => u.activation.kind === "auto" && u.activation.trigger.kind === "whenYouChooseThisCard");
}

/** The top-level `choose` steps of the use (the picks made when the card is chosen). */
function chooseSteps(steps: readonly Step[]): Extract<Step, { kind: "choose" }>[] {
  return steps.flatMap((s) => (s.kind === "choose" ? [s] : []));
}

/** What the level-up must ask for the cards it gains, in card order. `lookup` defaults to the SRD card effects. */
export function cardChoiceAsks(cardIds: readonly string[], lookup: (cardId: string) => Pick<CardEffect, "uses"> | undefined = cardEffect): CardChoiceAsk[] {
  const out: CardChoiceAsk[] = [];
  for (const cardId of new Set(cardIds)) {
    if (cardId === "") continue;
    const effect = lookup(cardId);
    const use = effect ? choosingUse(effect) : undefined;
    if (use === undefined) continue;
    for (const step of chooseSteps(use.steps)) {
      const count = step.count?.kind === "fixed" ? Math.max(1, step.count.value) : 1;
      out.push({ cardId, name: use.name, stepId: step.id, label: step.label, count, distinct: step.distinct === true, options: step.options.map((o) => ({ id: o.id, label: o.label })) });
    }
  }
  return out;
}

/** The answers that belong to `asks` (other cards' or steps' picks are dropped; unknown options too). */
export function cardChoicesFor(asks: readonly CardChoiceAsk[], picked: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  for (const a of asks) {
    const ids = (picked[a.cardId]?.[a.stepId] ?? []).filter((id) => a.options.some((o) => o.id === id));
    if (ids.length === 0) continue;
    out[a.cardId] = { ...out[a.cardId], [a.stepId]: ids.slice(0, a.count) };
  }
  return out;
}

/** "Vitality: choose 2 (Two benefits)." for each ask not answered with exactly its count of options. */
export function cardChoiceProblems(asks: readonly CardChoiceAsk[], picked: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>): string[] {
  return asks.flatMap((a) => {
    const ids = (picked[a.cardId]?.[a.stepId] ?? []).filter((id) => a.options.some((o) => o.id === id));
    const distinctOk = !a.distinct || new Set(ids).size === ids.length;
    return ids.length === a.count && distinctOk ? [] : [`${a.name}: choose ${a.count} (${a.label}).`];
  });
}
