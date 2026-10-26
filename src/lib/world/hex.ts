// Hex grid for the Journey to Horizon hex crawl (Hope & Fear p.171; D6).
// Axial coordinates (q, r) over the map image, calibrated in image pixels.
// Pure module: bundled into Convex.

export type HexOrientation = "flat" | "pointy";
export type HexGrid = {
  /** Centre of hex (0, 0) in image pixels. */
  originX: number;
  originY: number;
  /** Centre-to-corner radius in image pixels. */
  size: number;
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
  if (grid.orientation === "flat") {
    return { x: originX + size * 1.5 * h.q, y: originY + size * SQRT3 * (h.r + h.q / 2) };
  }
  return { x: originX + size * SQRT3 * (h.q + h.r / 2), y: originY + size * 1.5 * h.r };
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
  const py = (y - grid.originY) / grid.size;
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
    return { x: c.x + grid.size * Math.cos(a), y: c.y + grid.size * Math.sin(a) };
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
  const span = Math.ceil(Math.max(width, height) / grid.size);
  const qMin = Math.min(...qs) - 2;
  const qMax = Math.max(...qs) + 2;
  const rMin = Math.min(...rs) - span;
  const rMax = Math.max(...rs) + span;
  const out: Hex[] = [];
  for (let q = qMin; q <= qMax; q++) {
    for (let r = rMin; r <= rMax; r++) {
      const c = hexToPixel({ q, r }, grid);
      if (c.x < -grid.size || c.y < -grid.size || c.x > width + grid.size || c.y > height + grid.size) continue;
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
