"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import type { TravelRulesState } from "@/lib/world/map-state";
import { applyTerrainCells } from "@/lib/world/terrain";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const PAINT_CHUNK = 8000;

/**
 * The World board's mutations. Set-style edits (a retry is harmless) go
 * straight through; adds and moves carry an idempotency key per intent.
 * Every failure lands in one `error` message for the board's live region.
 */
export function useMapActions(campaignId: Id<"campaigns">) {
  const [error, setError] = useState<string | null>(null);
  const addToken = useIntent(api.maps.addToken);
  const moveParty = useIntent(api.maps.moveParty);
  const addType = useIntent(api.maps.addCustomType);
  const moveHex = useIntent(api.maps.moveToHex);

  const updateToken = useMutation(api.maps.updateToken);
  const removeToken = useMutation(api.maps.removeToken);
  const clearTrail = useMutation(api.maps.clearTrail);
  const setTerrain = useMutation(api.maps.setTerrain);
  // Painted cells show at once (no flicker between the stroke ending and the server's answer).
  const paintCells = useMutation(api.maps.paintCells).withOptimisticUpdate((store, { campaignId: id, indexes, codes }) => {
    const view = store.getQuery(api.maps.get, { campaignId: id });
    if (view) store.setQuery(api.maps.get, { campaignId: id }, { ...view, state: { ...view.state, terrain: applyTerrainCells(view.state.terrain, indexes, codes) } });
  });
  const setOptions = useMutation(api.maps.setOptions);
  const setTravelRules = useMutation(api.maps.setTravelRules);
  const renameType = useMutation(api.maps.renameType);
  const setHexGrid = useMutation(api.maps.setHexGrid);
  const updateHex = useMutation(api.maps.updateHex);
  const placePartyHex = useMutation(api.maps.placePartyHex);
  const setCrawlDay = useMutation(api.maps.setCrawlDay);

  async function run<T>(p: Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await p;
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    }
  }

  /** Keyed intents report their own errors (`useIntent`). */
  function keyed<T>(fire: () => Promise<T>): Promise<T> {
    setError(null);
    return fire();
  }

  const c = { campaignId };
  return {
    error: error ?? addToken.error ?? moveParty.error ?? addType.error ?? moveHex.error,
    clearError: () => {
      setError(null);
      addToken.clearError();
      moveParty.clearError();
      addType.clearError();
      moveHex.clearError();
    },
    addToken: (type: string, x: number, y: number) => keyed(() => addToken.fire({ ...c, type, x, y })),
    moveParty: (x: number, y: number, via?: { x: number; y: number }[]) => keyed(() => moveParty.fire({ ...c, x, y, via })),
    addCustomType: (label: string, icon: string, color: string) => keyed(() => addType.fire({ ...c, label, icon, color })),
    moveToHex: (args: { q: number; r: number; terrain: number; travelMode: "land" | "riverDown" | "riverUp" | "ocean"; encounterDie: 4 | 6 | 8 }) =>
      keyed(() => moveHex.fire({ ...c, ...args })),
    updateToken: (id: number, patch: Parameters<typeof updateToken>[0]["patch"]) => run(updateToken({ ...c, id, patch })),
    removeToken: (id: number) => run(removeToken({ ...c, id })),
    clearTrail: () => run(clearTrail(c)),
    /** Paints cells onto the stored grid, in chunks under Convex's 8192-element array limit. */
    paintCells: async (indexes: number[], codes: string) => {
      for (let i = 0; i < indexes.length; i += PAINT_CHUNK) {
        if ((await run(paintCells({ ...c, indexes: indexes.slice(i, i + PAINT_CHUNK), codes: codes.slice(i, i + PAINT_CHUNK) }).then(() => true))) === undefined) return;
      }
    },
    resetTerrain: () => run(setTerrain({ ...c, reset: true })),
    setOptions: (opts: Omit<Parameters<typeof setOptions>[0], "campaignId">) => run(setOptions({ ...c, ...opts })),
    setTravelRules: (rules: TravelRulesState | null) => run(setTravelRules({ ...c, rules })),
    renameType: (typeId: string, label: string) => run(renameType({ ...c, typeId, label })),
    setHexGrid: (grid: Parameters<typeof setHexGrid>[0]["grid"]) => run(setHexGrid({ ...c, grid })),
    updateHex: (q: number, r: number, patch: Parameters<typeof updateHex>[0]["patch"]) => run(updateHex({ ...c, q, r, patch })),
    placePartyHex: (q: number, r: number) => run(placePartyHex({ ...c, q, r })),
    setCrawlDay: (day: number) => run(setCrawlDay({ ...c, day })),
  };
}

export type MapActions = ReturnType<typeof useMapActions>;
