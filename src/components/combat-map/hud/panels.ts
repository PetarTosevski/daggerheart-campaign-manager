"use client";

import { useEffect, useSyncExternalStore } from "react";

import { AREAS_PANEL_ID, setAreasOpen, useAreasOpen } from "./areas/open";

/**
 * The GM's HUD panels (plan combat-hud H9.0; GMDesktop: the dock, "Waiting on you", the spotlight disc): one open at a
 * time, from one store. Opening one closes the one before; Escape closes the open one and focus goes back to the button
 * that opened it. The dock (H9.0), the spotlight disc (H9.1), "Waiting on you", Log and Areas (H9.2) and the day disc
 * (H9.3) read and set it. Client state only.
 *
 * "areas" is mirrored into `areas/open.ts` (the flag `HudAreas` reads until H9.2 moves it here), so the Areas panel
 * opens and closes with this store, and closing it from its own ✕ shows here too.
 */

export const HUD_PANELS = ["queue", "log", "areas", "spotlight", "dice", "fog", "playerView", "endScene"] as const;
export type HudPanel = (typeof HUD_PANELS)[number];

let current: HudPanel | null = null;
/** The element that opened `current` (focus goes back to it when the panel closes by Escape or `closePanel`). */
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(next: HudPanel | null, from: HTMLElement | null) {
  setAreasOpen(next === "areas");
  if (current === next && opener === from) return;
  current = next;
  opener = from;
  emit();
}

/** Opens `panel` (closing any other); `from` is the button that opened it, for the focus to come back to. */
export function openPanel(panel: HudPanel, from: HTMLElement | null = null): void {
  set(panel, from ?? (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
}

/**
 * Closes `panel` (or whatever is open, without an argument) and puts the focus back on its opener when `restoreFocus`
 * (Escape, ✕). Closing a panel that is not the open one does nothing.
 */
export function closePanel(panel?: HudPanel, restoreFocus = false): void {
  // The Areas flag may be on without this store knowing (set from the old toolbar button until H9.3 removes it).
  if (panel === "areas") setAreasOpen(false);
  if (current === null || (panel !== undefined && panel !== current)) return;
  const back = opener;
  set(null, null);
  if (restoreFocus && back?.isConnected) back.focus();
}

/** Opens `panel`, or closes it when it is the open one (by this store; a button that shows `usePanel()` should decide from that). */
export function togglePanel(panel: HudPanel, from: HTMLElement | null = null): void {
  if (current === panel) closePanel(panel);
  else openPanel(panel, from);
}

/** The open panel right now (handlers and tests). */
export function openPanelNow(): HudPanel | null {
  return current;
}

/**
 * The open panel, live. "areas" counts as open only while the Areas flag is (its own ✕ / Escape clears the flag), and
 * the Areas flag set from elsewhere (the old toolbar button) shows as "areas".
 */
export function usePanel(): HudPanel | null {
  const panel = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const areasOpen = useAreasOpen();
  if (panel === "areas") return areasOpen ? "areas" : null;
  return areasOpen && panel === null ? "areas" : panel;
}

/** Whether `panel` is the open one. */
export function usePanelOpen(panel: HudPanel): boolean {
  return usePanel() === panel;
}

/**
 * Escape closes the open panel and returns the focus to its opener. A panel that handles Escape itself (and stops it)
 * wins; this is the fallback for the ones that don't. Mount once (the dock does).
 */
export function usePanelEscape(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || current === null) return;
      // The Areas panel closed itself (its ✕ or Escape): forget it without moving the focus.
      if (current === "areas" && document.getElementById(AREAS_PANEL_ID) === null) {
        set(null, null);
        return;
      }
      closePanel(undefined, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Back to nothing open (tests). */
export function resetPanels(): void {
  current = null;
  opener = null;
  setAreasOpen(false);
  emit();
}
