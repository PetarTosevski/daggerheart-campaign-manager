import type { SpriteArt } from "../../../../../src/lib/combat-map/sprites/loader";
import { renderShadow, type ShadowCanvas, type ShadowSpec } from "../../../../../src/lib/combat-map/sprites/shadows";

import { siteUrl } from "../../auth/google";

import { SkiaMapCanvas } from "./canvas/context";
import type { SkiaApi } from "./canvas/skia-runtime";
import { paintStats } from "./paint-stats";

/**
 * Built-in packs are static files on the website (`/sprite-packs/...`): the deployment's site (`EXPO_PUBLIC_SITE_URL`,
 * as sign-in and join links read it), not always production (dcm-gdzi.18).
 */
export function absoluteSpriteUrl(url: string, origin: string = siteUrl()): string {
  if (url.startsWith("https://") || url.startsWith("http://")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return `${origin}${url.startsWith("/") ? url : `/${url}`}`;
}

function decodeSprite(skia: SkiaApi, bytes: Uint8Array): SkiaMapCanvas | null {
  const encoded = skia.Image.MakeImageFromEncoded(skia.Data.fromBytes(bytes));
  if (!encoded) return null;
  const width = encoded.width();
  const height = encoded.height();
  if (width <= 0 || height <= 0) return null;
  const canvas = new SkiaMapCanvas(skia, width, height);
  canvas.context.blitImage(encoded);
  return canvas;
}

async function fetchSprite(skia: SkiaApi, url: string): Promise<SkiaMapCanvas | null> {
  const response = await fetch(absoluteSpriteUrl(url));
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  paintStats.spriteDecodes += 1;
  return decodeSprite(skia, bytes);
}

/** Decoded sprite files kept across paints, by URL (oldest dropped past the cap), so a repaint never re-downloads. */
const SPRITE_CACHE_MAX = 160;
const decoded = new Map<string, Promise<SkiaMapCanvas | null>>();

function cachedSprite(skia: SkiaApi, url: string): Promise<SkiaMapCanvas | null> {
  const hit = decoded.get(url);
  if (hit) {
    decoded.delete(url);
    decoded.set(url, hit);
    return hit;
  }
  const loading = fetchSprite(skia, url).catch(() => null);
  decoded.set(url, loading);
  // A failed file is forgotten, so the next paint tries again.
  void loading.then((image) => {
    if (image === null && decoded.get(url) === loading) decoded.delete(url);
  });
  while (decoded.size > SPRITE_CACHE_MAX) {
    const oldest = decoded.keys().next().value;
    if (oldest === undefined) break;
    decoded.delete(oldest);
  }
  return loading;
}

/** Sprite pictures already decoded, so the painter can draw them in one pass. */
class ReadySpriteArt implements SpriteArt {
  private readonly scaled = new Map<string, SkiaMapCanvas>();
  private readonly shadows = new Map<string, CanvasImageSource>();
  private readonly textures = new Map<string, Uint8ClampedArray>();

  constructor(
    private readonly images: Map<string, SkiaMapCanvas>,
    private readonly skia: SkiaApi,
  ) {}

  sprite(url: string, w: number, h: number): CanvasImageSource | null {
    const key = `${url}|${w}|${h}`;
    const hit = this.scaled.get(key);
    if (hit) return hit as unknown as CanvasImageSource;
    const image = this.images.get(url);
    if (!image || w <= 0 || h <= 0) return null;
    const canvas = new SkiaMapCanvas(this.skia, w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, w, h);
    this.scaled.set(key, canvas);
    return canvas as unknown as CanvasImageSource;
  }

  shadow(url: string, w: number, h: number, rot: number, spec: ShadowSpec): CanvasImageSource | null {
    const key = `${url}|${w}|${h}|${rot.toFixed(3)}|${spec.blur.toFixed(2)}`;
    const hit = this.shadows.get(key);
    if (hit) return hit;
    const image = this.sprite(url, w, h);
    if (!image) return null;
    try {
      const canvas = renderShadow(
        (cw, ch) => new SkiaMapCanvas(this.skia, Math.max(1, cw), Math.max(1, ch)) as unknown as ShadowCanvas,
        image,
        w,
        h,
        rot,
        spec,
      );
      this.shadows.set(key, canvas as unknown as CanvasImageSource);
      return canvas as unknown as CanvasImageSource;
    } catch {
      return null;
    }
  }

  texture(url: string, size: number): Uint8ClampedArray | null {
    const key = `${url}|${size}`;
    const hit = this.textures.get(key);
    if (hit) return hit;
    const image = this.images.get(url);
    if (!image || size <= 0) return null;
    const canvas = new SkiaMapCanvas(this.skia, size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, size, size);
    const pixels = ctx.getImageData(0, 0, size, size).data;
    this.textures.set(key, pixels);
    return pixels;
  }
}

/** The map's sprite and texture files, from the cache or downloaded. URLs that fail are left out. */
export async function loadSpriteArt(skia: SkiaApi, urls: Iterable<string>): Promise<SpriteArt | null> {
  const list = [...new Set(urls)];
  if (list.length === 0) return null;
  const images = new Map<string, SkiaMapCanvas>();
  await Promise.all(
    list.map(async (url) => {
      // A missing file keeps that object's Classic drawing.
      const image = await cachedSprite(skia, url);
      if (image) images.set(url, image);
    }),
  );
  if (images.size === 0) return null;
  return new ReadySpriteArt(images, skia);
}
