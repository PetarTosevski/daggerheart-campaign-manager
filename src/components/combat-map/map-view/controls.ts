"use client";

import { useSyncExternalStore } from "react";

import { useViewerFlag } from "./use-viewer-flag";

/**
 * The map's controls as a small external store (plan combat-hud H9.0): zoom, Fit, Names, the pointer tool (Select /
 * Measure) and the GM's area tools. `MapBoard` owns the zoom (its `useMapZoom`) and publishes itself here; anything
 * outside the board (the Combat HUD's bottom dock, the player's map controls) reads and drives the same board through
 * `useMapControls()`. With `chrome="full"` the board's own toolbar uses the same store, so both stay in step.
 *
 * Client state only: nothing here is saved on the server. Names is the per-viewer localStorage switch it always was.
 */

/** localStorage key of the board's "Names" switch (per viewer). */
export const NAMES_KEY = "dh.combat.names";

/** What the pointer does on the map: Select is today's pointer (pan, tokens); Measure drags a range between squares. */
export type MapTool = "select" | "measure";

/** What a mounted board hands the store: its zoom and the actions that change it. */
export type BoardHandle = {
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
};

type Snapshot = {
  /** The published board, or null while none is mounted. */
  board: BoardHandle | null;
  /** Who published `board` (a board's stable identity), so an older board's unmount can't clear a newer one. */
  owner: object | null;
  tool: MapTool;
  /** The GM's classic area tools under the board's toolbar (Play, `chrome="full"` only). */
  areaTools: boolean;
};

const EMPTY: Snapshot = { board: null, owner: null, tool: "select", areaTools: false };
let snapshot: Snapshot = EMPTY;
const listeners = new Set<() => void>();

function emit(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publishes the mounted board `owner` (its zoom and actions); the last board to publish is the one the controls drive. */
export function publishBoard(owner: object, handle: BoardHandle): void {
  emit({ ...snapshot, owner, board: handle });
}

/** The board `owner` unmounted: the controls let go of it and the tool goes back to Select (only if it is still the one). */
export function releaseBoard(owner: object): void {
  if (snapshot.owner === owner) emit(EMPTY);
}

export function setMapTool(tool: MapTool): void {
  if (snapshot.tool !== tool) emit({ ...snapshot, tool });
}

export function setAreaTools(on: boolean): void {
  if (snapshot.areaTools !== on) emit({ ...snapshot, areaTools: on });
}

/** The current snapshot (tests, and handlers that must read it without a render). */
export function mapControlsSnapshot(): Snapshot {
  return snapshot;
}

/** The board's zoom shown as a percentage ("91%"); "100%" before a board is mounted. */
export function zoomLabel(zoom: number | null): string {
  return `${Math.round((zoom ?? 1) * 100)}%`;
}

export type MapControls = {
  /** The board's zoom, or null while no board is mounted. */
  zoom: number | null;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  tool: MapTool;
  setTool: (tool: MapTool) => void;
  showNames: boolean;
  setShowNames: (on: boolean) => void;
  areaTools: boolean;
  setAreaTools: (on: boolean) => void;
};

/** The names switch, per viewer (localStorage), shared by the board and the dock. */
export function useShowNames(): [boolean, (on: boolean) => void] {
  return useViewerFlag(NAMES_KEY);
}

/** The map tool alone (the board's measure layer reads only this). */
export function useMapTool(): MapTool {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.tool,
    () => EMPTY.tool,
  );
}

/** Everything the map's controls need, live. Zoom actions do nothing while no board is mounted. */
export function useMapControls(): MapControls {
  const s = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
  const [showNames, setShowNames] = useShowNames();
  return {
    zoom: s.board?.zoom ?? null,
    zoomIn: () => snapshot.board?.zoomIn(),
    zoomOut: () => snapshot.board?.zoomOut(),
    fit: () => snapshot.board?.fit(),
    tool: s.tool,
    setTool: setMapTool,
    showNames,
    setShowNames,
    areaTools: s.areaTools,
    setAreaTools,
  };
}
