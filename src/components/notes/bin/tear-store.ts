"use client";

import { useSyncExternalStore } from "react";

import type { Id } from "../../../../convex/_generated/dataModel";
import type { NotesView } from "../slots";

/**
 * What outlives the torn-out page's own components (D11 N7): the rip frame (B8), which plays on top of the paper for
 * 1.5 s while the page is already gone, and the 'Page torn out · Undo' toast (Q11), which stays 10 s. `TearOutButton`
 * starts both; `TearLayer` (mounted by `TornOutPages`, which is always on the Notes page) shows them. A tiny external
 * store, read with `useSyncExternalStore`.
 */

export type TearFrame = {
  key: number;
  /** A copy of the paper as it was when the page was torn out (cloned DOM, never HTML text). */
  paper: HTMLElement;
  rect: { top: number; left: number; width: number; height: number };
};

export type TornToast = {
  key: number;
  campaignId: Id<"campaigns">;
  pageId: Id<"journalPages">;
  title: string;
  /** The view to reopen the page in after Undo ('page' for an own page, 'journal' for a past journal's, N8). */
  view: NotesView;
};

type State = { tear: TearFrame | null; toast: TornToast | null };

let state: State = { tear: null, toast: null };
let counter = 0;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: State = { tear: null, toast: null };

/** The current rip frame and toast. */
export function useTearState(): State {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

export function startTear(paper: HTMLElement, rect: TearFrame["rect"]): void {
  set({ tear: { key: ++counter, paper, rect } });
}

export function endTear(key: number): void {
  if (state.tear?.key === key) set({ tear: null });
}

export function showToast(toast: Omit<TornToast, "key">): void {
  set({ toast: { ...toast, key: ++counter } });
}

export function hideToast(key: number): void {
  if (state.toast?.key === key) set({ toast: null });
}
