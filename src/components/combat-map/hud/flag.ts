"use client";

import { useSyncExternalStore } from "react";

/**
 * The Combat HUD opt-in switch (plan combat-hud H0, user answer 11b): per viewer, stored in this browser's
 * localStorage, off by default and always off on the server. `?hud=1` / `?hud=0` in the URL overrides the stored
 * value for that page view (links for testing and for sharing the new view). Wave 9 (H8.1) deletes this file.
 *
 * Read with `useSyncExternalStore`, so the first client render matches the server (off) and the stored value takes
 * over right after hydration without an effect writing state (CL6 / CL7).
 */

/** The localStorage key ("1" = on; anything else = off). */
export const HUD_STORAGE_KEY = "dcm:combat-hud";

/** Fired on this window when `setHudEnabled` changes the value (the `storage` event covers other tabs). */
const CHANGE_EVENT = "dcm:combat-hud-change";

/** The URL override: true / false for `?hud=1` / `?hud=0`, null without one. */
export function hudOverride(search: string): boolean | null {
  const value = new URLSearchParams(search).get("hud");
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

function readStored(): boolean {
  try {
    return window.localStorage.getItem(HUD_STORAGE_KEY) === "1";
  } catch {
    // Storage blocked (private mode, a sandboxed frame): the classic view.
    return false;
  }
}

/** The switch as this browser sees it right now: the URL override, else the stored value. */
export function readHudEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return hudOverride(window.location.search) ?? readStored();
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** Whether this viewer sees the Combat HUD. Off on the server and during hydration. */
export function useHudEnabled(): boolean {
  return useSyncExternalStore(subscribe, readHudEnabled, () => false);
}

/**
 * Turns the HUD on or off for this viewer (call from an event handler). Stores the choice and drops a `?hud=` override
 * from the URL, so the toggle always wins over the link that opened the page.
 */
export function setHudEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(HUD_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Storage blocked: the URL override below still applies for this page view.
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has("hud")) {
    url.searchParams.delete("hud");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
