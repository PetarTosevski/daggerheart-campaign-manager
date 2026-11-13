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

let hiRes: Map<string, { url: string; w: number; h: number }> | undefined;

/**
 * The @2x sibling of a built-in file's URL (plan sharp-4k HD3) and the 1x pixel size, or null (not a built-in URL, or
 * no @2x file). The URL map is built on the first call (dcm-uh6r).
 */
export function builtinHiRes(url: string): { url: string; w: number; h: number } | null {
  if (!hiRes) {
    hiRes = new Map();
    for (const sprites of Object.values(builtinManifest().folders)) {
      for (const sprite of sprites) {
        for (const f of [sprite, ...sprite.variants]) {
          if (f.file2x) hiRes.set(builtinSpriteUrl(f), { url: BUILTIN_SPRITE_BASE + f.file2x, w: f.px.w, h: f.px.h });
        }
      }
    }
  }
  return hiRes.get(url) ?? null;
}
