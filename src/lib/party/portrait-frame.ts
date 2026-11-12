// Portrait close-up (plan portrait-frame, PZ1; user 2026-11-12: "let me zoom in if i want a close up shot of my
// character on the portrait"). The character's saved framing, `sheet.portraitFrame`, and the one style helper every
// site that draws a portrait uses (no site computes these styles itself). Framework-free and import-free, so the
// sheet schema, Convex and the phone app can use it.
//
// How a site draws a framed portrait: a clipping frame (`overflow: hidden`, the arch, a card, a round token) holds an
// inner layer that fills it and carries the picture with `background-size: cover`; `portraitFrameStyle` gives that
// layer `background-position: x% y%`, `transform: scale(zoom)` and `transform-origin: x% y%`. So the focal point
// (x, y) stays put while the picture grows around it. Only the picture scales, never the frame or its badges.

/** The saved framing: zoom 1..3 (step 0.05); x and y the focal point in percent of the picture, 0..100. */
export type PortraitFrame = { zoom: number; x: number; y: number };

export const PORTRAIT_ZOOM_MIN = 1;
export const PORTRAIT_ZOOM_MAX = 3;
export const PORTRAIT_ZOOM_STEP = 0.05;
/** How far one arrow key press moves the focal point, in percent (Shift: `PORTRAIT_KEY_STEP_LARGE`). */
export const PORTRAIT_KEY_STEP = 2;
export const PORTRAIT_KEY_STEP_LARGE = 10;

/** Where the editor starts for a character with no saved frame: no zoom, centred, a little above the middle (today's "center 30%"). */
export const DEFAULT_PORTRAIT_FRAME: PortraitFrame = { zoom: 1, x: 50, y: 30 };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

/** A valid frame from any numbers: zoom to 1..3 on its 0.05 step, x and y to 0..100 at one decimal. */
export function clampPortraitFrame(frame: PortraitFrame): PortraitFrame {
  const zoom = Math.round(clamp(frame.zoom, PORTRAIT_ZOOM_MIN, PORTRAIT_ZOOM_MAX) / PORTRAIT_ZOOM_STEP) / Math.round(1 / PORTRAIT_ZOOM_STEP);
  const pct = (n: number) => Math.round(clamp(n, 0, 100) * 10) / 10;
  return { zoom: clamp(zoom, PORTRAIT_ZOOM_MIN, PORTRAIT_ZOOM_MAX), x: pct(frame.x), y: pct(frame.y) };
}

/** The frame to edit or draw: the saved one, else the default. */
export function portraitFrameOrDefault(frame: PortraitFrame | null | undefined): PortraitFrame {
  return frame ? clampPortraitFrame(frame) : DEFAULT_PORTRAIT_FRAME;
}

/**
 * The zoom-1 frame that draws like a CSS `background-position` (`"center 30%"`, `"50% 20%"`, `"left top"`): where the
 * editor starts for a character with no saved frame, so opening it shows the arch as it is. Keywords: left/top 0,
 * center 50, right/bottom 100; a missing or unreadable part is 50 (as in CSS).
 */
export function portraitFrameFromPosition(position: string): PortraitFrame {
  const words = position.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const value = (word: string | undefined): number | null => {
    if (word === undefined) return null;
    if (word === "left" || word === "top") return 0;
    if (word === "center") return 50;
    if (word === "right" || word === "bottom") return 100;
    const m = /^(-?\d+(?:\.\d+)?)%$/.exec(word);
    return m ? Number(m[1]) : null;
  };
  let [x, y] = [value(words[0]) ?? 50, value(words[1]) ?? 50];
  // "top center" / "bottom left": a vertical keyword first swaps the pair.
  if (words[0] === "top" || words[0] === "bottom" || words[1] === "left" || words[1] === "right") [x, y] = [y, x];
  return clampPortraitFrame({ zoom: 1, x, y });
}

/** Whether two frames draw the same (after clamping). */
export function samePortraitFrame(a: PortraitFrame, b: PortraitFrame): boolean {
  const [p, q] = [clampPortraitFrame(a), clampPortraitFrame(b)];
  return p.zoom === q.zoom && p.x === q.x && p.y === q.y;
}

type Size = { width: number; height: number };

/**
 * How far a `cover` picture of `natural` size sticks out of a `box`, in px on each axis (0 on the axis it fits). Unknown
 * natural size (not loaded yet): no overflow.
 */
export function coverOverflow(box: Size, natural: Size | null | undefined): Size {
  if (!natural || natural.width <= 0 || natural.height <= 0 || box.width <= 0 || box.height <= 0) return { width: 0, height: 0 };
  const scale = Math.max(box.width / natural.width, box.height / natural.height);
  return { width: Math.max(0, natural.width * scale - box.width), height: Math.max(0, natural.height * scale - box.height) };
}

/**
 * How many px the picture moves on screen per 1% of focal point on one axis: the background position moves it by
 * `zoom * overflow / 100` and the transform origin by `(zoom - 1) * box / 100`, both against the focal point.
 */
function pxPerPercent(zoom: number, box: number, overflow: number): number {
  return (zoom * overflow + (zoom - 1) * box) / 100;
}

/**
 * The drag maths: the frame after the pointer dragged the picture by (dx, dy) px inside a `box`, so the picture follows
 * the pointer (drag right: you see more of the picture's left, the focal point moves left). `overflow` is the cover
 * picture's overflow (`coverOverflow`); on an axis where the picture can't move (zoom 1 and no overflow) the point stays.
 */
export function dragPortraitFrame(frame: PortraitFrame, delta: { dx: number; dy: number }, box: Size, overflow: Size = { width: 0, height: 0 }): PortraitFrame {
  const along = (value: number, d: number, size: number, over: number) => {
    const rate = pxPerPercent(frame.zoom, size, over);
    return rate > 0 ? value - d / rate : value;
  };
  return clampPortraitFrame({ zoom: frame.zoom, x: along(frame.x, delta.dx, box.width, overflow.width), y: along(frame.y, delta.dy, box.height, overflow.height) });
}

/**
 * An arrow key moves the picture like a short drag: ArrowRight shows more of the left (x down), ArrowDown more of the top
 * (y down), by `PORTRAIT_KEY_STEP` percent (`PORTRAIT_KEY_STEP_LARGE` with Shift). Null for any other key.
 */
export function nudgePortraitFrame(frame: PortraitFrame, key: string, large = false): PortraitFrame | null {
  const step = large ? PORTRAIT_KEY_STEP_LARGE : PORTRAIT_KEY_STEP;
  const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  const move = moves[key];
  if (!move) return null;
  return clampPortraitFrame({ zoom: frame.zoom, x: frame.x + move[0], y: frame.y + move[1] });
}

/** The inner layer's style: plain CSS property values, so React (`style`) and any other renderer can use it. */
export type PortraitFrameStyle = {
  backgroundPosition: string;
  backgroundSize?: "cover";
  transform?: string;
  transformOrigin?: string;
};

/**
 * The style helper: the inner picture layer's style for a saved frame. Without a frame it is only
 * `backgroundPosition: fallbackPosition` (the site's position of today, e.g. "center 30%" or the art's own), so a
 * character with no frame draws exactly as before.
 */
export function portraitFrameStyle(frame: PortraitFrame | null | undefined, fallbackPosition: string): PortraitFrameStyle {
  if (!frame) return { backgroundPosition: fallbackPosition };
  const { zoom, x, y } = clampPortraitFrame(frame);
  const point = `${x}% ${y}%`;
  return { backgroundPosition: point, backgroundSize: "cover", transform: `scale(${zoom})`, transformOrigin: point };
}
