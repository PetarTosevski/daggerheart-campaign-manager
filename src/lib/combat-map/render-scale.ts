// Render scale of the Combat Map's canvases (plan sharp-4k, HD1): how many backing-store pixels a canvas draws per CSS
// pixel, so the map is as sharp as the screen allows on a 4K monitor or zoomed in. The canvas's CSS size never changes;
// only its backing store grows. Pure maths: the board measures the screen and the zoom (map-canvas.tsx).

/** Largest backing store a canvas may have, in pixels (4096 x 4096; browsers refuse or slow down past this). */
export const MAX_CANVAS_PIXELS = 16_777_216;
/** Largest backing-store side, in pixels. */
export const MAX_CANVAS_SIDE = 8192;
/** Scales are multiples of this step, so a small zoom change does not repaint and canvas sizes stay whole pixels. */
export const SCALE_STEP = 0.5;

/** Whether a canvas `width` x `height` CSS pixels fits the caps at scale `k`. */
const fits = (width: number, height: number, k: number) =>
  width * k <= MAX_CANVAS_SIDE && height * k <= MAX_CANVAS_SIDE && width * k * height * k <= MAX_CANVAS_PIXELS;

/**
 * The render scale k of a canvas `width` x `height` CSS pixels big (at board zoom 1): `device` (devicePixelRatio x the
 * root CSS zoom) times the board zoom (`zoom`, no extra below 1), rounded UP to a SCALE_STEP, at least 1, then lowered
 * step by step to the largest that keeps the backing store within MAX_CANVAS_SIDE per side and MAX_CANVAS_PIXELS in
 * all. A canvas too big even at 1 keeps 1 (as before HD1). Bad inputs (NaN, 0, negative) count as 1.
 */
export function renderScale(device: number, zoom: number, width: number, height: number): number {
  const d = Number.isFinite(device) && device > 0 ? device : 1;
  const z = Number.isFinite(zoom) && zoom > 1 ? zoom : 1;
  // The epsilon keeps a product that should be exact (2 x 0.8 x 1.25) from rounding up a whole step.
  let k = Math.max(1, Math.ceil((d * z) / SCALE_STEP - 1e-9) * SCALE_STEP);
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  while (k > 1 && !fits(w, h, k)) k -= SCALE_STEP;
  return k;
}
