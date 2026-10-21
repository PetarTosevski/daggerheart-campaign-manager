/**
 * Command-line options shared by sprites:cut and sprites:build.
 *
 *   --src <dir>       where the sheets are (<dir>/<folder>/<props|large|terrain>.jpg); default: the user's copy
 *   --setting <id>    only this folder (repeatable; a setting id or "common")
 *   --out <dir>       review output (default sprite-sheets/_out, git-ignored)
 */

import { resolve } from "node:path";

import { CATALOG } from "../../../src/lib/sprite-packs/catalog";

export const DEFAULT_SRC = "/mnt/c/Users/Petar/sprite-sheets";
export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
export const DEFAULT_OUT = resolve(REPO_ROOT, "sprite-sheets/_out");
export const PUBLIC_DIR = resolve(REPO_ROOT, "public/sprite-packs");
export const MANIFEST_FILE = resolve(REPO_ROOT, "src/lib/sprite-packs/builtin/manifest.ts");
export const OVERRIDES_FILE = resolve(import.meta.dirname, "../overrides.json");

export type Options = {
  src: string;
  out: string;
  /** Folders to process, in catalog order. */
  folders: string[];
  /** True when --setting narrowed the run (build keeps the other folders). */
  partial: boolean;
};

export function parseOptions(argv: readonly string[]): Options {
  let src = DEFAULT_SRC;
  let out = DEFAULT_OUT;
  const picked: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (!v) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--src") src = resolve(value());
    else if (arg === "--out") out = resolve(value());
    else if (arg === "--setting") picked.push(value());
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: pnpm sprites:<cut|build> [--src <dir>] [--setting <folder>]... [--out <dir>]");
      process.exit(0);
    } else throw new Error(`unknown argument ${arg}`);
  }
  const all = Object.keys(CATALOG);
  for (const p of picked) if (!all.includes(p)) throw new Error(`unknown setting ${p} (one of ${all.join(", ")})`);
  return {
    src,
    out,
    folders: picked.length > 0 ? all.filter((f) => picked.includes(f)) : all,
    partial: picked.length > 0,
  };
}
