import type { RgbaImage } from "../../../../../src/lib/sprite-packs/cut";
import { AlphaType, ColorType, FilterMode, MipmapMode } from "../combat-map/canvas/skia-enums";
import { loadSkia, type SkData, type SkImage, type SkiaApi } from "../combat-map/canvas/skia-runtime";
import { MAX_SHEET_BYTES, MAX_SHEET_PX, SPRITE_PX_PER_SQUARE, TEXTURE_PX } from "./labels";

/** Image types the cutter reads (same allowlist as the server). */
export const SHEET_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export class SheetError extends Error {}

type EncodedSkia = SkiaApi & {
  Image: SkiaApi["Image"] & {
    MakeImageFromEncoded(data: SkData): SkImage | null;
  };
};

function rgbaInfo(width: number, height: number) {
  return { width, height, alphaType: AlphaType.Unpremul, colorType: ColorType.RGBA_8888 };
}

async function skia(): Promise<EncodedSkia> {
  return (await loadSkia()) as EncodedSkia;
}

function readImagePixels(image: SkImage, skiaApi: SkiaApi): RgbaImage {
  const width = image.width();
  const height = image.height();
  const surface = skiaApi.Surface.Make(width, height);
  if (!surface) throw new SheetError("This device can't read images here.");
  const canvas = surface.getCanvas();
  canvas.clear(skiaApi.Color("rgba(0,0,0,0)"));
  const paint = skiaApi.Paint();
  canvas.drawImageRectOptions(
    image,
    skiaApi.XYWHRect(0, 0, width, height),
    skiaApi.XYWHRect(0, 0, width, height),
    FilterMode.Linear,
    MipmapMode.None,
    paint,
  );
  paint.dispose();
  const raw = canvas.readPixels(0, 0, rgbaInfo(width, height));
  image.dispose();
  surface.makeImageSnapshot().dispose();
  if (!raw || raw instanceof Float32Array) throw new SheetError("Couldn't read image pixels.");
  return { width, height, data: new Uint8ClampedArray(raw) };
}

/** Decodes a picked image URI into RGBA pixels (at most MAX_SHEET_BYTES and MAX_SHEET_PX per side). */
export async function readPickedSheet(uri: string, fileName: string, mimeType: string | undefined): Promise<RgbaImage> {
  const type = mimeType ?? "image/jpeg";
  if (!(SHEET_TYPES as readonly string[]).includes(type)) {
    throw new SheetError(`${fileName}: only PNG, JPEG, WebP or GIF images can be cut.`);
  }
  const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
  if (bytes.byteLength > MAX_SHEET_BYTES) throw new SheetError(`${fileName} is larger than 20 MB.`);
  const api = await skia();
  const data = api.Data.fromBytes(bytes);
  const image = api.Image.MakeImageFromEncoded(data);
  data.dispose();
  if (!image) throw new SheetError(`Couldn't read ${fileName} as an image.`);
  if (image.width() > MAX_SHEET_PX || image.height() > MAX_SHEET_PX) {
    image.dispose();
    throw new SheetError(`${fileName} is larger than ${MAX_SHEET_PX} pixels per side.`);
  }
  return readImagePixels(image, api);
}

function scaled(img: RgbaImage, maxSide: number, api: SkiaApi): { width: number; height: number; data: Uint8ClampedArray } {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  if (scale === 1) return { width: img.width, height: img.height, data: img.data };
  const src = api.Image.MakeImage(rgbaInfo(img.width, img.height), api.Data.fromBytes(new Uint8Array(img.data.buffer)), img.width * 4);
  if (!src) throw new SheetError("Couldn't resize the sprite.");
  const surface = api.Surface.Make(width, height);
  if (!surface) {
    src.dispose();
    throw new SheetError("Couldn't resize the sprite.");
  }
  const canvas = surface.getCanvas();
  const paint = api.Paint();
  canvas.drawImageRectOptions(
    src,
    api.XYWHRect(0, 0, img.width, img.height),
    api.XYWHRect(0, 0, width, height),
    FilterMode.Linear,
    MipmapMode.None,
    paint,
  );
  paint.dispose();
  src.dispose();
  const raw = canvas.readPixels(0, 0, rgbaInfo(width, height));
  const snapshot = surface.makeImageSnapshot();
  snapshot.dispose();
  if (!raw || raw instanceof Float32Array) throw new SheetError("Couldn't resize the sprite.");
  return { width, height, data: new Uint8ClampedArray(raw) };
}

export async function asyncThumbnail(img: RgbaImage, maxSide = 160): Promise<string> {
  const api = await skia();
  const { width, height, data } = scaled(img, maxSide, api);
  const image = api.Image.MakeImage(rgbaInfo(width, height), api.Data.fromBytes(new Uint8Array(data.buffer)), width * 4);
  if (!image) throw new SheetError("Couldn't build a preview.");
  const encoded = (image as SkImage & { encodeToBytes?: (fmt: number, q: number) => Uint8Array }).encodeToBytes?.(3, 100);
  image.dispose();
  if (!encoded) return "";
  const bin = encoded.reduce((acc, byte) => acc + String.fromCharCode(byte), "");
  return `data:image/png;base64,${globalThis.btoa?.(bin) ?? ""}`;
}

/**
 * Encodes a cut for upload: longest side at most `maxSide`, PNG (WebP when the runtime supports it).
 * Returns the blob and its pixel size.
 */
export async function encodeSprite(
  img: RgbaImage,
  maxSide: number,
  maxBytes: number,
): Promise<{ blob: Blob; px: { w: number; h: number }; contentType: string }> {
  const api = await skia();
  const { width, height, data } = scaled(img, maxSide, api);
  const image = api.Image.MakeImage(rgbaInfo(width, height), api.Data.fromBytes(new Uint8Array(data.buffer)), width * 4);
  if (!image) throw new SheetError("Couldn't encode the sprite.");
  const enc = image as SkImage & { encodeToBytes?: (fmt: number, q: number) => Uint8Array };
  const tryEncode = (fmt: number, q: number) => enc.encodeToBytes?.(fmt, q);
  let bytes = tryEncode(4, 90);
  let contentType = "image/webp";
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    bytes = tryEncode(4, 75);
  }
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    bytes = tryEncode(3, 100);
    contentType = "image/png";
  }
  if (!bytes || bytes.byteLength > maxBytes) {
    bytes = tryEncode(3, 85);
    contentType = "image/png";
  }
  image.dispose();
  if (!bytes || bytes.byteLength > maxBytes) throw new SheetError("This sprite is still larger than 1 MB after compressing it.");
  return { blob: new Blob([Uint8Array.from(bytes)], { type: contentType }), px: { w: width, h: height }, contentType };
}

/** Pixels per square side an object sprite is encoded at. */
export function maxSideForLabels(category: "object" | "texture", w: number, h: number, maxPx: number): number {
  return Math.min(maxPx, category === "texture" ? TEXTURE_PX : Math.max(w, h) * SPRITE_PX_PER_SQUARE);
}
