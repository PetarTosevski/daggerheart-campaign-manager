// Combat map painter (D9 tracer C2): a layout (areas + objects on a square grid, plus hand-painted terrain) becomes the
// board's hand-painted top-down battle map. Port of CMAP.render in reference/designs/project/Combat.dc.html.
//
// Pure TypeScript drawing into a given CanvasRenderingContext2D: no React, no DOM lookups, no dependency.
// Deterministic for a seed: the same spec, options and rectangle always give the same pixels.
//
// Entry points:
//   paintMap(ctx, spec, opts)            the whole map (C3). Size the canvas with mapPixelSize first.
//   paintMapRect(ctx, map, rect, opts)   repaint one rectangle in squares (C5 edits, light switches). Pass the old and
//                                        new objectBounds() of a changed object, or terrainDirtyRect() of painted squares.
//   prepareMap(spec, paint)              rasters and edge map, reusable across several paintMapRect calls.
// The context must have an identity transform (putImageData ignores transforms); scale with CSS or by drawing this
// canvas into another one.
//
// Deviation from the board (deliberate): texture strokes take their random numbers per square instead of from one
// sequence over the whole map, so repainting a rectangle draws exactly the strokes the full paint drew.

import {
  TERRAIN_PALETTE,
  WALLISH,
  WET,
  rasterize,
  rng,
  type PaintObject,
  type PaintSpec,
  type PaintedTerrain,
  type TerrainGrid,
  type TerrainId,
} from "./raster";

export const DEFAULT_CELL = 48;
/** Supersampling of the terrain raster used for soft, noisy edges. */
const FF = 4;
/** Hard cap on drawn objects, as on the board. */
const MAX_DRAWN_OBJECTS = 400;

/** A rectangle in squares (fractions allowed). */
export interface MapRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PaintOptions {
  /** Pixels per square (default 48, the board's CELL). */
  readonly cell?: number;
  /** How map lights (campfire, torch, walltorch) are drawn: as each object says (default), all lit, or all unlit. */
  readonly lights?: "spec" | "lit" | "unlit";
  /** Draw the square grid (default true). */
  readonly grid?: boolean;
  /** Darken the map's corners (default true). */
  readonly vignette?: boolean;
}

export interface PreparedMap {
  readonly spec: PaintSpec;
  readonly w: number;
  readonly h: number;
  readonly seed: number;
  /** Terrain per square. */
  readonly grid: TerrainGrid;
  /** Terrain per quarter square (FF x FF per square). */
  readonly fine: TerrainGrid;
  /** 1 where a fine cell is within 3 fine cells of a different terrain. */
  readonly edge: Uint8Array;
  readonly crisp: ReadonlySet<TerrainId>;
}

/** Kinds whose light the GM and players switch (R9). */
export const LIGHT_KINDS: ReadonlySet<string> = new Set(["campfire", "torch", "walltorch"]);

// ---------------------------------------------------------------------------------------------------- noise and random

const hash = (x: number, y: number, s: number): number => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0; // the board's float multiply, kept for an identical look
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

const vnoise = (x: number, y: number, s: number): number => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

const fbm = (x: number, y: number, s: number): number =>
  vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 13) * 0.15;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------------------------------- geometry helpers

export const mapPixelSize = (spec: Pick<PaintSpec, "w" | "h">, cell = DEFAULT_CELL): { width: number; height: number } => ({
  width: Math.max(0, Math.floor(spec.w)) * cell,
  height: Math.max(0, Math.floor(spec.h)) * cell,
});

export const unionRect = (a: MapRect, b: MapRect): MapRect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

export const padRect = (r: MapRect, pad: number): MapRect => ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad });

/**
 * The area to repaint after terrain changes in the given squares: noisy edges, shore foam and wall bevels reach
 * about 1.4 squares into the neighbours, so the rectangle is padded by 2.
 */
export const terrainDirtyRect = (squares: MapRect): MapRect => padRect(squares, 2);

const PX_MARGIN = 12; // line widths, drop shadows and shadowBlur, in pixels

