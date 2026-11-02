import { cardEffect } from "@/lib/srd/card-effects";

import { limitLabel, playableUses, type HandCard } from "../../actions/hand/model";
import type { TagKind } from "../ui";

/**
 * What the HUD hand shows around each card (plan combat-hud H2.3; board CmpCards "Card states in the hand"). The face
 * is the app's own `HandCardFace`, never changed (HANDOFF hard rule 1); every state lives around it: one tag above the
 * card, a lift and glow while it is being played, a grey wash when it can't be played. Pure: the unit tests read these
 * directly (tests/unit/hud/hand-states.test.tsx).
 */

/** Whose hand this is: the viewer's own, a PC's for the GM (Play-for decides), or another player's (read only). */
export type HandMode = "own" | "gm" | "view";

/** The tag kinds of the HUD's `Tag` plus the board's grey lock tag (`.hs-lock`). */
export type CardTagKind = TagKind | "lock";

export type CardTag = { kind: CardTagKind; text: string; lock?: true };

/** play: lifted and glowing; afford / locked: greyed (the face greys a used card and a locked one itself). */
export type CardWash = "none" | "play" | "afford" | "locked";

export type CardLook = {
  tag: CardTag | null;
  wash: CardWash;
  /** Whether the card shows an enabled Use. */
  canUse: boolean;
  /** Whether the card shows Use at all (disabled when it can't be used now); false for passive / reaction cards. */
  showUse: boolean;
  /** Why Use is disabled, for its title. */
  reason?: string;
};

export type LookContext = {
  mode: HandMode;
  /** The GM's "Play for this character" switch (always true for the viewer's own hand). */
  canPlay: boolean;
  /** The hand's character ("Moss"): the GM's lock tag and the view-only tag name them. */
  name: string;
  /** The acting character's Hope, or null while unknown (no shortfall is shown then). */
  hope: number | null;
  /** This card is being played: its dialog is open, it waits for a square on the map, or its use is on the way. */
  playing: boolean;
  /** The roll options can't be paid ("Not enough Hope for those Experiences."): a card that rolls waits. */
  rollBlock: string | null;
};

const lower = (s: string) => (s.length > 0 ? s[0]!.toLowerCase() + s.slice(1) : s);

/** "Used · back after a rest" from the card's reset label. */
export function usedText(resetLabel: string | null | undefined): string {
  return `Used · ${lower(resetLabel ?? "Back after a rest")}`;
}

/** The card's first ready action use, with its effect entry (null when nothing can start). */
function firstReady(card: HandCard) {
  const use = playableUses(card).find((u) => u.ready);
  if (!use) return null;
  return { use, effect: cardEffect(card.cardId)?.uses.find((u) => u.id === use.useId) };
}

/**
 * The Hope a card's first ready use costs its caster up front (fixed amounts of its `costs`, paid by the caster): the
 * shortfall the tag names before the click (CmpBlocked layer 1). 0 when it costs no Hope or the amount is chosen.
 */
export function hopeNeed(card: HandCard): number {
  const first = firstReady(card);
  const effect = first?.effect;
  if (!effect || (effect.paidBy !== undefined && effect.paidBy !== "self")) return 0;
  let need = 0;
  for (const cost of effect.costs ?? []) if (cost.kind === "hope" && cost.amount.kind === "fixed") need += cost.amount.value;
  return need;
}

/** Whether the first ready use rolls (the roll options apply to it). */
export function rollsNow(card: HandCard): boolean {
  return firstReady(card)?.use.rolls === true;
}

/** The tag for a card that is never played from the hand (passive, reaction, rider, automatic, out of combat). */
function howTag(card: HandCard): CardTag | null {
  if (card.state === "outOfCombat") return { kind: "used", text: "Out of combat" };
  if (card.state === "passive") return { kind: "used", text: "Passive · always on" };
  const kind = card.uses.find((u) => u.activation !== "passive")?.activation;
  if (kind === "reaction") return { kind: "used", text: "Reaction · shows in the hit window" };
  if (kind === "rider") return { kind: "used", text: "Rider · added to an attack" };
  if (kind === "auto") return { kind: "used", text: "Automatic" };
  return null;
}

/** The ready card's own tag: its tokens, else its limit, else nothing (its costs are on the face). */
function readyTag(card: HandCard): CardTag | null {
  if (card.tokens > 0) return { kind: "limit", text: `${card.tokens} token${card.tokens === 1 ? "" : "s"}` };
  const effect = firstReady(card)?.effect;
  if (effect?.limit) return { kind: "limit", text: limitLabel(effect.limit) };
  return null;
}

/** Everything around one card of the hand (board CmpCards, the tags in their order of precedence). */
export function cardLook(card: HandCard, ctx: LookContext): CardLook {
  const playable = playableUses(card);
  const how = playable.length === 0 ? howTag(card) : null;
  if (ctx.mode === "view") return { tag: { kind: "used", text: `${ctx.name}’s hand · view only` }, wash: "none", canUse: false, showUse: false };
  if (ctx.mode === "gm" && !ctx.canPlay) {
    return { tag: { kind: "lock", text: `Turn on “Play for ${ctx.name}”`, lock: true }, wash: "locked", canUse: false, showUse: false };
  }
  if (card.state === "exhausted") return { tag: { kind: "used", text: usedText(card.resetLabel) }, wash: "none", canUse: false, showUse: false };
  if (how) return { tag: how, wash: "none", canUse: false, showUse: false };
  if (ctx.playing) return { tag: { kind: "play", text: "Casting · pick a target" }, wash: "play", canUse: false, showUse: true, reason: "This card is being played." };
  const first = playable.find((u) => u.ready);
  if (!first) {
    const reset = playable.find((u) => u.resetLabel !== null)?.resetLabel ?? null;
    return { tag: { kind: "used", text: usedText(reset) }, wash: "none", canUse: false, showUse: true, reason: "Every use of this card is spent." };
  }
  const need = hopeNeed(card);
  if (ctx.hope !== null && need > ctx.hope) {
    const text = `Needs ${need} Hope`;
    return { tag: { kind: "no", text, lock: true }, wash: "afford", canUse: false, showUse: true, reason: `${text} · you have ${ctx.hope}` };
  }
  if (ctx.rollBlock && first.rolls) return { tag: readyTag(card), wash: "none", canUse: false, showUse: true, reason: ctx.rollBlock };
  return { tag: readyTag(card), wash: "none", canUse: true, showUse: true };
}

// ---------------------------------------------------------------- the vault

/** "Recall · 1 Stress" in combat, "Recall · free" while resting or for a free card (board CmpCards "Vault and recall"). */
export function recallText(recallCost: number, restOpen: boolean): string {
  return restOpen || recallCost === 0 ? "Recall · free" : `Recall · ${recallCost} Stress`;
}

/** "Loadout full · 5 of 5" when the loadout holds `max` cards. */
export function loadoutFullText(count: number, max: number): string | null {
  return count >= max ? `Loadout full · ${count} of ${max}` : null;
}

// ---------------------------------------------------------------- roll options

/** The board's advantage range: −3 (disadvantage) to +3. */
export const EDGE_MIN = -3;
export const EDGE_MAX = 3;
/** Help dice: none to three. */
export const HELP_MAX = 3;

/** Whether an Experience chip that is off can't be picked: each costs 1 Hope (CB p.90), with what is already picked. */
export function experienceShort(hope: number | null, picked: number, on: boolean): boolean {
  return !on && hope !== null && hope - picked < 1;
}

/** "+1", "−2", "0". */
export function signedEdge(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
}
