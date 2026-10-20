"use client";

import { useEffect, useRef } from "react";

import {
  objectBounds,
  paintMap,
  paintMapRect,
  prepareMap,
  terrainDirtyRect,
  unionRect,
  withObjects,
  type MapRect,
  type PreparedMap,
} from "@/lib/combat-map/painter";
import type { PaintObject, PaintSpec, PaintedTerrain } from "@/lib/combat-map/raster";

import type { CombatMapLayout } from "../../../../convex/combatMaps";
import type { ImageGrid } from "./grid";
import { toPaintSpec } from "./paint-spec";

/** Pixels per square on the map canvas (the painter's and the board's CELL); zoom scales it with CSS. */
export const MAP_CELL = 48;

/** The dark the board draws past an uploaded image's edge. */
const OFF_IMAGE = "#0b1214";

type Painted = {
  /** Terrain inputs: a change repaints everything. */
  structure: string;
  spec: PaintSpec;
  paint: PaintedTerrain;
  prepared: PreparedMap;
  objects: Map<string, PaintObject>;
};

/** Squares whose painted terrain differs between two cell maps, as one bounding rectangle, or null. */
function paintDiff(a: PaintedTerrain, b: PaintedTerrain): MapRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const touch = (key: string) => {
    const [x, y] = key.split(",").map(Number) as [number, number];
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const key in a) if (a[key] !== b[key]) touch(key);
  for (const key in b) if (!(key in a)) touch(key);
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Paints a generated or blank layout with C2's painter. The first paint (and any change of size, seed, base or
 * areas) draws the whole map; afterwards only what changed is repainted: an object's old and new bounds, or the
 * squares whose painted terrain changed (C5's "redraw only the changed area").
 */
function paintLayout(canvas: HTMLCanvasElement, layout: CombatMapLayout, paint: PaintedTerrain, prev: Painted | null): Painted | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return prev;
  const spec = toPaintSpec(layout);
  const structure = JSON.stringify([layout._id, layout.w, layout.h, layout.seed, layout.base, layout.plankV ?? false, layout.areas]);
  const objects = new Map<string, PaintObject>(layout.objects.map(({ _id, ...o }) => [_id, o]));
  if (prev === null || prev.structure !== structure || canvas.width !== layout.w * MAP_CELL) {
    canvas.width = layout.w * MAP_CELL;
    canvas.height = layout.h * MAP_CELL;
    const prepared = paintMap(ctx, spec, { cell: MAP_CELL, paint });
    return { structure, spec, paint, prepared, objects };
  }
  const dirty: MapRect[] = [];
  for (const [id, object] of objects) {
    const old = prev.objects.get(id);
    if (old === undefined) dirty.push(objectBounds(object, MAP_CELL));
    else if (JSON.stringify(old) !== JSON.stringify(object)) dirty.push(unionRect(objectBounds(old, MAP_CELL), objectBounds(object, MAP_CELL)));
  }
  for (const [id, old] of prev.objects) if (!objects.has(id)) dirty.push(objectBounds(old, MAP_CELL));
  const cellsChanged = paintDiff(prev.paint, paint);
  if (cellsChanged !== null) dirty.push(terrainDirtyRect(cellsChanged));
  if (dirty.length === 0) return { ...prev, spec, objects };
  const prepared = cellsChanged !== null ? prepareMap(spec, paint) : withObjects(prev.prepared, spec.objects ?? []);
  for (const rect of dirty) paintMapRect(ctx, prepared, rect, { cell: MAP_CELL });
  return { structure, spec, paint, prepared, objects };
}

/** Draws an uploaded image under its square grid (the board: image scaled so one grid square = one map square). */
function paintImage(canvas: HTMLCanvasElement, w: number, h: number, image: HTMLImageElement | null, grid: ImageGrid) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = w * MAP_CELL;
  canvas.height = h * MAP_CELL;
  ctx.fillStyle = OFF_IMAGE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (image) {
    const k = MAP_CELL / grid.cell;
    ctx.drawImage(image, -grid.offsetX * k, -grid.offsetY * k, image.naturalWidth * k, image.naturalHeight * k);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    ctx.moveTo(x * MAP_CELL + 0.5, 0);
    ctx.lineTo(x * MAP_CELL + 0.5, canvas.height);
  }
  for (let y = 0; y <= h; y++) {
    ctx.moveTo(0, y * MAP_CELL + 0.5);
    ctx.lineTo(canvas.width, y * MAP_CELL + 0.5);
  }
  ctx.stroke();
}

/**
 * The map itself: C2's painted layout, or the uploaded image with its grid (`grid` may be a drag preview).
 * Positioned at the stage's pad and scaled by `zoom` with CSS; the canvas keeps MAP_CELL pixels per square.
 */
export function MapCanvas({
  layout,
  paint,
  image,
  grid,
  zoom,
  pad,
}: {
  layout: CombatMapLayout;
  paint: PaintedTerrain;
  image: HTMLImageElement | null;
  grid: ImageGrid | null;
  zoom: number;
  pad: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const painted = useRef<Painted | null>(null);
  const isImage = layout.source === "image";
  const gridKey = grid ? `${grid.cell},${grid.offsetX},${grid.offsetY}` : "";

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (isImage) {
      painted.current = null;
      paintImage(el, layout.w, layout.h, image, grid ?? { cell: MAP_CELL, offsetX: 0, offsetY: 0 });
    } else {
      painted.current = paintLayout(el, layout, paint, painted.current);
    }
    // gridKey stands for `grid` (a new object on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, paint, image, isImage, gridKey]);

  const step = MAP_CELL * zoom;
  return (
    <canvas
      ref={canvas}
      className="cm-canvas"
      data-testid="combat-map-canvas"
      aria-hidden="true"
      style={{ left: pad * step, top: pad * step, width: layout.w * step, height: layout.h * step }}
    />
  );
}
