"use client";

import { useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";
import { RANGE_SQUARES } from "@/lib/domain/combat-map/ranges";

import type { CombatMapViewport } from "../slots";

/**
 * Pick a square on the map (plan lanes-2 wave 9, AO; dcm-u2wx client, dcm-lqnt). Whoever needs a square (the sheet
 * drawer's Use of a point-centred area such as Dark Cloud, CB p.42: "a point ... within Close range"; the GM's area
 * tools) calls `startAreaPick`; the map board shows a banner and a click layer over the map; the click's square goes to
 * `onPick`, whose returned line (the use's result, or an error) the banner shows. Escape or Cancel ends it.
 *
 * The request lives in a tiny module store, not in React state of the asker: the sheet drawer is a modal dialog that
 * closes (and unmounts its body) so the map can be clicked, and the use is sent from here after the pick.
 */

export type Square = { x: number; y: number };

export type AreaPickRequest = {
  /** What to pick, shown in the banner ("Pick the centre of Dark Cloud"). */
  prompt: string;
  /** The map the square must be on (a pick on another map's board is ignored). */
  mapId: string;
  /** Draws a preview circle of this Defined Range around the hovered square. */
  radius?: keyof typeof RANGE_SQUARES;
  /** Runs with the picked square. Its line (or thrown error's message) is shown in the banner. */
  onPick: (square: Square) => Promise<string | null>;
};

type PickState = { request: AreaPickRequest | null; busy: boolean; line: { text: string; error: boolean } | null };

let state: PickState = { request: null, busy: false, line: null };
const listeners = new Set<() => void>();

function set(next: Partial<PickState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

/** Starts a pick (replacing any running one). */
export function startAreaPick(request: AreaPickRequest): void {
  set({ request, busy: false, line: null });
}

/** Ends the running pick, if any. */
export function cancelAreaPick(): void {
  set({ request: null, busy: false });
}

/** Clears the banner's last line. */
export function dismissAreaPickLine(): void {
  set({ line: null });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getState = () => state;
const serverState: PickState = { request: null, busy: false, line: null };

/** The running pick and the banner's last line. */
export function useAreaPick(): PickState {
  return useSyncExternalStore(subscribe, getState, () => serverState);
}

/** Runs the pick's `onPick` with a square: the banner shows its line, the pick ends either way (unless `onPick` started another). */
export async function finishAreaPick(square: Square): Promise<void> {
  const request = state.request;
  if (request === null || state.busy) return;
  set({ busy: true });
  try {
    const text = await request.onPick(square);
    const line = text === null ? null : { text, error: false };
    // `onPick` may start the next pick (a wall's second end): keep that one running.
    set(state.request === request ? { request: null, busy: false, line } : { line });
  } catch (e) {
    set({ request: state.request === request ? null : state.request, busy: false, line: { text: errorMessage(e), error: true } });
  }
}

/** The whole square under a stage position (in squares, from `viewport.toSquares`), or null off the map. */
export function squareAt(p: Square, w: number, h: number): Square | null {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  return x >= 0 && y >= 0 && x < w && y < h ? { x, y } : null;
}

/** The banner above the map while a pick runs, then the pick's result line. */
export function AreaPickBanner({ mapId }: { mapId: string }) {
  const pick = useAreaPick();
  if (pick.request !== null && pick.request.mapId === mapId) {
    return (
      <div className="cm-area-pick-bar" role="status" data-testid="area-pick-banner">
        <span>{pick.busy ? "Sending…" : `${pick.request.prompt}: click a square on the map.`}</span>
        <BrandButton type="button" variant="cancel" size="sm" onClick={cancelAreaPick} disabled={pick.busy}>
          Cancel
        </BrandButton>
      </div>
    );
  }
  if (pick.line === null) return null;
  return (
    <div className="cm-area-pick-bar" role={pick.line.error ? "alert" : "status"} data-testid="area-pick-result" data-error={pick.line.error ? "true" : "false"}>
      <span>{pick.line.text}</span>
      <BrandButton type="button" variant="cancel" size="sm" icon aria-label="Dismiss" onClick={dismissAreaPickLine}>
        ✕
      </BrandButton>
    </div>
  );
}

/**
 * The click layer over the map while a pick for this map runs: the hovered square (and the preview circle) shows; a
 * click picks it. It stops the board's pan on its own pointer downs (the map-view pointer contract).
 */
export function AreaPickLayer({ mapId, viewport }: { mapId: string; viewport: CombatMapViewport }) {
  const pick = useAreaPick();
  const [hover, setHover] = useState<Square | null>(null);
  const request = pick.request;
  if (request === null || request.mapId !== mapId) return null;
  const { w, h, pad, cell, zoom } = viewport;
  const step = cell * zoom;
  const at = (e: ReactMouseEvent<HTMLDivElement>) => squareAt(viewport.toSquares(e.clientX, e.clientY), w, h);
  const reach = request.radius ? RANGE_SQUARES[request.radius] + 0.5 : null;
  return (
    <div
      className="cm-area-pick"
      data-testid="area-pick-layer"
      style={{ width: (w + 2 * pad) * step, height: (h + 2 * pad) * step }}
      onPointerDown={(e) => e.preventDefault()}
      onPointerMove={(e) => setHover(at(e))}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        const square = at(e);
        if (square) void finishAreaPick(square);
      }}
    >
      {hover ? (
        <svg className="cm-area-pick-svg" aria-hidden="true" width={(w + 2 * pad) * step} height={(h + 2 * pad) * step} viewBox={`0 0 ${w + 2 * pad} ${h + 2 * pad}`}>
          {reach !== null ? <circle cx={hover.x + pad + 0.5} cy={hover.y + pad + 0.5} r={reach} className="cm-area-pick-reach" /> : null}
          <rect x={hover.x + pad} y={hover.y + pad} width={1} height={1} className="cm-area-pick-square" />
        </svg>
      ) : null}
    </div>
  );
}
