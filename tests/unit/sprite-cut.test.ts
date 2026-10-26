import { describe, expect, it } from "vitest";

import {
  SHEET_GRIDS,
  TRIM_MARGIN,
  cutSheet,
  cutTerrain,
  keyMagenta,
  magentaScore,
  removeGridLines,
  seamFix,
  tileability,
  trimToAlpha,
} from "../../src/lib/sprite-packs/cut";
import type { RgbaImage, SpriteCut } from "../../src/lib/sprite-packs/cut";
import { stripMagentaFrame } from "../../scripts/sprite-packs/lib/pipeline";
import {
  PALETTE,
  blank,
  fillEllipse,
  fillRect,
  getPx,
  gridCells,
  jpegLike,
  objectSheet,
  rng,
  setPx,
  terrainSheet,
} from "../fixtures/sprite-sheets/synthetic";
import type { Rgb } from "../fixtures/sprite-sheets/synthetic";

/** Colour at the centre of a cut sprite. */
function centre(s: SpriteCut): Rgb {
  const [r, g, b] = getPx(s.image, Math.floor(s.image.width / 2), Math.floor(s.image.height / 2));
  return [r, g, b];
}

function near(a: Rgb, b: Rgb, tol = 16): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}

/** Visible pixels with a transparent 4-neighbour. */
function edgePixels(img: RgbaImage): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const a = (x: number, y: number) =>
    x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : (getPx(img, x, y)[3] ?? 0);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if (a(x, y) === 0) continue;
      if (a(x - 1, y) && a(x + 1, y) && a(x, y - 1) && a(x, y + 1)) continue;
      const [r, g, b] = getPx(img, x, y);
      out.push([r, g, b]);
    }
  return out;
}

describe("magenta key", () => {
  it("scores magenta and its shadow high, object colours low", () => {
    expect(magentaScore(255, 0, 255)).toBeCloseTo(1);
    expect(magentaScore(120, 10, 120)).toBeGreaterThan(0.8); // drop shadow on the background
    expect(magentaScore(120, 80, 50)).toBeLessThan(0);
    expect(magentaScore(15, 12, 18)).toBeLessThan(0.3); // black outline
    expect(magentaScore(200, 200, 200)).toBe(0);
  });

  it("keys the flat background to alpha 0 and keeps objects opaque", () => {
    const img = blank(8, 8);
    fillRect(img, 2, 2, 4, 4, [40, 160, 60]);
    const { image, alreadyTransparent } = keyMagenta(img);
    expect(alreadyTransparent).toBe(false);
    expect(getPx(image, 0, 0)[3]).toBe(0);
    expect(getPx(image, 3, 3)[3]).toBe(255);
    expect(getPx(img, 0, 0)[3]).toBe(255); // input unchanged
  });
});

