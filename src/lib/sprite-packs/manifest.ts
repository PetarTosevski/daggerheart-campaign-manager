/**
 * The generated built-in manifest (P4 writes src/lib/sprite-packs/builtin/
 * manifest.ts): which cut file each catalog key has, its pixel size, extra
 * cut variants (D8) and, for textures, the seam score (D6). Traits are not in
 * it; they come from the hand-curated catalog, joined by `createSpriteLookup`.
 */

import type { z } from "zod";

import { catalogEntry, type CatalogEntry } from "./catalog";
import type { builtinManifestSchema, manifestFileSchema, manifestSpriteSchema } from "./manifest-schema";

export const MANIFEST_SCHEMA_VERSION = 1;

export type ManifestFile = z.infer<typeof manifestFileSchema>;
export type ManifestSprite = z.infer<typeof manifestSpriteSchema>;
export type BuiltinManifest = z.infer<typeof builtinManifestSchema>;

/** A valid manifest with no sprites (before P4 has run). */
export const EMPTY_MANIFEST: BuiltinManifest = { schemaVersion: MANIFEST_SCHEMA_VERSION, folders: {} };

/** A catalog entry with its cut art, or `art: null` when the manifest has no file for it yet. */
export type ResolvedSprite = {
  readonly entry: CatalogEntry;
  readonly art: ManifestSprite | null;
};

export type SpriteLookup = {
  /** The catalog entry and art for a built-in key; null for a key the catalog does not know. */
  readonly get: (key: string) => ResolvedSprite | null;
  /** Manifest keys the catalog does not know (P4's test reports them). */
  readonly unknownKeys: readonly string[];
};

/**
 * Joins a parsed manifest with the catalog; the join is built on the first read (dcm-uh6r). `manifest` may be a function,
 * called on that first read, so a lazily built manifest (the built-in one) is not built before a sprite is looked up.
 */
export function createSpriteLookup(manifest: BuiltinManifest | (() => BuiltinManifest)): SpriteLookup {
  let joined: { art: Map<string, ManifestSprite>; unknownKeys: string[] } | undefined;
  const join = () => {
    if (joined) return joined;
    const art = new Map<string, ManifestSprite>();
    const unknownKeys: string[] = [];
    for (const sprites of Object.values((typeof manifest === "function" ? manifest() : manifest).folders)) {
      for (const sprite of sprites) {
        if (catalogEntry(sprite.key)) art.set(sprite.key, sprite);
        else unknownKeys.push(sprite.key);
      }
    }
    joined = { art, unknownKeys };
    return joined;
  };
  return {
    get: (key) => {
      const entry = catalogEntry(key);
      return entry ? { entry, art: join().art.get(key) ?? null } : null;
    },
    get unknownKeys() {
      return join().unknownKeys;
    },
  };
}
