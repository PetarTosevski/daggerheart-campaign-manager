import type { Range } from "@/lib/domain/card-effects/types";
import { rangeCheck, type Footprint } from "@/lib/domain/combat-actions/distance";
import { placementHolds, rangeSquares } from "@/lib/domain/feature-effects/areas";

import { RANGE_LABEL } from "../../actions/hand/model";

/**
 * The HUD's square picking, pure (plan combat-hud H3.3; CmpPicking 'Area · pick a square', 'Wall · two points', 'Chain
 * links'). No React: the store, the map layer and the bar read these, and the unit tests read them directly.
 *
 * - An area (`circle`): one centre square (or `count` of them, one area each: Forest Sprites), a crosshair with the
 *   radius preview, the banner "Pick the centre of Dark Cloud within Close · Esc cancels".
 * - A wall: two ends; both stay draggable until the confirm.
 * The placement check is the server's own (`placementHolds`, convex/combatAreas.ts refuses a square past `placeWithin`
 * with COMBAT_TARGET_INVALID), shown before the send (CmpBlocked layer 1).
 */

export type Square = { x: number; y: number };

/** What a picker asks the map for. */
export type AreaAsk = {
  /** The use or card the squares are for ("Dark Cloud", "Veil of Night"): the banner's bold name. */
  name: string;
  /** The area's own label ("Dark Cloud"). */
  label: string;
  shape: "circle" | "wall";
  /** Squares to pick: 1 for one area, 2 for a wall, n for n areas. */
  count: number;
  /** The circle's radius (no preview for a wall, or for Very Far, which has no edge). */
  radius?: Range;
  /** Each square is picked within this range of `origin` (the server's `placeWithin`). */
  within?: Range;
  blocksSight?: boolean;
  /** The caster's token: the `within` check and where the keyboard cursor starts. */
  origin?: Footprint | null;
};

const word = (r: Range | undefined) => (r === undefined ? "" : (RANGE_LABEL[r] ?? r));

/** The radius preview in squares (the classic picker's: the band's squares plus half a square), null for none. */
export function previewRadius(ask: Pick<AreaAsk, "shape" | "radius">): number | null {
  if (ask.shape !== "circle" || ask.radius === undefined || ask.radius === "veryFar") return null;
  return rangeSquares(ask.radius) + 0.5;
}

/** The square under a stage position in squares (`viewport.toSquares`), or null off the map. */
export function squareAt(p: Square, w: number, h: number): Square | null {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  return x >= 0 && y >= 0 && x < w && y < h ? { x, y } : null;
}

const same = (a: Square, b: Square) => a.x === b.x && a.y === b.y;

/**
 * The points after a click (or Enter) on `square`: the next one while some are missing; once all are down, the nearest
 * moves there (a wall's handle, a circle's centre). A click on a placed point changes nothing.
 */
export function placeAt(points: readonly Square[], count: number, square: Square): Square[] {
  if (points.some((p) => same(p, square))) return [...points];
  if (points.length < count) return [...points, square];
  let best = 0;
  let bestD = Infinity;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - square.x, p.y - square.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return points.map((p, i) => (i === best ? square : p));
}

/** The points with point `i` dragged to `square`. */
export function movePoint(points: readonly Square[], i: number, square: Square): Square[] {
  return points.map((p, j) => (j === i ? square : p));
}

export const CURSOR_KEYS: Readonly<Record<string, Square>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** Where the keyboard cursor starts: the caster's square (its centre square for a large token), else the map's centre. */
export function startCursor(origin: Footprint | null | undefined, w: number, h: number): Square {
  if (origin) {
    const half = Math.floor(((origin.size ?? 1) - 1) / 2);
    return clampSquare({ x: origin.x + half, y: origin.y + half }, w, h);
  }
  return { x: Math.floor(w / 2), y: Math.floor(h / 2) };
}

export function clampSquare(s: Square, w: number, h: number): Square {
  return { x: Math.max(0, Math.min(w - 1, s.x)), y: Math.max(0, Math.min(h - 1, s.y)) };
}

/** The cursor one square along an arrow key, kept on the map; null for any other key. */
export function stepCursor(cursor: Square, key: string, w: number, h: number): Square | null {
  const d = CURSOR_KEYS[key];
  return d ? clampSquare({ x: cursor.x + d.x, y: cursor.y + d.y }, w, h) : null;
}