describe("cutSheet", () => {
  it("cuts a clean 4 x 4 props sheet into 16 trimmed sprites in reading order", () => {
    const { img, shapes } = objectSheet(256, 4, 4);
    const cut = cutSheet(img, { layout: "props" });
    expect(cut.expected).toBe(16);
    expect(cut.method).toBe("bands");
    expect(cut.flags).toEqual([]);
    expect(cut.sprites).toHaveLength(16);
    cut.sprites.forEach((s, i) => {
      const shape = shapes[i];
      if (!shape) throw new Error("missing shape");
      expect(s.index).toBe(i);
      expect(near(centre(s), shape.colour)).toBe(true);
      // 1 px erosion on each side, then the trim margin on each side.
      expect(s.image.width).toBe(shape.w - 2 + TRIM_MARGIN * 2);
      expect(s.image.height).toBe(shape.h - 2 + TRIM_MARGIN * 2);
      expect(s.box.x).toBe(shape.x + 1 - TRIM_MARGIN);
      expect(s.box.y).toBe(shape.y + 1 - TRIM_MARGIN);
      expect(s.fragments).toBe(1);
      expect(s.touchesBorder).toBe(false);
      // The margin is transparent.
      expect(getPx(s.image, 0, 0)[3]).toBe(0);
    });
  });

  it("leaves no magenta in edge pixels of a JPEG-like sheet", () => {
    const { img, shapes } = objectSheet(384, 3, 3);
    jpegLike(img, 42);
    const cut = cutSheet(img, { layout: "large" });
    expect(cut.sprites).toHaveLength(9);
    expect(cut.fringe.before).toBeGreaterThan(0.02);
    expect(cut.fringe.after).toBeLessThan(0.005);
    for (const s of cut.sprites) {
      const edges = edgePixels(s.image);
      expect(edges.length).toBeGreaterThan(0);
      for (const [r, g, b] of edges) expect(Math.min(r, b) - g).toBeLessThanOrEqual(0);
    }
    cut.sprites.forEach((s, i) => {
      const shape = shapes[i];
      if (!shape) throw new Error("missing shape");
      expect(near(centre(s), shape.colour, 24)).toBe(true);
      // Within a few px of the drawn size: half-mixed ring pixels stay as soft edge, the rest is keyed or eroded away.
      expect(Math.abs(s.image.width - (shape.w + 2))).toBeLessThanOrEqual(4);
    });
  });

  it("removes thin drawn grid lines before finding the cells", () => {
    const { img, shapes } = objectSheet(384, 3, 3);
    const grey: Rgb = [215, 215, 215];
    for (const at of [127, 255]) {
      fillRect(img, 0, at, 384, 2, grey);
      fillRect(img, at, 0, 2, 384, grey);
    }
    const cut = cutSheet(img, { layout: "large" });
    const lines = cut.flags.find((f) => f.code === "lines-removed");
    expect(lines).toEqual({ code: "lines-removed", rows: [128, 256], cols: [128, 256] });
    expect(cut.sprites).toHaveLength(9);
    expect(cut.flags.some((f) => f.code === "count-mismatch")).toBe(false);
    cut.sprites.forEach((s, i) => {
      const shape = shapes[i];
      if (!shape) throw new Error("missing shape");
      expect(s.image.width).toBe(shape.w + 2);
      expect(s.image.height).toBe(shape.h + 2);
    });
  });

  it("reports 10 objects for 9 names instead of forcing them into 9", () => {
    // 3 x 3, but the first row holds four objects.
    const img = blank(400, 400);
    const top = [0, 1, 2, 3].map((i) => ({ x: 20 + i * 100, y: 30, w: 60, h: 60 }));
    const rest = gridCells(400, 400, 3, 3)
      .slice(3)
      .map((c) => ({ x: c.x + 30, y: c.y + 30, w: c.w - 60, h: c.h - 60 }));
    [...top, ...rest].forEach((b, i) => fillRect(img, b.x, b.y, b.w, b.h, PALETTE[i] ?? [0, 0, 0]));
    const cut = cutSheet(img, { layout: "large" });
    expect(cut.method).toBe("components");
    expect(cut.flags[0]).toEqual({ code: "count-mismatch", found: 10, expected: 9 });
    expect(cut.sprites).toHaveLength(10);
    cut.sprites.forEach((s, i) => expect(near(centre(s), PALETTE[i] ?? [0, 0, 0])).toBe(true));
  });

  it("keeps an object that touches the border and flags it", () => {
    const { img } = objectSheet(256, 4, 4);
    fillRect(img, 0, 0, 64, 64, [255, 0, 255]); // clear cell 0
    fillRect(img, 0, 15, 40, 30, PALETTE[0] ?? [0, 0, 0]); // flush with the left edge
    const cut = cutSheet(img, { layout: "props" });
    expect(cut.sprites).toHaveLength(16);
    expect(cut.flags).toContainEqual({ code: "touches-border", index: 0 });
    expect(cut.sprites[0]?.touchesBorder).toBe(true);
    // Padded past the sheet edge, so the margin stays transparent.
    expect(cut.sprites[0]?.box.x).toBe(-TRIM_MARGIN);
    expect(cut.sprites.filter((s) => s.touchesBorder)).toHaveLength(1);
  });

  it("follows an uneven 3 x 3 grid", () => {
    const img = blank(600, 600);
    const cols: Array<[number, number]> = [
      [10, 150],
      [215, 285],
      [360, 580],
    ];
    const rows: Array<[number, number]> = [
      [20, 120],
      [170, 230],
      [300, 560],
    ];
    rows.forEach(([y0, y1], r) =>
      cols.forEach(([x0, x1], c) => {
        const i = r * 3 + c;
        fillEllipse(img, x0, y0, x1 - x0, y1 - y0, PALETTE[i] ?? [0, 0, 0]);
      }),
    );
    const cut = cutSheet(img, { layout: "large" });
    expect(cut.method).toBe("bands");
    expect(cut.flags).toEqual([]);
    expect(cut.sprites).toHaveLength(9);
    cut.sprites.forEach((s, i) => expect(near(centre(s), PALETTE[i] ?? [0, 0, 0])).toBe(true));
  });

  it("merges the fragments inside one cell into one object", () => {
    const { img } = objectSheet(384, 3, 3);
    // Cell 4 (middle): replace the shape with scattered bones and a pair of stones far apart.
    fillRect(img, 128, 128, 128, 128, [255, 0, 255]);
    const bone: Rgb = [230, 220, 190];
    for (let k = 0; k < 6; k++) fillRect(img, 140 + k * 17, 140 + (k % 2) * 14, 10, 5, bone);
    fillEllipse(img, 140, 200, 30, 30, [130, 130, 130]);
    fillEllipse(img, 210, 200, 30, 30, [130, 130, 130]);
    const cut = cutSheet(img, { layout: "large" });
    expect(cut.flags.some((f) => f.code === "count-mismatch")).toBe(false);
    expect(cut.sprites).toHaveLength(9);
    const mid = cut.sprites[4];
    expect(mid?.fragments).toBe(8);
    // The cut spans both stones.
    expect(mid?.box.x).toBeLessThanOrEqual(141);
    expect((mid?.box.x ?? 0) + (mid?.box.w ?? 0)).toBeGreaterThanOrEqual(239);
  });

  it("uses an already transparent sheet as it is", () => {
    const img = blank(128, 128, [0, 0, 0], 0);
    const cells = gridCells(128, 128, 2, 2);
    // A purple object would be keyed by the magenta key; here it must survive untouched.
    const purple: Rgb = [200, 40, 210];
    cells.forEach((c) => fillRect(img, c.x + 16, c.y + 16, 32, 32, purple));
    const cut = cutSheet(img, { layout: { rows: 2, cols: 2 } });
    expect(cut.flags).toContainEqual({ code: "already-transparent" });
    expect(cut.sprites).toHaveLength(4);
    for (const s of cut.sprites) {
      expect(s.image.width).toBe(32 + TRIM_MARGIN * 2);
      expect(centre(s)).toEqual(purple);
      expect(edgePixels(s.image)[0]).toEqual(purple); // no despill, no erosion
    }
  });

  it("cuts a single sprite from the whole image", () => {
    const img = blank(100, 80);
    fillEllipse(img, 20, 10, 50, 40, [40, 80, 200]);
    setPx(img, 2, 2, [40, 80, 200]); // an isolated JPEG speck far away is dropped
    const cut = cutSheet(img, { layout: "single" });
    expect(cut.method).toBe("single");
    expect(cut.sprites).toHaveLength(1);
    expect(cut.sprites[0]?.image.width).toBe(50 - 2 + TRIM_MARGIN * 2);
  });

  it("flags an empty sheet", () => {
    const cut = cutSheet(blank(64, 64), { layout: "props" });
    expect(cut.sprites).toHaveLength(0);
    expect(cut.flags).toContainEqual({ code: "count-mismatch", found: 0, expected: 16 });
    expect(cut.flags).toContainEqual({ code: "empty" });
  });

  it("rejects a buffer of the wrong length", () => {
    expect(() => cutSheet({ width: 4, height: 4, data: new Uint8ClampedArray(10) }, { layout: "single" })).toThrow();
  });

  it("knows the prompt layouts", () => {
    expect(SHEET_GRIDS.props).toEqual({ rows: 4, cols: 4 });
    expect(SHEET_GRIDS.large).toEqual({ rows: 3, cols: 3 });
  });
});

