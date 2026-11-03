import { useSyncExternalStore } from "react";

/*
 * Who opened the Lorekeeper drawer, and on which page (plan combat-hud H9.A). The drawer (lorekeeper/drawer/index.tsx)
 * and the Combat Map app bar's Lorekeeper pill share it: the bar is in the shell, the drawer is mounted by the campaign
 * layout, so neither renders the other. It lives here, not in the drawer module, because the drawer imports the shell
 * and the shell imports the app bar: a store with no imports keeps that free of cycles.
 */
export type LorekeeperDrawerState = {
  /** The pathname the drawer was opened on (it is open only there), or null. */
  openAt: string | null;
  /** Someone has opened it in this tab: its panel chunk is wanted (and kept for reopening). */
  wanted: boolean;
};

const CLOSED: LorekeeperDrawerState = { openAt: null, wanted: false };

let state: LorekeeperDrawerState = CLOSED;
/** The control that opened the drawer; focus goes back to it on close. */
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();

function emit(next: LorekeeperDrawerState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens the drawer on `pathname`; `from` gets focus back when it closes. */
export function openLorekeeperDrawer(pathname: string, from: HTMLElement | null): void {
  opener = from;
  emit({ openAt: pathname, wanted: true });
}

/** Closes the drawer and returns focus to whoever opened it (else `fallback`). */
export function closeLorekeeperDrawer(fallback: HTMLElement | null): void {
  const target = opener?.isConnected ? opener : fallback;
  opener = null;
  emit({ openAt: null, wanted: state.wanted });
  target?.focus();
}

export function useLorekeeperDrawerState(): LorekeeperDrawerState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => CLOSED,
  );
}
