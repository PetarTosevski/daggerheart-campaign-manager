import type { FunctionArgs, FunctionReturnType } from "convex/server";

import type { api } from "../../../convex";

export type HandCard = FunctionReturnType<typeof api.combatCardsReads.hand>["loadout"][number];
export type HandUse = HandCard["uses"][number];
export type CardChoice = FunctionArgs<typeof api.combatCards.useCard>["choices"][number];
type UseCardResult = FunctionReturnType<typeof api.combatCards.useCard>;
export type ChoiceAsk = Extract<UseCardResult, { status: "needsChoice" }>["asks"][number];

/**
 * The phone's Hand rules (dcm-gdzi.16), read from `combatCardsReads.hand` (convex/lib/cardHandView.ts) and sent to
 * `combatCards.useCard` the way the server's runner reads them (convex/lib/cardRunner.ts `buildRun`):
 * - a self use, an "all targets within …" use and a use without targets send no target: the runner fills in the
 *   actor (self) or every enemy it sees in range (`count: "all"`);
 * - a use that picks creatures sends the picked tokens (side enemy / ally / selfOrAlly / any);
 * - a use on a point or an object needs the map's square picker, which the phone does not have yet: the website.
 */

/** The card's uses the player starts from the Hand (actions; reactions and passives are not started from here). */
export function actionUses(card: Pick<HandCard, "uses" | "state">): HandUse[] {
  if (card.state === "outOfCombat" || card.state === "passive") return [];
  return card.uses.filter((use) => use.activation === "action");
}

/** Why the use can't be played now (an exhausted card, a use spent until its reset), or null. */
export function blockedReason(card: Pick<HandCard, "state" | "resetLabel">, use: Pick<HandUse, "ready" | "resetLabel">): string | null {
  if (card.state === "exhausted") return card.resetLabel ? `Exhausted · ${card.resetLabel}` : "Exhausted";
  if (!use.ready) return use.resetLabel ? `Used · ${use.resetLabel}` : "Used";
  return null;
}

export type PickSide = "enemy" | "ally" | "selfOrAlly" | "any";

export type CardTargeting =
  /** Nothing to pick: the server fills the targets in (`text` says who). */
  | { kind: "none"; text: string }
  /** Creatures to pick: at most `max` (null: as many as the card allows), at least `min`. */
  | { kind: "pick"; side: PickSide; min: number; max: number | null }
  /** A point or object target: needs the map's square picker. */
  | { kind: "website"; text: string };

const PICK_SIDES: ReadonlySet<string> = new Set<PickSide>(["enemy", "ally", "selfOrAlly", "any"]);

const SIDE_WORD: Record<PickSide, string> = {
  enemy: "enemy",
  ally: "ally",
  selfOrAlly: "ally (or you)",
  any: "creature",
};

export function targetingOf(use: Pick<HandUse, "targets">): CardTargeting {
  const t = use.targets;
  if (t === null) return { kind: "none", text: "No target to pick." };
  if (t.side === "self") return { kind: "none", text: "Affects you." };
  if (t.side === "point" || t.side === "object") return { kind: "website", text: "Pick its square on the website's map." };
  if (!PICK_SIDES.has(t.side)) return { kind: "none", text: "No target to pick." };
  const side = t.side as PickSide;
  if (t.count === "all") return { kind: "none", text: `Every ${SIDE_WORD[side]} in range (the server picks them).` };
  if (t.count === "one") return { kind: "pick", side, min: 1, max: 1 };
  return { kind: "pick", side, min: 1, max: null };
}

export function sideWord(side: PickSide): string {
  return SIDE_WORD[side];
}

/** A creature the player can pick for a card, from their character's view. */
export type Candidate = { tokenId: string; name: string; side: "self" | "pc" | "enemy" | "other" };

