// Offline 2x upscaling of the rulebook art with Real-ESRGAN (plan .omc/plans/sharp-4k.yaml, tracer HD2), shared by
// scripts/srd/extract-adversary-art.mjs and scripts/srd/extract-environment-art.mjs.
//
// The upscaler is the realesrgan-ncnn-vulkan binary (github.com/xinntao/Real-ESRGAN releases, v0.2.5.0, models
// included), passed with --upscaler <path>. Under WSL the Windows .exe works too (it reaches the GPU through Windows):
// its file arguments are converted with `wslpath -w`. Every image of a run goes through ONE invocation (a folder in,
// a folder out), so the model loads once. Killing node under WSL does not stop the Windows process: end it with
// `taskkill.exe /F /IM realesrgan-ncnn-vulkan.exe`, or it keeps writing into the work folder.
//
// Model. realesr-animevideov3 (native 2x, the default) stays closest to the painted originals; realesrgan-x4plus
// (4x, brought down to 2x) cleans JPEG blocks harder but smooths faces into a waxy look and invents brush strokes,
// and takes over ten times as long on an integrated GPU. Comparison: docs/tasks/TASK-HD2.md.
//
// Alpha. The tool's own alpha handling is not trusted: the RGB under fully transparent pixels is whatever the PDF
// stored (often black or stray colours), which the network smears into the edge as a dark halo. So an image with any transparency is
// split: its RGB, with the transparent area filled by the colours of the nearest opaque pixels (pull-push), goes
// through the model; its alpha is resized with lanczos3; the two are recombined at 2x.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Supported models -> the scale they run at. A 4x model is brought down to 2x with lanczos3 afterwards. */
export const MODELS = { "realesr-animevideov3": 2, "realesrgan-x4plus": 4 };
export const DEFAULT_MODEL = "realesr-animevideov3";

/** The upscale factor of the committed art. */
export const FACTOR = 2;

const isWslExe = (exe) => exe.toLowerCase().endsWith(".exe") && process.platform === "linux";
const winPath = (p) => execFileSync("wslpath", ["-w", p], { encoding: "utf8" }).trim();

function hasTransparency({ data, info }) {
  for (let i = 3; i < data.length; i += info.channels) if (data[i] < 255) return true;
  return false;
}

const FAINT = 16;

/**
 * RGB of an RGBA image with every (nearly) transparent pixel replaced by the colour of the opaque pixels nearest to it:
 * halve the image until nothing is left (sharp averages with premultiplied alpha), then walk back up, filling each
 * level's transparent pixels from the filled level above.
 */
async function bleed(sharp, { data, info }) {
  // Nearly transparent pixels (alpha < FAINT) count as empty: they carry stray colours (bright green, yellow, black
  // specks) that would otherwise leak into the fill and the edge, and at under 6 % opacity their own colour is moot.
  const cleared = Buffer.from(data);
  for (let i = 3; i < cleared.length; i += 4) if (cleared[i] < FAINT) cleared[i] = 0;
  const levels = [{ data: cleared, w: info.width, h: info.height }];
  while (levels.at(-1).w > 1 || levels.at(-1).h > 1) {
    const prev = levels.at(-1);
    const w = Math.max(1, Math.ceil(prev.w / 2));
    const h = Math.max(1, Math.ceil(prev.h / 2));
    const next = await sharp(prev.data, { raw: { width: prev.w, height: prev.h, channels: 4 } })
      .resize(w, h, { fit: "fill", kernel: "linear" })
      .raw()
      .toBuffer();
    levels.push({ data: next, w, h });
  }
  let filled = Buffer.from(levels.at(-1).data);
  for (let i = filled.length - 1; i >= 3; i -= 4) filled[i] = 255;
  for (let l = levels.length - 2; l >= 0; l--) {
    const { data: cur, w, h } = levels[l];
    const above = levels[l + 1];
    const up = await sharp(filled, { raw: { width: above.w, height: above.h, channels: 4 } })
      .resize(w, h, { fit: "fill", kernel: "linear" })
      .raw()
      .toBuffer();
    filled = Buffer.from(cur);
    for (let i = 0; i < filled.length; i += 4) {
      if (cur[i + 3] === 0) {
        filled[i] = up[i];
        filled[i + 1] = up[i + 1];
        filled[i + 2] = up[i + 2];
      }
      filled[i + 3] = 255;
    }
  }
  return sharp(filled, { raw: { width: info.width, height: info.height, channels: 4 } }).removeAlpha();
}

