// Terrain rasterizer for the combat map painter (D9 tracer C2).
// Port of the board's CMAP.rasterize (reference/designs/project/Combat.dc.html): a layout's areas (rect, ellipse,
// poly, path, border) become a terrain grid, optionally supersampled, with hand-painted terrain cells merged on top.
// Pure TypeScript, no DOM. PaintSpec is declared structurally here because C1's spec.ts (the zod layout schema) is
// built in parallel; C3 checks that C1's spec type is assignable to PaintSpec.

/** Terrain palette: base colour, second colour (noise blend) and per-pixel jitter. From the board's TER table. */
export const TERRAIN_PALETTE = {
  grass: { c: [118, 150, 52], c2: [150, 176, 64], var: 26 },
  dirt: { c: [150, 122, 84], c2: [128, 101, 68], var: 18 },
  path: { c: [160, 134, 96], c2: [138, 112, 78], var: 14 },
  sand: { c: [222, 200, 150], c2: [200, 178, 128], var: 12 },
  water: { c: [70, 150, 190], c2: [52, 120, 168], var: 14 },
  deep: { c: [34, 80, 140], c2: [26, 60, 112], var: 12 },
  swamp: { c: [86, 98, 58], c2: [62, 78, 52], var: 16 },
  stone: { c: [150, 146, 136], c2: [124, 120, 112], var: 10 },
  cave: { c: [168, 156, 136], c2: [140, 128, 110], var: 14 },
  wall: { c: [40, 36, 34], c2: [26, 24, 24], var: 6 },
  wood: { c: [150, 108, 66], c2: [124, 86, 50], var: 10 },
  snow: { c: [236, 240, 244], c2: [212, 220, 230], var: 8 },
  lava: { c: [230, 92, 30], c2: [170, 40, 20], var: 30 },
  void: { c: [14, 14, 16], c2: [8, 8, 10], var: 2 },
} as const satisfies Record<string, { c: readonly [number, number, number]; c2: readonly [number, number, number]; var: number }>;

export type TerrainId = keyof typeof TERRAIN_PALETTE;
export const TERRAIN_IDS = Object.keys(TERRAIN_PALETTE) as TerrainId[];
export const isTerrain = (t: unknown): t is TerrainId => typeof t === "string" && Object.prototype.hasOwnProperty.call(TERRAIN_PALETTE, t);

/** Terrains that read as walls (dark edge, bevel). */
export const WALLISH: ReadonlySet<TerrainId> = new Set<TerrainId>(["wall", "void"]);
/** Terrains that get a foam/shore edge. */
export const WET: ReadonlySet<TerrainId> = new Set<TerrainId>(["water", "deep", "lava"]);

export type PaintPoints = ReadonlyArray<ReadonlyArray<number>>;

/** One layout area (the board's spec.areas entry). Unknown terrains or shapes are ignored, as on the board. */
export interface PaintArea {
  readonly terrain: string;
  readonly shape: string;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly width?: number;
  readonly points?: PaintPoints;
}

/** One map object (the board's spec.objects entry). Positions and sizes are in squares. */
export interface PaintObject {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly r?: number;
  readonly rot?: number;
  readonly len?: number;
  readonly span?: number;
  readonly variant?: string | null;
  readonly points?: PaintPoints;
  /** Lights (campfire, torch, walltorch): false = unlit. Unset = lit, as on the board. */
  readonly lit?: boolean | null;
  /** Mast: false hides the sail. */
  readonly sail?: boolean | null;
}

/** The board's scene spec: what the painter needs from a layout. */
export interface PaintSpec {
  /** Width and height in squares. */
  readonly w: number;
  readonly h: number;
  readonly seed?: number;
  readonly base?: string;
  /** Wood planks run vertically (bridges) instead of horizontally. */
  readonly plankV?: boolean;
  readonly areas?: ReadonlyArray<PaintArea>;
  readonly objects?: ReadonlyArray<PaintObject>;
}

/** Hand-painted terrain, keyed by square: paintKey(x, y) -> terrain id. Decoded from combatMapCells by the caller. */
export type PaintedTerrain = Readonly<Record<string, string>>;
export const paintKey = (x: number, y: number): string => `${x},${y}`;

/** grid[y][x] = terrain of the (sub)square. */
export type TerrainGrid = TerrainId[][];

/** The board's xorshift generator, values in [0, 1). */
export const rng = (seed: number): (() => number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const pointInPolygon = (px: number, py: number, pts: PaintPoints): boolean => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

export const segmentDistance = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};

/** Does area `a` cover the point (cx, cy) in squares? mapW/mapH are needed for "border". */
export const areaHits = (a: PaintArea, cx: number, cy: number, mapW: number, mapH: number): boolean => {
  const x = a.x ?? 0, y = a.y ?? 0;
  switch (a.shape) {
    case "rect":
      return cx >= x && cx <= x + (a.w ?? 1) && cy >= y && cy <= y + (a.h ?? 1);
    case "ellipse":
      return ((cx - x) / (a.rx || 1)) ** 2 + ((cy - y) / (a.ry || 1)) ** 2 <= 1;
    case "poly":
      return !!a.points && a.points.length > 2 && pointInPolygon(cx, cy, a.points);
    case "path": {
      const p = a.points;
      if (!p || p.length < 2) return false;
      const hw = (a.width || 2) / 2;
      for (let i = 0; i < p.length - 1; i++) if (segmentDistance(cx, cy, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) <= hw) return true;
      return false;
    }
    case "border": {
      const th = a.width || 2;
      return cx < th || cy < th || cx > mapW - th || cy > mapH - th;
    }
    default:
      return false;
  }
};

/** Paint hand-painted squares over a grid rasterized at `factor` sub-cells per square (in place). */
export const mergePaint = (grid: TerrainGrid, paint: PaintedTerrain | undefined, factor = 1): TerrainGrid => {
  if (!paint) return grid;
  const H = grid.length, W = H ? grid[0].length : 0;
  for (const k of Object.keys(paint)) {
    const t = paint[k];
    if (!isTerrain(t)) continue;
    const [sx, sy] = k.split(",").map(Number);
    if (!Number.isInteger(sx) || !Number.isInteger(sy)) continue;
    for (let yy = 0; yy < factor; yy++)
      for (let xx = 0; xx < factor; xx++) {
        const gx = sx * factor + xx, gy = sy * factor + yy;
        if (gx >= 0 && gy >= 0 && gx < W && gy < H) grid[gy][gx] = t;
      }
  }
  return grid;
};

/**
 * The board's rasterize: base terrain, then each area in order (later areas win), sampled at sub-cell centres,
 * then painted squares on top. `factor` sub-cells per square (the painter uses 4 for soft edges).
 */
export const rasterize = (spec: PaintSpec, factor = 1, paint?: PaintedTerrain): TerrainGrid => {
  const F = Math.max(1, Math.floor(factor));
  const W = Math.max(0, Math.floor(spec.w)) * F, H = Math.max(0, Math.floor(spec.h)) * F;
  const base: TerrainId = isTerrain(spec.base) ? spec.base : "grass";
  const g: TerrainGrid = Array.from({ length: H }, () => Array<TerrainId>(W).fill(base));
  for (const a of spec.areas ?? []) {
    if (!a || !isTerrain(a.terrain)) continue;
    const t = a.terrain;
    for (let y = 0; y < H; y++) {
      const cy = (y + 0.5) / F;
      for (let x = 0; x < W; x++) if (areaHits(a, (x + 0.5) / F, cy, spec.w, spec.h)) g[y][x] = t;
    }
  }
  return mergePaint(g, paint, F);
};
