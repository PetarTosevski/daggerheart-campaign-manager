// Terrain grid for the World map (D6), ported from World.dc.html. Pure module:
// bundled into Convex.

export const TERRAIN_COLUMNS = 128;
export const TERRAIN_ROWS = 98;

/** Terrain cells, row-major: r Road, w Wilds, p Plains, d Deep wilds, k Hills, m Wetlands, h Mountains, . Water, # Impassable. */
export const TERRAIN_CODES = ["r", "w", "p", "d", "k", "m", "h", ".", "#"] as const;

export type TerrainCode = (typeof TERRAIN_CODES)[number];

/** The board's names and colours per terrain (TNAME, TCOL). */
export const TERRAIN_NAMES: Record<TerrainCode, string> = {
  r: "Road",
  w: "Wilds",
  p: "Plains",
  m: "Wetlands",
  d: "Deep wilds",
  k: "Hills",
  h: "Mountains",
  ".": "Water",
  "#": "Impassable",
};
export const TERRAIN_COLOURS: Record<TerrainCode, string> = {
  r: "#b9b2a4",
  w: "#47a55a",
  p: "#e8d13a",
  m: "#4f8f84",
  d: "#1d6b36",
  k: "#f07a1e",
  h: "#d0453a",
  ".": "#3f86e0",
  "#": "#0b0907",
};

/** Paint brushes in key order 1–9: code, label, button colour. */
export const BRUSHES: readonly { code: TerrainCode; label: string; bg: string }[] = [
  { code: "r", label: "Road", bg: "#8f897c" },
  { code: "w", label: "Wilds", bg: "#3f7a46" },
  { code: "p", label: "Plains", bg: "#a8962a" },
  { code: "d", label: "Deep wilds", bg: "#1a4f2a" },
  { code: "k", label: "Hills", bg: "#b85a14" },
  { code: "m", label: "Wetlands", bg: "#3f6e66" },
  { code: "h", label: "Mountains / hard going", bg: "#9a3a2e" },
  { code: ".", label: "Water / none", bg: "#3a5a9a" },
  { code: "#", label: "Impassable", bg: "#0b0907" },
];

/** Brush sizes (radius in cells) and their labels. */
export const BRUSH_SIZES: readonly { size: number; label: string }[] = [
  { size: 1, label: "S" },
  { size: 2, label: "M" },
  { size: 4, label: "L" },
  { size: 6, label: "XL" },
];

