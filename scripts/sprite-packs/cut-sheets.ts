/**
 * pnpm sprites:cut [--src <dir>] [--setting <folder>]... [--out <dir>]
 *
 * Cuts the sheets, labels the cuts from the catalog, applies overrides.json
 * and writes candidates, manifest-draft.json, contact sheets and report.html
 * to sprite-sheets/_out/ (git-ignored). Nothing in the repo changes; run
 * `pnpm sprites:build` with the same arguments to write the pack.
 */

import { parseOptions } from "./lib/options";
import { run } from "./lib/run";

await run(parseOptions(process.argv.slice(2)), "cut");
