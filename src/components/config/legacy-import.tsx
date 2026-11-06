"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useEffect, useRef } from "react";

import { readLegacyPrefs, type StorageLike } from "@/lib/config/legacy-prefs";

import { api } from "../../../convex/_generated/api";

/**
 * The one-time move of this browser's old values to the account (plan config IMP, N3 a: automatic, nothing to click).
 * docs/tasks/TASK-CONFIG-IMP.md has the rules; the parser is src/lib/config/legacy-prefs.ts.
 */

/** The browser storage the import reads and then clears (`window.localStorage` fits). */
export type LegacyStorage = StorageLike & { removeItem(key: string): void };

/** The three import mutations (the `useMutation` results in the app; fakes in the unit test). */
export type LegacyImportCalls = {
  preferences: (args: FunctionArgs<typeof api.preferences.importLegacy>) => Promise<unknown>;
  uiState: (args: FunctionArgs<typeof api.uiState.importLegacy>) => Promise<unknown>;
  drafts: (args: FunctionArgs<typeof api.drafts.importLegacy>) => Promise<unknown>;
};

/** `LEGACY_FOLDS_MAX` in convex/preferences.ts: more folds than this is INVALID, so the rest are dropped. */
export const LEGACY_FOLDS_SENT_MAX = 50;

/** What one run did: nothing found, imported then cleared, or cleared without importing (another device came first). */
export type LegacyImportOutcome = "none" | "imported" | "dropped";

function removeKeys(storage: LegacyStorage, keys: readonly string[]) {
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Blocked storage: the key stays, and the next load drops it (the account is already marked imported).
    }
  }
}

/**
 * Reads `storage`'s old values and, unless the account already imported once (`alreadyImported`, first device wins),
 * sends them: UI state and drafts first, then preferences, which marks the account imported. The keys (and the dead
 * `dcm:combat-hud`) are removed only after every call succeeded; a failure rejects and leaves them for the next load.
 */
export async function runLegacyImport(
  storage: LegacyStorage | null | undefined,
  alreadyImported: boolean,
  calls: LegacyImportCalls,
): Promise<LegacyImportOutcome> {
  if (!storage) return "none";
  const legacy = readLegacyPrefs(storage);
  if (legacy.keys.length === 0 && legacy.dead.length === 0) return "none";
  const importing = !alreadyImported && legacy.keys.length > 0;
  if (importing) {
    await Promise.all([
      Object.keys(legacy.uiState).length > 0 ? calls.uiState({ uiState: legacy.uiState }) : null,
      legacy.drafts.length > 0 ? calls.drafts({ drafts: legacy.drafts }) : null,
    ]);
    await calls.preferences({ ...legacy.preferences, folds: legacy.handFolds.slice(0, LEGACY_FOLDS_SENT_MAX) });
  }
  removeKeys(storage, [...legacy.keys, ...legacy.dead]);
  return importing ? "imported" : "dropped";
}

function browserStorage(): LegacyStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Runs `runLegacyImport` once per page load (per signed-in mount), as soon as the account's `legacyImported` is known.
 * Rule 13 / CL6 exception, like the campaign shell's `markOpened`: the write starts from an effect, guarded by a ref
 * (StrictMode and re-renders never send it twice) and safe to repeat on the server (each mutation writes only what is
 * unset). Renders nothing; signed out or still loading it mounts no mutation at all.
 */
export function LegacyImport() {
  const { isAuthenticated } = useConvexAuth();
  const prefs = useQuery(api.preferences.get, isAuthenticated ? {} : "skip");
  return prefs === undefined ? null : <LegacyImportRun alreadyImported={prefs.legacyImported} />;
}

function LegacyImportRun({ alreadyImported }: { alreadyImported: boolean }) {
  const preferences = useMutation(api.preferences.importLegacy);
  const uiState = useMutation(api.uiState.importLegacy);
  const drafts = useMutation(api.drafts.importLegacy);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // A failure keeps the keys; the next load tries again.
    void runLegacyImport(browserStorage(), alreadyImported, { preferences, uiState, drafts }).catch(() => undefined);
  }, [alreadyImported, preferences, uiState, drafts]);

  return null;
}
