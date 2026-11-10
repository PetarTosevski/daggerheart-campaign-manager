import { mapPixelSize } from "../../../../../../src/lib/combat-map/painter";
import type { SpriteArt } from "../../../../../../src/lib/combat-map/sprites/loader";
import { paintMap, type SpritePaintSpec } from "../../../../../../src/lib/combat-map/sprites/painter";
import { renderShadow, type ShadowCanvas } from "../../../../../../src/lib/combat-map/sprites/shadows";

import { SkiaMapCanvas } from "./context";
import { loadSkia, type SkiaApi } from "./skia-runtime";

/** Opaque magenta. Terrain and texture swatches in the fixture are not this color. */
export const SPRITE_MARK = { r: 255, g: 0, b: 255 } as const;

const CELL = 16;

/**
 * One Sprites-style frame: grass terrain (Classic underlay plus a loaded texture)
 * and one crate sprite. Throws if the painter never asks for that sprite.
 */
export async function paintFixtureFrame(): Promise<{
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  spriteRequests: number;
}> {
  const skia = await loadSkia();
  const spec: SpritePaintSpec = {
    w: 4,
    h: 4,
    seed: 7,
    base: "grass",
    setting: "forest",
    objects: [{ id: "fixture-sprite", kind: "crate", x: 2, y: 2, r: 1.5 }],
  };
  const size = mapPixelSize(spec, CELL);
  const canvas = new SkiaMapCanvas(skia, size.width, size.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Skia surface has no 2d context");

  let spriteRequests = 0;
  const art: SpriteArt = {
    sprite(_url, w, h) {
      spriteRequests += 1;
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
    texture(_url, tile) {
      return solidPixels(tile, 30, 140, 50);
    },
  };

  paintMap(ctx as unknown as CanvasRenderingContext2D, spec, { art, cell: CELL });
  if (spriteRequests === 0) {
    throw new Error("The sprite painter did not ask for a sprite image.");
  }
  return { width: canvas.width, height: canvas.height, pixels: ctx.readPixels(), spriteRequests };
}

function solidCanvas(skia: SkiaApi, width: number, height: number, fill: string): SkiaMapCanvas {
  const canvas = new SkiaMapCanvas(skia, Math.max(1, width), Math.max(1, height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Skia surface has no 2d context");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function solidPixels(size: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return data;
}