/**
 * Upscales every image 2x with Real-ESRGAN in one run of the tool.
 * `items`: Map key -> PNG (or any sharp input) buffer. Returns Map key -> { data, info } raw RGBA at exactly 2x.
 * `opts`: { exe, model, work, tile } (work: a folder to keep the tool's inputs and outputs in; a temp folder otherwise;
 * tile: the tool's -t tile size, auto when left out; timeoutMs: give up on a run that takes longer, none when left
 * out).
 *
 * The tool exits 0 even when the GPU fails mid-run ("vkQueueSubmit failed", Vulkan device lost: it then writes blank
 * images), so its stderr is read and any "failed" line fails the run. On the Intel Arc 140T the auto tile size lost
 * the device on the sprite packs (HD3); -t 128 ran mostly clean. A run can also hang with no output: with timeoutMs it
 * is killed (taskkill.exe for the Windows .exe, which outlives its WSL launcher) and the call throws.
 */
export async function upscaleAll(sharp, items, { exe, model = DEFAULT_MODEL, work, tile, timeoutMs }) {
  const scale = MODELS[model];
  if (!scale) throw new Error(`unknown model ${model} (one of ${Object.keys(MODELS).join(", ")})`);
  const dir = work ?? mkdtempSync(join(tmpdir(), "art-upscale-"));
  const inDir = join(dir, "in");
  const outDir = join(dir, "out");
  rmSync(inDir, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(inDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const meta = new Map(); // key -> { file, width, height, alpha? }
  let n = 0;
  for (const [key, buf] of items) {
    const file = `img${String(n++).padStart(4, "0")}.png`;
    const px = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = px.info;
    const alpha = hasTransparency(px) ? px : undefined;
    const rgb = alpha ? await bleed(sharp, px) : sharp(px.data, { raw: { width, height, channels: 4 } }).removeAlpha();
    await rgb.png().toFile(join(inDir, file));
    meta.set(key, { file, width, height, alpha });
  }

  const p = isWslExe(exe) ? winPath : (x) => x;
  const started = Date.now();
  const args = ["-i", p(inDir), "-o", p(outDir), "-n", model, "-s", String(scale), "-f", "png"];
  if (tile) args.push("-t", String(tile));
  const run = spawnSync(exe, args, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs });
  if (run.error) {
    if (isWslExe(exe)) spawnSync("taskkill.exe", ["/F", "/IM", exe.split("/").at(-1)], { stdio: "ignore" });
    throw run.error;
  }
  const failures = (run.stderr ?? "").split(/\r?\n/).filter((l) => /failed|error/i.test(l));
  if (run.status !== 0 || failures.length > 0) {
    throw new Error(`${exe} exited ${run.status} with ${failures.length} failure lines, e.g. ${failures[0] ?? "(none)"}`);
  }
  console.error(`upscaled ${items.size} images with ${model} in ${((Date.now() - started) / 1000).toFixed(1)} s`);

  const out = new Map();
  for (const [key, m] of meta) {
    const w = m.width * FACTOR;
    const h = m.height * FACTOR;
    let rgb = sharp(readFileSync(join(outDir, m.file))).removeAlpha();
    if (scale !== FACTOR) rgb = rgb.resize(w, h, { fit: "fill", kernel: "lanczos3" });
    const big = await rgb.raw().toBuffer({ resolveWithObject: true });
    if (big.info.width !== w || big.info.height !== h || big.info.channels !== 3) {
      throw new Error(`${key}: upscaled to ${big.info.width}x${big.info.height}x${big.info.channels}, expected ${w}x${h}x3`);
    }
    let a;
    if (m.alpha) {
      const mask = Buffer.alloc(m.width * m.height);
      for (let i = 0; i < mask.length; i++) mask[i] = m.alpha.data[i * 4 + 3];
      // extractChannel: sharp writes a resized one-channel raw image back out as three channels otherwise.
      a = await sharp(mask, { raw: { width: m.width, height: m.height, channels: 1 } })
        .resize(w, h, { fit: "fill", kernel: "lanczos3" })
        .extractChannel(0)
        .raw()
        .toBuffer();
      if (a.length !== w * h) throw new Error(`${key}: alpha has ${a.length} bytes, expected ${w * h}`);
    }
    const data = Buffer.alloc(w * h * 4);
    for (let i = 0, j = 0; i < w * h; i++, j += 3) {
      data[i * 4] = big.data[j];
      data[i * 4 + 1] = big.data[j + 1];
      data[i * 4 + 2] = big.data[j + 2];
      data[i * 4 + 3] = a ? a[i] : 255;
    }
    out.set(key, { data, info: { width: w, height: h, channels: 4 } });
  }
  if (!work) rmSync(dir, { recursive: true, force: true });
  return out;
}

/** Parses the shared flags: --upscaler <exe>, --model <name>, --upscale-work <dir>. Returns true if `a` was one. */
export function upscaleArg(out, a, next) {
  if (a === "--upscaler") out.upscaler = next();
  else if (a === "--model") out.model = next();
  else if (a === "--upscale-work") out.upscaleWork = next();
  else return false;
  return true;
}

export const UPSCALE_USAGE = "[--upscaler <realesrgan-ncnn-vulkan(.exe)> [--model realesr-animevideov3|realesrgan-x4plus] [--upscale-work <dir>]]";
