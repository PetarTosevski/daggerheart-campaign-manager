"use client";

import { useId, useMemo } from "react";

import { buildMovementGrid, type MovementGrid, type MovementObject } from "@/lib/domain/combat-map/movement";
import { spriteMove, spriteTraits } from "@/lib/sprite-packs/traits";

import type { CombatMapLayout } from "../../../../convex/combatMaps";
import type { DecodedCells } from "./cells";

/**
 * Movement on the map (plan `.omc/plans/map-movement.yaml`, tracer M1; D5): the map's blocking and difficult squares
 * as the browser sees them, built with M0's pure rules from the same layout the server reads, and the hatch over the
 * difficult squares the viewer can see. The server still decides every move (combatTokens.move): this only draws.
 *
 * Sprites: built-in refs use the catalog's traits and `move`; an uploaded sprite moves as its Classic kind here
 * (the layout carries no upload labels), as the vision layer's light switches already do.
 */

/** A layout object as movement reads it (M0's `movementObject`, with built-in sprite traits only). */
function movementObject(o: CombatMapLayout["objects"][number]): MovementObject {
  const builtin = o.sprite !== undefined && "builtin" in o.sprite ? o.sprite : null;
  return {
    kind: o.kind,
    x: o.x,
    y: o.y,
    r: o.r,
    rot: o.rot,
    traits: builtin ? spriteTraits(builtin) : null,
    move: builtin ? spriteMove(builtin) : null,
    open: o.open === true,
    ...(o.points === undefined ? {} : { points: o.points }),
  };
}

/** The layout's movement grid (D1, D2): areas, painted terrain and sight blockers, objects; an image ignores terrain. */
export function layoutMovementGrid(layout: CombatMapLayout, cells: Pick<DecodedCells, "paint" | "block">): MovementGrid {
  return buildMovementGrid({
    w: layout.w,
    h: layout.h,
    base: layout.base,
    areas: layout.areas,
    paint: cells.paint,
    block: cells.block,
    objects: layout.objects.map(movementObject),
    image: layout.source === "image",
  });
}

/** `layoutMovementGrid`, rebuilt only when the layout or its cells change. */
export function useLayoutMovementGrid(layout: CombatMapLayout | null | undefined, cells: Pick<DecodedCells, "paint" | "block"> | null): MovementGrid | null {
  return useMemo(() => (layout && cells ? layoutMovementGrid(layout, cells) : null), [layout, cells]);
}

/** What the viewer sees, per vision sample (the vision layer's fog masks); `null` = everything (the GM's own view). */
export type SeenMasks = {
  readonly sw: number;
  readonly sh: number;
  /** Samples per square side. */
  readonly scale: number;
  readonly seen: Uint8Array;
  readonly explored: Uint8Array | null;
};

/** Whether any sample of square (x, y) is seen now or explored. */
function squareSeen(masks: SeenMasks, x: number, y: number): boolean {
  const k = masks.scale;
  for (let sy = y * k; sy < (y + 1) * k && sy < masks.sh; sy++) {
    for (let sx = x * k; sx < (x + 1) * k && sx < masks.sw; sx++) {
      const i = sy * masks.sw + sx;
      if (masks.seen[i] === 1 || masks.explored?.[i] === 1) return true;
    }
  }
  return false;
}

/** The difficult squares to hatch: all of them for the GM's own view, else only those the viewer has seen. */
export function hatchedSquares(grid: MovementGrid, masks: SeenMasks | null): number[] {
  const out: number[] = [];
  for (let i = 0; i < grid.difficult.length; i++) {
    if (grid.difficult[i] !== 1) continue;
    if (masks === null || squareSeen(masks, i % grid.w, Math.floor(i / grid.w))) out.push(i);
  }
  return out;
}

type MovementOverlayProps = {
  grid: MovementGrid;
  /** null = the GM's own view (every difficult square); `"loading"` = nothing yet. */
  masks: SeenMasks | null | "loading";
  pad: number;
  /** Screen pixels per square (cell x zoom). */
  step: number;
};

/**
 * The hatch over difficult terrain (D5), in Classic and Sprites alike (it is drawn over the canvas, under the fog):
 * a light tint with diagonal strokes, on the squares the viewer can see. Static, so reduced motion changes nothing.
 */
export function MovementOverlay({ grid, masks, pad, step }: MovementOverlayProps) {
  const id = useId();
  const squares = useMemo(() => (masks === "loading" ? [] : hatchedSquares(grid, masks)), [grid, masks]);
  if (squares.length === 0) return null;
  let d = "";
  for (const i of squares) d += `M${(i % grid.w) + pad} ${Math.floor(i / grid.w) + pad}h1v1h-1z`;
  const patternId = `cm-hatch-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      className="cm-move-hatch"
      data-testid="combat-difficult-hatch"
      data-squares={squares.length}
      aria-hidden="true"
      width={(grid.w + 2 * pad) * step}
      height={(grid.h + 2 * pad) * step}
      viewBox={`0 0 ${grid.w + 2 * pad} ${grid.h + 2 * pad}`}
      preserveAspectRatio="none"
    >
      <defs>
        <pattern id={patternId} patternUnits="userSpaceOnUse" width={0.5} height={0.5} patternTransform="rotate(45)">
          <rect width={0.5} height={0.5} fill="rgba(255, 226, 150, 0.1)" />
          <line x1={0} y1={0} x2={0} y2={0.5} stroke="rgba(20, 14, 6, 0.55)" strokeWidth={0.13} />
          <line x1={0} y1={0} x2={0} y2={0.5} stroke="rgba(255, 226, 150, 0.7)" strokeWidth={0.06} />
        </pattern>
      </defs>
      <path d={d} fill={`url(#${patternId})`} stroke="rgba(255, 226, 150, 0.45)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
