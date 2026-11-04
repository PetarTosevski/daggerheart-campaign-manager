"use client";

import { useSyncExternalStore } from "react";

/**
 * Which token's action ring is open (plan combat-hud H3.4): one module store, like `hud/pick-area/store.ts`, so the
 * token layer (H1.3's click handler opens it) and the ring layer read the same value without a provider. Every change
 * runs from an event handler (a click, a key), never from an effect.
 */

export type RingOpen = {
  tokenId: string;
  /** Opened from the keyboard (Enter / Space on the token): focus moves to the first button. */
  focus: boolean;
  /** Bumped on every open, so a reopen focuses again. */
  seq: number;
};

let open: RingOpen | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function set(next: RingOpen | null) {
  open = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const get = () => open;
const none = () => null;

/** The open ring, or null. */
export function useActionRing(): RingOpen | null {
  return useSyncExternalStore(subscribe, get, none);
}

/** Opens the ring around `tokenId` (closing any other). */
export function openActionRing(tokenId: string, focus = false): void {
  seq += 1;
  set({ tokenId, focus, seq });
}

/** A click on your token: opens its ring, or closes it when it is already open. */
export function toggleActionRing(tokenId: string, focus = false): void {
  if (open?.tokenId === tokenId) set(null);
  else openActionRing(tokenId, focus);
}

export function closeActionRing(): void {
  if (open !== null) set(null);
}

/** Unit tests: start closed. */
export function resetActionRingForTests(): void {
  open = null;
  seq = 0;
}
