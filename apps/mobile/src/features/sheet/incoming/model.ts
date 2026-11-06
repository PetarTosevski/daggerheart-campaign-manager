import type { FunctionArgs, FunctionReturnType } from "convex/server";

import { SEVERITY_LABEL } from "../../../../../../src/lib/domain/encounters/damage";
import { cardEffect } from "../../../../../../src/lib/srd/card-effects";
import { DOMAIN_CARDS } from "../../../../../../src/lib/srd/domain-cards";
import { DOMAINS } from "../../../../../../src/lib/srd/domains";

import type { api } from "../../../convex";

/**
 * The phone's incoming-hit prompt (plan combat-actions AA4, sheet-drawer SD4, DA8, lanes-2 E2/E2.3), read only from
 * `adversaryActionsReads.pending` and answered with `adversaryActions.respond`.
 *
 * The website's model (src/components/combat-map/actions/reactions/model.ts) imports `@/lib/...`, which the phone
 * can't resolve; until it moves to src/lib (a website change) the phone keeps this one, built on the shared SRD and
 * damage modules. The modes and answers follow the server (convex/adversaryActions.ts `respond`,
 * convex/lib/incomingHits.ts `hitView`, convex/adversaryActionsReads.ts `preRollView`).
 */

export type HitView = FunctionReturnType<typeof api.adversaryActionsReads.pending>[number];
export type FeatureView = NonNullable<HitView["features"]>[number];
export type GrantView = NonNullable<HitView["grants"]>[number];
export type ArmorStep = NonNullable<HitView["armorPreview"]>[number];
/** What `respond` takes: the server's `hitChoiceValidator` or a before-roll feature answer. */
export type HitChoice = FunctionArgs<typeof api.adversaryActions.respond>["choice"];
type FeatureAnswer = Extract<HitChoice, { kind: "feature" }>;

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
  const counts = slotCounts(view);
  if (view.direct === true || counts.length === 0) return "ok";
  return counts.length === 1 && counts[0] === 1 ? "armorOne" : "armorMany";
}

/**
 * The Armor Slot counts on offer. The server's preview lists only counts that buy a step (Armor Eater, HF p.71: "must
 * mark an additional Armor Slot" lists 0, 2, 4); without a preview, 1..maxSlots.
 */
export function slotCounts(view: Pick<HitView, "maxSlots" | "armorPreview">): number[] {
  const previewed = (view.armorPreview ?? []).flatMap((step) => (step.slots > 0 ? [step.slots] : []));
  if (previewed.length > 0) return previewed;
  const max = Math.max(0, view.maxSlots ?? 0);
  return [...Array(max).keys()].map((n) => n + 1);
}

export function previewAt(view: Pick<HitView, "armorPreview">, slots: number): ArmorStep | undefined {
  return (view.armorPreview ?? []).find((step) => step.slots === slots);
}

/** "Minor (1 HP)", or "No damage". */
export function severityWords(step: Pick<ArmorStep, "severity" | "hp">): string {
  if (step.severity === "none") return SEVERITY_LABEL.none;
  return `${SEVERITY_LABEL[step.severity]} (${step.hp} HP)`;
}

/** The hit PC's damage line: "14 damage: Major (2 HP)." (their own numbers only, Q14). */
export function hitDamageText(view: HitView): string {
  const now = previewAt(view, 0) ?? { severity: view.severity ?? "none", hp: 0 };
  return `${view.damage ?? 0} damage: ${severityWords(now)}.`;
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
      const after = previewAt(view, 1);
      if (after === undefined) return "Mark an Armor Slot?";
      return after.severity === "none" ? "Mark an Armor Slot to take no damage?" : `Mark an Armor Slot to make it ${SEVERITY_LABEL[after.severity]}?`;
    }
    case "armorMany": {
      const counts = slotCounts(view);
      const single = counts.length === 1 ? previewAt(view, counts[0]) : undefined;
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

// ---------------------------------------------------------------- feature answers (SD4)

export type FeaturePicks = {
  numbers: Record<string, number>;
  options: Record<string, string>;
  optionals: Record<string, boolean>;
  situations: Record<string, boolean>;
};

/** The smallest count a number control takes (at least 1). */
export const numberFloor = (n: Pick<FeatureView["numbers"][number], "min">) => Math.max(1, n.min);

/** A feature's controls at rest: smallest counts, first options, `defaultOn` optionals ticked (DA8, Draining Bane). */
export function startingPicks(feature: FeatureView): FeaturePicks {
  const picks: FeaturePicks = { numbers: {}, options: {}, optionals: {}, situations: {} };
  for (const n of feature.numbers) picks.numbers[n.id] = numberFloor(n);
  for (const o of feature.options) if (o.options.length > 0) picks.options[o.id] = o.options[0].id;
  for (const o of feature.optionals) if (o.defaultOn === true) picks.optionals[o.id] = true;
  return picks;
}

/** Use is ready once the player confirmed every situation the feature names (Q13). */
export function picksReady(feature: FeatureView, picks: FeaturePicks): boolean {
  return feature.situations.every((text) => picks.situations[text]);
}

/** The `respond` answer for a feature (`useFeature`'s ids: `n:`, `opt:`, `optional:`, `situations`). */
export function featureAnswer(feature: FeatureView, picks: FeaturePicks): FeatureAnswer {
  const choices: FeatureAnswer["choices"] = [];
  for (const n of feature.numbers) choices.push({ id: `n:${n.id}`, value: picks.numbers[n.id] ?? numberFloor(n) });
  for (const o of feature.options) {
    const picked = picks.options[o.id];
    if (picked !== undefined) choices.push({ id: `opt:${o.id}`, value: [picked] });
  }
  for (const o of feature.optionals) choices.push({ id: `optional:${o.id}`, value: picks.optionals[o.id] === true });
  if (feature.situations.length > 0) choices.push({ id: "situations", value: feature.situations.filter((text) => picks.situations[text]) });
  return { kind: "feature", featureId: feature.featureId, useId: feature.useId, choices };
}

// ---------------------------------------------------------------- grants (lanes-2 E2.3)

/** A grant's amount to pay, from 1 to what it offers (Money Talks, CB p.228; Doom, HF p.75). */
export function grantPay(grant: Pick<GrantView, "amount">, wanted: number): number {
  const most = Math.max(1, Math.trunc(grant.amount ?? 1));
  if (!Number.isFinite(wanted)) return most;
  return Math.min(most, Math.max(1, Math.trunc(wanted)));
}

export const HIT_RETRY_DELAYS_MS = [500, 1500, 4000] as const;
export const HIT_RETRY_STABLE_MS = 10_000;