/** The rectangle (in squares) an object's drawing can touch, shadow and glow included. */
export const objectBounds = (o: PaintObject, cell = DEFAULT_CELL): MapRect => {
  const s = o.r || 1;
  const m = PX_MARGIN / cell;
  if (o.kind === "hull" && o.points && o.points.length > 2) {
    const xs = o.points.map((p) => p[0]), ys = o.points.map((p) => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    return padRect({ x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }, 0.5 + m);
  }
  let rad: number;
  switch (o.kind) {
    case "tree": case "bush": rad = 1.4 * s; break;
    case "deadtree": rad = 1.6 * s; break;
    case "rock": case "boulder": case "tent": case "pillar": case "statue": rad = 1.1 * s; break;
    case "campfire": rad = 1.4 * s; break;
    case "log": rad = Math.max((o.len || 2.5) / 2, 0.3 * s) + 0.2 * s; break;
    case "crate": case "chest": case "table": rad = 0.9 * s; break;
    case "barrel": rad = 0.4 * s; break;
    case "rubble": rad = 0.8 * s; break;
    case "mast": rad = Math.max((o.span || 4) / 2, 1.4) + 0.4 * s; break;
    case "mushroom": case "bones": rad = 0.4 * s; break;
    case "crystal": rad = 1.6 * s; break;
    case "torch": case "walltorch": rad = 1.8 * s; break;
    default: rad = 1.8 * s;
  }
  rad += m;
  return { x: o.x - rad, y: o.y - rad, w: 2 * rad, h: 2 * rad };
};

const intersects = (a: MapRect, b: MapRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ---------------------------------------------------------------------------------------------------- preparation

export const prepareMap = (spec: PaintSpec, paint?: PaintedTerrain): PreparedMap => {
  const w = Math.max(0, Math.floor(spec.w)), h = Math.max(0, Math.floor(spec.h));
  const grid = rasterize(spec, 1, paint);
  const fine = rasterize(spec, FF, paint);
  const FW = w * FF, FH = h * FF;
  const edge = new Uint8Array(FW * FH);
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) {
      const t = fine[y][x];
      let e = 0;
      for (let dy = -3; dy <= 3 && !e; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= FH) continue;
        const row = fine[yy];
        for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < FW && row[xx] !== t) { e = 1; break; }
        }
      }
      edge[y * FW + x] = e;
    }
  const crisp = new Set<TerrainId>(["wood"]);
  if (spec.base === "wall" || spec.base === "void") crisp.add("stone");
  return { spec, w, h, seed: (spec.seed || 1) | 0, grid, fine, edge, crisp };
};

// ---------------------------------------------------------------------------------------------------- terrain pixels

