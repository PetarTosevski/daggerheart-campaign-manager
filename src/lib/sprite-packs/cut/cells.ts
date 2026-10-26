/**
 * Cell finding (sprite packs P2): which opaque pixels make up which object.
 *
 * 1. Label the opaque mask (alpha >= 128) into 8-connected components. Specks
 *    below a size floor are attached to a nearby object or dropped (JPEG
 *    noise).
 * 2. Bands: split the sheet into row bands at empty pixel rows, then each row
 *    band into column bands at empty columns. When that gives exactly the
 *    expected rows x columns, each band cell is one object and every fragment
 *    inside it (sparks, scattered bones, a pair of stones) belongs to it. This
 *    copes with uneven grids (dungeon/large).
 * 3. Otherwise (a fragment leaves a gap, an object straddles a band, an extra
 *    object): connected components with nearest-merge. The closest two groups
 *    merge first, but only while the merged group still fits in one grid cell
 *    and there are more groups than expected; what is left is the object list.
 *    A different count is reported, never forced.
 * Objects come back in reading order (rows by centre, then left to right).
 */

import type { SheetGrid } from "./types";
import type { RgbaImage } from "./types";

/** Alpha at or above which a pixel counts as part of an object. */
export const OPAQUE_ALPHA = 128;

export interface Component {
  /** 1-based label in the label map. */
  label: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
}

export interface Labels {
  /** Per pixel: 0 = background, else the component's label. */
  labels: Int32Array;
  /** `comps[label - 1]`. */
  comps: Component[];
}

