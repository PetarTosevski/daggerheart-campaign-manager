/**
 * node --import ./scripts/sprite-packs/ts-hooks.mjs scripts/sprite-packs/upscale-2x.ts --upscaler <exe>
 *   [--setting <folder>]... [--force] [--work <dir>] [--preview <dir>] [--model <name>] [--tile <px>]
 *
 * Plan sharp-4k, tracer HD3: writes an @2x sibling of every built-in sprite-pack file, upscaled 2x with Real-ESRGAN
 * (scripts/srd/upscale.mjs, realesr-animevideov3 by default, the model of the adversary art), and records it in the
 * generated manifest as `file2x`. The 1x files and every other manifest field stay as they are.
 *
 * - Objects keep a clean alpha edge: upscale.mjs bleeds the colour under transparent pixels, upscales the RGB only and
 *   resizes the alpha with lanczos3.
 * - Textures (catalog category "texture") must still tile. A tile upscaled on its own loses the wrap at its edges (the
 *   network sees no neighbour there), so each one is padded with PAD px taken from its opposite edges (a wrapped
 *   copy), upscaled, and the centre cropped back to exactly 2x. The seam score of every texture (wrap edge against
 *   the inside) is logged; --preview writes 2x2 wrap-around PNGs to check by eye.
 * - Names follow the pack build's hashing (encode.ts): `<folder>/<slug>@2x.<sha256 of the 2x bytes, 8 hex>.webp`.
 * - Per folder: one upscaler run, then its files and the manifest are written, so a stopped run resumes where it
 *   left off. Entries that already have an @2x file on disk are skipped unless --force.
 *
 * - --tile is the upscaler's -t (default 128: the auto size lost the Vulkan device on the Intel Arc 140T; 0 = auto).
 *
 * `pnpm sprites:build` rebuilds a folder without its @2x files; rerun this for that folder afterwards.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import sharp from "sharp";

import { CATALOG, catalogEntry } from "../../src/lib/sprite-packs/catalog";
import type { BuiltinManifest, ManifestFile } from "../../src/lib/sprite-packs/manifest";
import { builtinManifestSchema } from "../../src/lib/sprite-packs/manifest-schema";
// Plain ES module (shared with the SRD art scripts); its types are inferred from the JS.
import { upscaleAll, DEFAULT_MODEL } from "../srd/upscale.mjs";
import { manifestSource } from "./lib/encode";
import { MANIFEST_FILE, PUBLIC_DIR } from "./lib/options";
import { currentManifest } from "./lib/run";

/** Pixels taken from the opposite edges around a texture before it is upscaled (output: 2 * PAD cropped away). */
export const PAD = 64;

/**
 * WebP settings of the @2x files: the 1x settings (encode.ts), with four times the byte budget (four times the pixels),
 * except textures at q90. Lossy WebP leaves the image's outer blocks unfiltered, which puts a faint line on the wrap
 * edge; the upscaled tile is smoother inside than the 1x one, so at q80 that line stood out (seam score 1.03 raw ->
 * 2.22 encoded on castle-interior/blue-royal-carpet); q90 brings it to about 1.4 for under twice the bytes.
 */
const OBJECT_QUALITY = 82;
const TEXTURE_QUALITY = 90;
const OBJECT_BUDGET = 4 * 80 * 1024;
const TEXTURE_BUDGET = 4 * 200 * 1024;
const MIN_QUALITY = 40;

type Raw = { data: Buffer; info: { width: number; height: number; channels: number } };

type Options = { upscaler: string; folders: string[]; force: boolean; work: string; preview: string | null; model: string; tile: number };

function parse(argv: readonly string[]): Options {
  let upscaler = "";
  let force = false;
  let work = resolve("sprite-sheets/_out/upscale-2x");
  let preview: string | null = null;
  let model = DEFAULT_MODEL as string;
  let tile = 128;
  const picked: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (!v) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--upscaler") upscaler = resolve(value());
    else if (arg === "--setting") picked.push(value());
    else if (arg === "--force") force = true;
    else if (arg === "--work") work = resolve(value());
    else if (arg === "--preview") preview = resolve(value());
    else if (arg === "--model") model = value();
    else if (arg === "--tile") tile = Number(value());
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!upscaler) throw new Error("--upscaler <realesrgan-ncnn-vulkan(.exe)> is required");
  const all = Object.keys(CATALOG);
  for (const p of picked) if (!all.includes(p)) throw new Error(`unknown setting ${p}`);
  return { upscaler, folders: picked.length > 0 ? all.filter((f) => picked.includes(f)) : all, force, work, preview, model, tile };
}

