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
import { CATALOG, CATALOG_ENTRIES } from "../../src/lib/sprite-packs/catalog";
import { builtinManifestSchema, type ManifestFile } from "../../src/lib/sprite-packs/manifest";
import { activeOverride, loadOverrides } from "../../scripts/sprite-packs/lib/overrides";
import { stripMagentaFrame, untint } from "../../scripts/sprite-packs/lib/pipeline";

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

describe("the village extra sheet (tracer P4V)", () => {
  it("holds nine sprites from town-street-and-market/large-2", () => {
    const village = CATALOG_ENTRIES.filter((e) => e.extraSheet === "large-2" && e.key.startsWith("town-street-and-market/")).map((e) => e.key);
    expect(village).toHaveLength(9);
    for (const key of village) expect(BUILTIN_LOOKUP.get(key)?.art, key).not.toBeNull();
  });

  it("untint turns rose pixels inside its areas warm grey-brown and leaves brown wood and everything outside alone", () => {
    const px = (rgba: number[][]) => ({ width: rgba.length, height: 1, data: new Uint8ClampedArray(rgba.flat()) });
    const rose = [177, 110, 102, 255];
    const wood = [150, 110, 70, 255];
    const out = untint(px([rose, wood, rose, rose]), [[0, 0, 0.75, 1]]);
    const [r = 0, g = 0, b = 0, a = 0] = out.data.slice(0, 4);
    expect(r - g).toBeLessThan(25);
    expect(b).toBeLessThan(g);
    expect(a).toBe(255);
    expect([...out.data.slice(4, 8)]).toEqual(wood);
    expect([...out.data.slice(12, 16)]).toEqual(rose);
  });
});

describe("batch 2 (tracer P11Z)", () => {
  it("holds 1169 sprites: 580 primary, the village's 9 and batch 2's 580 (props-2, large-2 / large-3, terrain-2)", () => {
    expect(sprites).toHaveLength(1169);
    const batch2 = CATALOG_ENTRIES.filter(
      (e) => e.extraSheet !== undefined && !(e.extraSheet === "large-2" && e.key.startsWith("town-street-and-market/")),
    );
    expect(batch2).toHaveLength(580);
    for (const e of batch2) expect(BUILTIN_LOOKUP.get(e.key)?.art, e.key).not.toBeNull();
  });

  it("every overrides.json sheet is a sheet the catalog draws, and every index is in range", () => {
    const overrides = loadOverrides(join(ROOT, "scripts/sprite-packs/overrides.json"));
    for (const [id, raw] of Object.entries(overrides.sheets)) {
      const [folder = "", sheetId = ""] = id.split("/");
      const sheet = sheetId.replace(/-.*$/, "") as "props" | "large" | "terrain";
      const entries = CATALOG[folder as keyof typeof CATALOG][sheet].filter((e) => (e.extraSheet ?? sheet) === sheetId);
      expect(entries.length, id).toBeGreaterThan(0);
      for (const ov of Array.isArray(raw) ? raw : [raw]) {
        const n = ov.when?.found ?? entries.length;
        const indices = [
          ...(ov.unpink ?? []),
          ...(ov.unmix ?? []),
          ...(ov.skip ?? []),
          ...(ov.order ?? []),
          ...Object.keys(ov.untint ?? {}).map(Number),
          ...Object.keys(ov.rotate ?? {}).map(Number),
          ...Object.keys(ov.variants ?? {}).map(Number),
        ];
        for (const i of indices) expect(i, `${id} #${i + 1}`).toBeLessThan(n);
        if (ov.order) expect([...ov.order].sort((a, b) => a - b), id).toEqual(Array.from({ length: entries.length }, (_, i) => i));
      }
    }
    // The town's current large-3 is drawn tannery, canal, gallows (the catalog lists gallows before the canal): the
    // order fix applies to that file only (its SHA-256), so a sheet regenerated in catalog order is not reordered.
    const town = (sha256?: string) => activeOverride(overrides, "town-street-and-market/large-3", 9, sha256);
    expect(town("93c09597b2743fbe0b730f1b05737f7932e0a70628eff08d78f66b74d3eb6c5d").active).toMatchObject({ order: [0, 1, 2, 3, 4, 5, 6, 8, 7], unpink: [7] });
    const regenerated = town("0123456789abcdef");
    expect(regenerated.active.order).toBeUndefined();
    expect(regenerated.active.unpink).toBeUndefined();
    expect(Object.keys(regenerated.active.untint ?? {})).toEqual(["4", "5"]);
    expect(regenerated.notes[0]).toMatch(/^override inactive: written for the sheet file 93c09597b2743fbe/);
  });

  it("stripMagentaFrame cuts a plain magenta outer frame away and leaves a white frame (cutTerrain's job) alone", () => {
    const MAGENTA = [255, 0, 255, 255];
    const GRASS = [70, 130, 50, 255];
    const WHITE = [250, 250, 250, 255];
    const sheet = (size: number, frame: number, frameColour: number[]) => {
      const data = new Uint8ClampedArray(size * size * 4);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const inFrame = x < frame || y < frame || x >= size - frame || y >= size - frame;
          data.set(inFrame ? frameColour : GRASS, (y * size + x) * 4);
        }
      return { width: size, height: size, data };
    };
    const { image, frame } = stripMagentaFrame(sheet(100, 8, MAGENTA));
    expect(frame).toEqual({ top: 8, bottom: 8, left: 8, right: 8 });
    expect([image.width, image.height]).toEqual([84, 84]);
    expect([...image.data.slice(0, 4)]).toEqual(GRASS);
    // The swatches' magenta cross (a thin line through the middle) is not a frame.
    const crossed = sheet(100, 0, MAGENTA);
    for (let i = 0; i < 100; i++) crossed.data.set(MAGENTA, (50 * 100 + i) * 4);
    expect(stripMagentaFrame(crossed).image).toBe(crossed);
    const white = sheet(100, 8, WHITE);
    expect(stripMagentaFrame(white).image).toBe(white);
  });
});
