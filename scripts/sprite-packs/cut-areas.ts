/**
 * pnpm sprites:areas [--src <dir>] [--out <dir>] [--dry]
 *
 * Cuts the six area-effect sheets (<src>/{fills-1..4,decals,walls}.jpg, magenta background;
 * docs/sprite-packs/area-effects-prompts.md) and writes public/area-effects/<kind>.<hash>.webp plus the generated
 * src/lib/combat-map/area-effects/manifest.ts. --dry writes nothing into the repo, only PNG previews to --out
 * (default sprite-sheets/_out/area-effects, git-ignored). The raw sheets are never committed.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { AREA_SHEETS, type AreaSheet } from "../../src/lib/combat-map/area-effects/kinds";
import { areaManifest, cutAreaSheet, decodeFile, encodeArea, type AreaCut, type EncodedArea } from "./lib/areas";
import { areaManifestSource } from "./lib/areas-manifest";
import { png } from "./lib/encode";
import { REPO_ROOT } from "./lib/options";

const DEFAULT_SRC = "/mnt/c/Users/Petar/sprite-sheets/area-effects";
const PUBLIC_DIR = resolve(REPO_ROOT, "public/area-effects");
const MANIFEST_FILE = resolve(REPO_ROOT, "src/lib/combat-map/area-effects/manifest.ts");
const EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

function parse(argv: readonly string[]) {
  let src = DEFAULT_SRC;
  let out = resolve(REPO_ROOT, "sprite-sheets/_out/area-effects");
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--src") src = resolve(value());
    else if (arg === "--out") out = resolve(value());
    else if (arg === "--dry") dry = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: pnpm sprites:areas [--src <dir>] [--out <dir>] [--dry]");
      process.exit(0);
    } else throw new Error(`unknown argument ${arg}`);
  }
  return { src, out, dry };
}

function sheetFile(src: string, sheet: AreaSheet): string | null {
  for (const ext of EXTENSIONS) {
    const file = join(src, `${sheet}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

const opts = parse(process.argv.slice(2));
const started = Date.now();
const cuts: AreaCut[] = [];
for (const sheet of AREA_SHEETS) {
  const file = sheetFile(opts.src, sheet);
  if (file === null) {
    console.log(`  ${sheet}: missing (skipped)`);
    continue;
  }
  const got = await cutAreaSheet({ sheet, image: await decodeFile(file) });
  for (const c of got) console.log(`  ${sheet} -> ${c.kind} ${c.image.width}x${c.image.height}${c.notes.length ? ` (${c.notes.join("; ")})` : ""}`);
  cuts.push(...got);
}
const encoded: EncodedArea[] = [];
for (const c of cuts) encoded.push(await encodeArea(c));

if (opts.dry) {
  mkdirSync(opts.out, { recursive: true });
  for (const e of encoded) writeFileSync(join(opts.out, `${e.cut.kind}.png`), await png(e.cut.image));
  console.log(`previews: ${opts.out}`);
} else {
  mkdirSync(PUBLIC_DIR, { recursive: true });
  for (const name of readdirSync(PUBLIC_DIR)) if (name.endsWith(".webp")) rmSync(join(PUBLIC_DIR, name));
  for (const e of encoded) writeFileSync(join(PUBLIC_DIR, e.file), e.bytes);
  writeFileSync(MANIFEST_FILE, areaManifestSource(areaManifest(encoded)));
  const total = encoded.reduce((n, e) => n + e.bytes.length, 0);
  console.log(`wrote ${encoded.length} files (${Math.round(total / 1024)} KB) to public/area-effects and the manifest`);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