/** The tile with PAD px of its opposite edges around it (a wrapped copy), as PNG. */
async function wrapPad(rgb: Raw): Promise<Buffer> {
  const { width: w, height: h } = rgb.info;
  const W = w + 2 * PAD;
  const H = h + 2 * PAD;
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    const sy = (((y - PAD) % h) + h) % h;
    for (let x = 0; x < W; x++) {
      const sx = (((x - PAD) % w) + w) % w;
      const s = (sy * w + sx) * 3;
      const d = (y * W + x) * 3;
      out[d] = rgb.data[s]!;
      out[d + 1] = rgb.data[s + 1]!;
      out[d + 2] = rgb.data[s + 2]!;
    }
  }
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

/**
 * How well an RGB image tiles: the mean colour step across its wrap edges (last column -> first, last row -> first)
 * over the mean step between neighbouring pixels inside. About 1 = no seam; well above 1 = a visible seam.
 */
export function seamRatio(data: Buffer | Uint8ClampedArray, w: number, h: number, channels: number): number {
  const step = (a: number, b: number) => {
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(data[a + c]! - data[b + c]!);
    return d;
  };
  let edge = 0;
  let inner = 0;
  for (let y = 0; y < h; y++) {
    edge += step((y * w + w - 1) * channels, y * w * channels);
    inner += step((y * w + (w >> 1) - 1) * channels, (y * w + (w >> 1)) * channels);
  }
  for (let x = 0; x < w; x++) {
    edge += step(((h - 1) * w + x) * channels, x * channels);
    inner += step((((h >> 1) - 1) * w + x) * channels, ((h >> 1) * w + x) * channels);
  }
  return inner === 0 ? (edge === 0 ? 1 : Infinity) : edge / inner;
}

async function encode(raw: Raw, texture: boolean, base: string): Promise<{ file: string; bytes: Buffer }> {
  const budget = texture ? TEXTURE_BUDGET : OBJECT_BUDGET;
  let quality = texture ? TEXTURE_QUALITY : OBJECT_QUALITY;
  for (;;) {
    const pipe = sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: 4 } });
    const bytes = await (texture
      ? pipe.removeAlpha().webp({ quality, effort: 6, smartSubsample: true })
      : pipe.webp({ quality, alphaQuality: 90, effort: 6, smartSubsample: true })
    ).toBuffer();
    if (bytes.length <= budget || quality <= MIN_QUALITY) {
      if (bytes.length > budget) throw new Error(`${base}: ${bytes.length} bytes over the ${budget} budget at q${quality}`);
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
      return { file: `${base}@2x.${hash}.webp`, bytes };
    }
    quality -= 6;
  }
}

/** Upscaler runs per folder before giving up: the Vulkan device is sometimes lost, or the tool hangs, mid-run. */
const ATTEMPTS = 4;
/** A folder (about 60 files) takes 10-30 s on the Intel Arc 140T; a run past this has hung and is killed and retried. */
const RUN_TIMEOUT_MS = 300_000;