/** Squares a wall covers between its two ends (a grid line: the longer axis plus one). */
export function wallLength(a: Square, b: Square): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) + 1;
}

/** " within Close" or "". */
export function withinText(ask: Pick<AreaAsk, "within">): string {
  return ask.within ? ` within ${word(ask.within)}` : "";
}

/** The banner's prompt as parts (the name is bold): CmpPicking "Pick the centre of **Dark Cloud** within Close". */
export function bannerParts(ask: AreaAsk, placed: number): { before: string; name: string; after: string } {
  const within = withinText(ask);
  if (ask.shape === "wall") {
    if (placed === 0) return { before: "", name: ask.name, after: `: pick the first point${within}` };
    if (placed === 1) return { before: "", name: ask.name, after: `: pick the second point${within}` };
    return { before: "", name: ask.name, after: ": drag a point to move it" };
  }
  if (ask.count > 1) return { before: `Pick square ${Math.min(placed + 1, ask.count)} of ${ask.count} for `, name: ask.label, after: within };
  return { before: "Pick the centre of ", name: ask.label, after: within };
}

export function bannerText(ask: AreaAsk, placed: number): string {
  const p = bannerParts(ask, placed);
  return `${p.before}${p.name}${p.after}`;
}

/** The banner's right-hand note: "Esc cancels" for one square, "1 of 2 points" for several. */
export function progressText(ask: Pick<AreaAsk, "count">, placed: number): string {
  return ask.count > 1 ? `${placed} of ${ask.count} points` : "Esc cancels";
}

/** The bar's summary: "Radius: Close (6 squares)", "Length 6 squares · within Far", "3 areas · Radius: Very Close (3 squares)". */
export function summaryText(ask: AreaAsk, points: readonly Square[]): string {
  if (ask.shape === "wall") {
    const [a, b] = points;
    const length = a && b ? `Length ${wallLength(a, b)} squares` : "A wall between two points";
    return `${length}${ask.within ? ` · within ${word(ask.within)}` : ""}`;
  }
  const radius = ask.radius === undefined ? "" : ask.radius === "veryFar" ? `Radius: Very Far` : `Radius: ${word(ask.radius)} (${rangeSquares(ask.radius)} squares)`;
  return ask.count > 1 ? `${ask.count} areas · ${radius}` : radius;
}

/** Why a picked square can't be sent (the server's `placeWithin` check), or null. */
export function placementProblem(ask: AreaAsk, points: readonly Square[]): string | null {
  if (!ask.within || !ask.origin) return null;
  const origin = ask.origin;
  const bad = points.some((p) => !placementHolds({ placeWithin: ask.within }, origin, { x: p.x, y: p.y, size: 1 }));
  return bad ? `${ask.label} must be placed within ${word(ask.within)} range of you.` : null;
}

/** Whether a square is outside `within` (drawn amber). */
export function outside(ask: AreaAsk, square: Square): boolean {
  return ask.within !== undefined && ask.origin != null && !placementHolds({ placeWithin: ask.within }, ask.origin, { x: square.x, y: square.y, size: 1 });
}

/** Why the confirm can't send yet: points missing, a square out of reach. */
export function confirmProblem(ask: AreaAsk, points: readonly Square[]): string | null {
  if (points.length < ask.count) return ask.count === 1 ? "Pick a square on the map." : `Pick ${ask.count - points.length} more ${ask.count - points.length === 1 ? "point" : "points"} on the map.`;
  return placementProblem(ask, points);
}

/** The confirm's default label: "Place Dark Cloud here", "Raise Veil of Night", "Place 3 Forest Sprites". */
export function confirmLabel(ask: AreaAsk): string {
  if (ask.shape === "wall") return `Raise ${ask.label}`;
  return ask.count > 1 ? `Place ${ask.count} × ${ask.label}` : `Place ${ask.label} here`;
}

/** A chain link's band from the last link (CmpPicking 'Chain links': "each link within Very Close of the last"). */
export function linkBand(from: Footprint | undefined, to: Footprint | undefined): Range | null {
  if (!from || !to) return null;
  return rangeCheck(from, to, "unlimited").band;
}
