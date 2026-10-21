/**
 * The committed built-in sprite packs (tracer P4): the generated manifest is
 * valid, matches the catalog and the files under public/sprite-packs, and the
 * files stay within the size budgets. Raw sheets are never tracked.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BUILTIN_LOOKUP, BUILTIN_MANIFEST, builtinSpriteUrl } from "../../src/lib/sprite-packs/builtin";
import { CATALOG_ENTRIES } from "../../src/lib/sprite-packs/catalog";
import { builtinManifestSchema, type ManifestFile } from "../../src/lib/sprite-packs/manifest";

const ROOT = resolve(__dirname, "../..");
const PUBLIC = join(ROOT, "public/sprite-packs");
const KB = 1024;
const OBJECT_BUDGET = 80 * KB;
const TEXTURE_BUDGET = 200 * KB;
const TOTAL_BUDGET = 24 * KB * KB;
const SPRITE_PX_PER_SQUARE = 160;
const TEXTURE_PX = 512;

/** Catalog items with no cut; must match the "Missing" list in docs/tasks/TASK-SP-P4.md (none today). */
const KNOWN_MISSING: readonly string[] = [];

const sprites = Object.values(BUILTIN_MANIFEST.folders).flat();
const allFiles: ManifestFile[] = sprites.flatMap((s) => [s, ...s.variants]);

/** Canvas size of a WebP file (VP8X, VP8 or VP8L header). */
function webpSize(buf: Buffer): { w: number; h: number } {
  expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buf.toString("ascii", 8, 12)).toBe("WEBP");
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`unknown WebP chunk ${chunk}`);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("built-in sprite manifest", () => {
  it("passes the P1 schema and every key is a catalog key", () => {
    expect(() => builtinManifestSchema.parse(BUILTIN_MANIFEST)).not.toThrow();
    expect(BUILTIN_LOOKUP.unknownKeys).toEqual([]);
  });

  it("has a file for every catalog item (or lists it as known missing)", () => {
    const have = new Set(sprites.map((s) => s.key));
    const missing = CATALOG_ENTRIES.filter((e) => !have.has(e.key)).map((e) => e.key);
    expect(missing).toEqual(KNOWN_MISSING);
    for (const e of CATALOG_ENTRIES) if (have.has(e.key)) expect(BUILTIN_LOOKUP.get(e.key)?.art).not.toBeNull();
  });

  it("keeps catalog order within each folder", () => {
    const order = new Map(CATALOG_ENTRIES.map((e, i) => [e.key, i]));
    for (const list of Object.values(BUILTIN_MANIFEST.folders)) {
      const idx = list.map((s) => order.get(s.key) ?? -1);
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
  });

  it("names content-hashed files in the sprite's folder", () => {
    for (const s of sprites)
      for (const f of [s, ...s.variants]) {
        const [folder, slug] = s.key.split("/");
        expect(f.file).toMatch(new RegExp(`^${folder}/${slug}(-v\\d+)?\\.[0-9a-f]{8}\\.webp$`));
      }
    expect(builtinSpriteUrl(sprites[0]!)).toBe(`/sprite-packs/${sprites[0]!.file}`);
  });

  it("gives textures a seam score and objects none", () => {
    for (const s of sprites) {
      const entry = BUILTIN_LOOKUP.get(s.key)!.entry;
      if (entry.category === "texture") expect(s.seam).toBeGreaterThanOrEqual(0);
      else expect(s.seam).toBeUndefined();
    }
  });
});

describe("public/sprite-packs", () => {
  it("every manifest file exists, has the recorded size and fits its budget", () => {
    for (const s of sprites) {
      const entry = BUILTIN_LOOKUP.get(s.key)!.entry;
      for (const f of [s, ...s.variants]) {
        const path = join(PUBLIC, f.file);
        expect(existsSync(path), f.file).toBe(true);
        const buf = readFileSync(path);
        expect(webpSize(buf), f.file).toEqual(f.px);
        if (entry.category === "texture") {
          expect(buf.length, f.file).toBeLessThanOrEqual(TEXTURE_BUDGET);
          expect(f.px).toEqual({ w: TEXTURE_PX, h: TEXTURE_PX });
        } else {
          expect(buf.length, f.file).toBeLessThanOrEqual(OBJECT_BUDGET);
          // Fits the item's squares at SPRITE_PX_PER_SQUARE, touching at least one side (D4).
          const bw = entry.w * SPRITE_PX_PER_SQUARE;
          const bh = entry.h * SPRITE_PX_PER_SQUARE;
          expect(f.px.w <= bw && f.px.h <= bh, f.file).toBe(true);
          expect(f.px.w === bw || f.px.h === bh, f.file).toBe(true);
        }
      }
    }
  });

  it("holds only referenced files, within the total budget", () => {
    const referenced = new Set(allFiles.map((f) => f.file));
    const onDisk = walk(PUBLIC).map((p) => p.slice(PUBLIC.length + 1).split("\\").join("/"));
    expect(onDisk.filter((f) => !referenced.has(f))).toEqual([]);
    expect(onDisk.length).toBe(referenced.size);
    const total = walk(PUBLIC).reduce((n, p) => n + statSync(p).size, 0);
    expect(total).toBeLessThanOrEqual(TOTAL_BUDGET);
  });

  it("never tracks a raw sheet under sprite-sheets/", () => {
    const tracked = execFileSync("git", ["ls-files", "sprite-sheets"], { cwd: ROOT, encoding: "utf8" }).trim();
    expect(tracked).toBe("");
  });
});
