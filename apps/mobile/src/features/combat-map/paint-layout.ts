import { FOG_PAD_SQUARES } from "../../../../../src/lib/domain/combat-map/vision";
import { paintMap } from "../../../../../src/lib/combat-map/painter";
import { paintMap as paintSpriteMap, mapUrls, prepareMap } from "../../../../../src/lib/combat-map/sprites/painter";
import { renderShadow, type ShadowCanvas } from "../../../../../src/lib/combat-map/sprites/shadows";
import { decodeCells } from "../../../../../src/components/combat-map/map-view/cells";
import { toPaintSpec, toSpritePaintSpec } from "../../../../../src/components/combat-map/map-view/paint-spec";
import type { SpriteArt } from "../../../../../src/lib/combat-map/sprites/loader";
import { fogImage, type FogMasks } from "./fog-paint";

import { SkiaMapCanvas, type SkiaCanvasContext } from "./canvas/context";
import { loadSkia, type SkiaApi } from "./canvas/skia-runtime";
import { SPRITE_MARK } from "./canvas/paint-frame";
import type { CombatMapLayout } from "./contract";
import { MAP_CELL } from "./constants";
import { loadSpriteArt } from "./sprite-art";

export type PaintedFrame = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  padSquares: number;
};

function solidCanvas(skia: SkiaApi, width: number, height: number, fill: string): SkiaMapCanvas {
  const canvas = new SkiaMapCanvas(skia, Math.max(1, width), Math.max(1, height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Skia surface has no 2d context");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

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

function drawFogOverlay(ctx: SkiaCanvasContext, skia: SkiaApi, pad: number, masks: FogMasks): void {
  const image = fogImage(masks, pad);
  const fogSurface = new SkiaMapCanvas(skia, image.width, image.height);
  const fctx = fogSurface.getContext("2d");
  if (!fctx) return;
  fctx.putImageData({ width: image.width, height: image.height, data: image.data }, 0, 0);
  const drawW = image.width * (MAP_CELL / masks.scale);
  const drawH = image.height * (MAP_CELL / masks.scale);
  const shift = pad > 0 ? 0 : -image.offset * (MAP_CELL / masks.scale);
  ctx.drawImage(fogSurface, shift, shift, drawW, drawH);
}

/**
 * Paints the live map layout to RGBA bytes. Players get fog padding and an optional fog overlay from `playerView`.
 */
export async function paintCombatLayout(
  layout: CombatMapLayout,
  opts: { player: boolean; fog?: FogMasks | null },
): Promise<PaintedFrame> {
  const skia = await loadSkia();
  const pad = opts.player ? FOG_PAD_SQUARES : 0;
  const stageW = (layout.w + 2 * pad) * MAP_CELL;
  const stageH = (layout.h + 2 * pad) * MAP_CELL;
  const stage = new SkiaMapCanvas(skia, stageW, stageH);
  const ctx = stage.getContext("2d");
  if (!ctx) throw new Error("Skia surface has no 2d context");

  const cells = decodeCells(layout.cells ?? [], layout.w, layout.h);
  const mapCanvas = new SkiaMapCanvas(skia, layout.w * MAP_CELL, layout.h * MAP_CELL);
  const mapCtx = mapCanvas.getContext("2d");
  if (!mapCtx) throw new Error("Skia surface has no 2d context");

  if (layout.style === "sprites") {
    const spec = toSpritePaintSpec(layout, new Map());
    const prepared = prepareMap(spec, cells.paint);
    const needed = mapUrls(prepared, MAP_CELL);
    const art =
      process.env.JEST_WORKER_ID === undefined
        ? ((await loadSpriteArt(skia, [...needed.objects.keys(), ...needed.textures])) ?? stubSpriteArt(skia))
        : stubSpriteArt(skia);
    paintSpriteMap(mapCtx as unknown as CanvasRenderingContext2D, spec, {
      art,
      cell: MAP_CELL,
      paint: cells.paint,
    });
  } else {
    const spec = toPaintSpec(layout);
    paintMap(mapCtx as unknown as CanvasRenderingContext2D, spec, {
      cell: MAP_CELL,
      paint: cells.paint,
      grid: true,
      vignette: true,
    });
  }

  ctx.drawImage(mapCanvas, pad * MAP_CELL, pad * MAP_CELL, layout.w * MAP_CELL, layout.h * MAP_CELL);
  if (opts.player && opts.fog) {
    drawFogOverlay(ctx, skia, pad, opts.fog);
  }

  return { width: stage.width, height: stage.height, pixels: ctx.readPixels(), padSquares: pad };
}

/** Pixel size of the stage for a layout (includes fog padding for players). */
export function stagePixelSize(layout: Pick<CombatMapLayout, "w" | "h">, player: boolean): { width: number; height: number; pad: number } {
  const pad = player ? FOG_PAD_SQUARES : 0;
  return { width: (layout.w + 2 * pad) * MAP_CELL, height: (layout.h + 2 * pad) * MAP_CELL, pad };
}

/** Aspect ratio (height / width) of the painted stage. */
export function stageAspect(layout: Pick<CombatMapLayout, "w" | "h">, player: boolean): number {
  const { width, height } = stagePixelSize(layout, player);
  return height / width;
}
