/**
 * The generated built-in manifest (P4 writes src/lib/sprite-packs/builtin/
 * manifest.ts): which cut file each catalog key has, its pixel size, extra
 * cut variants (D8) and, for textures, the seam score (D6). Traits are not in
 * it; they come from the hand-curated catalog, joined by `createSpriteLookup`.
 */

import { z } from "zod";

import { catalogEntry, folderOfKey, type CatalogEntry } from "./catalog";

export const MANIFEST_SCHEMA_VERSION = 1;

const pxSchema = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

/** One cut, content-hashed WebP under public/sprite-packs (D8). */
export const manifestFileSchema = z.object({
  /** Path relative to /sprite-packs/, e.g. `forest/oak-tree.1a2b3c4d.webp`. */
  file: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+(\.[a-z0-9]+)?\.(webp|png)$/),
  px: pxSchema,
});
export type ManifestFile = z.infer<typeof manifestFileSchema>;

export const manifestSpriteSchema = manifestFileSchema.extend({
  /** Catalog key `<folder>/<slug>` (D8). */
  key: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/),
  /** Further cuts of the same item (variant 2, 3, ...), mixed like terrain variants. */
  variants: z.array(manifestFileSchema).default([]),
  /** Textures: tileability after the seam fix, 0 (bad) .. 1 (seamless). */
  seam: z.number().min(0).max(1).optional(),
});
export type ManifestSprite = z.infer<typeof manifestSpriteSchema>;

export const builtinManifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    /** Per folder (the 19 settings and common), the cut sprites. */
    folders: z.record(z.string().regex(/^[a-z0-9-]+$/), z.array(manifestSpriteSchema)),
  })
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    for (const [folder, sprites] of Object.entries(manifest.folders)) {
      sprites.forEach((sprite, i) => {
        if (folderOfKey(sprite.key) !== folder) {
          ctx.addIssue({ code: "custom", path: ["folders", folder, i, "key"], message: `key not in folder ${folder}` });
        }
        if (seen.has(sprite.key)) {
          ctx.addIssue({ code: "custom", path: ["folders", folder, i, "key"], message: "duplicate key" });
        }
        seen.add(sprite.key);
      });
    }
  });
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

/** Joins a parsed manifest with the catalog. */
export function createSpriteLookup(manifest: BuiltinManifest): SpriteLookup {
  const art = new Map<string, ManifestSprite>();
  const unknownKeys: string[] = [];
  for (const sprites of Object.values(manifest.folders)) {
    for (const sprite of sprites) {
      if (catalogEntry(sprite.key)) art.set(sprite.key, sprite);
      else unknownKeys.push(sprite.key);
    }
  }
  return {
    get: (key) => {
      const entry = catalogEntry(key);
      return entry ? { entry, art: art.get(key) ?? null } : null;
    },
    unknownKeys,
  };
}
