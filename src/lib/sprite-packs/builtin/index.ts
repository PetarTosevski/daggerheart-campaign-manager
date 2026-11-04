/**
 * The built-in sprite packs (tracer P4): the generated manifest joined with
 * the catalog, and the static URL of a cut file. Framework-free (CH6).
 */

import { createSpriteLookup, type ManifestFile, type SpriteLookup } from "../manifest";
import { builtinManifest } from "./manifest";

export { builtinManifest };

/** Where public/sprite-packs is served (immutable cache headers in next.config.ts, D8). */
export const BUILTIN_SPRITE_BASE = "/sprite-packs/";

/** Catalog entry + cut art for every built-in key. */
export const BUILTIN_LOOKUP: SpriteLookup = createSpriteLookup(builtinManifest);

/** The URL of a built-in sprite file (`forest/oak-tree.1a2b3c4d.webp` -> `/sprite-packs/forest/oak-tree.1a2b3c4d.webp`). */
export function builtinSpriteUrl(file: ManifestFile | string): string {
  return BUILTIN_SPRITE_BASE + (typeof file === "string" ? file : file.file);
}
