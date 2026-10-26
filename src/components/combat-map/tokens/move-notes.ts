"use client";

import { useSyncExternalStore } from "react";

/**
 * What the last moves on this screen said (map-movement M1; D3, D5), shared by the token layer and the token card:
 * - `notice`: the newest announcement: a player's refused move ("Blocked", polite aria-live) or the GM's warning that
 *   a token went through something that stops players. Cleared by the layer after a few seconds.
 * - `difficult`: tokens whose last move here crossed or ended on difficult terrain, with the square they ended on;
 *   the card shows the movement-roll note while the token is still there.
 * - `bump`: the token whose move was just refused (a short shake, none with reduced motion).
 * In memory only (never stored; the next move replaces it), per tab.
 */

export type MoveNotice = { readonly kind: "blocked" | "warning"; readonly text: string; readonly seq: number; readonly tokenId: string };

type State = {
  readonly notice: MoveNotice | null;
  readonly difficult: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  readonly bump: { readonly tokenId: string; readonly seq: number } | null;
};

/** The words of the announcements (D3). */
export const BLOCKED_TEXT = "Blocked";
export const WARNING_TEXT = "Moved through a wall or building: players can’t pass there.";
/** D5, on the token card. */
export const DIFFICULT_TEXT = "Difficult terrain: a movement roll is needed to pass this turn";

let state: State = { notice: null, difficult: new Map(), bump: null };
let seq = 0;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => state;

/** A move the server accepted: the GM's warning when it went through a blocker, and the token's difficult note. */
export function noteMove(tokenId: string, to: { x: number; y: number }, result: { blocked: boolean; difficult: boolean }) {
  const difficult = new Map(state.difficult);
  if (result.difficult) difficult.set(tokenId, { x: to.x, y: to.y });
  else difficult.delete(tokenId);
  set({ ...state, difficult, notice: result.blocked ? { kind: "warning", text: WARNING_TEXT, seq: ++seq, tokenId } : state.notice });
}

/** A player's move the server refused (MOVE_BLOCKED): the token is back where it was. */
export function noteBlocked(tokenId: string) {
  const n = ++seq;
  set({ ...state, notice: { kind: "blocked", text: BLOCKED_TEXT, seq: n, tokenId }, bump: { tokenId, seq: n } });
}

/** Clears the announcement `n` (and its bump) unless a newer one replaced it. */
export function clearNotice(n: number) {
  if (state.notice?.seq !== n && state.bump?.seq !== n) return;
  set({ ...state, notice: state.notice?.seq === n ? null : state.notice, bump: state.bump?.seq === n ? null : state.bump });
}

export function useMoveNotes(): State {
  return useSyncExternalStore(subscribe, read, read);
}
