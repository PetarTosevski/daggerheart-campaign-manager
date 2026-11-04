"use client";

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { bandOf, tokenDistance } from "@/lib/domain/combat-actions/distance";
import { RANGE_BANDS } from "@/lib/domain/combat-map/ranges";

import type { CombatMapViewport } from "../slots";

/**
 * Measure (plan combat-hud H9.0; GMDesktop dock "Measure"; user answer Q9b): with the Measure tool on, a drag from one
 * square to another shows the distance in squares and its range band (Melee, Very Close, Close, Far, Very Far) with the
 * app's range model (`tokenDistance` / `bandOf`, CB p.103 "Defined Ranges": a diagonal step counts as one square). For
 * the GM and players alike, each on their own screen: nothing is saved or sent. The measurement stays until the next
 * drag or until the tool goes back to Select.
 *
 * The layer covers the stage while the tool is on, so a drag measures instead of panning the map or moving a token
 * (it calls `preventDefault`, the map area's pointer contract in ./context.ts). Styles are inline: the layer has no
 * stylesheet of its own.
 */

export type Square = { x: number; y: number };

const BAND_LABEL: Readonly<Record<string, string>> = {
  ...Object.fromEntries(RANGE_BANDS.map((b) => [b.key, b.label])),
  veryFar: "Very Far",
};

/** "7 squares · Far" between two squares (Chebyshev, as the engine measures token distance). */
export function measureText(from: Square, to: Square): string {
  const distance = tokenDistance(from, to);
  return `${distance} ${distance === 1 ? "square" : "squares"} · ${BAND_LABEL[bandOf(distance)] ?? "Very Far"}`;
}

/** The square under a point in map squares (fractional), kept on the map. */
export function squareAt(point: { x: number; y: number }, w: number, h: number): Square {
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max - 1, Math.floor(n)));
  return { x: clamp(point.x, w), y: clamp(point.y, h) };
}

const LAYER: CSSProperties = { position: "absolute", inset: 0, zIndex: 70, cursor: "crosshair", touchAction: "none" };
const LABEL: CSSProperties = {
  position: "absolute",
  transform: "translate(-50%, -140%)",
  padding: "4px 10px",
  borderRadius: 999,
  background: "rgba(11, 18, 20, 0.94)",
  boxShadow: "0 0 0 1px rgba(227, 180, 90, 0.7)",
  color: "#f3cf86",
  font: "600 12.5px var(--font-plex), 'IBM Plex Sans', sans-serif",
  whiteSpace: "nowrap",
  pointerEvents: "none",
};
const SR_ONLY: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

export function MeasureLayer({ viewport }: { viewport: CombatMapViewport }) {
  const { cell, zoom, w, h, pad, toSquares } = viewport;
  const [line, setLine] = useState<{ from: Square; to: Square } | null>(null);
  const dragging = useRef<number | null>(null);
  const step = cell * zoom;
  const centre = (s: Square) => ({ x: (s.x + pad + 0.5) * step, y: (s.y + pad + 0.5) * step });

  function at(e: ReactPointerEvent) {
    return squareAt(toSquares(e.clientX, e.clientY), w, h);
  }
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragging.current = e.pointerId;
    const square = at(e);
    setLine({ from: square, to: square });
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragging.current !== e.pointerId || line === null) return;
    const to = at(e);
    if (to.x !== line.to.x || to.y !== line.to.y) setLine({ from: line.from, to });
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragging.current === e.pointerId) dragging.current = null;
  }

  const text = line ? measureText(line.from, line.to) : null;
  const a = line ? centre(line.from) : null;
  const b = line ? centre(line.to) : null;
  return (
    <div
      style={LAYER}
      data-testid="combat-measure"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {a && b && text ? (
        <>
          <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }} aria-hidden="true">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e3b45a" strokeWidth={3} strokeDasharray="8 6" strokeLinecap="round" />
            <circle cx={a.x} cy={a.y} r={Math.max(4, step * 0.18)} fill="#e3b45a" />
            <circle cx={b.x} cy={b.y} r={Math.max(4, step * 0.18)} fill="none" stroke="#e3b45a" strokeWidth={3} />
          </svg>
          <span style={{ ...LABEL, left: b.x, top: b.y }} data-testid="combat-measure-label">
            {text}
          </span>
        </>
      ) : null}
      <span role="status" style={SR_ONLY}>
        {text ? `Measured: ${text}` : "Measure: drag from one square to another."}
      </span>
    </div>
  );
}
