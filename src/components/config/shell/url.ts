"use client";

import { useSearchParams } from "next/navigation";

import { parseSettingsSection, SETTINGS_PARAM, settingsUrl, type SettingsSection } from "../slots";

/**
 * The open settings section from the URL (`?settings=`; null = closed). `useSearchParams` needs a Suspense boundary
 * above it when a route is prerendered, so every reader sits in one (the gear and the panel bring their own).
 */
export function useSettingsSection(): SettingsSection | null {
  return parseSettingsSection(useSearchParams().get(SETTINGS_PARAM));
}

/**
 * Rewrites the URL's settings param in place. `history.replaceState` is synced by Next's router into
 * `useSearchParams` / `usePathname` without a server round trip or a scroll jump (Next 14.1+), and adds no history
 * entry. Every other param (the Journal's `tab`, `s`, `sv`, the Notes' `page`, ...) stays.
 */
function writeSection(section: SettingsSection | null) {
  const { pathname, search, hash } = window.location;
  const next = settingsUrl(pathname, search, section) + hash;
  if (next !== pathname + search + hash) window.history.replaceState(null, "", next);
}

/** Opens Campaign settings at `section` (or switches to it while open). */
export function openSettings(section: SettingsSection = "table") {
  writeSection(section);
}

/** Closes Campaign settings (removes `?settings=`). */
export function closeSettings() {
  writeSection(null);
}
