import { paintMap } from "../../../../../src/lib/combat-map/painter";
import { paintMap as paintSpriteMap, mapUrls, prepareMap } from "../../../../../src/lib/combat-map/sprites/painter";
import { renderShadow, type ShadowCanvas } from "../../../../../src/lib/combat-map/sprites/shadows";
import { decodeCells } from "../../../../../src/components/combat-map/map-view/cells";
import { toPaintSpec, toSpritePaintSpec } from "../../../../../src/components/combat-map/map-view/paint-spec";
import type { SpriteArt } from "../../../../../src/lib/combat-map/sprites/loader";

import { SkiaMapCanvas } from "./canvas/context";
import { loadSkia, type SkiaApi, type SkImage } from "./canvas/skia-runtime";
import { SPRITE_MARK } from "./canvas/paint-frame";
import type { CombatMapLayout } from "./contract";
import { MAP_CELL } from "./constants";
import { paintStats } from "./paint-stats";
import { loadSpriteArt } from "./sprite-art";

/**
 * Longest side of the painted base map, in pixels. Well under the 4096 px texture limit of many Android GPUs, and a
 * Large map (40 x 27) still gets 48 px a square: about 10 MB, painted once per layout change (dcm-gdzi.14).
 */
export const BASE_MAX_PX = 2048;

/** Pixels per square the base map is painted at: the website's 48, fewer on a map whose long side would pass BASE_MAX_PX. */
export function baseCell(w: number, h: number): number {
  return Math.max(16, Math.min(MAP_CELL, Math.floor(BASE_MAX_PX / Math.max(1, w, h))));
}

/**
 * What the painter reads from a layout, as text: equal keys paint the same picture. Tokens, the name, `live`,
 * `updatedAt` and the GM's fog marks are left out, so a token move or a fog brush never repaints the map. Null for
 * an uploaded image map (drawn from its file, not painted).
 */
export function paintKey(layout: CombatMapLayout): string | null {
  if (layout.source === "image") return null;
  return JSON.stringify([
    layout._id,
    layout.w,
    layout.h,
    layout.seed,
    layout.base,
    layout.plankV ?? false,
    layout.style ?? "classic",
    layout.setting ?? null,
    layout.texturePalette ?? null,
    layout.areas,
    layout.objects,
    layout.cells.filter((c) => c.layer !== "fog"),
    layout.textureCells ?? null,
  ]);
}

/** The painted base map: one Skia image of the map's squares only (no fog margin), `cell` pixels a square. */
export type BaseImage = { image: SkImage; cell: number; width: number; height: number };

function solidCanvas(skia: SkiaApi, width: number, height: number, fill: string): SkiaMapCanvas {
  const canvas = new SkiaMapCanvas(skia, Math.max(1, width), Math.max(1, height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Skia surface has no 2d context");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Jest has no network: sprites paint as the magenta mark the spike tests look for. */
function stubSpriteArt(skia: SkiaApi): SpriteArt {
  return {
    sprite(_url, w, h) {
      return solidCanvas(skia, w, h, `rgb(${SPRITE_MARK.r},${SPRITE_MARK.g},${SPRITE_MARK.b})`) as unknown as CanvasImageSource;
    },
    shadow(_url, w, h, rot, shadow) {
      const image = solidCanvas(skia, w, h, `rgb(${SPRITE_MARK.r},${SPRITE_MARK.g},${SPRITE_MARK.b})`);
      return renderShadow(
        (width, height) => new SkiaMapCanvas(skia, width, height) as unknown as ShadowCanvas,
        image as unknown as CanvasImageSource,
        w,
        h,
        rot,
        shadow,
      ) as unknown as CanvasImageSource;
    },
    texture(_url: string, tile: number) {
      const data = new Uint8ClampedArray(tile * tile * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 30;
        data[i + 1] = 140;
        data[i + 2] = 50;
        data[i + 3] = 255;
      }
      return data;
    },
  };
}

/**
 * Paints the map's terrain and objects once with the website's painters (Classic or Sprites) and returns the result
 * as a Skia image. The pixels stay in Skia: no copy into JavaScript, and the screen draws the image under a transform
 * every frame without painting again.
 */
export async function paintBase(layout: CombatMapLayout): Promise<BaseImage> {
  const started = Date.now();
  const skia = await loadSkia();
  const cell = baseCell(layout.w, layout.h);
  const canvas = new SkiaMapCanvas(skia, layout.w * cell, layout.h * cell);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Skia surface has no 2d context");
  const cells = decodeCells(layout.cells ?? [], layout.w, layout.h);

  if (layout.style === "sprites") {
    const spec = toSpritePaintSpec(layout, new Map());
    const prepared = prepareMap(spec, cells.paint);
    const needed = mapUrls(prepared, cell);
    const art =
      process.env.JEST_WORKER_ID === undefined
        ? ((await loadSpriteArt(skia, [...needed.objects.keys(), ...needed.textures])) ?? stubSpriteArt(skia))
        : stubSpriteArt(skia);
    paintSpriteMap(ctx as unknown as CanvasRenderingContext2D, spec, { art, cell, paint: cells.paint });
  } else {
    paintMap(ctx as unknown as CanvasRenderingContext2D, toPaintSpec(layout), {
      cell,
      paint: cells.paint,
      grid: true,
      vignette: true,
    });
  }

  paintStats.base += 1;
  paintStats.lastBaseMs = Date.now() - started;
  return { image: canvas.snapshot(), cell, width: canvas.width, height: canvas.height };
}
