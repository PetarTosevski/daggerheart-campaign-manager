import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { TokenArt } from "../token/model";

/**
 * The spotlight's display copy and optimistic updates (plan combat-hud H1.S; boards Main 'GM's turn', CmpTokens,
 * GMDesktop). Pure: the parts in `index.tsx` render what these return.
 */

export type SpotlightState = FunctionReturnType<typeof api.combatSpotlight.state>;

/** The card's line under "The GM has the spotlight": why it moved (CB p.100, p.149). */
export function spotlightReasonLine(state: Pick<SpotlightState, "reason" | "rollBy">): string {
  const who = state.rollBy?.name;
  switch (state.reason) {
    case "rollWithFear":
      return who ? `${who} rolled with Fear.` : "A roll came up with Fear.";
    case "failedRoll":
      return who ? `${who} failed a roll.` : "A roll failed.";
    case "adversary":
      return "An adversary is acting.";
    case "gmTook":
      return "The GM is making a move.";
    default:
      return "";
  }
}

/** Who holds it, for the GM's spotlight menu and screen readers. */
export function holderLine(state: Pick<SpotlightState, "holder" | "canMove">): string {
  const { holder } = state;
  if (holder === null) return "The players have the spotlight.";
  if (holder.kind === "pc") return `${holder.name} has the spotlight.`;
  return state.canMove ? "You have the spotlight." : "The GM has the spotlight.";
}

/** Whether a PC holds it (the banner's "Spotlight" tag). */
export function pcHolds(state: SpotlightState | undefined, characterId: Id<"characters">): boolean {
  return state?.holder?.kind === "pc" && state.holder.characterId === characterId;
}

/** Whether the GM holds it (the Fear banner's SPOTLIGHT tag, the players' GM's-turn card). */
export function gmHolds(state: SpotlightState | undefined): boolean {
  return state?.holder?.kind === "gm";
}

/**
 * The state right after `combatSpotlight.gmTake` (the GM's optimistic update; `now` from the click). With `tokenId` the
 * GM spotlights that adversary (reason `adversary`, the token lit; `since` kept while the GM already holds it); without
 * it a GM who already holds it keeps everything, as the server does.
 */
export function afterTake(state: SpotlightState, now: number, tokenId?: Id<"combatTokens">): SpotlightState {
  if (state.holder?.kind === "gm") {
    if (tokenId === undefined || state.adversaryTokenId === tokenId) return state;
    const since = state.since ?? now;
    return {
      holder: { kind: "gm" },
      since,
      reason: "adversary",
      rollBy: null,
      reactionsOnly: state.reactionsOnly,
      canMove: state.canMove,
      adversaryTokenId: tokenId,
      // The server names it; until then the card keeps its generic line.
      adversaryName: null,
    };
  }
  return {
    ...state,
    holder: { kind: "gm" },
    since: now,
    reason: tokenId === undefined ? "gmTook" : "adversary",
    rollBy: null,
    reactionsOnly: !state.canMove,
    adversaryTokenId: tokenId ?? null,
    adversaryName: null,
  };
}

/** The state right after `combatSpotlight.handTo` (the GM's optimistic update). */
export function afterHandTo(state: SpotlightState, pc: { characterId: Id<"characters">; name: string }, now: number): SpotlightState {
  if (state.holder?.kind === "pc" && state.holder.characterId === pc.characterId) return state;
  return { ...state, holder: { kind: "pc", ...pc }, since: now, reason: "handedBack", rollBy: null, reactionsOnly: false, adversaryTokenId: null, adversaryName: null };
}

/**
 * The players' GM's-turn card title (user 2026-11-03): "<adversary> has the spotlight" when the GM spotlighted an
 * adversary the party saw this scene but the player's map does not draw now (hidden, fogged, out of sight), so no light
 * shows whose turn it is; otherwise "The GM has the spotlight" (a drawn token stands in its light instead). The server
 * sends a player the name only for an adversary the party saw this scene (`combatSpotlight.state`).
 */
export function gmTurnTitle(state: Pick<SpotlightState, "adversaryTokenId" | "adversaryName">, drawn: ReadonlySet<string> | null): string {
  const { adversaryTokenId: tokenId, adversaryName: name } = state;
  if (tokenId === null || name === null || drawn === null || drawn.has(tokenId)) return "The GM has the spotlight";
  return `${name} has the spotlight`;
}

/**
 * What the spotlight lights on the map (bead dcm-bxp.99.32.35; H9.1, CmpTokens 'Spotlight' map light): the PC holder's
 * token(s) (gold), the adversary token the GM spotlighted (purple), or every PC token while the whole party holds it
 * (nobody chosen, user answer Q8 a: a smaller, dimmer gold pool on each). Null while loading, or when the GM holds it
 * generally (nothing is lit).
 */
export type SpotlightLit = { characterId: Id<"characters"> } | { tokenId: Id<"combatTokens"> } | { party: true };

export function litOf(state: SpotlightState | undefined): SpotlightLit | null {
  if (state === undefined) return null;
  const holder = state.holder;
  if (holder === null) return { party: true };
  if (holder.kind === "pc") return { characterId: holder.characterId };
  return state.adversaryTokenId ? { tokenId: state.adversaryTokenId } : null;
}