describe("removeGridLines", () => {
  it("does nothing on a sheet without lines", () => {
    const { img } = objectSheet(256, 4, 4);
    const { image } = keyMagenta(img);
    expect(removeGridLines(image)).toEqual({ rows: [], cols: [] });
  });
});

describe("trimToAlpha", () => {
  it("crops to the alpha bounds plus the margin", () => {
    const img = blank(20, 20, [0, 0, 0], 0);
    fillRect(img, 5, 6, 4, 3, [10, 20, 30]);
    const t = trimToAlpha(img);
    expect(t?.box).toEqual({ x: 3, y: 4, w: 8, h: 7 });
    expect(t?.image.width).toBe(8);
    expect(trimToAlpha(blank(4, 4, [0, 0, 0], 0))).toBeNull();
  });
});

describe("cutTerrain", () => {
  it("finds the four swatches inside a white frame and a thin magenta cross", () => {
    const { img, boxes, bases } = terrainSheet(400, 24, 8);
    const cut = cutTerrain(img);
    expect(cut.flags).toEqual([]);
    expect(cut.inner).toEqual({ x: 24, y: 24, w: 352, h: 352 });
    expect(cut.swatches).toHaveLength(4);
    cut.swatches.forEach((s, i) => {
      const drawn = boxes[i];
      if (!drawn) throw new Error("missing box");
      expect(s.index).toBe(i);
      expect(s.box.w).toBe(s.box.h);
      // Inside the drawn swatch, past the bleed.
      expect(s.box.x).toBeGreaterThan(drawn.x);
      expect(s.box.y).toBeGreaterThan(drawn.y);
      expect(s.box.x + s.box.w).toBeLessThan(drawn.x + drawn.w);
      expect(s.box.y + s.box.h).toBeLessThan(drawn.y + drawn.h);
      expect(s.box.w).toBeGreaterThan(drawn.w - 12);
      // No frame white, no magenta, the right ground.
      let sum = [0, 0, 0];
      for (let y = 0; y < s.image.height; y++)
        for (let x = 0; x < s.image.width; x++) {
          const [r, g, b] = getPx(s.image, x, y);
          expect(magentaScore(r, g, b)).toBeLessThan(0.3);
          sum = [sum[0]! + r, sum[1]! + g, sum[2]! + b];
        }
      const n = s.image.width * s.image.height;
      expect(near([sum[0]! / n, sum[1]! / n, sum[2]! / n], bases[i] ?? [0, 0, 0], 6)).toBe(true);
    });
  });

  it("works without a frame", () => {
    const { img } = terrainSheet(300, 0, 6);
    const cut = cutTerrain(img);
    expect(cut.inner).toEqual({ x: 0, y: 0, w: 300, h: 300 });
    expect(cut.flags).toEqual([]);
    // 147 px swatches minus the bleed inset on both sides.
    for (const s of cut.swatches) expect(s.box.w).toBe(142);
  });

  /** A sheet drawn inside a plain magenta outer frame `m` px wide (TASK-SP-P11Z's batch-2 terrain sheets). */
  function inMagentaFrame(sheet: RgbaImage, m: number): RgbaImage {
    const out = blank(sheet.width + 2 * m, sheet.height + 2 * m, [255, 0, 255]);
    for (let y = 0; y < sheet.height; y++)
      out.data.set(sheet.data.subarray(y * sheet.width * 4, (y + 1) * sheet.width * 4), ((y + m) * out.width + m) * 4);
    return out;
  }

  it("strips a plain magenta outer frame, with or without a white frame inside it", () => {
    for (const white of [0, 16]) {
      const { img: plain, bases } = terrainSheet(300, white, 6);
      const before = cutTerrain(plain);
      const cut = cutTerrain(inMagentaFrame(plain, 30));
      expect(cut.flags).toEqual([]);
      // The same cut as on the sheet without the magenta frame, moved by the frame on the input sheet.
      expect(cut.inner).toEqual({ ...before.inner, x: before.inner.x + 30, y: before.inner.y + 30 });
      cut.swatches.forEach((s, i) => {
        const b = before.swatches[i];
        if (!b) throw new Error("missing swatch");
        expect(s.box).toEqual({ ...b.box, x: b.box.x + 30, y: b.box.y + 30 });
        expect(s.image).toEqual(b.image);
        const [r, g, bl] = getPx(s.image, Math.floor(s.image.width / 2), Math.floor(s.image.height / 2));
        expect(near([r, g, bl], bases[i] ?? [0, 0, 0], 30)).toBe(true);
      });
    }
  });

  it("cuts the same swatches as the build script's stripMagentaFrame then cutTerrain", () => {
    const framed = inMagentaFrame(terrainSheet(320, 12, 8).img, 24);
    jpegLike(framed, 3);
    const viaScript = cutTerrain(stripMagentaFrame(framed).image);
    const direct = cutTerrain(framed);
    expect(direct.flags).toEqual(viaScript.flags);
    expect(direct.swatches.map((s) => s.image)).toEqual(viaScript.swatches.map((s) => s.image));
  });

  it("flags a sheet without a cross and splits it in the middle", () => {
    const img = blank(200, 200, [100, 120, 80]);
    const r = rng(1);
    for (let i = 0; i < img.data.length; i += 4) img.data[i] = 80 + Math.floor(r() * 40);
    const cut = cutTerrain(img);
    expect(cut.flags).toEqual([
      { code: "no-cross", axis: "x" },
      { code: "no-cross", axis: "y" },
    ]);
    expect(cut.swatches).toHaveLength(4);
  });
});

