// Hex grid for the Journey to Horizon hex crawl (Hope & Fear p.171; D6).
// Axial coordinates (q, r) over the map image, calibrated in image pixels
// (the printed grids of the built-in maps: ./printed-grids.ts).
// Pure module: bundled into Convex.

export type HexOrientation = "flat" | "pointy";
export type HexGrid = {
  /** Centre of hex (0, 0) in image pixels. */
  originX: number;
  originY: number;
  /** Centre-to-corner radius in image pixels (horizontal). */
  size: number;
  /**
   * Vertical centre-to-corner radius when the printed hexes are slightly
   * taller or flatter than regular ones (art scaled unevenly). Unset: `size`.
   */
  sizeY?: number;
  orientation: HexOrientation;
};
export type Hex = { q: number; r: number };

export const MIN_HEX_SIZE = 10;
export const MAX_HEX_SIZE = 400;
/** Most hexes drawn for the calibration overlay. */
export const MAX_GRID_HEXES = 15000;

const SQRT3 = Math.sqrt(3);

export const hexKey = (h: Hex) => `${h.q},${h.r}`;

/** Centre of a hex in image pixels. */
export function hexToPixel(h: Hex, grid: HexGrid): { x: number; y: number } {
  const { size, originX, originY } = grid;
  const sizeY = verticalSize(grid);
  if (grid.orientation === "flat") {
    return { x: originX + size * 1.5 * h.q, y: originY + sizeY * SQRT3 * (h.r + h.q / 2) };
  }
  return { x: originX + size * SQRT3 * (h.q + h.r / 2), y: originY + sizeY * 1.5 * h.r };
}

/** The grid's vertical centre-to-corner radius (`sizeY`, else `size`). */
export const verticalSize = (grid: HexGrid) => grid.sizeY ?? grid.size;

/** The same grid with hexes `k` times as large about the same centres (markers drawn inside a hex). */
export function scaleGrid(grid: HexGrid, k: number): HexGrid {
  return { ...grid, size: grid.size * k, ...(grid.sizeY !== undefined ? { sizeY: grid.sizeY * k } : {}) };
}

/** A hex's bounding box in image pixels: corner to corner across its points, edge to edge across its flats. */
export function hexBox(grid: HexGrid): { width: number; height: number } {
  const sizeY = verticalSize(grid);
  return grid.orientation === "flat" ? { width: 2 * grid.size, height: SQRT3 * sizeY } : { width: SQRT3 * grid.size, height: 2 * sizeY };
}

/** The hex of grid `to` that holds the centre of hex `h` of grid `from` (recalibration). */
export function remapHex(h: Hex, from: HexGrid, to: HexGrid): Hex {
  const c = hexToPixel(h, from);
  return pixelToHex(c.x, c.y, to);
}

export function sameGrid(a: HexGrid, b: HexGrid): boolean {
  return a.originX === b.originX && a.originY === b.originY && a.size === b.size && verticalSize(a) === verticalSize(b) && a.orientation === b.orientation;
}

/** Rounds fractional axial coordinates to the containing hex (cube rounding). */
export function roundHex(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // Normalise -0 to 0 so keys and equality stay stable.
  return { q: rq + 0, r: rr + 0 };
}

/** The hex containing an image-pixel point. */
export function pixelToHex(x: number, y: number, grid: HexGrid): Hex {
  const px = (x - grid.originX) / grid.size;
  const py = (y - grid.originY) / verticalSize(grid);
  if (grid.orientation === "flat") {
    const q = (2 / 3) * px;
    return roundHex(q, (-1 / 3) * px + (SQRT3 / 3) * py);
  }
  return roundHex((SQRT3 / 3) * px - (1 / 3) * py, (2 / 3) * py);
}

const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function neighbours(h: Hex): Hex[] {
  return DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export const isAdjacent = (a: Hex, b: Hex) => hexDistance(a, b) === 1;

/** The six corners of a hex in image pixels. */
export function hexCorners(h: Hex, grid: HexGrid): { x: number; y: number }[] {
  const c = hexToPixel(h, grid);
  const offset = grid.orientation === "flat" ? 0 : 30;
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i + offset) * Math.PI) / 180;
    return { x: c.x + grid.size * Math.cos(a), y: c.y + verticalSize(grid) * Math.sin(a) };
  });
}

/** SVG path data (image-pixel units) outlining the given hexes. */
export function hexesPath(hexes: Hex[], grid: HexGrid): string {
  return hexes
    .map((h) => {
      const pts = hexCorners(h, grid);
      return `M${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("L")}Z`;
    })
    .join("");
}

/** Every hex whose centre lies within the image (plus a one-hex margin), capped at MAX_GRID_HEXES. */
export function hexesCovering(width: number, height: number, grid: HexGrid): Hex[] {
  const corners = [pixelToHex(0, 0, grid), pixelToHex(width, 0, grid), pixelToHex(0, height, grid), pixelToHex(width, height, grid)];
  const qs = corners.map((h) => h.q);
  const rs = corners.map((h) => h.r);
  const span = Math.ceil(Math.max(width, height) / Math.min(grid.size, verticalSize(grid)));
  const qMin = Math.min(...qs) - 2;
  const qMax = Math.max(...qs) + 2;
  const rMin = Math.min(...rs) - span;
  const rMax = Math.max(...rs) + span;
  const out: Hex[] = [];
  for (let q = qMin; q <= qMax; q++) {
    for (let r = rMin; r <= rMax; r++) {
      const c = hexToPixel({ q, r }, grid);
      const m = Math.max(grid.size, verticalSize(grid));
      if (c.x < -m || c.y < -m || c.x > width + m || c.y > height + m) continue;
      out.push({ q, r });
      if (out.length >= MAX_GRID_HEXES) return out;
    }
  }
  return out;
}

/**
 * What players may see of the crawl: explored hexes, the party's hex and its
 * neighbours ("the hex they are in… and any hex adjacent", HF p.171).
 */
export function visibleHexKeys(explored: Hex[], party: Hex | null): Set<string> {
  const keys = new Set(explored.map(hexKey));
  if (party) {
    keys.add(hexKey(party));
    for (const n of neighbours(party)) keys.add(hexKey(n));
  }
  return keys;
}