/** The board's suggested Witherwild terrain at half resolution (64 × 49). */
const WITHERWILD_HALF = [
  "..............................................................h.",
  "..............................................................hh",
  "............................................................hhh.",
  ".............................................................hhh",
  "....................................w..ww.....................hh",
  "...................................wwwwwww...................hhh",
  "....................................wwwwwwww.............h.hhhhh",
  "......................................wwwwww...........hhhhhhhhh",
  ".....................................wwwwwwww..........hhhhhhhhh",
  "....................................wwwwwwwwhhhhh.hhhhhhhhhhhhh.",
  "....................................wwhhhhhhhhhhhhhhhhhhhhhhhhhh",
  ".......................................hhhhhhhhhhhhhhhhhhhhhhhh.",
  "...................................w......hhhhhhhhhhhhhhhhhhhhhh",
  "..................................hwhh..hhhhhhhhhhhhhhhhhhhhhhhh",
  "..................................hwwwwhhhhhhhhhhhhhhhhhhhhhhhh.",
  "..................................hhwwwwwwwhhhhhhhhhhhhhhhhhhhh.",
  "........................rw....hh...rrrwwwwwwwwhhhhhhhhhhhhhhhh..",
  "...h......hhh........wwrrwhh.hwrrrrrrrrrrrwwwwwwhhhhhhhhhh......",
  "hhhhhhhhhhhhhhwwwwwwwwwrwwwwwwwrrrrrrrrrrrwwwwwwwwwwwwwwhh......",
  ".hhhhhhhhhhhhhwwwwwwwwrrwwwwwwwrrrrrrrrrrrrwwwwwwwwwwwwwwww.....",
  "hhhhhhhhhhhhhwwwwwwwwwrww.wwwwwrrrrrrrrrrrrwwwwwwwwwwwwwwww.....",
  ".hhhhhhhhhhhhwwwwwwwwwrw..wwwwwrrrrrrrrrrrrwwwwwwwwwrwwwwwww....",
  ".hhhhhhhhhhhwwwwwwwwwwrwwwwwwwwwwwrrrrrwwwwwwwwwwwwrwwrrwwwww...",
  "wwwwwwwwwwwwwwwwwwwwwwrrwwwwwwwwwwwwrwwwwwwwwwwwwwrwwwwwrwwww...",
  "wwwwwwww.....wwwwwwwwwwrwwwwwwwwwwwwrwwwwwwwwhhhhrrhhhhwrrw.....",
  "wwwwwwww.....wwwwwwwwwwwrrwwwwwwwwwwrwwwwwwwwhhhrrhhhhhhhh......",
  "wwwwwwwwwwwwwwwwwwwwwwwwwwrrrwwwwwwwrwwwwwwwwhhrrhhhhhhhhhhh....",
  ".wwwwwwwwwwwwwwwwwwwwwwwwwwwwwrrrrrrrrwwwwwrrrrhhhhhhhhhhhhh....",
  ".wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwhhhhhhhhhhhhhhhwww.",
  "wwwwwwwwwwwwwhhh.wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwhhhhhhhhhhhhhwwww",
  ".wwwwwwwwwwwhhhhwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwhhhhhhhhhhhwww.",
  "wwww.wwwwwwwhhhhhwwww.wwwwwwwwwwwww.......wwwwwwwwwwwwwwwwwww...",
  "....wwwwwwwhhhhhww..wwwwwwwwwwwwwwwww...hhhhhhhhhhhhhwwwwwwww...",
  "......wwwwwhhhhwwwwwwwwwwwwwwwhhwwwwwhhhhhhhhhhhhhhhhhhhww......",
  "......wwwwwwwwwwwwwwwwwwwwhhhhhhhhhwwhhhhhhhhhhhhhhhhhhhh.......",
  ".....wwwwwww........wwwwwwhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh.......",
  ".....wwwwww..........wwwwwhhhhhhhhhhhwhhhhhhhhhhhhhhhhhhhh......",
  ".......wwwwwwwwwwwwwwwwwwwhhhhhhhhhhhwwwhhhhhhhhhhhhhh..........",
  ".......wwwwwwwwwwww...wwwwhhhhhhhhhhhwwwwwwwwhhhhhhhh...........",
  "......wwwwwwwwwwwwwwwwwwwwhhhhhhhhhhhwwwwwwwwwwwwwwwww..........",
  "......wwwwwwwwww.wwwwwwwwwhhhhhhhhhhhwww.....wwwwwwwww..........",
  "........wwwww....wwwwwwwwwwhhhhhhhhhhw........wwwwwww...........",
  ".........www..........wwwwwhhhhhhhhhwwww....wwwwwww.............",
  "..........ww.........wwwwwwwhhhhhhhhwwwwwwwwwwwwww..............",
  "..............wwwwwwwwwwwwwwwhhhhhhwwwwwwwwwwwwwww..............",
  "............wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww..............",
  "............wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww...................",
  ".............wwwwwwwwwwwwwwwwwwwwwwwwwwwwww.....................",
  "...............ww.wwwwwwwwwwwwwwwwwwwwwwww......................",
].join("");

/** Doubles a 64 × 49 grid to 128 × 98 (the board's `up2`); other lengths pass through. */
export function upscaleTerrain(grid: string): string {
  const half = TERRAIN_COLUMNS / 2;
  if (grid.length !== half * (TERRAIN_ROWS / 2)) return grid;
  let out = "";
  for (let r = 0; r < TERRAIN_ROWS / 2; r++) {
    const row = grid
      .slice(r * half, r * half + half)
      .split("")
      .map((ch) => ch + ch)
      .join("");
    out += row + row;
  }
  return out;
}

