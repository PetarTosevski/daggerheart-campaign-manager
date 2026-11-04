"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the GM's "Areas on the map" panel is open (plan combat-hud H5.3). The toolbar's Areas button (hud/scene) and
 * the panel (`HudAreas`, mounted by the shell in the pop region) live in different regions, so they share this one
 * flag, like the classic square pick (`map-view/area-pick.tsx`). Client state only.
 */

let open = false;
const listeners = new Set<() => void>();

/** The panel's element id (the Areas button's `aria-controls`). */
export const AREAS_PANEL_ID = "hud-areas";

export function setAreasOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The flag, live. */
export function useAreasOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}