describe("seamFix and tileability", () => {
  /** A swatch with a strong left-to-right and top-to-bottom gradient: its wrap seams are hard. */
  function gradient(size: number): RgbaImage {
    const img = blank(size, size);
    const r = rng(9);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const n = (r() - 0.5) * 20;
        setPx(img, x, y, [40 + (x * 180) / size + n, 60 + (y * 150) / size + n, 90 + n]);
      }
    return img;
  }

  it("scores a hard-seamed swatch low and a seam-fixed one near 1", () => {
    const img = gradient(96);
    expect(tileability(img)).toBeLessThan(0.3);
    const fixed = seamFix(img);
    expect(fixed.width).toBe(96);
    expect(tileability(fixed)).toBeGreaterThan(0.85);
    expect(getPx(img, 0, 0)).not.toEqual(getPx(fixed, 0, 0)); // the input is not changed in place
  });

  it("scores a flat swatch 1", () => {
    expect(tileability(blank(16, 16, [10, 20, 30]))).toBe(1);
  });
});

describe("purity", () => {
  it("imports nothing from Node, the DOM or other app folders", () => {
    const sources = import.meta.glob("../../src/lib/sprite-packs/cut/*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const [, src] of files) {
      const text = String(src);
      const specifiers = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const s of specifiers) expect(s).toMatch(/^\.\/[a-z-]+$/);
      expect(text).not.toMatch(/\b(document|window|HTMLCanvasElement|Buffer|require)\b/);
    }
  });
});
