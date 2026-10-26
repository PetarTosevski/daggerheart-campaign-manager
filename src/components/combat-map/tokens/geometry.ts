/**
 * Token geometry (D9 C6), pure: no React, no Convex. The server (convex/combatTokens.ts) and the client's optimistic
 * updates share it, so a dragged token lands where the server will put it.
 *
 * Squares: a token at (x, y) with size s covers [x, x + s) × [y, y + s). Facing in radians, 0 = east, clockwise
 * (screen y down), R5.
 */

/** R5: a turn snaps to 15 degrees. */
export const TURN_STEP = Math.PI / 12;
/** The token panel's ⟲ / ⟳ buttons turn by 45 degrees (the board). */
export const TURN_BUTTON_STEP = Math.PI / 4;

/** Keeps an angle in (-π, π]. */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  let a = angle % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/** A turn: the angle snapped to 15 degrees (R5), in (-π, π]. */
export function snapTurn(angle: number): number {
  return normalizeAngle(Math.round(normalizeAngle(angle) / TURN_STEP) * TURN_STEP);
}

/** Top-left square of a token of `size` moved to (x, y): whole squares, inside a w × h map. */
export function clampSquare(x: number, y: number, size: number, w: number, h: number): { x: number; y: number } {
  const fit = (v: number, max: number) => Math.max(0, Math.min(Math.max(0, max), Number.isFinite(v) ? Math.round(v) : 0));
  return { x: fit(x, w - size), y: fit(y, h - size) };
}

/** A move (R5): the snapped, clamped square, and the token faces the way it moved (unchanged when it did not move). */
export function moveToken(
  token: { x: number; y: number; size: number; face: number },
  x: number,
  y: number,
  map: { w: number; h: number },
): { x: number; y: number; face: number } {
  const to = clampSquare(x, y, token.size, map.w, map.h);
  const dx = to.x - token.x;
  const dy = to.y - token.y;
  return { ...to, face: dx === 0 && dy === 0 ? token.face : normalizeAngle(Math.atan2(dy, dx)) };
}

/** Initials for a token without a portrait: up to 2 letters (3 on a big token), as on the board. */
export function initialsOf(name: string, size: number): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, size > 1 ? 3 : 2)
    .toUpperCase();
}

/** Which side of the map new tokens of a side start on: the party and allies left, everyone else right (the board). */
export function startSide(side: "pc" | "enemy" | "ally" | "neutral"): "left" | "right" {
  return side === "pc" || side === "ally" ? "left" : "right";
}

/** A token's initial facing: the party and allies face east, everyone else west (the board). */
export function startFace(side: "pc" | "enemy" | "ally" | "neutral"): number {
  return startSide(side) === "left" ? 0 : Math.PI;
}

/**
 * Free squares for new tokens (the board's `freeSpot`): closest to a fifth of the map from the preferred edge and
 * to the middle row, on the preferred half first; never on a square another token covers, never twice, and, when
 * `walkable` is given, on walkable squares if any are left. `size`: the new tokens' squares per side (the whole
 * footprint must be free). Returns `count` top-left squares (falls back to (1, 1)).
 */
export function freeSquares(
  map: { w: number; h: number },
  taken: readonly { x: number; y: number; size: number }[],
  prefer: "left" | "right",
  count: number,
  walkable?: (x: number, y: number) => boolean,
  size = 1,
): { x: number; y: number }[] {
  const { w, h } = map;
  const midY = Math.floor(h / 2);
  const startX = Math.round(prefer === "left" ? w * 0.2 : w * 0.78);
  const cells: [number, number, number][] = [];
  for (let x = 1; x < w - 1; x++) {
    for (let y = 1; y < h - 1; y++) {
      const wrongHalf = (prefer === "left") === x > w / 2;
      cells.push([x, y, Math.abs(x - startX) * 1.4 + Math.abs(y - midY) * 0.8 + (wrongHalf ? 40 : 0)]);
    }
  }
  cells.sort((a, b) => a[2] - b[2]);
  const used = taken.map((t) => ({ ...t }));
  // The new token's whole footprint (size × size from its top-left square) must be free and on the map.
  const covered = (x: number, y: number) =>
    x + size > w || y + size > h || used.some((t) => x < t.x + t.size && x + size > t.x && y < t.y + t.size && y + size > t.y);
  const dry = (x: number, y: number) => {
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (!walkable!(x + dx, y + dy)) return false;
    return true;
  };
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    let spot: { x: number; y: number } | null = null;
    for (const strict of [true, false]) {
      for (const [x, y] of cells) {
        if (covered(x, y)) continue;
        if (strict && walkable && !dry(x, y)) continue;
        spot = { x, y };
        break;
      }
      if (spot) break;
    }
    const at = spot ?? { x: Math.min(1, w - 1), y: Math.min(1, h - 1) };
    out.push(at);
    used.push({ ...at, size });
  }
  return out;
}