export const WITHERWILD_TERRAIN = upscaleTerrain(WITHERWILD_HALF);
export const BLANK_TERRAIN = "w".repeat(TERRAIN_COLUMNS * TERRAIN_ROWS);

/** "Reset to suggested": the Witherwild grid for Witherwild, all Wilds elsewhere. */
export function suggestedTerrain(frameId: string): string {
  return frameId === "witherwild" ? WITHERWILD_TERRAIN : BLANK_TERRAIN;
}

/** The terrain under a map point given in percent (0–100), clamped to the grid. */
export function terrainAt(grid: string, x: number, y: number): TerrainCode {
  const c = Math.min(TERRAIN_COLUMNS - 1, Math.max(0, Math.floor((x / 100) * TERRAIN_COLUMNS)));
  const r = Math.min(TERRAIN_ROWS - 1, Math.max(0, Math.floor((y / 100) * TERRAIN_ROWS)));
  return grid[r * TERRAIN_COLUMNS + c] as TerrainCode;
}

/** The grid cell (column, row) under a map point in percent. */
export function cellOf(x: number, y: number): { c: number; r: number } {
  return { c: Math.floor((x / 100) * TERRAIN_COLUMNS), r: Math.floor((y / 100) * TERRAIN_ROWS) };
}

/** Paints a round brush of `size` centred on cell (c0, r0), as the board's `paintAt`. */
export function paintTerrain(grid: string, c0: number, r0: number, size: number, brush: TerrainCode): string {
  const g = grid.split("");
  for (let r = r0 - size + 1; r <= r0 + size - 1; r++) {
    for (let c = c0 - size + 1; c <= c0 + size - 1; c++) {
      if (r < 0 || c < 0 || r >= TERRAIN_ROWS || c >= TERRAIN_COLUMNS) continue;
      if (Math.hypot(r - r0, c - c0) > size - 0.5) continue;
      g[r * TERRAIN_COLUMNS + c] = brush;
    }
  }
  return g.join("");
}

/** Cells of `after` that differ from `before`: their indexes, and their codes in `after` (one character each). */
export function terrainDiff(before: string, after: string): { indexes: number[]; codes: string } {
  const indexes: number[] = [];
  let codes = "";
  for (let i = 0; i < after.length; i++) {
    if (before[i] !== after[i]) {
      indexes.push(i);
      codes += after[i];
    }
  }
  return { indexes, codes };
}

/** The grid with cell `indexes[k]` set to `codes[k]` (a later repeat of an index wins). */
export function applyTerrainCells(grid: string, indexes: readonly number[], codes: string): string {
  const g = grid.split("");
  indexes.forEach((i, k) => {
    g[i] = codes[k];
  });
  return g.join("");
}

export type TerrainPaths = Record<"r" | "w" | "p" | "d" | "k" | "m" | "h" | "x" | "b", string>;

/** One SVG path per terrain (viewBox 0 0 128 98), merging horizontal runs. Water is `x`, impassable `b`. */
export function terrainPaths(grid: string): TerrainPaths {
  const out: TerrainPaths = { r: "", w: "", p: "", d: "", k: "", m: "", h: "", x: "", b: "" };
  for (let r = 0; r < TERRAIN_ROWS; r++) {
    let c = 0;
    while (c < TERRAIN_COLUMNS) {
      const ch = grid[r * TERRAIN_COLUMNS + c];
      let e = c;
      while (e + 1 < TERRAIN_COLUMNS && grid[r * TERRAIN_COLUMNS + e + 1] === ch) e++;
      const k = (ch === "." ? "x" : ch === "#" ? "b" : ch) as keyof TerrainPaths;
      if (k in out) out[k] += `M${c} ${r}h${e - c + 1}v1h${-(e - c + 1)}Z`;
      c = e + 1;
    }
  }
  for (const k of Object.keys(out) as (keyof TerrainPaths)[]) if (!out[k]) out[k] = "M0 0";
  return out;
}
