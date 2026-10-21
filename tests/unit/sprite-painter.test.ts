import { describe, expect, it } from "vitest";

import { paintMap as classicPaintMap } from "../../src/lib/combat-map/painter";
import { SpriteImages, type LoadedImage, type SpriteArt } from "../../src/lib/combat-map/sprites/loader";
import {
  mapUrls,
  objectBounds,
  paintMap,
  paintMapRect,
  prepareMap,
  withObjects,
  type SpritePaintObject,
  type SpritePaintSpec,
  type UploadedSprite,
} from "../../src/lib/combat-map/sprites/painter";
import { objectArt, terrainTextures } from "../../src/lib/combat-map/sprites/resolve";
import { SHADOW_DIR, shadowSpec } from "../../src/lib/combat-map/sprites/shadows";
import { BUILTIN_LOOKUP, builtinSpriteUrl } from "../../src/lib/sprite-packs/builtin/index";

// Sprite painter (sprite packs P6). jsdom has no canvas: a mock 2D context records every call and keeps a real RGBA
// buffer for putImageData / getImageData, and a fake SpriteArt hands out patterned textures and stand-in sprites.
// The fixture "manifest" is the committed built-in one (stable keys, D8) plus two uploaded sprites below.

const CELL = 8;

type Call = { op: string; args: unknown[] };

interface Recorder {
  ctx: CanvasRenderingContext2D;
  calls: Call[];
  buffer: Uint8ClampedArray;
  /** Pixel rectangles written by putImageData or read by getImageData. */
  touched: { x: number; y: number; w: number; h: number }[];
}

function recorder(width: number, height: number): Recorder {
  const calls: Call[] = [];
  const touched: Recorder["touched"] = [];
  const buffer = new Uint8ClampedArray(width * height * 4);
  const state: Record<string | symbol, unknown> = {};
  const special: Record<string, (...a: unknown[]) => unknown> = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray((w as number) * (h as number) * 4) }),
    putImageData: (img, x, y) => {
      const i = img as ImageData;
      const ox = x as number, oy = y as number;
      touched.push({ x: ox, y: oy, w: i.width, h: i.height });
      for (let yy = 0; yy < i.height; yy++)
        for (let xx = 0; xx < i.width; xx++) {
          const gx = ox + xx, gy = oy + yy;
          if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue;
          buffer.set(i.data.subarray((yy * i.width + xx) * 4, (yy * i.width + xx) * 4 + 4), (gy * width + gx) * 4);
        }
    },
    getImageData: (x, y, w, h) => {
      const ox = x as number, oy = y as number, rw = w as number, rh = h as number;
      touched.push({ x: ox, y: oy, w: rw, h: rh });
      const data = new Uint8ClampedArray(rw * rh * 4);
      for (let yy = 0; yy < rh; yy++) data.set(buffer.subarray(((oy + yy) * width + ox) * 4, ((oy + yy) * width + ox + rw) * 4), yy * rw * 4);
      return { width: rw, height: rh, data };
    },
    createRadialGradient: () => ({ addColorStop: (...a: unknown[]) => calls.push({ op: "addColorStop", args: a }) }),
  };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push({ op: prop, args });
        return special[prop]?.(...args);
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      calls.push({ op: `set:${String(prop)}`, args: [value] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, buffer, touched };
}

/** A texture tile: a colour per URL with a diagonal stripe, so orientation and mixing change pixels. */
function patternTexture(url: string, size: number): Uint8ClampedArray {
  let h = 0;
  for (const ch of url) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const base = [40 + (h % 160), 40 + ((h >> 8) % 160), 40 + ((h >> 16) % 160)];
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const stripe = (x * 2 + y) % size < size / 4 ? 40 : 0;
      out[i] = base[0]! + stripe; out[i + 1] = base[1]! + stripe; out[i + 2] = base[2]!; out[i + 3] = 255;
    }
  return out;
}

type FakeArt = SpriteArt & { missing: Set<string>; asked: string[] };

