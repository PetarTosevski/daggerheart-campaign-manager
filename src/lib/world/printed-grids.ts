// The hex grids printed on the built-in frame maps (WORLD_MAPS in
// ./map-state.ts), in image pixels of the published art, so the hex crawl's
// overlay covers exactly one printed hex per hex (dcm-kggd). Pure module:
// bundled into Convex.
//
// Measured from the art by fitting a hex lattice to the printed lines over the
// whole image (least squares on line darkness), then checked by eye at the
// four corners and the centre. Of the ten built-in maps only Journey to
// Horizon prints a hex grid; the others (Witherwild, Five Banners Burning,
// Beast Feast, Age of Umbra, Motherboard, Colossus of the Drylands, Castle
// High, Reign of the Weredragon, Dark Heart of Andaluria) are pictorial maps
// without one.

import type { PublishedFrameId } from "../frames/index";
import type { HexGrid } from "./hex";

export const PRINTED_HEX_GRIDS: Partial<Record<PublishedFrameId, HexGrid>> = {
  /**
   * 3400 × 2228 art, "1 hex = approx. 24 miles". Flat-topped hexes 49.2 px
   * corner to corner; the art is a hair taller than regular hexes (sizeY), which
   * adds up to ~1.8 px over the map's height. Hex (0, 0) is the cut-off hex in
   * the top-left corner.
   */
  "journey-to-horizon": { originX: 1.98, originY: 6.05, size: 24.612, sizeY: 24.592, orientation: "flat" },
};

/** The grid printed on a frame's own map art, or null when that art has none. */
export function printedHexGrid(frameId: string): HexGrid | null {
  return (PRINTED_HEX_GRIDS as Record<string, HexGrid | undefined>)[frameId] ?? null;
}

/**
 * The calibration every hex crawl started with before the printed grid was
 * measured (larger than the printed hexes and off their grid). Stored crawls
 * still on it are moved to the printed grid by `migrations/worldHex`.
 */
export const LEGACY_DEFAULT_GRID: HexGrid = { originX: 0, originY: 0, size: 33, orientation: "flat" };
