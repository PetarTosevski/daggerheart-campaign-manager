import { describe, expect, it } from "vitest";

import { SpriteImages, type HiRes, type LoadedImage } from "../../src/lib/combat-map/sprites/loader";
import { builtinHiRes, builtinManifest, builtinSpriteUrl } from "../../src/lib/sprite-packs/builtin/index";

// @2x sprite files (plan sharp-4k HD3): the loader asks for the @2x sibling only when the painter wants more pixels
// than the 1x file has, so normal zoom loads exactly the 1x files. jsdom has no canvas: canvases are stubs.

const SMALL = "/sprite-packs/forest/oak.11111111.webp";
const BIG = "/sprite-packs/forest/oak@2x.22222222.webp";
const hiRes: HiRes = (url) => (url === SMALL ? { url: BIG, w: 160, h: 120 } : null);

function setup() {
  const loads: string[] = [];
  const pending = new Map<string, { resolve: (i: LoadedImage) => void; reject: (e: unknown) => void }>();
  const drawn: unknown[] = [];
  const images = new SpriteImages(
    (url) =>
      new Promise<LoadedImage>((resolve, reject) => {
        loads.push(url);
        pending.set(url, { resolve, reject });
      }),
    (w, h) => {
      const ctx = new Proxy({} as Record<string, unknown>, {
        get: (t, p) =>
          typeof p === "string" && p in t
            ? t[p]
            : (...a: unknown[]) => {
                if (p === "drawImage") drawn.push(a[0]);
                return p === "getImageData" ? { data: new Uint8ClampedArray((a[2] as number) * (a[3] as number) * 4) } : undefined;
              },
        set: (t, p, v) => ((t[p as string] = v), true),
      });
      return { width: w, height: h, getContext: () => ctx as unknown as CanvasRenderingContext2D } as never;
    },
    hiRes,
  );
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  return { images, loads, pending, drawn, settle };
}

describe("sprite loader @2x (HD3)", () => {
  it("loads only the 1x file at or below its size, for sprites, shadows and textures", () => {
    const { images, loads } = setup();
    images.sprite(SMALL, 160, 120);
    images.sprite(SMALL, 48, 36);
    images.shadow(SMALL, 160, 100, 0, { blur: 2 } as never);
    images.texture(SMALL, 120);
    expect(loads).toEqual([SMALL]);
  });

  it("loads the @2x file instead when the painter asks for more pixels than the 1x file has", () => {
    for (const ask of [(i: SpriteImages) => i.sprite(SMALL, 161, 120), (i: SpriteImages) => i.sprite(SMALL, 100, 121), (i: SpriteImages) => i.texture(SMALL, 200)]) {
      const { images, loads } = setup();
      ask(images);
      expect(loads).toEqual([BIG]);
    }
  });

  it("draws the loaded 1x file while the @2x one loads, then the @2x one; listeners hear the 1x URL", async () => {
    const { images, loads, pending, drawn, settle } = setup();
    const heard: string[] = [];
    images.subscribe((url) => heard.push(url));
    const small = { width: 160, height: 120 } as LoadedImage;
    const big = { width: 320, height: 240 } as LoadedImage;

    images.sprite(SMALL, 96, 72);
    pending.get(SMALL)!.resolve(small);
    await settle();
    expect(images.sprite(SMALL, 320, 240)).not.toBeNull();
    expect(drawn.at(-1)).toBe(small);
    expect(loads).toEqual([SMALL, BIG]);

    pending.get(BIG)!.resolve(big);
    await settle();
    expect(heard).toEqual([SMALL, SMALL]);
    expect(images.sprite(SMALL, 320, 240)).not.toBeNull();
    expect(drawn.at(-1)).toBe(big);
    // Back at normal zoom the 1x file is drawn again.
    images.sprite(SMALL, 48, 36);
    expect(drawn.at(-1)).toBe(small);
  });

  it("falls back to the 1x file when the @2x file fails", async () => {
    const { images, loads, pending, settle } = setup();
    const heard: string[] = [];
    images.subscribe((url) => heard.push(url));
    expect(images.texture(SMALL, 256)).toBeNull();
    pending.get(BIG)!.reject(new Error("404"));
    await settle();
    expect(heard).toEqual([SMALL]);
    expect(images.texture(SMALL, 256)).toBeNull();
    expect(loads).toEqual([BIG, SMALL]);
    pending.get(SMALL)!.resolve({ width: 160, height: 120 } as LoadedImage);
    await settle();
    expect(images.texture(SMALL, 256)).not.toBeNull();
  });

  it("never asks for @2x for a URL without one (uploads)", () => {
    const { images, loads } = setup();
    images.sprite("https://cdn.example/upload.webp", 2000, 2000);
    expect(loads).toEqual(["https://cdn.example/upload.webp"]);
  });

  it("builtinHiRes maps every built-in file's URL to its @2x URL at exactly twice the 1x size", () => {
    const files = Object.values(builtinManifest().folders).flatMap((sprites) => sprites.flatMap((s) => [s, ...s.variants]));
    expect(files.length).toBeGreaterThan(1000);
    for (const f of files) {
      expect(f.file2x, f.file).toBeDefined();
      expect(f.file2x!.startsWith(f.file.replace(/(-v\d+)?\.[0-9a-f]{8}\.webp$/, "$1") + "@2x.")).toBe(true);
      expect(builtinHiRes(builtinSpriteUrl(f))).toEqual({ url: builtinSpriteUrl(f.file2x!), w: f.px.w, h: f.px.h });
    }
    expect(builtinHiRes("/sprite-packs/nope.webp")).toBeNull();
  });
});