function fakeArt(): FakeArt {
  const missing = new Set<string>();
  const asked: string[] = [];
  return {
    missing,
    asked,
    sprite: (url, w, h) => (asked.push(url), missing.has(url) ? null : ({ fake: "sprite", url, width: w, height: h } as unknown as CanvasImageSource)),
    shadow: (url, w, h) => (missing.has(url) ? null : ({ fake: "shadow", url, width: w + 6, height: h + 6 } as unknown as CanvasImageSource)),
    texture: (url, size) => (missing.has(url) ? null : patternTexture(url, size)),
  };
}

const keyUrl = (key: string) => builtinSpriteUrl(BUILTIN_LOOKUP.get(key)!.art!);

const UPLOADED: UploadedSprite[] = [
  { _id: "up-statue", category: "object", w: 2, h: 2, light: "none", height: "tall", footprint: "circle", px: { w: 300, h: 320 }, url: "https://files.test/statue.webp" },
  { _id: "up-gone", category: "object", w: 1, h: 1, light: "none", height: "low", footprint: "circle", px: { w: 160, h: 160 }, url: null },
];

/** A small forest map: grass base, a dirt path, a wall block (never textured), mapped and ref'd objects. */
function forestSpec(objects: SpritePaintObject[] = forestObjects()): SpritePaintSpec {
  return {
    w: 14,
    h: 10,
    seed: 4242,
    base: "grass",
    areas: [
      { terrain: "path", shape: "path", points: [[0, 5], [14, 5]], width: 2 },
      { terrain: "wall", shape: "rect", x: 10, y: 0, w: 4, h: 3 },
      { terrain: "water", shape: "ellipse", x: 3, y: 2, rx: 2, ry: 1.5 },
    ],
    objects,
    setting: "forest",
    uploaded: new Map(UPLOADED.map((u) => [u._id, u])),
  };
}

function forestObjects(): SpritePaintObject[] {
  return [
    { id: "o-tree", kind: "tree", x: 2, y: 8, r: 1.4 },
    { id: "o-crate", kind: "crate", x: 7, y: 7.5, r: 0.8, sprite: { builtin: "common/wooden-crate" } },
    { id: "o-fire", kind: "campfire", x: 8, y: 2, r: 1 },
    { id: "o-statue", kind: "statue", x: 11.5, y: 7.5, r: 1, sprite: { uploaded: "up-statue" } },
    { id: "o-hull", kind: "hull", x: 6, y: 1, r: 1, points: [[5, 0.5], [7, 0.5], [7, 1.5], [5, 1.5]] },
  ];
}

const W = 14 * CELL, H = 10 * CELL;

describe("resolve (D1)", () => {
  it("an object draws its ref, else the stand-in for its Classic kind in the setting, else Classic", () => {
    const uploaded = new Map(UPLOADED.map((u) => [u._id, u]));
    expect(objectArt({ id: "a", kind: "crate", sprite: { builtin: "common/wooden-crate" } }, "forest", 1, uploaded)).toMatchObject({ url: keyUrl("common/wooden-crate"), via: "ref", w: 1, h: 1 });
    expect(objectArt({ id: "a", kind: "statue", sprite: { uploaded: "up-statue" } }, "forest", 1, uploaded)).toMatchObject({ url: "https://files.test/statue.webp", via: "ref" });
    // A deleted / fileless / unknown ref resolves like no ref (D9): the stand-in, deterministic per id and seed.
    const mapped = objectArt({ id: "a", kind: "tree" }, "forest", 1, uploaded);
    expect(mapped?.via).toBe("mapped");
    expect(objectArt({ id: "a", kind: "tree", sprite: { uploaded: "up-gone" } }, "forest", 1, uploaded)).toEqual(mapped);
    expect(objectArt({ id: "a", kind: "tree", sprite: { builtin: "forest/no-such-thing" } }, "forest", 1, uploaded)).toEqual(mapped);
    expect(objectArt({ id: "a", kind: "tree" }, "forest", 1, uploaded)).toEqual(mapped);
    // No stand-in anywhere (a hull): Classic.
    expect(objectArt({ id: "h", kind: "hull" }, "forest", 1, uploaded)).toBeNull();
  });

  it("a terrain mixes the setting's and common's textures; wall and void have none (D6)", () => {
    const grass = terrainTextures("grass", "forest").map((t) => t.url);
    expect(grass.length).toBeGreaterThanOrEqual(4);
    expect(grass).toContain(keyUrl("forest/moss"));
    expect(grass).toContain(keyUrl("common/grass"));
    expect(terrainTextures("wall", "forest")).toEqual([]);
    expect(terrainTextures("void", "dungeon")).toEqual([]);
    // Planks and cobblestone road are not rotatable (common gravel, a path texture with no direction, is), forest floor is.
    const path = terrainTextures("path", "forest");
    expect(path.find((t) => t.url === keyUrl("common/cobblestone-road"))?.rotatable).toBe(false);
    expect(terrainTextures("grass", "forest").some((t) => t.rotatable)).toBe(true);
  });
});

