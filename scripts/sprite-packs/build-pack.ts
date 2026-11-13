/**
 * pnpm sprites:build [--src <dir>] [--setting <folder>]... [--out <dir>]
 *
 * Writes public/sprite-packs/<folder>/<slug>.<hash8>.webp (objects at
 * SPRITE_PX_PER_SQUARE per square side, textures TEXTURE_PX per swatch) and
 * src/lib/sprite-packs/builtin/manifest.ts, plus the review report. With
 * --setting only those folders are rebuilt; the other folders' files and
 * manifest entries are kept, and keys never change (D8).
 *
 * A rebuilt folder loses its @2x files (plan sharp-4k HD3): rerun
 * scripts/sprite-packs/upscale-2x.ts for it afterwards.
 */

import { parseOptions } from "./lib/options";
import { run } from "./lib/run";

await run(parseOptions(process.argv.slice(2)), "build");
