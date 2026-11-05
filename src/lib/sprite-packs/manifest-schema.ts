/**
 * The zod schemas of the generated built-in manifest (P4). Split out of `./manifest` (dcm-uh6r): only the pack build
 * script and the tests parse a manifest, so the Convex functions that resolve sprites do not build these schemas on
 * every call. `./index` re-exports them.
 */
import * as z from "../zod";

import { folderOfKey } from "./catalog";
import { MANIFEST_SCHEMA_VERSION } from "./manifest";

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

export const manifestSpriteSchema = manifestFileSchema.extend({
  /** Catalog key `<folder>/<slug>` (D8). */
  key: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/),
  /** Further cuts of the same item (variant 2, 3, ...), mixed like terrain variants. */
  variants: z.array(manifestFileSchema).default([]),
  /** Textures: tileability after the seam fix, 0 (bad) .. 1 (seamless). */
  seam: z.number().min(0).max(1).optional(),
});

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