const paintTerrain = (ctx: CanvasRenderingContext2D, m: PreparedMap, C: number, x0: number, y0: number, x1: number, y1: number) => {
  const rw = x1 - x0, rh = y1 - y0;
  if (rw <= 0 || rh <= 0) return;
  const { fine, edge, seed, crisp, spec } = m;
  const FW = m.w * FF, FH = m.h * FF, FC = C / FF;
  const T = (gx: number, gy: number): TerrainId => fine[clamp(Math.floor(gy * FF), 0, FH - 1)][clamp(Math.floor(gx * FF), 0, FW - 1)];
  const wallish = (t: TerrainId) => WALLISH.has(t);
  const img = ctx.createImageData(rw, rh);
  const D = img.data;
  const amp = C * 0.38, fq = 1 / (C * 1.1);
  const plankV = !!spec.plankV;
  for (let py = y0; py < y1; py++)
    for (let px = x0; px < x1; px++) {
      const fx = Math.min(FW - 1, Math.floor(px / FC)), fy = Math.min(FH - 1, Math.floor(py / FC));
      let t: TerrainId;
      let wallEdge = 0, wetEdge = false, rim = false;
      if (edge[fy * FW + fx]) {
        const t0 = fine[fy][fx];
        let ox = (fbm(px * fq, py * fq, seed) - 0.5) * 2 * amp, oy = (fbm(px * fq + 31, py * fq + 17, seed) - 0.5) * 2 * amp;
        t = T((px + ox) / C, (py + oy) / C);
        if (crisp.has(t0) || crisp.has(t)) { t = t0; ox = 0; oy = 0; }
        const k = 7;
        const s = [T((px + ox + k) / C, (py + oy) / C), T((px + ox - k) / C, (py + oy) / C), T((px + ox) / C, (py + oy + k) / C), T((px + ox) / C, (py + oy - k) / C)];
        const wt = wallish(t);
        if (s.some((u) => wallish(u) !== wt)) wallEdge = 1;
        else {
          const k2 = 14;
          const s2 = [T((px + ox + k2) / C, (py + oy) / C), T((px + ox - k2) / C, (py + oy) / C), T((px + ox) / C, (py + oy + k2) / C), T((px + ox) / C, (py + oy - k2) / C)];
          if (s2.some((u) => wallish(u) !== wt)) wallEdge = 2;
        }
        if (WET.has(t) && s.some((u) => !WET.has(u))) wetEdge = true;
        if (t === "wood" && s.some((u) => u !== "wood")) rim = true;
      } else t = fine[fy][fx];
      const P = TERRAIN_PALETTE[t];
      const n = fbm(px * 0.045, py * 0.045, seed + 3), n2 = vnoise(px * 0.22, py * 0.22, seed + 5);
      let r = P.c[0] + (P.c2[0] - P.c[0]) * n, gg = P.c[1] + (P.c2[1] - P.c[1]) * n, b = P.c[2] + (P.c2[2] - P.c[2]) * n;
      const j = (n2 - 0.5) * P.var;
      r += j; gg += j; b += j;
      if (t === "wood") {
        const along = plankV ? px : py, across = plankV ? py : px;
        const plank = Math.floor(along / (C / 3));
        const seam = along % (C / 3) < 1.6;
        const pv = (hash(plank, Math.floor(across / (C * 2.2)), seed) - 0.5) * 22;
        r += pv; gg += pv * 0.8; b += pv * 0.6;
        if (seam) { r -= 45; gg -= 40; b -= 32; }
      }
      if (t === "stone") {
        const shift = (Math.floor(py / (C / 2)) % 2) * C / 4;
        const bx = (px + shift) % (C / 2), by = py % (C / 2);
        if (bx < 1.5 || by < 1.5) { r -= 38; gg -= 38; b -= 36; }
        const sv = (hash(Math.floor((px + shift) / (C / 2)), Math.floor(py / (C / 2)), seed) - 0.5) * 20;
        r += sv; gg += sv; b += sv;
      }
      const wt = wallish(t);
      if (t === "wall" && (px + py) % 9 < 1.4 && wallEdge) { r += 70; gg += 64; b += 56; }
      if (wallEdge === 1) { r = wt ? 92 : r * 0.55; gg = wt ? 80 : gg * 0.55; b = wt ? 66 : b * 0.55; }
      else if (wallEdge === 2 && !wt) { r *= 0.8; gg *= 0.8; b *= 0.8; }
      else if (wallEdge === 2 && wt && (px - py + 400) % 6 < 1.6) { r += 50; gg += 45; b += 40; }
      if (rim) { r = 70; gg = 44; b = 24; }
      if (wetEdge && t !== "lava") { r = r * 0.4 + 235 * 0.6; gg = gg * 0.4 + 245 * 0.6; b = b * 0.4 + 245 * 0.6; }
      if ((t === "water" || t === "deep") && vnoise(px * 0.06, py * 0.2, seed + 9) > 0.72) { r += 18; gg += 22; b += 22; }
      if (t === "lava" && n2 > 0.7) { r = 255; gg = 200; b = 80; }
      const i = ((py - y0) * rw + (px - x0)) * 4;
      D[i] = clamp(r, 0, 255); D[i + 1] = clamp(gg, 0, 255); D[i + 2] = clamp(b, 0, 255); D[i + 3] = 255;
    }
  ctx.putImageData(img, x0, y0);
};

const strokeCount: Partial<Record<TerrainId, number>> = { grass: 9, dirt: 4, path: 4, cave: 4, swamp: 5, sand: 3, snow: 2 };

const paintStrokes = (ctx: CanvasRenderingContext2D, m: PreparedMap, C: number, sx0: number, sy0: number, sx1: number, sy1: number) => {
  ctx.lineCap = "round";
  for (let y = sy0; y < sy1; y++)
    for (let x = sx0; x < sx1; x++) {
      const t = m.grid[y][x];
      const R = rng(Math.floor(hash(x, y, m.seed + 101) * 2147483646) + 1);
      const n = strokeCount[t] ?? 0;
      for (let k = 0; k < n; k++) {
        const sx = (x + R()) * C, sy = (y + R()) * C;
        if (t === "grass" || t === "swamp") {
          const l = 3 + R() * 4;
          ctx.strokeStyle = R() < 0.5 ? "rgba(60,92,26,0.55)" : "rgba(190,214,96,0.45)";
          ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 2, sy - l); ctx.moveTo(sx, sy); ctx.lineTo(sx + 2, sy - l * 0.9); ctx.stroke();
        } else {
          ctx.fillStyle = t === "snow" ? "rgba(170,185,200,0.6)" : "rgba(80,66,50,0.45)";
          ctx.beginPath(); ctx.ellipse(sx, sy, 1.5 + R() * 2.5, 1 + R() * 1.8, R() * 3, 0, 7); ctx.fill();
        }
      }
      if (t === "swamp" && R() < 0.3) {
        ctx.fillStyle = "rgba(40,70,50,0.6)";
        ctx.beginPath(); ctx.ellipse((x + R()) * C, (y + R()) * C, C * 0.4, C * 0.25, R() * 3, 0, 7); ctx.fill();
      }
      if ((t === "water" || t === "deep") && R() < 0.35) {
        ctx.strokeStyle = "rgba(220,240,255,0.35)"; ctx.lineWidth = 1.4;
        const wx = (x + R()) * C, wy = (y + R()) * C;
        ctx.beginPath(); ctx.arc(wx, wy, 6 + R() * 6, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      }
    }
};