async function upscaleWithRetries(items: Map<string, Buffer>, opts: Options, work: string): Promise<Map<string, Raw>> {
  for (let attempt = 1; ; attempt++) {
    try {
      // Each retry halves the tile (smaller GPU submissions lose the device less often), down to 32.
      const tile = opts.tile ? Math.max(32, opts.tile >> (attempt - 1)) : undefined;
      return (await upscaleAll(sharp, items, { exe: opts.upscaler, model: opts.model, work, tile, timeoutMs: RUN_TIMEOUT_MS })) as Map<string, Raw>;
    } catch (e) {
      if (attempt >= ATTEMPTS) throw e;
      console.error(`  upscaler failed (attempt ${attempt} of ${ATTEMPTS}): ${(e as Error).message}; retrying in 10 s`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const started = Date.now();
  const manifest: BuiltinManifest = await currentManifest();
  /** Seam scores: the 1x file, the 2x pixels before encoding, the encoded @2x file (what ships). */
  const seams: { file: string; before: number; raw: number; after: number }[] = [];
  let written = 0;
  let bytesWritten = 0;

  for (const folder of opts.folders) {
    const sprites = manifest.folders[folder];
    if (!sprites) continue;
    const t = Date.now();
    const files: { file: ManifestFile; texture: boolean }[] = [];
    for (const s of sprites) {
      const texture = catalogEntry(s.key)?.category === "texture";
      for (const f of [s, ...s.variants]) {
        if (!opts.force && f.file2x && existsSync(join(PUBLIC_DIR, f.file2x))) continue;
        files.push({ file: f, texture });
      }
    }
    if (files.length === 0) {
      console.log(`  ${folder}: nothing to do`);
      continue;
    }

    const items = new Map<string, Buffer>();
    for (const { file, texture } of files) {
      const src = readFileSync(join(PUBLIC_DIR, file.file));
      if (!texture) {
        items.set(file.file, await sharp(src).png().toBuffer());
        continue;
      }
      const rgb = (await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true })) as Raw;
      items.set(file.file, await wrapPad(rgb));
    }
    const work = join(opts.work, folder);
    const up = await upscaleWithRetries(items, opts, work);

    for (const { file, texture } of files) {
      let raw = up.get(file.file)!;
      const w = file.px.w * 2;
      const h = file.px.h * 2;
      if (texture) {
        const W = raw.info.width;
        const cropped = Buffer.alloc(w * h * 4);
        for (let y = 0; y < h; y++) raw.data.copy(cropped, y * w * 4, ((y + 2 * PAD) * W + 2 * PAD) * 4, ((y + 2 * PAD) * W + 2 * PAD + w) * 4);
        raw = { data: cropped, info: { width: w, height: h, channels: 4 } };
      }
      if (raw.info.width !== w || raw.info.height !== h) throw new Error(`${file.file}: ${raw.info.width}x${raw.info.height}, expected ${w}x${h}`);
      const old = file.file2x;
      const enc = await encode(raw, texture, file.file.replace(/(-v\d+)?\.[0-9a-f]{8}\.webp$/, "$1").replace(/\.webp$/, ""));
      if (old && old !== enc.file) rmSync(join(PUBLIC_DIR, old), { force: true });
      writeFileSync(join(PUBLIC_DIR, enc.file), enc.bytes);
      file.file2x = enc.file;
      if (texture) {
        const before = await sharp(join(PUBLIC_DIR, file.file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const after = await sharp(enc.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        seams.push({
          file: file.file,
          before: seamRatio(before.data, before.info.width, before.info.height, 3),
          raw: seamRatio(raw.data, w, h, 4),
          after: seamRatio(after.data, w, h, 3),
        });
      }
      written++;
      bytesWritten += enc.bytes.length;
      if (texture && opts.preview) {
        mkdirSync(opts.preview, { recursive: true });
        const tile = await sharp(enc.bytes).png().toBuffer();
        const name = enc.file.replace(/\//g, "__").replace(/\.webp$/, "");
        await sharp({ create: { width: 2 * w, height: 2 * h, channels: 3, background: "#000" } })
          .composite([0, 1, 2, 3].map((i) => ({ input: tile, left: (i % 2) * w, top: (i >> 1) * h })))
          .png()
          .toFile(join(opts.preview, `${name}.wrap2x2.png`));
      }
    }
    builtinManifestSchema.parse(manifest);
    writeFileSync(MANIFEST_FILE, manifestSource(manifest));
    console.log(`  ${folder}: ${files.length} files in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }

  if (seams.length > 0) {
    const worst = [...seams].sort((a, b) => b.after - a.after).slice(0, 8);
    console.log(`texture seams (wrap edge / inside; 1x file -> 2x pixels -> @2x file), worst ${worst.length} of ${seams.length}:`);
    for (const s of worst) console.log(`  ${s.file}: ${s.before.toFixed(2)} -> ${s.raw.toFixed(2)} -> ${s.after.toFixed(2)}`);
    const mean = (k: "before" | "raw" | "after") => seams.reduce((n, s) => n + s[k], 0) / seams.length;
    console.log(`  mean: ${mean("before").toFixed(2)} -> ${mean("raw").toFixed(2)} -> ${mean("after").toFixed(2)}`);
  }
  console.log(`wrote ${written} @2x files, ${(bytesWritten / 1024 / 1024).toFixed(1)} MB, in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

await main();