/** 8-connected components of the pixels with alpha >= `minAlpha`. */
export function labelComponents(img: RgbaImage, minAlpha = OPAQUE_ALPHA): Labels {
  const { width: w, height: h, data } = img;
  const labels = new Int32Array(w * h);
  const comps: Component[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (labels[start] !== 0 || (data[start * 4 + 3] ?? 0) < minAlpha) continue;
    const label = comps.length + 1;
    const c: Component = { label, x0: w, y0: h, x1: -1, y1: -1, area: 0 };
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top > 0) {
      const p = stack[--top] ?? 0;
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
          const q = ny * w + nx;
          if (labels[q] !== 0 || (data[q * 4 + 3] ?? 0) < minAlpha) continue;
          labels[q] = label;
          stack[top++] = q;
        }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/** One object: a group of components. */
export interface Cluster {
  /** Labels of the components that make up the object. */
  labels: number[];
  /** Components above the speck floor (the object's real pieces). */
  fragments: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface CellsResult {
  /** Objects in reading order. */
  clusters: Cluster[];
  method: "bands" | "components" | "single";
  /** Per pixel: 0 = none, else 1 + the index of the object that owns it (soft edge pixels included). */
  owner: Int32Array;
}

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Chebyshev gap between two boxes in px (0 when they touch or overlap). */
function gap(a: Bounds, b: Bounds): number {
  const dx = Math.max(0, b.x0 - a.x1 - 1, a.x0 - b.x1 - 1);
  const dy = Math.max(0, b.y0 - a.y1 - 1, a.y0 - b.y1 - 1);
  return Math.max(dx, dy);
}

function union(a: Cluster, b: Cluster): Cluster {
  return {
    labels: [...a.labels, ...b.labels],
    fragments: a.fragments + b.fragments,
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function clusterOf(c: Component, fragment: boolean): Cluster {
  return { labels: [c.label], fragments: fragment ? 1 : 0, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 };
}

/** Runs of indices in [from, to) whose profile is > 0, split at gaps of at least `minGap` empty entries. */
export function bandsOf(profile: ArrayLike<number>, from: number, to: number, minGap: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  let lastFull = -1;
  for (let i = from; i < to; i++) {
    if ((profile[i] ?? 0) === 0) continue;
    if (start < 0) start = i;
    else if (i - lastFull - 1 >= minGap) {
      out.push([start, lastFull]);
      start = i;
    }
    lastFull = i;
  }
  if (start >= 0) out.push([start, lastFull]);
  return out;
}

/** Sort objects into reading order: rows by centre (a new row when the centre drops by more than `rowStep`), then by x. */
function readingOrder(clusters: Cluster[], rowStep: number): Cluster[] {
  const cy = (c: Cluster) => (c.y0 + c.y1) / 2;
  const cx = (c: Cluster) => (c.x0 + c.x1) / 2;
  const byY = [...clusters].sort((a, b) => cy(a) - cy(b));
  const rows: Cluster[][] = [];
  let row: Cluster[] = [];
  let sum = 0;
  for (const c of byY) {
    if (row.length > 0 && cy(c) - sum / row.length > rowStep) {
      rows.push(row);
      row = [];
      sum = 0;
    }
    row.push(c);
    sum += cy(c);
  }
  if (row.length > 0) rows.push(row);
  return rows.flatMap((r) => r.sort((a, b) => cx(a) - cx(b)));
}

/** The owner map: cluster labels, then grown 2 px into the soft (alpha > 0) edge pixels around them. */
function ownerMap(img: RgbaImage, lab: Labels, clusters: Cluster[]): Int32Array {
  const { width: w, height: h, data } = img;
  const byLabel = new Int32Array(lab.comps.length + 1);
  clusters.forEach((c, i) => {
    for (const l of c.labels) byLabel[l] = i + 1;
  });
  const owner = new Int32Array(w * h);
  for (let p = 0; p < w * h; p++) owner[p] = byLabel[lab.labels[p] ?? 0] ?? 0;
  for (let pass = 0; pass < 2; pass++) {
    const prev = owner.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if ((prev[p] ?? 0) !== 0 || (data[p * 4 + 3] ?? 0) === 0) continue;
        let o = 0;
        if (x > 0) o = prev[p - 1] ?? 0;
        if (!o && x < w - 1) o = prev[p + 1] ?? 0;
        if (!o && y > 0) o = prev[p - w] ?? 0;
        if (!o && y < h - 1) o = prev[p + w] ?? 0;
        if (o) owner[p] = o;
      }
  }
  return owner;
}

/** Find the objects of a keyed sheet. `grid` null = the whole image is one sprite. */
export function findCells(img: RgbaImage, grid: SheetGrid | null): CellsResult {
  const { width: w, height: h } = img;
  const lab = labelComponents(img);
  const speckArea = Math.max(6, Math.round(w * h * 1.5e-5));
  const near = Math.round(Math.min(w, h) * 0.02);
  const items = lab.comps.filter((c) => c.area >= speckArea);
  const specks = lab.comps.filter((c) => c.area < speckArea);
  // Specks join the nearest real piece within `near`, else they are dropped.
  const attach = new Map<number, number>();
  for (const s of specks) {
    let best = -1;
    let bestGap = near + 1;
    items.forEach((it, i) => {
      const g = gap(s, it);
      if (g < bestGap) {
        bestGap = g;
        best = i;
      }
    });
    if (best >= 0) attach.set(s.label, best);
  }
  const withSpecks = (i: number, it: Component): Cluster => {
    let c = clusterOf(it, true);
    for (const [label, to] of attach) {
      const s = lab.comps[label - 1];
      if (to === i && s) c = union(c, clusterOf(s, false));
    }
    return c;
  };
  const base = items.map((it, i) => withSpecks(i, it));

  const done = (clusters: Cluster[], method: CellsResult["method"], rowStep: number): CellsResult => {
    const ordered = readingOrder(clusters, rowStep);
    return { clusters: ordered, method, owner: ownerMap(img, lab, ordered) };
  };

  if (!grid) {
    const all = base.reduce<Cluster | null>((acc, c) => (acc ? union(acc, c) : c), null);
    return done(all ? [all] : [], "single", h);
  }

  const cellW = w / grid.cols;
  const cellH = h / grid.rows;

  // Bands.
  const kept = new Uint8Array(lab.comps.length + 1);
  for (const c of base) for (const l of c.labels) kept[l] = 1;
  const rowProfile = new Int32Array(h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (kept[lab.labels[y * w + x] ?? 0]) rowProfile[y] = (rowProfile[y] ?? 0) + 1;
  const minGapY = Math.max(2, Math.round(h * 0.004));
  const minGapX = Math.max(2, Math.round(w * 0.004));
  const rowBands = bandsOf(rowProfile, 0, h, minGapY);
  if (rowBands.length === grid.rows) {
    const cells: Array<Bounds & { row: number }> = [];
    let ok = true;
    rowBands.forEach(([y0, y1], row) => {
      const colProfile = new Int32Array(w);
      for (let y = y0; y <= y1; y++)
        for (let x = 0; x < w; x++) if (kept[lab.labels[y * w + x] ?? 0]) colProfile[x] = (colProfile[x] ?? 0) + 1;
      const colBands = bandsOf(colProfile, 0, w, minGapX);
      if (colBands.length !== grid.cols) ok = false;
      for (const [x0, x1] of colBands) cells.push({ x0, y0, x1, y1, row });
    });
    if (ok) {
      const groups: Array<Cluster | null> = cells.map(() => null);
      for (const c of base) {
        const cx = (c.x0 + c.x1) / 2;
        const cy = (c.y0 + c.y1) / 2;
        const at = cells.findIndex((b) => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1);
        const i = at >= 0 ? at : 0;
        const g = groups[i];
        groups[i] = g ? union(g, c) : c;
      }
      const clusters = groups.filter((g): g is Cluster => g !== null);
      if (clusters.length === grid.rows * grid.cols) return done(clusters, "bands", cellH / 2);
    }
  }

  // Connected components with nearest-merge, bounded by one grid cell.
  const expected = grid.rows * grid.cols;
  let clusters = [...base];
  while (clusters.length > expected) {
    let bi = -1;
    let bj = -1;
    let best = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const a = clusters[i];
      if (!a) continue;
      for (let j = i + 1; j < clusters.length; j++) {
        const b = clusters[j];
        if (!b) continue;
        const g = gap(a, b);
        if (g >= best) continue;
        const uw = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0) + 1;
        const uh = Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0) + 1;
        if (uw > cellW || uh > cellH) continue;
        best = g;
        bi = i;
        bj = j;
      }
    }
    const a = clusters[bi];
    const b = clusters[bj];
    if (!a || !b) break;
    clusters = clusters.filter((_, k) => k !== bi && k !== bj);
    clusters.push(union(a, b));
  }
  return done(clusters, "components", cellH / 2);
}