// ---------------------------------------------------------------------------------------------------- objects

const TREE_PALETTES: Record<string, readonly [string, string, string]> = {
  green: ["#5f8a2e", "#3f6420", "#8fb84a"],
  dark: ["#3f6a3a", "#2a4a2a", "#6a9a5a"],
  autumn: ["#c98a24", "#9a5f16", "#e8b44a"],
  olive: ["#7d8c2c", "#5a6620", "#a8b84a"],
  pine: ["#2f5a3a", "#1f3f28", "#4f7a52"],
  pink: ["#c87aa0", "#9a4a76", "#eaa8c8"],
};
const RANDOM_TREE = ["green", "green", "dark", "olive", "autumn"] as const;

const paintHull = (ctx: CanvasRenderingContext2D, o: PaintObject, C: number, seed: number) => {
  const pts = (o.points ?? []).map((p) => [p[0] * C, p[1] * C] as const);
  const path = () => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const horiz = maxX - minX >= maxY - minY;
  ctx.save(); ctx.lineJoin = "round";
  path(); ctx.strokeStyle = "rgba(240,250,255,0.35)"; ctx.lineWidth = C * 0.9; ctx.stroke(); ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = C * 0.35; ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.translate(8, 10); path(); ctx.fill(); ctx.translate(-8, -10);
  path(); ctx.fillStyle = "#9a6a3c"; ctx.fill();
  ctx.save(); path(); ctx.clip();
  const pw = C / 3;
  for (let k = 0; ; k++) {
    const a = horiz ? minY + k * pw : minX + k * pw;
    if (a > (horiz ? maxY : maxX)) break;
    const v = (hash(k, 3, seed) - 0.5) * 26;
    ctx.fillStyle = `rgb(${154 + v},${108 + v * 0.8},${62 + v * 0.6})`;
    if (horiz) ctx.fillRect(minX, a, maxX - minX, pw - 1.4); else ctx.fillRect(a, minY, pw - 1.4, maxY - minY);
    ctx.fillStyle = "rgba(60,36,18,0.55)";
    for (let q = 0; q < 6; q++) {
      const b = (horiz ? minX : minY) + hash(k, q, seed) * (horiz ? maxX - minX : maxY - minY);
      if (horiz) ctx.fillRect(b, a, 1.4, pw); else ctx.fillRect(a, b, pw, 1.4);
    }
  }
  ctx.restore();
  path(); ctx.strokeStyle = "#4a2c14"; ctx.lineWidth = C * 0.28; ctx.stroke(); ctx.strokeStyle = "#2a170a"; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
};

const paintShadow = (ctx: CanvasRenderingContext2D, o: PaintObject, C: number) => {
  const x = o.x * C, y = o.y * C, s = (o.r || 1) * C;
  const shade = (rx: number, ry: number) => { ctx.fillStyle = "rgba(10,20,8,0.32)"; ctx.beginPath(); ctx.ellipse(x + rx * 0.25, y + ry * 0.3, rx, ry, 0, 0, 7); ctx.fill(); };
  if (/tree|bush/.test(o.kind)) shade(s * 1.05, s * 0.95);
  else if (/rock|boulder|tent|statue|pillar/.test(o.kind)) shade(s * 0.8, s * 0.6);
};

