import { mapPixelSize, paintMap } from "../../../../../src/lib/combat-map/painter";
import type { PaintSpec } from "../../../../../src/lib/combat-map/raster";

import { SkiaMapCanvas } from "./canvas/context";
import { loadSkia } from "./canvas/skia-runtime";
import { MAP_CELL } from "./constants";

/** A small Classic layout for tests (grass, one crate object). */
export function classicFixtureSpec(): PaintSpec {
  return {
    w: 4,
    h: 4,
    seed: 3,
    base: "grass",
    areas: [],
    objects: [{ kind: "crate", x: 2, y: 2, r: 1.5 }],
  };
}

/** Paints a Classic combat frame through the Skia adapter (C1 spike path). */
export async function paintClassicFixtureFrame(): Promise<{
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}> {
  const skia = await loadSkia();
  const spec = classicFixtureSpec();
  const size = mapPixelSize(spec, MAP_CELL);
  const canvas = new SkiaMapCanvas(skia, size.width, size.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Skia surface has no 2d context");
  paintMap(ctx as unknown as CanvasRenderingContext2D, spec, { cell: MAP_CELL, grid: true, vignette: true });
  return { width: canvas.width, height: canvas.height, pixels: ctx.readPixels() };
}
