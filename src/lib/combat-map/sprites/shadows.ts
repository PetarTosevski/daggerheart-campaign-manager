// Sprite shadows (sprite packs P6, D5). The sprites have no shadows of their own: the app adds one from each sprite's
// alpha, with one light from the top-left (the style block's light), so every shadow falls to the bottom-right. Flat
// sprites (rugs, pools, stains) cast none; low and tall ones are offset and blurred by their height. Tune here.

import type { SpriteHeight } from "../../sprite-packs/catalog/index";

/** Where shadows fall: a unit vector toward the bottom-right (light from the top-left). */
export const SHADOW_DIR = { x: Math.SQRT1_2, y: Math.SQRT1_2 } as const;
/** Shadow darkness (0..1). */
export const SHADOW_ALPHA = 0.42;
/** Shadow colour (multiplied by SHADOW_ALPHA). */
export const SHADOW_RGB = "12,18,10";
/** Blur radius per height, in squares. */
export const SHADOW_BLUR: Readonly<Record<SpriteHeight, number>> = { flat: 0, low: 0.05, tall: 0.09 };
/**
 * Offset per height, in squares per square of the sprite's radius (a 2 x 2 tree has radius 1): bigger things cast
 * longer shadows.
 */
export const SHADOW_OFFSET: Readonly<Record<SpriteHeight, number>> = { flat: 0, low: 0.1, tall: 0.26 };
/** Smallest offset of a shadow that is drawn at all, in pixels (so small props still lift off the ground). */
export const SHADOW_MIN_OFFSET_PX = 2;

export interface ShadowSpec {
  /** Offset of the shadow from the sprite, in pixels (always toward SHADOW_DIR). */
  readonly dx: number;
  readonly dy: number;
  /** Blur radius in pixels (canvas shadowBlur). */
  readonly blur: number;
}

/** The shadow of a sprite of the given height and radius (squares) at `cell` pixels per square; null = no shadow. */
export function shadowSpec(height: SpriteHeight, radiusSquares: number, cell: number): ShadowSpec | null {
  if (height === "flat") return null;
  const len = Math.max(SHADOW_MIN_OFFSET_PX, SHADOW_OFFSET[height] * Math.max(0.5, radiusSquares) * cell);
  return { dx: SHADOW_DIR.x * len, dy: SHADOW_DIR.y * len, blur: Math.max(1, SHADOW_BLUR[height] * cell) };
}

/** How far (pixels) a shadow reaches past its sprite's drawn rectangle: offset plus blur. */
export function shadowReach(spec: ShadowSpec | null): number {
  return spec ? Math.hypot(spec.dx, spec.dy) + 2 * spec.blur : 0;
}

/** The 2D canvas operations a shadow is rendered with (a real canvas, or a test double). */
export interface ShadowCanvas {
  width: number;
  height: number;
  getContext(kind: "2d", settings?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
}

/**
 * Renders the shadow silhouette of an image drawn `w` x `h` pixels and rotated by `rot` (radians) into a new canvas
 * from `create`, centred like the sprite: drawing the result centred on the sprite's centre and moved by
 * (spec.dx, spec.dy) puts the shadow in place. The sprite itself is drawn far off the canvas with the shadow offset
 * pulling only its shadow back in, so the silhouette comes from the sprite's alpha in every browser.
 */
export function renderShadow<C extends ShadowCanvas>(
  create: (w: number, h: number) => C,
  image: CanvasImageSource,
  w: number,
  h: number,
  rot: number,
  spec: ShadowSpec,
): C {
  const half = Math.ceil(Math.hypot(w, h) / 2 + 2 * spec.blur + 2);
  const canvas = create(2 * half, 2 * half);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const far = 4 * half + 1000;
  ctx.shadowColor = `rgba(${SHADOW_RGB},${SHADOW_ALPHA})`;
  ctx.shadowBlur = spec.blur;
  ctx.shadowOffsetX = far;
  ctx.shadowOffsetY = 0;
  ctx.translate(half - far, half);
  ctx.rotate(rot);
  ctx.drawImage(image, -w / 2, -h / 2, w, h);
  return canvas;
}
