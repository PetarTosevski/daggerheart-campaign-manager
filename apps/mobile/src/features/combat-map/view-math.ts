/**
 * Pan and zoom of the combat map, pure (dcm-gdzi.13). Every function is a Reanimated worklet, so the gesture
 * handlers call them on the UI thread, and plain JS (buttons, tests) calls the same code.
 *
 * World units are squares: square (0, 0)'s top-left corner is the origin, the map covers `w` x `h`. A view is
 * `s` screen points per square and the screen position (`x`, `y`) of the origin.
 *
 * Pinch zoom is computed from the view and focal point captured when the pinch began, never from the live view, so
 * the scale cannot compound frame by frame (the old `view.z * e.scale` bug), and the square under the fingers stays
 * under the fingers (it also follows a two-finger drag).
 */

export type MapView = { s: number; x: number; y: number };
export type Viewport = { w: number; h: number };
/** The map in squares; `pad` squares of fog margin around it that a player may pan into (0 for the GM). */
export type MapBounds = { w: number; h: number; pad: number };
export type ZoomLimits = { min: number; max: number };
export type Point = { x: number; y: number };

/** Most screen points per square (a token then reads as a big button). */
export const MAX_SQUARE_PT = 160;
/** Fewest screen points per square however far out a big map is zoomed. */
export const MIN_SQUARE_PT = 3;
/** Screen points of the map (with its fog margin) that always stay on screen. */
export const KEEP_PT = 80;

function clamp(n: number, min: number, max: number): number {
  "worklet";
  return Math.max(min, Math.min(max, n));
}

/** Points per square that fit the whole map (not the fog margin) in the viewport. */
export function fitScale(viewport: Viewport, bounds: MapBounds): number {
  "worklet";
  if (viewport.w <= 0 || viewport.h <= 0 || bounds.w <= 0 || bounds.h <= 0) return 1;
  return Math.min(viewport.w / bounds.w, viewport.h / bounds.h);
}

/** Zoom out to half the fit, in to MAX_SQUARE_PT (or the fit, on a viewport wider than that). */
export function zoomLimits(viewport: Viewport, bounds: MapBounds): ZoomLimits {
  "worklet";
  const fit = fitScale(viewport, bounds);
  return { min: Math.max(MIN_SQUARE_PT, fit / 2), max: Math.max(MAX_SQUARE_PT, fit) };
}

/** Keeps at least KEEP_PT of the map and its margin on screen. */
export function clampView(view: MapView, viewport: Viewport, bounds: MapBounds): MapView {
  "worklet";
  const keepX = Math.min(KEEP_PT, viewport.w / 2);
  const keepY = Math.min(KEEP_PT, viewport.h / 2);
  const x = clamp(view.x, keepX - (bounds.w + bounds.pad) * view.s, viewport.w - keepX + bounds.pad * view.s);
  const y = clamp(view.y, keepY - (bounds.h + bounds.pad) * view.s, viewport.h - keepY + bounds.pad * view.s);
  return { s: view.s, x, y };
}

/** The whole map, centred. */
export function fitView(viewport: Viewport, bounds: MapBounds): MapView {
  "worklet";
  const s = fitScale(viewport, bounds);
  return { s, x: (viewport.w - bounds.w * s) / 2, y: (viewport.h - bounds.h * s) / 2 };
}

/** A one-finger drag: the view at the drag's start moved by the translation so far. */
export function panView(start: MapView, dx: number, dy: number): MapView {
  "worklet";
  return { s: start.s, x: start.x + dx, y: start.y + dy };
}

/**
 * A pinch: `start` and `focalStart` captured when it began, `focal` and the gesture's cumulative `scale` now. The
 * world point under `focalStart` ends up under `focal`.
 */
export function pinchView(start: MapView, focalStart: Point, focal: Point, scale: number, limits: ZoomLimits): MapView {
  "worklet";
  const s = clamp(start.s * scale, limits.min, limits.max);
  const r = s / start.s;
  return { s, x: focal.x - (focalStart.x - start.x) * r, y: focal.y - (focalStart.y - start.y) * r };
}

/** Zoom by `factor` about a screen point (the buttons zoom about the viewport's centre). */
export function zoomAbout(view: MapView, factor: number, at: Point, limits: ZoomLimits): MapView {
  "worklet";
  return pinchView(view, at, at, factor, limits);
}

/** The square position (fractional) under a screen point. */
export function screenToSquare(view: MapView, px: number, py: number): Point {
  "worklet";
  return { x: (px - view.x) / view.s, y: (py - view.y) / view.s };
}

/** Zoom as a percentage of the fit (100% = the whole map fills the viewport). */
export function zoomPercent(view: MapView, viewport: Viewport, bounds: MapBounds): number {
  "worklet";
  return Math.round((view.s / fitScale(viewport, bounds)) * 100);
}
