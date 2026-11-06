"use client";

import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs } from "convex/server";

import { UI_STATE_DEFAULTS, type UiState, type UiStateKey } from "@/lib/config/preferences";
import { refusalFor } from "@/lib/errors/refusals";
import { hudToasts } from "@/components/combat-map/hud/toasts/store";

import { api } from "../../convex/_generated/api";

/** One key and its new value (rule 12: a single-field intent). */
export type UiStateSetArgs = FunctionArgs<typeof api.uiState.set>;

/**
 * `uiState.set`'s optimistic update: the key's new value goes into the cached `uiState.get` at once, so the switch,
 * fold or sort moves on the click and rolls back if the server refuses. Nothing to update while it hasn't loaded.
 */
export function uiStateLocally(store: OptimisticLocalStore, { change }: UiStateSetArgs): void {
  const current = store.getQuery(api.uiState.get, {});
  if (current === undefined) return;
  store.setQuery(api.uiState.get, {}, { ...current, [change.key]: change.value });
}

/**
 * One UI-state value stored on the account (plan config U6e, Q15 b): the Combat Map's Names switch and range circles,
 * the catalogue sort orders and the roll panels' folds, so they follow the user to every device. Reads `uiState.get`
 * (the default while it loads) and writes `uiState.set({ change: { key, value } })` with `uiStateLocally`. A refused
 * write rolls back and shows the HUD toast (visible where the HUD is; elsewhere the rollback is the signal).
 */
export function useUiState<K extends UiStateKey>(key: K): [UiState[K], (value: UiState[K]) => void] {
  const state = useQuery(api.uiState.get, {});
  const set = useMutation(api.uiState.set).withOptimisticUpdate(uiStateLocally);
  const value = (state?.[key] ?? UI_STATE_DEFAULTS[key]) as UiState[K];
  return [
    value,
    (next) => {
      set({ change: { key, value: next } as UiStateSetArgs["change"] }).catch((error: unknown) => hudToasts.refusal(refusalFor(error)));
    },
  ];
}
