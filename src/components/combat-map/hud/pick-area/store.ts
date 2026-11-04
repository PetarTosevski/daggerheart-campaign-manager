"use client";

import { useSyncExternalStore } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { placeAt, type AreaAsk, type Square } from "./model";

/**
 * The HUD's square-picking mode (plan combat-hud H3.3): one module store, like the classic `map-view/area-pick.tsx`, so
 * whoever asks for squares (a feature's Use from the sheet panel, H3.1's card picker, H3.4's action ring) needs no
 * provider, and the map layer, the bar and the asker all read the same picks. Every change runs from an event handler
 * (a click, a drag, a key), never from an effect. The last result line (the use's outcome, or a refusal) stays in the
 * bar until dismissed (`showPickLine`), so feature uses that never touch the map can report there too.
 */

/** What the confirm's send came back with. */
export type AreaPickOutcome =
  /** The use ran: the mode ends; `line` (the result) shows in the bar. */
  | { kind: "done"; line?: string | null }
  /** The GM approves first (out of range): the mode ends; "Waiting for the GM" shows from the server's open requests. */
  | { kind: "pending"; line?: string | null }
  /** Keep picking, with a message under the confirm. */
  | { kind: "stay"; message?: string };

export type AreaPickSpec = AreaAsk & {
  /** Stable per asker and thing ("feature:<char>:<feature>:<use>"). */
  id: string;
  /** The map the squares are on (another map's board ignores the mode). */
  mapId: string;
  /** The confirm's label; default `confirmLabel(ask)` ("Place Dark Cloud here"). */
  confirm?: string;
  /** The cost line beside the confirm ("Spends 1 Hope"). */
  pay?: string | null;
  /** Sends the use with the picked squares (in pick order). A thrown error keeps the mode and shows under the confirm. */
  send: (squares: Square[]) => Promise<AreaPickOutcome>;
  /** Runs once when the mode ends without a send (Cancel, Esc, another pick starting). */
  onCancel?: () => void;
};

export type AreaPickLive = {
  spec: AreaPickSpec;
  points: Square[];
  /** The keyboard cursor (arrows move it, Enter places a point there); null until a key is pressed. */
  cursor: Square | null;
  sending: boolean;
  message: string | null;
};

export type PickLine = { text: string; error: boolean };

type State = { live: AreaPickLive | null; line: PickLine | null };

let state: State = { live: null, line: null };
/** What had focus when the mode started (focus goes back on cancel); not rendered. */
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getState = () => state;
const SERVER: State = { live: null, line: null };

/** The running square pick and the bar's last line. */
export function useAreaPickState(): State {
  return useSyncExternalStore(subscribe, getState, () => SERVER);
}

function restoreFocus() {
  const el = opener;
  opener = null;
  if (el && el.isConnected) el.focus();
}

/** Starts square picking (ending any running one: its `onCancel` runs). Call from a click handler. */
export function startAreaPick(spec: AreaPickSpec): void {
  const before = state.live;
  if (before && before.spec.id !== spec.id) before.spec.onCancel?.();
  if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement && !before) opener = document.activeElement;
  set({ live: { spec, points: [], cursor: null, sending: false, message: null }, line: null });
}

/**
 * Picks squares and resolves with them when the player confirms (null when cancelled): for an asker that sends the
 * use itself. The mode ends at the confirm, so a refusal can't keep it open: prefer `startAreaPick` with `send`.
 */
export function pickArea(spec: Omit<AreaPickSpec, "send" | "onCancel">): Promise<Square[] | null> {
  return new Promise((resolve) => {
    startAreaPick({
      ...spec,
      send: async (squares) => {
        resolve(squares);
        return { kind: "done" };
      },
      onCancel: () => resolve(null),
    });
  });
}

/** Ends the mode without sending (Cancel, Esc): runs `onCancel`, gives focus back. */
export function cancelAreaPick(): void {
  const live = state.live;
  if (!live) return;
  set({ live: null });
  live.spec.onCancel?.();
  restoreFocus();
}

/** A click or Enter on a square: the next point, or the nearest one moves there. */
export function placeSquare(square: Square): void {
  const live = state.live;
  if (!live || live.sending) return;
  set({ live: { ...live, points: placeAt(live.points, live.spec.count, square), cursor: square, message: null } });
}

/** A handle dragged to a square. */
export function movePointTo(i: number, square: Square): void {
  const live = state.live;
  if (!live || live.sending || i < 0 || i >= live.points.length) return;
  set({ live: { ...live, points: live.points.map((p, j) => (j === i ? square : p)), message: null } });
}

export function setCursor(square: Square): void {
  const live = state.live;
  if (!live) return;
  set({ live: { ...live, cursor: square } });
}

/** Shows a line in the bar (a use's result, or a refusal), replacing the last. */
export function showPickLine(text: string, error = false): void {
  set({ line: { text, error } });
}

export function dismissPickLine(): void {
  set({ line: null });
}

/** The confirm: sends the squares; done / pending end the mode, `stay` and a refusal keep it with a message. */
export async function confirmAreaPick(): Promise<void> {
  const live = state.live;
  if (!live || live.sending || live.points.length < live.spec.count) return;
  const id = live.spec.id;
  set({ live: { ...live, sending: true, message: null } });
  const mine = () => state.live !== null && state.live.spec.id === id;
  try {
    const out = await live.spec.send([...live.points]);
    if (out.kind === "stay") {
      if (mine()) set({ live: { ...state.live!, sending: false, message: out.message ?? null } });
      return;
    }
    if (mine()) set({ live: null });
    opener = null;
    if (out.line) set({ line: { text: out.line, error: false } });
  } catch (e) {
    if (mine()) set({ live: { ...state.live!, sending: false, message: errorMessage(e) } });
  }
}

/** Test seam: the store back to empty. */
export function resetAreaPickForTests(): void {
  opener = null;
  set({ live: null, line: null });
}