/** The pool under a token: gold for a PC holder, purple for an adversary, a dim gold for each PC of the whole party. */
export type PoolKind = "pc" | "gm" | "party";

/**
 * The pool under `token`, or null. A token the viewer draws is matched by id (the adversary) or by its PC's character
 * (`kind`/`characterId`, on the GM's tokens and a player's PCs). A player only ever matches a token their layers
 * already draw, so the light never reveals a fogged or hidden token.
 */
export function poolOf(lit: SpotlightLit | null, token: { _id: string; kind?: string; characterId?: string }): PoolKind | null {
  if (lit === null) return null;
  if ("party" in lit) return token.kind === "pc" ? "party" : null;
  if ("tokenId" in lit) return token._id === lit.tokenId ? "gm" : null;
  return token.kind === "pc" && token.characterId === lit.characterId ? "pc" : null;
}

/** Whether `token` is the one holder (its face glows); the whole party lights pools only, no face glow. */
export function isLit(lit: SpotlightLit | null, token: { _id: string; kind?: string; characterId?: string }): boolean {
  const pool = poolOf(lit, token);
  return pool === "pc" || pool === "gm";
}

/** The state right after `combatSpotlight.handToParty` (the GM's optimistic update, H9.S): nobody chosen. */
export function afterHandToParty(state: SpotlightState): SpotlightState {
  if (state.holder === null) return state;
  return { ...state, holder: null, since: null, reason: null, rollBy: null, reactionsOnly: false, adversaryTokenId: null, adversaryName: null };
}

/**
 * Who the spotlight disc shows (H9.1, CmpTokens 'Spotlight'): the whole party, one PC, an adversary (its initial on red,
 * purple light), or the GM generally (the GM's own move, or an adversary a player may not learn: the server sends a
 * player its id and name only when the party saw it this scene). `names` (the GM's token names) stands in while the
 * server has not named a just-taken adversary yet.
 */
export type DiscHolder =
  | { kind: "party"; name: string }
  | { kind: "pc"; characterId: Id<"characters">; name: string }
  | { kind: "adversary"; tokenId: Id<"combatTokens">; name: string }
  | { kind: "gm"; name: string };

export function discHolder(state: SpotlightState, names?: ReadonlyMap<string, string>): DiscHolder {
  const { holder } = state;
  if (holder === null) return { kind: "party", name: "The party" };
  if (holder.kind === "pc") return { kind: "pc", characterId: holder.characterId, name: holder.name };
  const tokenId = state.adversaryTokenId;
  if (tokenId !== null) {
    const name = state.adversaryName ?? names?.get(tokenId) ?? null;
    if (name !== null) return { kind: "adversary", tokenId, name };
  }
  return { kind: "gm", name: "The GM" };
}

/** The disc's accessible name: the GM's button "Spotlight: Moss. Change who has it", a player's image "Spotlight: Moss". */
export function discLabel(holder: Pick<DiscHolder, "name">, gm: boolean): string {
  return gm ? `Spotlight: ${holder.name}. Change who has it` : `Spotlight: ${holder.name}`;
}

/**
 * What a take for an adversary costs (user answer Q7 a; the board's script): "1 Fear" only when the spotlight moves from
 * the party or a PC to an adversary; while the GM already holds it, moving it between adversaries is free.
 */
export function takePay(state: Pick<SpotlightState, "holder">, chosen: "free" | "fear"): "free" | "fear" {
  return state.holder?.kind === "gm" ? "free" : chosen;
}

/**
 * The adversary holder's portrait on the disc (user 2026-11-04: "If an adversary has a picture please use it on the
 * spotlight icon as well"): the art its map token draws (`artOf` over the token's portrait), looked up by token id in
 * `art` (from the GM's `combatTokensReads.list`, or a player's `combatVision.playerView` `others`). Only for an
 * adversary holder: while the disc says "The GM" (an adversary the party has not seen) it shows no portrait, so none can
 * leak. Null draws the initial.
 */
export function holderArt(holder: DiscHolder, art: ReadonlyMap<string, TokenArt | null> | undefined): TokenArt | null {
  if (holder.kind !== "adversary" || art === undefined) return null;
  return art.get(holder.tokenId) ?? null;
}

/**
 * Whether an adversary row is defeated (user 2026-11-04: "I shouldn't be allowed to take the spotlight of dead NPCs"):
 * marked defeated (`stats.down`, a Minion group with every Minion gone included) or every HP marked, as the server's
 * `adversaryDefeated` reads it (convex/lib/spotlight.ts, ADVERSARY_DEFEATED).
 */
export function isDefeatedRow(stats: { hp: number; hpMax: number; down: boolean } | null): boolean {
  if (stats === null) return false;
  return stats.down || (stats.hpMax > 0 && stats.hp >= stats.hpMax);
}

/** The Adversaries tab's order: the living first, the defeated at the bottom, each in the map's order. */
export function livingFirst<T extends { defeated: boolean }>(rows: readonly T[]): T[] {
  return [...rows.filter((r) => !r.defeated), ...rows.filter((r) => r.defeated)];
}

/** The letter on an adversary's face (Cinzel on red). */
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}