const canopy = (ctx: CanvasRenderingContext2D, C: number, x: number, y: number, rad: number, col: string, dark: string, hi: string, rnd: () => number) => {
  const blobs: [number, number, number][] = [];
  const n = 7 + Math.floor((rad / C) * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
    const d = rad * (0.55 + rnd() * 0.18);
    blobs.push([x + Math.cos(a) * d, y + Math.sin(a) * d, rad * (0.38 + rnd() * 0.12)]);
  }
  blobs.push([x, y, rad * 0.62]);
  ctx.fillStyle = "#1d2a12"; blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx, by, br + 2.4, 0, 7); ctx.fill(); });
  ctx.fillStyle = dark; blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx, by, br, 0, 7); ctx.fill(); });
  ctx.fillStyle = col; blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx - br * 0.12, by - br * 0.14, br * 0.8, 0, 7); ctx.fill(); });
  ctx.fillStyle = hi; blobs.forEach(([bx, by, br]) => { ctx.beginPath(); ctx.arc(bx - br * 0.25, by - br * 0.3, br * 0.42, 0, 7); ctx.fill(); });
  ctx.strokeStyle = "rgba(25,40,15,0.5)"; ctx.lineWidth = 1.2;
  for (let i = 0; i < n * 2; i++) {
    const a = rnd() * 7, d = rnd() * rad * 0.8;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 3 + rnd() * 3, 0.2, 2.6); ctx.stroke();
  }
};

const isLit = (o: PaintObject, lights: PaintOptions["lights"]) => (lights === "lit" ? true : lights === "unlit" ? false : o.lit !== false);