describe("sprite painter", () => {
  it("is deterministic for a seed: the same spec and images give the same calls and pixels", () => {
    const a = recorder(W, H);
    const b = recorder(W, H);
    paintMap(a.ctx, forestSpec(), { cell: CELL, art: fakeArt() });
    paintMap(b.ctx, forestSpec(), { cell: CELL, art: fakeArt() });
    const log = (r: Recorder) => JSON.stringify(r.calls, (_, v: unknown) => (typeof v === "function" || v instanceof Uint8ClampedArray ? undefined : v));
    expect(log(b)).toEqual(log(a));
    expect(Buffer.from(b.buffer).equals(Buffer.from(a.buffer))).toBe(true);
    // Another seed changes the picture.
    const c = recorder(W, H);
    paintMap(c.ctx, { ...forestSpec(), seed: 7 }, { cell: CELL, art: fakeArt() });
    expect(Buffer.from(c.buffer).equals(Buffer.from(a.buffer))).toBe(false);
  });

  it("a dirty-rect paint touches only that rectangle and equals the same area of the full paint", () => {
    const art = fakeArt();
    const full = recorder(W, H);
    const m = paintMap(full.ctx, forestSpec(), { cell: CELL, art });

    const rect = { x: 3, y: 2, w: 4, h: 3 };
    const px = { x0: 3 * CELL, y0: 2 * CELL, x1: 7 * CELL, y1: 5 * CELL };
    const only = recorder(W, H);
    paintMapRect(only.ctx, m, rect, { cell: CELL, art });
    for (const t of only.touched) {
      expect(t.x).toBeGreaterThanOrEqual(px.x0);
      expect(t.y).toBeGreaterThanOrEqual(px.y0);
      expect(t.x + t.w).toBeLessThanOrEqual(px.x1);
      expect(t.y + t.h).toBeLessThanOrEqual(px.y1);
    }
    // Vector drawing is clipped to the rectangle.
    const clips = only.calls.filter((c) => c.op === "rect").map((c) => c.args as number[]);
    expect(clips).toContainEqual([px.x0, px.y0, px.x1 - px.x0, px.y1 - px.y0]);
    for (const [x, y, w, h] of clips) {
      expect(x).toBeGreaterThanOrEqual(px.x0);
      expect(y).toBeGreaterThanOrEqual(px.y0);
      expect(x! + w!).toBeLessThanOrEqual(px.x1);
      expect(y! + h!).toBeLessThanOrEqual(px.y1);
    }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const inside = x >= px.x0 && x < px.x1 && y >= px.y0 && y < px.y1;
        if (!inside) expect(only.buffer[i + 3]).toBe(0);
        else expect([...only.buffer.subarray(i, i + 4)]).toEqual([...full.buffer.subarray(i, i + 4)]);
      }

    // Repainting a rectangle of an already painted map changes nothing.
    const again = recorder(W, H);
    paintMap(again.ctx, forestSpec(), { cell: CELL, art });
    paintMapRect(again.ctx, m, rect, { cell: CELL, art });
    expect(Buffer.from(again.buffer).equals(Buffer.from(full.buffer))).toBe(true);
  });

  it("a moved object repaints inside its old and new bounds (withObjects + objectBounds)", () => {
    const art = fakeArt();
    const spec = forestSpec();
    const before = recorder(W, H);
    const m = paintMap(before.ctx, spec, { cell: CELL, art });
    const moved = forestObjects().map((o) => (o.id === "o-crate" ? { ...o, x: 9, y: 8 } : o));
    const oldB = objectBounds(spec.objects![1]!, spec, CELL);
    const newB = objectBounds(moved[1]!, spec, CELL);
    const next = withObjects(m, moved);
    paintMapRect(before.ctx, next, oldB, { cell: CELL, art });
    paintMapRect(before.ctx, next, newB, { cell: CELL, art });
    const fresh = recorder(W, H);
    paintMap(fresh.ctx, forestSpec(moved), { cell: CELL, art });
    expect(Buffer.from(before.buffer).equals(Buffer.from(fresh.buffer))).toBe(true);
  });

  it("draws sprites by ref and by stand-in, Classic for hulls, with shadows toward the bottom-right", () => {
    const art = fakeArt();
    const r = recorder(W, H);
    paintMap(r.ctx, forestSpec(), { cell: CELL, art });
    const images = r.calls.filter((c) => c.op === "drawImage").map((c) => c.args[0] as { fake: string; url: string; width: number });
    const sprites = images.filter((i) => i.fake === "sprite").map((i) => i.url);
    expect(sprites).toContain(keyUrl("common/wooden-crate"));
    expect(sprites).toContain("https://files.test/statue.webp");
    expect(sprites.length).toBe(4); // tree (stand-in), crate, campfire (stand-in), statue; the hull is Classic
    // Each non-flat sprite has a shadow drawn before it, offset down-right of the sprite.
    const shadows = r.calls.filter((c) => c.op === "drawImage" && (c.args[0] as { fake: string }).fake === "shadow");
    expect(shadows.length).toBe(4);
    // The hull is drawn Classic (its plank fill), before every sprite.
    const hullFill = r.calls.findIndex((c) => c.op === "set:fillStyle" && c.args[0] === "#9a6a3c");
    const firstSprite = r.calls.findIndex((c) => c.op === "drawImage");
    expect(hullFill).toBeGreaterThan(-1);
    expect(hullFill).toBeLessThan(firstSprite);
  });

  it("every shadow falls the same way, longer for tall sprites; flat sprites cast none (D5)", () => {
    expect(shadowSpec("flat", 1, 48)).toBeNull();
    const low = shadowSpec("low", 1, 48)!;
    const tall = shadowSpec("tall", 1, 48)!;
    for (const s of [low, tall, shadowSpec("low", 0.5, 8)!, shadowSpec("tall", 2, 4)!]) {
      expect(s.dx).toBeGreaterThan(0);
      expect(s.dy).toBeGreaterThan(0);
      expect(s.dx / s.dy).toBeCloseTo(SHADOW_DIR.x / SHADOW_DIR.y);
    }
    expect(Math.hypot(tall.dx, tall.dy)).toBeGreaterThan(Math.hypot(low.dx, low.dy));
    expect(tall.blur).toBeGreaterThan(low.blur);
  });

  it("a missing sprite falls back to the Classic drawing of its kind", () => {
    const art = fakeArt();
    art.missing.add(keyUrl("common/wooden-crate"));
    const r = recorder(W, H);
    paintMap(r.ctx, forestSpec([{ id: "o-crate", kind: "crate", x: 7, y: 7, r: 1, sprite: { builtin: "common/wooden-crate" } }]), { cell: CELL, art });
    expect(r.calls.some((c) => c.op === "drawImage")).toBe(false);
    // The Classic crate: its box and diagonal planks.
    expect(r.calls.some((c) => c.op === "strokeRect")).toBe(true);
    expect(r.calls.some((c) => c.op === "set:fillStyle" && c.args[0] === "#a77a48")).toBe(true);
    // Loaded, it is a sprite and the Classic box is gone.
    const loaded = recorder(W, H);
    paintMap(loaded.ctx, forestSpec([{ id: "o-crate", kind: "crate", x: 7, y: 7, r: 1, sprite: { builtin: "common/wooden-crate" } }]), { cell: CELL, art: fakeArt() });
    expect(loaded.calls.some((c) => c.op === "strokeRect")).toBe(false);
    expect(loaded.calls.some((c) => c.op === "drawImage")).toBe(true);
  });

  it("lit lights keep a glow, switched-off lights have none", () => {
    const fire = (lit: boolean): SpritePaintObject[] => [{ id: "o-fire", kind: "campfire", x: 6, y: 6, r: 1, lit }];
    const on = recorder(W, H);
    paintMap(on.ctx, forestSpec(fire(true)), { cell: CELL, art: fakeArt(), vignette: false });
    expect(on.calls.filter((c) => c.op === "createRadialGradient")).toHaveLength(1);
    const off = recorder(W, H);
    paintMap(off.ctx, forestSpec(fire(false)), { cell: CELL, art: fakeArt(), vignette: false });
    expect(off.calls.filter((c) => c.op === "createRadialGradient")).toHaveLength(0);
  });

  it("textures replace the Classic terrain; wall keeps its Classic pixels; nothing loaded = Classic", () => {
    const spec = forestSpec([]);
    const sprites = recorder(W, H);
    paintMap(sprites.ctx, spec, { cell: CELL, art: fakeArt(), grid: false, vignette: false });
    const classic = recorder(W, H);
    classicPaintMap(classic.ctx, spec, { cell: CELL, grid: false, vignette: false });
    const px = (b: Uint8ClampedArray, x: number, y: number) => [...b.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
    // Deep inside the wall block (squares 11..13 x 0..1): identical to Classic.
    for (const [x, y] of [[12 * CELL + 3, 1 * CELL + 2], [13 * CELL + 1, 0 * CELL + 5]] as const) expect(px(sprites.buffer, x, y)).toEqual(px(classic.buffer, x, y));
    // Open grass (square 8, 8): textured, so not the Classic pixel.
    expect(px(sprites.buffer, 8 * CELL + 4, 8 * CELL + 4)).not.toEqual(px(classic.buffer, 8 * CELL + 4, 8 * CELL + 4));

    // No texture loaded at all: the terrain is the Classic terrain everywhere.
    const art = fakeArt();
    for (const t of ["grass", "path", "water"] as const) for (const tex of terrainTextures(t, "forest")) art.missing.add(tex.url);
    const none = recorder(W, H);
    paintMap(none.ctx, spec, { cell: CELL, art, grid: false, vignette: false });
    expect(Buffer.from(none.buffer).equals(Buffer.from(classic.buffer))).toBe(true);
  });

  it("several textures of one class are mixed across the map, and hand-painted texture cells win", () => {
    const spec: SpritePaintSpec = { w: 24, h: 24, seed: 9, base: "grass", areas: [], objects: [], setting: "forest" };
    const r = recorder(24 * CELL, 24 * CELL);
    paintMap(r.ctx, spec, { cell: CELL, art: fakeArt(), grid: false, vignette: false });
    // Base colours of the textures (patternTexture) show up in different places: count distinct dominant colours.
    const colours = new Set<string>();
    for (let y = 2; y < 24 * CELL; y += 9)
      for (let x = 2; x < 24 * CELL; x += 9) {
        const i = (y * 24 * CELL + x) * 4;
        colours.add(`${r.buffer[i]! >> 4},${r.buffer[i + 1]! >> 4}`);
      }
    expect(colours.size).toBeGreaterThan(3);

    const cellKeyed: SpritePaintSpec = { ...spec, textures: { "5,5": { builtin: "forest/muddy-path" } } };
    const painted = recorder(24 * CELL, 24 * CELL);
    const m = paintMap(painted.ctx, cellKeyed, { cell: CELL, art: fakeArt(), grid: false, vignette: false });
    const at = (b: Uint8ClampedArray) => [...b.subarray(((5 * CELL + 4) * 24 * CELL + 5 * CELL + 4) * 4, ((5 * CELL + 4) * 24 * CELL + 5 * CELL + 4) * 4 + 3)];
    expect(at(painted.buffer)).not.toEqual(at(r.buffer));
    expect(mapUrls(m).textures.has(keyUrl("forest/muddy-path"))).toBe(true);
  });

  it("mapUrls lists every sprite with its bounds, for the repaint when an image arrives", () => {
    const m = prepareMap(forestSpec());
    const urls = mapUrls(m, CELL);
    expect(urls.objects.get("https://files.test/statue.webp")).toHaveLength(1);
    expect(urls.objects.get(keyUrl("common/wooden-crate"))).toHaveLength(1);
    expect([...urls.textures].length).toBeGreaterThan(3);
  });
});