/** The creatures of the view that fit a side (the server checks again: `sideAllows`). */
export function candidatesFor(
  side: PickSide,
  view: { tokenId: string; pcs: readonly { _id: string; name: string }[]; others: readonly { _id: string; name: string; side: string }[] },
): Candidate[] {
  const self: Candidate[] = [];
  const pcs: Candidate[] = [];
  for (const t of view.pcs) (t._id === view.tokenId ? self : pcs).push({ tokenId: t._id, name: t._id === view.tokenId ? "You" : t.name, side: t._id === view.tokenId ? "self" : "pc" });
  const enemies: Candidate[] = view.others.filter((t) => t.side === "enemy").map((t) => ({ tokenId: t._id, name: t.name, side: "enemy" }));
  const friends: Candidate[] = view.others.filter((t) => t.side === "pc" || t.side === "ally").map((t) => ({ tokenId: t._id, name: t.name, side: "pc" }));
  const rest: Candidate[] = view.others.filter((t) => t.side !== "enemy" && t.side !== "pc" && t.side !== "ally").map((t) => ({ tokenId: t._id, name: t.name, side: "other" }));
  switch (side) {
    case "enemy":
      return enemies;
    case "ally":
      return [...pcs, ...friends];
    case "selfOrAlly":
      return [...self, ...pcs, ...friends];
    case "any":
      return [...enemies, ...pcs, ...friends, ...rest, ...self];
  }
}

/** Toggles a pick within the use's limit (one target: the new pick replaces the old). */
export function togglePicked(picked: readonly string[], tokenId: string, max: number | null): string[] {
  if (picked.includes(tokenId)) return picked.filter((id) => id !== tokenId);
  if (max === 1) return [tokenId];
  if (max !== null && picked.length >= max) return [...picked];
  return [...picked, tokenId];
}

/** Why Use is not ready yet with these picks, or null. */
export function pickProblem(targeting: CardTargeting, picked: readonly string[]): string | null {
  if (targeting.kind === "website") return targeting.text;
  if (targeting.kind === "pick" && picked.length < targeting.min) return `Pick ${targeting.max === 1 ? "a" : "at least one"} ${sideWord(targeting.side)} first.`;
  return null;
}

/** The targets `useCard` takes: none when the server fills them in. */
export function targetTokenIdsOf(targeting: CardTargeting, picked: readonly string[]): string[] {
  return targeting.kind === "pick" ? [...picked] : [];
}

/** The numbers the player sets before the use ("spend any number of Hope"), as `n:<choice>` (convex/lib/cardChoices.ts). */
export function numberChoices(use: Pick<HandUse, "choices">, values: Readonly<Record<string, number>>): CardChoice[] {
  return use.choices.map((c) => ({ id: `n:${c.id}`, value: Math.max(c.min, values[c.id] ?? c.min) }));
}

/** The asks the phone answers itself: `choose` steps. Splits and follow-up links still need the website. */
export type ChooseAsk = Extract<ChoiceAsk, { kind: "choose" }>;

export function chooseAsks(asks: readonly ChoiceAsk[]): { choose: ChooseAsk[]; other: number } {
  const choose = asks.filter((a): a is ChooseAsk => a.kind === "choose");
  return { choose, other: asks.length - choose.length };
}

/** The key of a `choose` ask: its step and, for a step every chooser answers, the chooser. */
export function askKey(ask: Pick<ChooseAsk, "stepId" | "chooserId">): string {
  return ask.chooserId === undefined ? `opt:${ask.stepId}` : `by:${ask.stepId}:${ask.chooserId}`;
}

/** The answers to `choose` asks, as the choice ids the runner reads (`opt:<step>`, `by:<step>:<chooser>`). */
export function askAnswers(asks: readonly ChooseAsk[], picked: Readonly<Record<string, string>>): CardChoice[] {
  const out: CardChoice[] = [];
  for (const ask of asks) {
    const option = picked[askKey(ask)];
    if (option !== undefined) out.push({ id: askKey(ask), value: [option] });
  }
  return out;
}
