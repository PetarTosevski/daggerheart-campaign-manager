import { describe, expect, it } from "vitest";

import { prepareMap as classicPrepareMap } from "../../src/lib/combat-map/painter";
import type { SpriteArt } from "../../src/lib/combat-map/sprites/loader";
import { drawGlow, objectPx, placedBounds, type PlacedObject } from "../../src/lib/combat-map/sprites/objects";
import { shadowFloors, shadowSpec } from "../../src/lib/combat-map/sprites/shadows";
import { compositeTextures, loadTiles, planTextures, terrainPx, type SpritePaintArea } from "../../src/lib/combat-map/sprites/terrain";

// Plan sharp-4k HD6: the fixed pixel sizes of the Sprites painter follow the cell (x pixelScale(cell)), so a canvas
// painted at k = 2 (cell 96) is the k = 1 picture (cell 48) at twice the resolution, and k = 1 is unchanged.

describe("Sprites painter fixed sizes follow the cell (HD6)", () => {
  it("terrain: the wall rim probes are 7 / 14 px and the noise step 8 px at k = 1, twice that at k = 2", () => {
    expect(terrainPx(48)).toEqual({ rim: [7, 14], noiseStep: 8 });
    expect(terrainPx(96)).toEqual({ rim: [14, 28], noiseStep: 16 });
    // Thumbnails and the phone (cells up to 48) keep the k = 1 sizes.
    expect(terrainPx(16)).toEqual(terrainPx(48));
  });

  it("objects: the bounds margin is 12 px and the glow's inner radius 1 px at k = 1, twice that at k = 2", () => {
    expect(objectPx(48)).toEqual({ margin: 12, glowInner: 1 });
    expect(objectPx(96)).toEqual({ margin: 24, glowInner: 2 });
    expect(objectPx(8)).toEqual(objectPx(48));
  });

  it("shadows: the minimum offset is 2 px and the minimum blur 1 px at k = 1, twice that at k = 2", () => {
    expect(shadowFloors(48)).toEqual({ offset: 2, blur: 1 });
    expect(shadowFloors(96)).toEqual({ offset: 4, blur: 2 });
    expect(shadowFloors(4)).toEqual(shadowFloors(48));
    // At a small cell the floors bind (0.1 x 0.5 x 16 = 0.8 px offset, 0.05 x 16 = 0.8 px blur).
    const tiny = shadowSpec("low", 0.1, 16)!;
    expect(Math.hypot(tiny.dx, tiny.dy)).toBeCloseTo(2, 10);
    expect(tiny.blur).toBe(1);
    // Every shadow at k = 2 is the k = 1 shadow doubled.
    for (const [height, r] of [["low", 0.1], ["low", 1], ["tall", 0.3], ["tall", 2]] as const) {
      const a = shadowSpec(height, r, 48)!, b = shadowSpec(height, r, 96)!;
      expect(b.dx).toBeCloseTo(2 * a.dx, 10);
      expect(b.dy).toBeCloseTo(2 * a.dy, 10);
      expect(b.blur).toBeCloseTo(2 * a.blur, 10);
    }
  });

  it("an object's bounds in squares are the same at k = 1 and k = 2 (margin and shadow reach scale together)", () => {
    const p: PlacedObject = {
      o: { id: "o", kind: "crate", x: 4, y: 3, r: 0.5 },
      art: { url: "u", w: 1, h: 1, px: { w: 100, h: 100 }, height: "low", light: "none", via: "ref" },
      sw: 0.6,
      sh: 0.6,
    };
    const a = placedBounds(p, 48), b = placedBounds(p, 96);
    for (const k of ["x", "y", "w", "h"] as const) expect(b[k]).toBeCloseTo(a[k], 10);
  });

  it("a light glow's gradient starts at 1 px at k = 1 and 2 px at k = 2", () => {
    const glowInner = (cell: number) => {
      let inner = NaN;
      const ctx = {
        createRadialGradient: (_x0: number, _y0: number, r0: number) => ((inner = r0), { addColorStop: () => undefined }),
        beginPath: () => undefined,
        arc: () => undefined,
        fill: () => undefined,
      } as unknown as CanvasRenderingContext2D;
      const p: PlacedObject = {
        o: { id: "t", kind: "torch", x: 2, y: 2, r: 0.5 },
        art: { url: "t", w: 1, h: 1, px: { w: 64, h: 64 }, height: "low", light: "torch", via: "ref" },
        sw: 1,
        sh: 1,
      };
      drawGlow(ctx, p, cell, "lit");
      return inner;
    };
    expect(glowInner(48)).toBe(1);
    expect(glowInner(96)).toBe(2);
  });

  describe("textured terrain along a wall", () => {
    const AREAS: SpritePaintArea[] = [{ terrain: "wall", shape: "rect", x: 3, y: 0, w: 3, h: 4 }];
    const SPEC = { w: 6, h: 4, seed: 777, base: "grass", areas: AREAS };
    const TEX = 200;
    /** Every texture a flat grey: a textured pixel is then TEX x the brightness noise x the wall rim's shade. */
    const flatArt = {
      texture: (_url: string, size: number) => {
        const out = new Uint8ClampedArray(size * size * 4);
        for (let i = 0; i < out.length; i += 4) out.set([TEX, TEX, TEX, 255], i);
        return out;
      },
    } as unknown as SpriteArt;

    const composite = (cell: number): Uint8ClampedArray => {
      const prepared = classicPrepareMap(SPEC);
      const plan = planTextures(prepared, AREAS, undefined, undefined, "forest", new Map());
      const W = SPEC.w * cell, H = SPEC.h * cell;
      const data = new Uint8ClampedArray(W * H * 4);
      expect(compositeTextures(data, 0, 0, W, H, prepared, plan, loadTiles(plan, flatArt, cell, prepared.seed), cell)).toBe(true);
      return data;
    };
    /** Pixels in the darkest rim band (TEX x 0.58 x at most 1.09 < 135), wall pixels (left at 0) excluded. */
    const darkRim = (d: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! > 0 && d[i]! < 135) n++;
      return n;
    };

    it("the dark rim band is twice as wide at k = 2 (four times the pixels), and the picture matches pixel for pixel", () => {
      const a = composite(48), b = composite(96);
      const ratio = darkRim(b) / darkRim(a);
      // Fixed 7 / 14 px probes gave about 3.1 (the band half as wide in squares); scaled probes give 4.
      expect(ratio).toBeGreaterThan(3.8);
      expect(ratio).toBeLessThan(4.2);
      // Pixel (x, y) at k = 1 equals pixel (2x, 2y) at k = 2, except where the per-pixel feather jitter falls
      // differently right on the wall's edge (was 95 % with the fixed sizes).
      let same = 0, total = 0;
      for (let y = 0; y < SPEC.h * 48; y++)
        for (let x = 0; x < SPEC.w * 48; x++, total++)
          if (Math.abs(a[(y * SPEC.w * 48 + x) * 4]! - b[(2 * y * SPEC.w * 96 + 2 * x) * 4]!) <= 2) same++;
      expect(same / total).toBeGreaterThan(0.975);
    });
  });
});
