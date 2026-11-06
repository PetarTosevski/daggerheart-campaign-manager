// Hex-shaped World map markers (dcm-kggd): on a map with a hex grid every
// marker, the party's included, is a hex of the grid sitting exactly on the
// hex that holds it. Several in one hex share it as a flower of seven
// third-size hexes (the centre, then the six around it), which tiles the hex
// exactly; past seven, the rest stack on the centre with a count. Positions
// and sizes are percentages of the map image, so they hold at every zoom.

import { hexBox, hexKey, hexToPixel, pixelToHex, type Hex, type HexGrid } from "./hex";

/** Most markers one hex shows side by side; the rest stack on its centre. */
export const HEX_SLOTS = 7;

export type HexTokenItem = { key: string; x: number; y: number };
export type HexTokenPlace = {
  /** Centre, in percent of the map image. */
  x: number;
  y: number;
  /** Bounding box, in percent of the map image's width and height. */
  width: number;
  height: number;
  hex: Hex;
  /** 0 = the hex's centre (the whole hex when alone), 1–6 = around it. */
  slot: number;
  /** Shares its hex with other markers (drawn third-size; its name shows in the marker list, not on the map). */
  shared: boolean;
  /** Markers stacked on this one's slot beyond the first (shown as "+n" on the top one). */
  stacked: number;
};

const SQRT3 = Math.sqrt(3);

/** The offset (image pixels) of flower slot `slot` from the hex centre, for sub-hexes of a third the size. */
function slotOffset(slot: number, grid: HexGrid): { dx: number; dy: number } {
  if (slot === 0) return { dx: 0, dy: 0 };
  // Neighbouring sub-hexes sit across their edges: flat tops at 30° + 60°k, pointy tops at 60°k.
  const deg = (grid.orientation === "flat" ? -90 : -60) + 60 * (slot - 1);
  const a = (deg * Math.PI) / 180;
  const sizeY = grid.sizeY ?? grid.size;
  // Centre to centre across an edge: √3 × the sub-hex radius (a third of the hex's).
  return { dx: (SQRT3 * grid.size * Math.cos(a)) / 3, dy: (SQRT3 * sizeY * Math.sin(a)) / 3 };
}

/**
 * Where each marker is drawn: grouped by the hex holding its point, in the
 * order given (put the party first so it keeps the centre).
 */
export function layoutHexTokens(items: readonly HexTokenItem[], grid: HexGrid, image: { width: number; height: number }): Map<string, HexTokenPlace> {
  const groups = new Map<string, { hex: Hex; keys: string[] }>();
  for (const it of items) {
    const hex = pixelToHex((it.x / 100) * image.width, (it.y / 100) * image.height, grid);
    const k = hexKey(hex);
    const g = groups.get(k);
    if (g) g.keys.push(it.key);
    else groups.set(k, { hex, keys: [it.key] });
  }
  const full = hexBox(grid);
  const out = new Map<string, HexTokenPlace>();
  for (const { hex, keys } of groups.values()) {
    const c = hexToPixel(hex, grid);
    const alone = keys.length === 1;
    const k = alone ? 1 : 1 / 3;
    const width = ((full.width * k) / image.width) * 100;
    const height = ((full.height * k) / image.height) * 100;
    const overflow = Math.max(0, keys.length - HEX_SLOTS);
    keys.forEach((key, i) => {
      // Past the seventh, markers stack on the centre under the first (its slot keeps the count).
      const slot = alone ? 0 : i < HEX_SLOTS ? i : 0;
      const { dx, dy } = alone ? { dx: 0, dy: 0 } : slotOffset(slot, grid);
      out.set(key, {
        x: ((c.x + dx) / image.width) * 100,
        y: ((c.y + dy) / image.height) * 100,
        width,
        height,
        hex,
        slot,
        shared: !alone,
        stacked: i === 0 ? overflow : 0,
      });
    });
  }
  return out;
}

/** The hex outline (SVG points) in a `width` × `height` box: flat or pointy top. */
export function hexPoints(orientation: HexGrid["orientation"], width: number, height: number, inset = 0): string {
  const rx = width / 2 - inset;
  const ry = height / 2 - inset;
  const cx = width / 2;
  const cy = height / 2;
  // Flat: corners at 0°, 60°…; across the flats the box is √3/2 of the corner-to-corner span.
  const pts =
    orientation === "flat"
      ? [0, 60, 120, 180, 240, 300].map((d) => [cx + rx * Math.cos((d * Math.PI) / 180), cy + (ry / (SQRT3 / 2)) * Math.sin((d * Math.PI) / 180)])
      : [30, 90, 150, 210, 270, 330].map((d) => [cx + (rx / (SQRT3 / 2)) * Math.cos((d * Math.PI) / 180), cy + ry * Math.sin((d * Math.PI) / 180)]);
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}