const paintObject = (ctx: CanvasRenderingContext2D, o: PaintObject, C: number, seed: number, lights: PaintOptions["lights"]) => {
  const x = o.x * C, y = o.y * C, s = (o.r || 1) * C;
  const rnd = rng(Math.floor(o.x * 97 + o.y * 131) + seed);
  const rot = o.rot || 0;
  ctx.save();
  switch (o.kind) {
    case "tree": case "bush": {
      const pal = (o.variant && TREE_PALETTES[o.variant]) || TREE_PALETTES[RANDOM_TREE[Math.floor(rnd() * 5)]];
      canopy(ctx, C, x, y, s * (o.kind === "bush" ? 0.7 : 1), pal[0], pal[1], pal[2], rnd);
      break;
    }
    case "deadtree": {
      ctx.strokeStyle = "#e8e2d4"; ctx.lineCap = "round";
      const br = (bx: number, by: number, a: number, l: number, w: number, d: number): void => {
        if (d > 4 || l < 4) return;
        const ex = bx + Math.cos(a) * l, ey = by + Math.sin(a) * l;
        ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
        br(ex, ey, a - 0.5 + rnd() * 0.3, l * 0.62, w * 0.62, d + 1);
        br(ex, ey, a + 0.4 + rnd() * 0.3, l * 0.6, w * 0.6, d + 1);
      };
      ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 6;
      for (let i = 0; i < 6; i++) br(x, y, (i / 6) * 6.28 + rnd(), s * 0.55, s * 0.12, 0);
      ctx.fillStyle = "#d8d0c0"; ctx.beginPath(); ctx.arc(x, y, s * 0.14, 0, 7); ctx.fill();
      break;
    }
    case "rock": case "boulder": {
      const n = 7 + Math.floor(rnd() * 4);
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.28;
        const d = s * (0.32 + rnd() * 0.16) * (o.kind === "boulder" ? 1.3 : 1);
        pts.push([x + Math.cos(a) * d, y + Math.sin(a) * d * 0.85]);
      }
      ctx.fillStyle = "#5c5e62"; ctx.strokeStyle = "#1e1f22"; ctx.lineWidth = 2.4;
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#8a8c90"; ctx.beginPath(); ctx.moveTo(pts[n - 2][0], pts[n - 2][1]);
      for (let i = n - 1; i < n + 2; i++) ctx.lineTo(pts[i % n][0], pts[i % n][1]);
      ctx.lineTo(x - s * 0.04, y - s * 0.02); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(30,30,34,0.6)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x - s * 0.1, y - s * 0.12); ctx.lineTo(x + s * 0.06, y + s * 0.1); ctx.stroke();
      break;
    }
    case "tent": {
      ctx.translate(x, y); ctx.rotate(rot);
      const w = s * 1.1, h = s * 0.85;
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
      ctx.fillStyle = "#efd9b0"; ctx.strokeStyle = "#5a4126"; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w / 2, 0); ctx.lineTo(-w / 2, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#cfb489";
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-w / 2 - 3, 0); ctx.lineTo(w / 2 + 3, 0); ctx.stroke();
      break;
    }
    case "campfire": {
      ctx.fillStyle = "rgba(40,30,25,0.55)"; ctx.beginPath(); ctx.arc(x, y, s * 0.75, 0, 7); ctx.fill();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * 6.28;
        ctx.fillStyle = i % 2 ? "#7a7c80" : "#5c5e62"; ctx.strokeStyle = "#222"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * s * 0.42, y + Math.sin(a) * s * 0.42, s * 0.11, s * 0.08, a, 0, 7); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = "#2a2420"; ctx.beginPath(); ctx.arc(x, y, s * 0.3, 0, 7); ctx.fill();
      if (isLit(o, lights)) {
        const gr = ctx.createRadialGradient(x, y, 1, x, y, s * 1.4);
        gr.addColorStop(0, "rgba(255,190,80,0.55)"); gr.addColorStop(1, "rgba(255,140,40,0)");
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, s * 1.4, 0, 7); ctx.fill();
        ctx.fillStyle = "#ff9a2a"; ctx.beginPath(); ctx.arc(x, y, s * 0.17, 0, 7); ctx.fill();
        ctx.fillStyle = "#ffe28a"; ctx.beginPath(); ctx.arc(x, y, s * 0.08, 0, 7); ctx.fill();
      } else {
        ctx.strokeStyle = "#4a3a2c"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x - s * 0.18, y - s * 0.1); ctx.lineTo(x + s * 0.18, y + s * 0.1); ctx.moveTo(x - s * 0.15, y + s * 0.14); ctx.lineTo(x + s * 0.15, y - s * 0.12); ctx.stroke();
        ctx.fillStyle = "rgba(150,140,130,0.6)"; ctx.beginPath(); ctx.arc(x, y, s * 0.08, 0, 7); ctx.fill();
      }
      break;
    }
    case "log": {
      ctx.translate(x, y); ctx.rotate(rot);
      const l = (o.len || 2.5) * C, w = s * 0.32;
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(-l / 2 + 4, -w / 2 + 5, l, w);
      ctx.fillStyle = "#6d4a2c"; ctx.strokeStyle = "#2e1d10"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-l / 2, -w / 2, l, w, w / 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(40,24,12,0.6)"; ctx.lineWidth = 1.3;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(-l / 2 + w * 0.4, -w * 0.3 + i * w * 0.2); ctx.lineTo(l / 2 - w * 0.4, -w * 0.28 + i * w * 0.2 + (rnd() - 0.5) * 3); ctx.stroke();
      }
      ctx.fillStyle = "#c99a62"; ctx.beginPath(); ctx.ellipse(l / 2 - w * 0.15, 0, w * 0.2, w * 0.46, 0, 0, 7); ctx.fill(); ctx.stroke();
      break;
    }
    case "crate": case "chest": case "table": {
      ctx.translate(x, y); ctx.rotate(rot);
      const w = s * (o.kind === "table" ? 1.4 : 0.7), h = s * (o.kind === "table" ? 0.8 : o.kind === "chest" ? 0.5 : 0.7);
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(-w / 2 + 4, -h / 2 + 5, w, h);
      ctx.fillStyle = o.kind === "chest" ? "#8a5a2a" : "#a77a48"; ctx.strokeStyle = "#3a2412"; ctx.lineWidth = 2;
      ctx.fillRect(-w / 2, -h / 2, w, h); ctx.strokeRect(-w / 2, -h / 2, w, h);
      if (o.kind === "crate") { ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.moveTo(w / 2, -h / 2); ctx.lineTo(-w / 2, h / 2); ctx.stroke(); }
      if (o.kind === "chest") { ctx.fillStyle = "#d6b04a"; ctx.fillRect(-w / 2, -2, w, 4); ctx.fillRect(-3, -h / 2, 6, h); }
      if (o.kind === "table") {
        ctx.strokeStyle = "rgba(58,36,18,0.5)";
        for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2 + (i * h) / 4); ctx.lineTo(w / 2, -h / 2 + (i * h) / 4); ctx.stroke(); }
      }
      break;
    }
    case "barrel": {
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.arc(x + 4, y + 5, s * 0.34, 0, 7); ctx.fill();
      ctx.fillStyle = "#9a6a3a"; ctx.strokeStyle = "#3a2412"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, s * 0.34, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#4a4a4a"; ctx.beginPath(); ctx.arc(x, y, s * 0.24, 0, 7); ctx.stroke();
      break;
    }
    case "pillar": case "statue": {
      ctx.fillStyle = "#9c988e"; ctx.strokeStyle = "#2a2826"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(x, y, s * 0.42, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#c4c0b6"; ctx.beginPath(); ctx.arc(x - s * 0.08, y - s * 0.08, s * 0.24, 0, 7); ctx.fill();
      if (o.kind === "statue") { ctx.fillStyle = "#7a776e"; ctx.beginPath(); ctx.arc(x, y, s * 0.16, 0, 7); ctx.fill(); ctx.stroke(); }
      break;
    }
    case "rubble": {
      for (let i = 0; i < 9; i++) {
        const a = rnd() * 6.28, d = rnd() * s * 0.6;
        ctx.fillStyle = rnd() < 0.5 ? "#77756e" : "#5a5852"; ctx.strokeStyle = "#26241f"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, 3 + rnd() * s * 0.12, 2 + rnd() * s * 0.08, rnd() * 3, 0, 7); ctx.fill(); ctx.stroke();
      }
      break;
    }
    case "mast": {
      ctx.fillStyle = "#5a3a1e"; ctx.strokeStyle = "#2a180a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, s * 0.2, 0, 7); ctx.fill(); ctx.stroke();
      if (o.sail !== false) {
        ctx.translate(x, y); ctx.rotate(rot);
        const sw = (o.span || 4) * C;
        ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.ellipse(10, 10, s * 0.35, sw / 2, 0, 0, 7); ctx.fill();
        const d = C * 0.9;
        ctx.fillStyle = "#f1e6cc"; ctx.strokeStyle = "#7a6440"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-d * 0.2, -sw / 2); ctx.quadraticCurveTo(d * 1.4, 0, -d * 0.2, sw / 2); ctx.lineTo(-d * 0.6, sw / 2); ctx.quadraticCurveTo(d * 0.5, 0, -d * 0.6, -sw / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = "rgba(122,100,64,0.45)"; ctx.lineWidth = 1.2;
        for (let k = 1; k < 4; k++) { const yy = -sw / 2 + (k * sw) / 4; ctx.beginPath(); ctx.moveTo(-d * 0.55, yy); ctx.lineTo(d * 0.35, yy * 0.92); ctx.stroke(); }
        ctx.fillStyle = "#5a3a1e"; ctx.fillRect(-d * 0.65, -sw / 2 - 3, 5, sw + 6);
      }
      break;
    }
    case "mushroom": {
      ctx.fillStyle = "#b8443a"; ctx.strokeStyle = "#3a1410"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, s * 0.22, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f4e8d8";
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(x + (rnd() - 0.5) * s * 0.25, y + (rnd() - 0.5) * s * 0.25, 2, 0, 7); ctx.fill(); }
      break;
    }
    case "crystal": {
      const gr = ctx.createRadialGradient(x, y, 1, x, y, s * 1.6);
      gr.addColorStop(0, "rgba(120,200,255,0.55)"); gr.addColorStop(1, "rgba(120,200,255,0)");
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, s * 1.6, 0, 7); ctx.fill();
      ctx.fillStyle = "rgb(120,200,255)"; ctx.beginPath(); ctx.arc(x, y, s * 0.12, 0, 7); ctx.fill();
      break;
    }
    case "torch": case "walltorch": {
      const lit = isLit(o, lights);
      if (lit) {
        const gr = ctx.createRadialGradient(x, y, 1, x, y, s * 1.8);
        gr.addColorStop(0, "rgba(255,170,60,0.6)"); gr.addColorStop(1, "rgba(255,170,60,0)");
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, s * 1.8, 0, 7); ctx.fill();
      }
      ctx.fillStyle = "#3a2a1a"; ctx.strokeStyle = "#120c06"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.roundRect(x - s * 0.1, y - s * 0.1, s * 0.2, s * 0.32, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#6a6a6e"; ctx.fillRect(x - s * 0.16, y + s * 0.12, s * 0.32, s * 0.06);
      if (lit) {
        ctx.fillStyle = "#ff9a2a"; ctx.beginPath(); ctx.ellipse(x, y - s * 0.14, s * 0.12, s * 0.17, 0, 0, 7); ctx.fill();
        ctx.fillStyle = "#ffe28a"; ctx.beginPath(); ctx.ellipse(x, y - s * 0.12, s * 0.05, s * 0.08, 0, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = "#2a2420"; ctx.beginPath(); ctx.arc(x, y - s * 0.12, s * 0.08, 0, 7); ctx.fill();
      }
      break;
    }
    case "bones": {
      ctx.strokeStyle = "#ece4d2"; ctx.lineWidth = 3; ctx.lineCap = "round";
      for (let i = 0; i < 4; i++) {
        const a = rnd() * 6.28;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * s * 0.3, y + Math.sin(a) * s * 0.3); ctx.lineTo(x - Math.cos(a) * s * 0.3, y - Math.sin(a) * s * 0.3); ctx.stroke();
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
};

// ---------------------------------------------------------------------------------------------------- entry points

const drawableObjects = (spec: PaintSpec): PaintObject[] =>
  (spec.objects ?? []).filter((o) => o && Number.isFinite(o.x) && Number.isFinite(o.y)).slice(0, MAX_DRAWN_OBJECTS);

/**
 * Repaint one rectangle (in squares) of the map: terrain, texture strokes, every object that reaches into it
 * (in the board's order: hulls, shadows, bodies), grid and vignette, clipped to the rectangle. The result is
 * pixel-identical to the same area of paintMap.
 */
export const paintMapRect = (ctx: CanvasRenderingContext2D, map: PreparedMap | PaintSpec, rect: MapRect, opts: PaintOptions = {}): void => {
  const m = "fine" in map ? map : prepareMap(map);
  const C = opts.cell ?? DEFAULT_CELL;
  const PW = m.w * C, PH = m.h * C;
  const x0 = clamp(Math.floor(rect.x * C), 0, PW), y0 = clamp(Math.floor(rect.y * C), 0, PH);
  const x1 = clamp(Math.ceil((rect.x + rect.w) * C), 0, PW), y1 = clamp(Math.ceil((rect.y + rect.h) * C), 0, PH);
  if (x1 <= x0 || y1 <= y0) return;
  const area: MapRect = { x: x0 / C, y: y0 / C, w: (x1 - x0) / C, h: (y1 - y0) / C };

  paintTerrain(ctx, m, C, x0, y0, x1, y1);

  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();

  // strokes reach a few pixels past their square: include one square around the rectangle
  paintStrokes(ctx, m, C,
    clamp(Math.floor(area.x) - 1, 0, m.w), clamp(Math.floor(area.y) - 1, 0, m.h),
    clamp(Math.ceil(area.x + area.w) + 1, 0, m.w), clamp(Math.ceil(area.y + area.h) + 1, 0, m.h));

  const objs = drawableObjects(m.spec).filter((o) => intersects(objectBounds(o, C), area));
  for (const o of objs) if (o.kind === "hull" && o.points && o.points.length > 2) paintHull(ctx, o, C, m.seed);
  for (const o of objs) paintShadow(ctx, o, C);
  for (const o of objs) paintObject(ctx, o, C, m.seed, opts.lights);

  if (opts.grid !== false) {
    ctx.strokeStyle = "rgba(20,24,16,0.22)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let gx = Math.floor(area.x); gx <= Math.min(m.w, Math.ceil(area.x + area.w)); gx++) { ctx.moveTo(gx * C + 0.5, y0); ctx.lineTo(gx * C + 0.5, y1); }
    for (let gy = Math.floor(area.y); gy <= Math.min(m.h, Math.ceil(area.y + area.h)); gy++) { ctx.moveTo(x0, gy * C + 0.5); ctx.lineTo(x1, gy * C + 0.5); }
    ctx.stroke();
  }
  if (opts.vignette !== false) {
    const vg = ctx.createRadialGradient(PW / 2, PH / 2, Math.min(PW, PH) * 0.45, PW / 2, PH / 2, Math.max(PW, PH) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = vg; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  ctx.restore();
};

/** The same prepared terrain with another object list (an object moved, was added or a light switched). */
export const withObjects = (m: PreparedMap, objects: ReadonlyArray<PaintObject>): PreparedMap => ({ ...m, spec: { ...m.spec, objects } });

/**
 * Paint the whole map at (0, 0). The canvas should be mapPixelSize(spec, cell) big. Returns the prepared map so
 * later dirty-rect repaints can reuse it: withObjects() when only objects change, prepareMap() again when terrain or
 * painted squares change.
 */
export const paintMap = (ctx: CanvasRenderingContext2D, spec: PaintSpec, opts: PaintOptions & { paint?: PaintedTerrain } = {}): PreparedMap => {
  const m = prepareMap(spec, opts.paint);
  paintMapRect(ctx, m, { x: 0, y: 0, w: m.w, h: m.h }, opts);
  return m;
};