describe("loader (SpriteImages)", () => {
  function setup() {
    const canvases: { w: number; h: number; ops: string[] }[] = [];
    const pending = new Map<string, { resolve: (i: LoadedImage) => void; reject: (e: unknown) => void }>();
    const loads: string[] = [];
    const images = new SpriteImages(
      (url) =>
        new Promise<LoadedImage>((resolve, reject) => {
          loads.push(url);
          pending.set(url, { resolve, reject });
        }),
      (w, h) => {
        const record = { w, h, ops: [] as string[] };
        canvases.push(record);
        const ctx = new Proxy({} as Record<string, unknown>, {
          get: (t, p) => (typeof p === "string" && p in t ? t[p] : (...a: unknown[]) => (record.ops.push(String(p)), p === "getImageData" ? { data: new Uint8ClampedArray((a[2] as number) * (a[3] as number) * 4) } : undefined)),
          set: (t, p, v) => ((t[p as string] = v), true),
        });
        return { width: w, height: h, getContext: () => ctx as unknown as CanvasRenderingContext2D } as never;
      },
    );
    return { images, canvases, pending, loads };
  }

  it("loads an image once, lazily, tells listeners, and caches every drawn size (no re-decoding per paint)", async () => {
    const { images, canvases, pending, loads } = setup();
    const heard: string[] = [];
    images.subscribe((url) => heard.push(url));
    expect(images.sprite("/a.webp", 48, 48)).toBeNull();
    expect(images.sprite("/a.webp", 48, 48)).toBeNull();
    expect(loads).toEqual(["/a.webp"]);
    pending.get("/a.webp")!.resolve({ width: 160, height: 160 } as LoadedImage);
    await Promise.resolve();
    await Promise.resolve();
    expect(heard).toEqual(["/a.webp"]);

    const first = images.sprite("/a.webp", 48, 48);
    expect(first).not.toBeNull();
    expect(images.sprite("/a.webp", 48, 48)).toBe(first);
    expect(canvases).toHaveLength(1);
    const spec = shadowSpec("tall", 0.5, 48)!;
    const shadow = images.shadow("/a.webp", 48, 48, 0.5, spec);
    expect(images.shadow("/a.webp", 48, 48, 0.5, spec)).toBe(shadow);
    expect(canvases).toHaveLength(2);
    const tex = images.texture("/a.webp", 192);
    expect(images.texture("/a.webp", 192)).toBe(tex);
    expect(canvases).toHaveLength(3);
    // Another size is another bitmap, from the same decoded image.
    images.sprite("/a.webp", 96, 96);
    expect(canvases).toHaveLength(4);
    expect(loads).toEqual(["/a.webp"]);
  });

  it("a failed image stays missing (the painter keeps the Classic drawing)", async () => {
    const { images, pending, loads } = setup();
    const heard: string[] = [];
    images.subscribe((url) => heard.push(url));
    expect(images.texture("/bad.webp", 64)).toBeNull();
    pending.get("/bad.webp")!.reject(new Error("404"));
    await Promise.resolve();
    await Promise.resolve();
    expect(images.texture("/bad.webp", 64)).toBeNull();
    expect(images.sprite("/bad.webp", 8, 8)).toBeNull();
    expect(loads).toEqual(["/bad.webp"]);
    expect(heard).toEqual([]);
  });
});
