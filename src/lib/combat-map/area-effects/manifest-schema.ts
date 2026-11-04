/**
 * The shape of the generated area-effect manifest (manifest.ts, written by `pnpm sprites:areas`,
 * scripts/sprite-packs/cut-areas.ts): per kind, its content-hashed file under public/area-effects/ and its pixel size.
 * A kind missing from it draws with `generic` (and without `generic`, as a plain tint).
 */

import type { AreaKind } from "./kinds";

export type AreaManifestEntry = {
  /** File name under /area-effects/, e.g. `darkness.1a2b3c4d.webp`. */
  file: string;
  px: { w: number; h: number };
};

export type AreaManifest = {
  schemaVersion: 1;
  kinds: Partial<Record<AreaKind, AreaManifestEntry>>;
};

/** The public folder the files are served from. */
export const AREA_EFFECTS_PATH = "/area-effects/";

/** A file name the manifest may hold (`<kind>.<hash8>.webp`). */
export const AREA_FILE = /^[a-z0-9-]+\.[0-9a-f]{8}\.webp$/;
