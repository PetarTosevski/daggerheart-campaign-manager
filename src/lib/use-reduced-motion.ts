import { useSyncExternalStore } from "react";

import { TEXT_SIZES, type TextSize } from "@/lib/config/preferences";

/**
 * The account's display preferences on `<html>` (plan config U6b, Q12 a / Q13 a).
 *
 * `PrefsSync` (src/app/(gm)/prefs-sync.tsx) writes two attributes on `document.documentElement`:
 * - `data-reduce-motion` (present = the account asks for calmer motion). globals.css applies the same calm as
 *   `@media (prefers-reduced-motion: reduce)` under it.
 * - `data-text-size="small" | "medium" | "large"`: globals.css sets CSS `zoom` 0.9 / 1 / 1.15 on the root.
 *
 * Q13 a: On = calmer even when the device doesn't ask; Off = follow the device. Nothing here ever forces motion on a
 * device that asks for less, so `prefersReducedMotion()` is device OR account.
 *
 * The (gm) layout (a Server Component, which can't import this hook module) holds the inline script that applies the
 * cache on a hard load; tests/unit/prefs-sync.test.tsx runs it against these constants.
 */

export const REDUCE_MOTION_ATTR = "data-reduce-motion";
export const TEXT_SIZE_ATTR = "data-text-size";

/**
 * The last display preferences this browser saw, so the first paint of a hard load already has them (no flash while
 * `preferences.get` loads). A cache of the account's values, never read as the source of truth: the account wins as
 * soon as the query answers. JSON `{ r: boolean, t: TextSize }`.
 */
export const DISPLAY_PREFS_CACHE_KEY = "dcm:display-prefs";

const DEVICE_QUERY = "(prefers-reduced-motion: reduce)";

export type DisplayPrefs = { reduceMotion: boolean; textSize: TextSize };

export function isTextSize(value: unknown): value is TextSize {
  return (TEXT_SIZES as readonly unknown[]).includes(value);
}

/** Writes the two attributes on `root`; `null` removes both (signed out, or the app shell unmounted). */
export function applyDisplayPrefs(root: HTMLElement, prefs: DisplayPrefs | null): void {
  if (prefs === null) {
    root.removeAttribute(REDUCE_MOTION_ATTR);
    root.removeAttribute(TEXT_SIZE_ATTR);
    return;
  }
  if (prefs.reduceMotion) root.setAttribute(REDUCE_MOTION_ATTR, "");
  else root.removeAttribute(REDUCE_MOTION_ATTR);
  if (root.getAttribute(TEXT_SIZE_ATTR) !== prefs.textSize) root.setAttribute(TEXT_SIZE_ATTR, prefs.textSize);
}

/** The cached display preferences, or null when none (or unreadable: private mode, a bad value). */
export function readCachedDisplayPrefs(storage: Pick<Storage, "getItem"> | undefined): DisplayPrefs | null {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(DISPLAY_PREFS_CACHE_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return null;
    const { r, t } = parsed as { r?: unknown; t?: unknown };
    if (typeof r !== "boolean" || !isTextSize(t)) return null;
    return { reduceMotion: r, textSize: t };
  } catch {
    return null;
  }
}

/** Saves (or, with null, forgets) the display cache; storage errors are ignored (the account still applies). */
export function writeCachedDisplayPrefs(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, prefs: DisplayPrefs | null) {
  try {
    if (prefs === null) storage?.removeItem(DISPLAY_PREFS_CACHE_KEY);
    else storage?.setItem(DISPLAY_PREFS_CACHE_KEY, JSON.stringify({ r: prefs.reduceMotion, t: prefs.textSize }));
  } catch {
    // Storage full or blocked: nothing to cache.
  }
}

/** Whether the device asks for less motion (`prefers-reduced-motion: reduce`). */
export function deviceReducesMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DEVICE_QUERY).matches;
}

/** Whether the account asks for calmer motion (PrefsSync's attribute on `<html>`). */
export function accountReducesMotion(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute(REDUCE_MOTION_ATTR);
}

/**
 * Device OR account (Q13 a). For code outside React, or in event handlers and animation starts: read it at the moment
 * of use, as the `matchMedia(...).matches` reads it replaces did.
 */
export function prefersReducedMotion(): boolean {
  return deviceReducesMotion() || accountReducesMotion();
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const media = typeof window.matchMedia === "function" ? window.matchMedia(DEVICE_QUERY) : null;
  media?.addEventListener?.("change", onChange);
  const observer = typeof MutationObserver === "function" ? new MutationObserver(onChange) : null;
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: [REDUCE_MOTION_ATTR] });
  return () => {
    media?.removeEventListener?.("change", onChange);
    observer?.disconnect();
  };
}

/**
 * `prefersReducedMotion()` as a hook that re-renders when either side changes (the device setting or the account's
 * switch). The server snapshot is false (full motion) because the server knows neither; the first client render after
 * hydration reads the real value, so there is no mismatch.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
