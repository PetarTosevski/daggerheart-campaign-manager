/**
 * Sprite cut core (sprite packs P2): pure TypeScript over RGBA buffers, shared
 * by the offline script (P4, sharp) and the browser upload (P8, canvas
 * ImageData). No Node or DOM imports anywhere in this folder.
 */

export { SHEET_GRIDS } from "./types";
export type { Box, CutFlag, FringeScore, RgbaImage, SheetCut, SheetGrid, SheetKind, SpriteCut } from "./types";
export { cutSheet } from "./sheet";
export type { CutOptions } from "./sheet";
export { defringe, keyMagenta, magentaScore } from "./key";
export { removeGridLines } from "./lines";
export { findCells, labelComponents } from "./cells";
export { TRIM_MARGIN, trimToAlpha } from "./trim";
export { cutTerrain, seamFix, tileability } from "./terrain";
export type { TerrainCut, TerrainFlag, TerrainSwatch } from "./terrain";
