"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useLayoutEffect } from "react";

import {
  applyDisplayPrefs,
  readCachedDisplayPrefs,
  writeCachedDisplayPrefs,
  type DisplayPrefs,
} from "@/lib/use-reduced-motion";

import { api } from "../../../convex/_generated/api";

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Applies the account's Reduce motion and Text size (plan config U6b) to the whole app, like `AccentSync` does for
 * the accent: `data-reduce-motion` and `data-text-size` on `<html>` (src/lib/use-reduced-motion.ts has the rules).
 *
 * No React state is written: a layout effect writes the two DOM attributes (and the browser's display cache), so the
 * change lands before the browser paints the update. The layout's inline script already applied the cached values to
 * the server-rendered page, so a hard load doesn't flash either.
 * - Signed in and loaded: the account's values, cached for the next hard load.
 * - Still loading: the cached values (re-applied, so StrictMode's unmount / remount doesn't drop them).
 * - Signed out: neither attribute, and the cache is cleared.
 * - Unmounted (leaving the app shell for /signin): neither attribute.
 */
export function PrefsSync() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const prefs = useQuery(api.preferences.get, isAuthenticated ? {} : "skip");
  const state: "loading" | "signedOut" | "ready" = isLoading
    ? "loading"
    : !isAuthenticated
      ? "signedOut"
      : prefs === undefined
        ? "loading"
        : "ready";
  const reduceMotion = prefs?.reduceMotion ?? false;
  const textSize = prefs?.textSize ?? "medium";

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (state === "loading") {
      const cached = readCachedDisplayPrefs(storage());
      if (cached) applyDisplayPrefs(root, cached);
      return;
    }
    const next: DisplayPrefs | null = state === "ready" ? { reduceMotion, textSize } : null;
    applyDisplayPrefs(root, next);
    writeCachedDisplayPrefs(storage(), next);
  }, [state, reduceMotion, textSize]);

  useLayoutEffect(() => () => applyDisplayPrefs(document.documentElement, null), []);

  return null;
}
