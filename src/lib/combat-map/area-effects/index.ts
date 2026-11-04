/**
 * Area-effect art for the map overlay (plan lanes-2 wave 9, AO; dcm-lqnt): an area's label -> its kind -> the file to
 * draw and how. A kind without a cut file draws as `generic`; without that too, as a plain tint (`url: null`).
 */

import { areaKindOf, isWallKind, kindStyle, type AreaKind, type KindStyle } from "./kinds";
import { AREA_MANIFEST } from "./manifest";
import { AREA_EFFECTS_PATH, type AreaManifest } from "./manifest-schema";

export * from "./kinds";
export { AREA_MANIFEST } from "./manifest";
export { AREA_EFFECTS_PATH, AREA_FILE } from "./manifest-schema";
export type { AreaManifest, AreaManifestEntry } from "./manifest-schema";

/** Squares one fill tile covers (a 512 px swatch every 4 squares: big enough that the repeat is hard to see). */
export const FILL_TILE_SQUARES = 4;

export type AreaArt = KindStyle & {
  /** The kind the label asked for. */
  kind: AreaKind;
  /** The kind actually drawn (`generic` when `kind` has no file). */
  drawn: AreaKind;
  /** The file's URL, or null when not even `generic` was cut. */
  url: string | null;
  px: { w: number; h: number } | null;
};

/** The art an area draws with. A wall whose kind has no wall art draws with no image (a plain line, `mode: "wall"`). */
export function areaArt(label: string, shape: "circle" | "wall", manifest: AreaManifest = AREA_MANIFEST): AreaArt {
  const kind = areaKindOf(label, shape);
  const own = manifest.kinds[kind];
  if (own && isWallKind(kind) === (shape === "wall")) return { kind, drawn: kind, url: AREA_EFFECTS_PATH + own.file, px: own.px, ...kindStyle(kind) };
  if (shape === "wall") return { kind, drawn: kind, url: null, px: null, mode: "wall", opacity: 1 };
  const generic = manifest.kinds.generic;
  return { kind, drawn: "generic", url: generic ? AREA_EFFECTS_PATH + generic.file : null, px: generic?.px ?? null, ...kindStyle("generic") };
}
