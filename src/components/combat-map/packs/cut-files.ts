/**
 * Cutting dropped images for the upload screen (sprite packs P8, D9): runs the pure cut core on each image with
 * the chosen sheet layout and words its flags for the GM. Pure (no DOM): the canvas glue is in browser-image.ts.
 */

import { cutSheet, cutTerrain, seamFix, type CutFlag, type RgbaImage, type TerrainFlag } from "../../../lib/sprite-packs/cut";
import { SHEET_LAYOUT_INFO, type SheetLayout } from "./labels";

export type CutPiece = { image: RgbaImage; source: string };

export type CutOutcome = {
  /** The layout the cuts were made with ("auto" resolved to props, large or single). */
  layout: Exclude<SheetLayout, "auto">;
  pieces: CutPiece[];
  /** What the cutter had to fix or could not decide, worded for the GM. */
  notes: string[];
};

function objectNotes(source: string, flags: readonly CutFlag[]): string[] {
  const notes: string[] = [];
  for (const flag of flags) {
    if (flag.code === "count-mismatch") notes.push(`${source}: found ${flag.found} sprites where the layout expects ${flag.expected}.`);
    else if (flag.code === "touches-border") notes.push(`${source}: sprite ${flag.index + 1} touches the edge of the sheet and may be clipped.`);
    else if (flag.code === "lines-removed") notes.push(`${source}: drawn grid lines were removed.`);
    else if (flag.code === "empty") notes.push(`${source}: no sprites found.`);
  }
  return notes;
}

function terrainNotes(source: string, flags: readonly TerrainFlag[]): string[] {
  return flags.map((flag) =>
    flag.code === "no-cross"
      ? `${source}: no magenta divider found; the sheet was split down the middle.`
      : flag.code === "uneven-swatches"
        ? `${source}: the four swatches differ in size.`
        : `${source}: swatch ${flag.index + 1} still shows magenta.`,
  );
}

/** One image cut with a fixed layout. */
function cutOne(img: RgbaImage, source: string, layout: Exclude<SheetLayout, "auto">): { pieces: CutPiece[]; notes: string[]; matches: boolean } {
  if (layout === "terrain") {
    const cut = cutTerrain(img);
    return { pieces: cut.swatches.map((s) => ({ image: seamFix(s.image), source })), notes: terrainNotes(source, cut.flags), matches: cut.flags.length === 0 };
  }
  const cut = cutSheet(img, { layout });
  const matches = !cut.flags.some((f) => f.code === "count-mismatch" || f.code === "empty");
  return { pieces: cut.sprites.map((s) => ({ image: s.image, source })), notes: objectNotes(source, cut.flags), matches };
}

/**
 * Cuts every image with `layout`. "auto" reads each sheet as props (4 x 4), else large (3 x 3) when that count
 * matches, else as one single sprite; terrain sheets are never guessed (pick "Terrain 2 × 2").
 */
export function cutImages(images: readonly { image: RgbaImage; source: string }[], layout: SheetLayout): CutOutcome[] {
  return images.map(({ image, source }) => {
    if (layout !== "auto") {
      const { pieces, notes } = cutOne(image, source, layout);
      return { layout, pieces, notes };
    }
    for (const guess of ["props", "large"] as const) {
      const attempt = cutOne(image, source, guess);
      if (attempt.matches) return { layout: guess, pieces: attempt.pieces, notes: attempt.notes };
    }
    const single = cutOne(image, source, "single");
    return { layout: "single", pieces: single.pieces, notes: single.notes };
  });
}

export const layoutLabel = (layout: SheetLayout) => SHEET_LAYOUT_INFO[layout].label;
