/**
 * The Hand as `combatCardsReads.hand` returns it (plan combat-actions, CA4; split out of `./cardHand`, which re-exports
 * it, dcm-uh6r): each card's state from the sheet's `featureUses` (Q3) and the recall riders it offers. Read-only
 * helpers without the card runner, so the HUD's Hand query loads light.
 */
import { v, type Infer } from "convex/values";

import { cardAvailability, featureUseKey, keyAvailability, RESET_LABEL } from "../../src/lib/domain/card-effects/availability";
import type { CardUse, TargetSpec } from "../../src/lib/domain/card-effects/types";
import { owned } from "../../src/lib/domain/feature-effects/owned";
import { featureAvailability } from "../../src/lib/domain/feature-effects/run";
import { cardEffect, cardUsage } from "../../src/lib/srd/card-effects/index";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import { getDomainCard } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { resolveOptions } from "../../src/lib/frames/options";
import type { Doc } from "../_generated/dataModel";

export const handUseValidator = v.object({
  useId: v.string(),
  name: v.string(),
  activation: v.union(v.literal("action"), v.literal("reaction"), v.literal("rider"), v.literal("auto"), v.literal("passive")),
  ready: v.boolean(),
  resetLabel: v.union(v.null(), v.string()),
  usesLeft: v.union(v.null(), v.number()),
  /** Whether the use rolls (the Hand shows the roll options). */
  rolls: v.boolean(),
  /** Who it targets: side, range ("weapon", "unlimited" or a band) and count kind; null for trigger targets or none. */
  targets: v.union(v.null(), v.object({ side: v.string(), range: v.string(), count: v.string() })),
  /** NumberChoices the player sets first ("spend any number of Hope"). */
  choices: v.array(v.object({ id: v.string(), label: v.string(), min: v.number() })),
});

export const handCardValidator = v.object({
  cardId: v.string(),
  name: v.string(),
  domain: v.string(),
  level: v.number(),
  type: v.string(),
  recallCost: v.number(),
  place: v.union(v.literal("loadout"), v.literal("vault")),
  usage: v.union(v.literal("combat"), v.literal("passive"), v.literal("outOfCombat")),
  /** ready / exhausted (its card key used up, CB p.101), passive (always on), outOfCombat (CARD_NOT_COMBAT on the map). */
  state: v.union(v.literal("ready"), v.literal("exhausted"), v.literal("passive"), v.literal("outOfCombat")),
  resetLabel: v.union(v.null(), v.string()),
  tokens: v.number(),
  uses: v.array(handUseValidator),
});
export type HandCard = Infer<typeof handCardValidator>;

function specOf(use: CardUse): TargetSpec | undefined {
  return use.targets && use.targets.side !== "trigger" ? (use.targets as TargetSpec) : undefined;
}

/** One card of the Hand: its state from the sheet's `featureUses` (Q3, the same answer CA7 greys the sheet with). */
export function handCard(sheet: CharacterSheet, cardId: string, place: "loadout" | "vault"): HandCard | null {
  const card = getDomainCard(cardId);
  if (card === undefined) return null;
  const usage = cardUsage(cardId);
  const effect = cardEffect(cardId);
  const uses = (effect?.uses ?? []).map((u) => {
    const a = cardAvailability(sheet, cardId, { useId: u.id, ...(u.limit ? { limit: u.limit } : {}) });
    const spec = specOf(u);
    return {
      useId: u.id,
      name: u.name,
      activation: u.activation.kind,
      ready: a.state === "ready",
      resetLabel: a.state === "exhausted" ? a.label : null,
      usesLeft: a.state === "ready" && a.usesLeft !== undefined ? a.usesLeft : null,
      rolls: u.roll !== undefined,
      targets: spec ? { side: spec.side, range: spec.range, count: spec.count.kind } : null,
      choices: (u.choices ?? []).map((c) => ({ id: c.id, label: c.label, min: c.min })),
    };
  });
  const main = cardAvailability(sheet, cardId);
  const limited = (effect?.uses ?? []).filter((u) => u.activation.kind !== "passive");
  const allSpent = limited.length > 0 && limited.every((u) => u.limit !== undefined && cardAvailability(sheet, cardId, { useId: u.id, limit: u.limit }).state === "exhausted");
  let state: HandCard["state"];
  let resetLabel: string | null = null;
  if (usage === "outOfCombat") state = "outOfCombat";
  else if (main.state === "exhausted" || allSpent) {
    state = "exhausted";
    resetLabel = main.state === "exhausted" ? main.label : (uses.find((u) => u.resetLabel !== null)?.resetLabel ?? RESET_LABEL.rest);
  } else state = usage === "passive" ? "passive" : "ready";
  return {
    cardId,
    name: card.name,
    domain: card.domain,
    level: card.level,
    type: card.type,
    recallCost: card.recallCost,
    place,
    usage,
    state,
    resetLabel,
    tokens: sheet.cardTokens?.find((t) => t.cardId === cardId)?.count ?? 0,
    uses,
  };
}

