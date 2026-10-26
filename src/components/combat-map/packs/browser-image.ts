"use client";

import type { RgbaImage } from "@/lib/sprite-packs/cut";

import { MAX_SHEET_BYTES, MAX_SHEET_PX } from "./labels";

/**
 * Canvas glue of the upload screen (sprite packs P8, D9): a dropped file becomes an RGBA buffer for the pure cut
 * core (src/lib/sprite-packs/cut), and a cut becomes a resized WebP (PNG where the browser cannot encode WebP) for
 * upload. Everything runs locally; the sheet itself is never uploaded.
 */

/** Image types the screen reads (as the server's allowlist: never SVG). */
export const SHEET_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export class SheetError extends Error {}

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new SheetError("This browser can't read images here.");
  return ctx;
}

/** Decodes a dropped file into RGBA pixels (at most MAX_SHEET_BYTES and MAX_SHEET_PX per side). */
export async function readSheet(file: File): Promise<RgbaImage> {
  if (!(SHEET_TYPES as readonly string[]).includes(file.type)) throw new SheetError(`${file.name}: only PNG, JPEG, WebP or GIF images can be cut.`);
  if (file.size > MAX_SHEET_BYTES) throw new SheetError(`${file.name} is larger than 20 MB.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new SheetError(`Couldn’t read ${file.name} as an image.`);
  }
  try {
    if (bitmap.width > MAX_SHEET_PX || bitmap.height > MAX_SHEET_PX) throw new SheetError(`${file.name} is larger than ${MAX_SHEET_PX} pixels per side.`);
    const c = canvas(bitmap.width, bitmap.height);
    const ctx = context(c);
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    return { width: data.width, height: data.height, data: data.data };
  } finally {
    bitmap.close();
  }
}

/** A canvas holding `img` scaled down so its longest side is at most `maxSide` (never scaled up). */
function scaled(img: RgbaImage, maxSide: number): HTMLCanvasElement {
  const source = canvas(img.width, img.height);
  context(source).putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (scale === 1) return source;
  const out = canvas(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
  const ctx = context(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

/** A small preview (data URL) of a cut, for the labelling grid. */
export function thumbnail(img: RgbaImage, maxSide = 160): string {
  return scaled(img, maxSide).toDataURL("image/png");
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, type, quality));
}

/**
 * Encodes a cut for upload: longest side at most `maxSide`, WebP (quality 0.9, then 0.75 when over `maxBytes`), or
 * PNG where the browser cannot encode WebP. Returns the file and its pixel size; throws SheetError when it stays too big.
 */
export async function encodeSprite(img: RgbaImage, maxSide: number, maxBytes: number): Promise<{ blob: Blob; px: { w: number; h: number } }> {
  const c = scaled(img, maxSide);
  const px = { w: c.width, h: c.height };
  for (const quality of [0.9, 0.75]) {
    const webp = await toBlob(c, "image/webp", quality);
    if (webp && webp.type === "image/webp") {
      if (webp.size <= maxBytes) return { blob: webp, px };
      continue;
    }
    const png = await toBlob(c, "image/png");
    if (png && png.size <= maxBytes) return { blob: png, px };
    break;
  }
  throw new SheetError("This sprite is still larger than 1 MB after compressing it.");
}
