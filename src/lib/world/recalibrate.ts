// Moving a stored hex crawl onto another grid (dcm-kggd): each hex keeps the
// spot on the map its centre marked, now named by the new grid's hex that
// holds that spot. Used by `migrations/worldHex` to put crawls calibrated on
// the old default grid onto the Horizon map's printed grid. Pure module:
// bundled into Convex.

import { hexKey, hexToPixel, pixelToHex, remapHex, type Hex, type HexGrid } from "./hex";
import type { CrawlHex, MapToken } from "./map-state";

type Image = { width: number; height: number };
type LastMove = { q: number; r: number } & Record<string, unknown>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clampPct = (n: number) => round2(Math.max(0, Math.min(100, n)));

/** A hex's centre in map percent. */
export function hexCentrePct(h: Hex, grid: HexGrid, image: Image): { x: number; y: number } {
  const c = hexToPixel(h, grid);
  return { x: clampPct((c.x / image.width) * 100), y: clampPct((c.y / image.height) * 100) };
}

/**
 * Two hexes landing on one new hex (only when the old hexes were smaller than
 * the new ones) merge: the first keeps its fields, the second fills the gaps,
 * and the merged hex is explored if either was.
 */
function mergeHex(a: CrawlHex, b: CrawlHex): CrawlHex {
  return { ...b, ...a, explored: a.explored || b.explored };
}

/** The crawl's hexes on grid `to`: one per new hex, sorted by q then r. */
export function remapHexes(hexes: readonly CrawlHex[], from: HexGrid, to: HexGrid): CrawlHex[] {
  const out = new Map<string, CrawlHex>();
  for (const h of hexes) {
    const n = remapHex(h, from, to);
    const moved: CrawlHex = { ...h, q: n.q, r: n.r };
    const key = hexKey(n);
    const prev = out.get(key);
    out.set(key, prev ? mergeHex(prev, moved) : moved);
  }
  return [...out.values()].sort((a, b) => a.q - b.q || a.r - b.r);
}

/** A marker snapped to the centre of the new hex that holds its spot (Horizon markers sit on hex centres). */
export function remapToken<T extends Pick<MapToken, "x" | "y">>(token: T, to: HexGrid, image: Image): T {
  const h = pixelToHex((token.x / 100) * image.width, (token.y / 100) * image.height, to);
  return { ...token, ...hexCentrePct(h, to, image) };
}

/** The crawl's party hex, last move and party marker on grid `to`. */
export function remapCrawlScalars<C extends { grid: HexGrid; party: Hex | null; lastMove?: LastMove }>(
  crawl: C,
  party: { x: number; y: number },
  to: HexGrid,
  image: Image,
): { crawl: C; party: { x: number; y: number } } {
  const from = crawl.grid;
  const next: C = { ...crawl, grid: to, party: crawl.party ? remapHex(crawl.party, from, to) : null };
  if (crawl.lastMove) next.lastMove = { ...crawl.lastMove, ...remapHex(crawl.lastMove, from, to) };
  return { crawl: next, party: next.party ? hexCentrePct(next.party, to, image) : party };
}
