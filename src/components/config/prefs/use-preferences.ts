"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback } from "react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";

import { api } from "../../../../convex/_generated/api";

/** The account's preferences as `preferences.get` returns them (stored values over the defaults). */
export type PreferencesView = FunctionReturnType<typeof api.preferences.get>;

/** One preference, changed alone (rule 12: a single-field intent). */
export type PreferenceChange = FunctionArgs<typeof api.preferences.set>["change"];

/** The account's preferences; undefined while loading. */
export function usePreferences(): PreferencesView | undefined {
  return useQuery(api.preferences.get, {});
}

/**
 * `preferences.set` with an optimistic update on `preferences.get` (rule 12): the switch moves at once and rolls back
 * if the server refuses. The Preferences rows and the dice share it, so a flip in one shows in the other.
 */
export function useSetPreference(): (change: PreferenceChange) => Promise<null> {
  const set = useMutation(api.preferences.set).withOptimisticUpdate((store, { change }) => {
    const current = store.getQuery(api.preferences.get, {});
    if (current !== undefined) store.setQuery(api.preferences.get, {}, { ...current, [change.key]: change.value });
  });
  return useCallback((change: PreferenceChange) => set({ change }), [set]);
}