/** The loadout, then the vault (`owned − loadout`), each card with its state. */
export function handOf(sheet: CharacterSheet): { loadout: HandCard[]; vault: HandCard[] } {
  const loadout = sheet.domainCards.loadout.flatMap((id) => handCard(sheet, id, "loadout") ?? []);
  const vault = sheet.domainCards.owned.filter((id) => !sheet.domainCards.loadout.includes(id)).flatMap((id) => handCard(sheet, id, "vault") ?? []);
  return { loadout, vault };
}

/** A `whenYouRecall` rider the Hand offers with a recall (Perfect Recall, CB p.50); `id` is what `moveCard` takes. */
export const recallRiderOptionValidator = v.object({ id: v.string(), name: v.string(), ready: v.boolean(), amount: v.number() });
export type RecallRiderOption = Infer<typeof recallRiderOptionValidator>;

/**
 * Plan lanes-2, E1 (dcm-cfpv): the recall riders the character can take with a recall: the `rider` uses with a
 * `whenYouRecall` trigger and a `reduceRecallCost` step of the loadout's cards and the held features, with whether their
 * limit is ready. Automatic ones are not listed (they always apply).
 */
export function recallRiderOptions(sheet: CharacterSheet, campaign: Pick<Doc<"campaigns">, "frameId" | "options">): RecallRiderOption[] {
  const out: RecallRiderOption[] = [];
  const offers = (use: CardUse) => use.activation.kind === "rider" && use.activation.trigger.kind === "whenYouRecall" && reductionOf(use) > 0;
  for (const id of sheet.domainCards.loadout) {
    for (const use of cardEffect(id)?.uses ?? []) {
      if (!offers(use)) continue;
      out.push({ id: `${id}:${use.id}`, name: use.name, ready: keyAvailability(sheet, featureUseKey(id, use.id), use.limit).state === "ready", amount: reductionOf(use) });
    }
  }
  for (const held of owned(sheet, { hopeAndFear: resolveOptions(campaign.frameId, campaign.options).hopeAndFear })) {
    const entry = featureEffect(held.featureId);
    for (const use of entry?.uses ?? []) {
      if (!offers(use)) continue;
      out.push({ id: `${held.featureId}:${use.id}`, name: use.name, ready: featureAvailability(sheet, entry!, use.id).state === "ready", amount: reductionOf(use) });
    }
  }
  return out;
}

/** The Recall Cost a `loadout` `reduceRecallCost` step takes off (its fixed amount, 1 by default). */
export function reductionOf(use: CardUse): number {
  let n = 0;
  for (const step of use.steps) {
    if (step.kind !== "loadout" || step.op !== "reduceRecallCost") continue;
    n += step.amount === undefined ? 1 : step.amount.kind === "fixed" ? step.amount.value : 1;
  }
  return n;
}
