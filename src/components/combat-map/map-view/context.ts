"use client";

import { createContext, useContext } from "react";

import type { CombatMapLayout } from "../../../../convex/combatMaps";
import type { CombatMapViewport } from "../slots";
import type { DecodedCells } from "./cells";

/**
 * What the map area knows beyond the slots' `CombatMapViewport` (D9 C3): the layout on screen (objects, painted
 * cells, image), its decoded cells and the uploaded image's pixel size. Layers of later tracers (editor, tokens,
 * vision) read it with `useMapView()` instead of querying the layout again. Only set inside `MapBoard`'s stage.
 *
 * Pointer contract: the map area pans on a drag of its background. A layer that handles a pointer down itself
 * (a token drag, a brush stroke) calls `event.preventDefault()` on it, and the map area then leaves it alone.
 */
export type MapViewState = {
  layout: CombatMapLayout;
  cells: DecodedCells;
  viewport: CombatMapViewport;
  /** The uploaded image's natural size once loaded (image maps), else null. */
  image: { width: number; height: number } | null;
};

export const MapViewContext = createContext<MapViewState | null>(null);

/** The map on screen; throws outside `MapBoard`'s layers (a programming error). */
export function useMapView(): MapViewState {
  const state = useContext(MapViewContext);
  if (state === null) throw new Error("useMapView() is only available inside the map board's layers.");
  return state;
}
