// Sprite images for the sprite painter (sprite packs P6). Built-in WebPs (the static manifest, served immutable from
// /sprite-packs/) and uploaded sprites (URLs from combatMapStyle.spriteSources) are loaded lazily, the first time
// the painter asks for one, and decoded once. Every size the painter draws is cached as its own bitmap: a sprite
// scaled to its drawn size, its shadow (D5) and a texture's pixels at its tile size, so a repaint never decodes or
// rescales anything. Listeners hear when an image arrives (the canvas repaints the affected rectangle); an image
// that fails stays missing and its object or terrain keeps its Classic drawing.
//
// @2x (plan sharp-4k HD3): a built-in file can have a sibling upscaled 2x (manifest `file2x`). It is loaded only when
// the painter asks for more pixels than the 1x file has (a high-density screen, zoomed in), so normal zoom loads
// exactly the 1x files. Until the @2x file arrives the 1x one is drawn if it is already loaded; listeners hear the 1x
// URL either way (the URL the painter knows). If the @2x file fails, the 1x file is used.

import { builtinHiRes } from "../../sprite-packs/builtin/index";
import { renderShadow, type ShadowCanvas, type ShadowSpec } from "./shadows";

/** What the painter asks for; null = not loaded (yet), draw Classic. Asking starts the load. */
export interface SpriteArt {
  /** The sprite at `w` x `h` pixels (whole pixels). */
  sprite(url: string, w: number, h: number): CanvasImageSource | null;
  /** The sprite's shadow silhouette at that size and rotation, centred like the sprite (see renderShadow). */
  shadow(url: string, w: number, h: number, rot: number, spec: ShadowSpec): CanvasImageSource | null;
  /** RGBA pixels of a texture scaled to `size` x `size` (one tile). */
  texture(url: string, size: number): Uint8ClampedArray | null;
}

/** A decoded image. */
export type LoadedImage = CanvasImageSource & { readonly width: number; readonly height: number };

export type LoadImage = (url: string) => Promise<LoadedImage>;
export type CreateCanvas = (w: number, h: number) => ShadowCanvas & CanvasImageSource;

/** The @2x sibling of a 1x URL and the 1x file's pixel size, or null when it has none (uploads, a file not upscaled). */
export type HiRes = (url: string) => { readonly url: string; readonly w: number; readonly h: number } | null;

const NO_HI_RES: HiRes = () => null;

type Entry = { state: "loading" | "failed" } | { state: "ready"; image: LoadedImage };

/** Bitmaps kept per cache before the oldest are dropped. */
const MAX_SCALED = 1500;
const MAX_TEXTURES = 160;

function remember<V>(map: Map<string, V>, key: string, value: V, max: number): V {
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value as string);
  return value;
}

/** Loads, decodes and caches sprite images; one per page (see `spriteImages()`), shared by every map and thumbnail. */
export class SpriteImages implements SpriteArt {
  private readonly entries = new Map<string, Entry>();
  private readonly scaled = new Map<string, CanvasImageSource>();
  private readonly shadows = new Map<string, CanvasImageSource>();
  private readonly textures = new Map<string, Uint8ClampedArray>();
  private readonly listeners = new Set<(url: string) => void>();

  constructor(
    private readonly load: LoadImage,
    private readonly createCanvas: CreateCanvas,
    private readonly hiRes: HiRes = NO_HI_RES,
  ) {}

  /** Hears every image that finished loading (by URL). Returns the unsubscribe function. */
  subscribe(listener: (url: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The decoded image, or null while loading / after a failure. The first call starts the load. */
  image(url: string): LoadedImage | null {
    return this.fetch(url, url);
  }

  /** Like `image`, but listeners hear `announce` (the 1x URL when `url` is its @2x sibling). */
  private fetch(url: string, announce: string): LoadedImage | null {
    const entry = this.entries.get(url);
    if (entry) return entry.state === "ready" ? entry.image : null;
    this.entries.set(url, { state: "loading" });
    this.load(url).then(
      (image) => {
        this.entries.set(url, { state: "ready", image });
        for (const listener of [...this.listeners]) listener(announce);
      },
      () => {
        this.entries.set(url, { state: "failed" });
        // The 1x file takes over: tell the painter to ask again.
        if (announce !== url) for (const listener of [...this.listeners]) listener(announce);
      },
    );
    return null;
  }

  /**
   * The image to draw `url` from at `w` x `h` pixels, with the URL it was loaded from (the cache key): the @2x
   * sibling when the size is larger than the 1x file (falling back to the 1x file while it loads or after it
   * failed), the 1x file otherwise.
   */
  private source(url: string, w: number, h: number): { image: LoadedImage; from: string } | null {
    const hi = this.hiRes(url);
    if (hi && (w > hi.w || h > hi.h)) {
      const big = this.fetch(hi.url, url);
      if (big) return { image: big, from: hi.url };
      const small = this.entries.get(url);
      if (this.entries.get(hi.url)?.state !== "failed") {
        return small?.state === "ready" ? { image: small.image, from: url } : null;
      }
    }
    const image = this.image(url);
    return image ? { image, from: url } : null;
  }

  sprite(url: string, w: number, h: number): CanvasImageSource | null {
    if (w <= 0 || h <= 0) return null;
    const src = this.source(url, w, h);
    if (!src) return null;
    const key = `${src.from}|${w}|${h}`;
    const hit = this.scaled.get(key);
    if (hit) return hit;
    const image = src.image;
    const canvas = this.createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, w, h);
    return remember(this.scaled, key, canvas, MAX_SCALED);
  }

  shadow(url: string, w: number, h: number, rot: number, spec: ShadowSpec): CanvasImageSource | null {
    if (w <= 0 || h <= 0) return null;
    const src = this.source(url, w, h);
    if (!src) return null;
    const key = `${src.from}|${w}|${h}|${rot.toFixed(3)}|${spec.blur.toFixed(2)}`;
    const hit = this.shadows.get(key);
    if (hit) return hit;
    return remember(this.shadows, key, renderShadow(this.createCanvas, src.image, w, h, rot, spec), MAX_SCALED);
  }

  texture(url: string, size: number): Uint8ClampedArray | null {
    if (size <= 0) return null;
    const src = this.source(url, size, size);
    if (!src) return null;
    const key = `${src.from}|${size}`;
    const hit = this.textures.get(key);
    if (hit) return hit;
    const image = src.image;
    const canvas = this.createCanvas(size, size);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, size, size);
    return remember(this.textures, key, ctx.getImageData(0, 0, size, size).data, MAX_TEXTURES);
  }
}

/** Decodes an image in the browser before it is handed to the painter. */
function browserLoad(url: string): Promise<LoadedImage> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  return img.decode().then(() => img);
}

function browserCanvas(w: number, h: number): ShadowCanvas & HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

let shared: SpriteImages | null = null;

/** The page's sprite image cache (browser only); built-in files load their @2x sibling when drawn above 1x size. */
export function spriteImages(): SpriteImages {
  shared ??= new SpriteImages(browserLoad, browserCanvas, builtinHiRes);
  return shared;
}
