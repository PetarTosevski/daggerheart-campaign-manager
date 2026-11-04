/**
 * Plan lanes-2 wave 9, AO (dcm-lqnt): the area-effect cutter (scripts/sprite-packs/lib/areas.ts) on small synthetic
 * sheets laid out like docs/sprite-packs/area-effects-prompts.md: a 2 x 2 fill sheet with a magenta cross, a 3 x 3
 * decal sheet and a 4-row wall sheet on flat magenta. The real sheets are never committed.
 */
// @vitest-environment node

import { describe, expect, it } from "vitest";

import { areaManifest, cutAreaSheet, DECAL_PX, encodeArea, FILL_PX, WALL_PX } from "../../scripts/sprite-packs/lib/areas";
import { areaManifestSource } from "../../scripts/sprite-packs/lib/areas-manifest";
import { AREA_FILE } from "../../src/lib/combat-map/area-effects";
import type { RgbaImage } from "../../src/lib/sprite-packs/cut";

const MAGENTA = [255, 0, 255] as const;

function sheet(size: number, paint: (x: number, y: number) => readonly [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return { width: size, height: size, data };
}

/** Four noisy swatches (one colour each) with an 8 px magenta cross. */
function fillSheet(): RgbaImage {
  const colours = [
    [40, 30, 60],
    [180, 180, 180],
    [60, 60, 60],
    [20, 30, 50],
  ];
  return sheet(256, (x, y) => {
    if (Math.abs(x - 128) < 4 || Math.abs(y - 128) < 4) return MAGENTA;
    const c = colours[(y < 128 ? 0 : 2) + (x < 128 ? 0 : 1)]!;
    const n = ((x * 7 + y * 13) % 17) - 8;
    return [c[0]! + n, c[1]! + n, c[2]! + n];
  });
}

/** Nine rings, one per cell of a 3 x 3 grid, on magenta. */
function decalSheet(): RgbaImage {
  const cell = 300 / 3;
  return sheet(300, (x, y) => {
    const cx = (Math.floor(x / cell) + 0.5) * cell;
    const cy = (Math.floor(y / cell) + 0.5) * cell;
    const d = Math.hypot(x - cx, y - cy);
    return d > 25 && d < 38 ? [60, 160, 240] : MAGENTA;
  });
}

/** Four long strips on magenta. */
function wallSheet(): RgbaImage {
  return sheet(320, (x, y) => {
    const row = Math.floor(y / 80);
    const inside = x > 10 && x < 310 && Math.abs(y - (row * 80 + 40)) < 12;
    return inside ? [240, 120 + row * 20, 20] : MAGENTA;
  });
}

describe("area cutter (scripts/sprite-packs/lib/areas.ts)", () => {
  it("cuts a fill sheet into its four kinds at FILL_PX, opaque; the swirl fills are not seam-fixed", async () => {
    const cuts = await cutAreaSheet({ sheet: "fills-2", image: fillSheet() });
    expect(cuts.map((c) => c.kind)).toEqual(["ink", "acid", "brambles", "generic"]);
    for (const c of cuts) {
      expect(c.image.width).toBe(FILL_PX);
      expect(c.image.height).toBe(FILL_PX);
      expect(c.alpha).toBe(false);
    }
    expect(cuts[0]!.notes).toContain("scaled (no seam fix)");
    expect(cuts[1]!.notes.some((n) => n.startsWith("tileability"))).toBe(true);
    // No magenta from the cross is left in a swatch.
    const px = cuts[3]!.image.data;
    let magenta = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i]! > 200 && px[i + 1]! < 60 && px[i + 2]! > 200) magenta++;
    expect(magenta).toBe(0);
  });

  it("cuts the decal sheet into nine centred squares with a see-through middle and background", async () => {
    const cuts = await cutAreaSheet({ sheet: "decals", image: decalSheet() });
    expect(cuts.map((c) => c.kind)).toEqual(["rune-circle", "radiant-circle", "moonlight", "healing-barrier", "silence", "fortress", "ritual-dark", "frost-glyph", "shadow-pool"]);
    const ring = cuts[0]!.image;
    expect([ring.width, ring.height]).toEqual([DECAL_PX, DECAL_PX]);
    const alphaAt = (x: number, y: number) => ring.data[(y * ring.width + x) * 4 + 3]!;
    expect(alphaAt(DECAL_PX / 2, DECAL_PX / 2)).toBe(0);
    expect(alphaAt(2, 2)).toBe(0);
    // Somewhere on the ring is opaque.
    let opaque = 0;
    for (let x = 0; x < DECAL_PX; x++) if (alphaAt(x, DECAL_PX / 2) > 200) opaque++;
    expect(opaque).toBeGreaterThan(0);
  });

  it("cuts the wall sheet into four strips WALL_PX high, keeping their aspect", async () => {
    const cuts = await cutAreaSheet({ sheet: "walls", image: wallSheet() });
    expect(cuts.map((c) => c.kind)).toEqual(["fire-wall", "force-wall", "hunger-wall", "shadow-line"]);
    for (const c of cuts) {
      expect(c.image.height).toBe(WALL_PX);
      expect(c.image.width).toBeGreaterThan(WALL_PX * 5);
      expect(c.alpha).toBe(true);
    }
  });

  it("encodes content-hashed WebPs and writes a stable manifest", async () => {
    const cuts = await cutAreaSheet({ sheet: "walls", image: wallSheet() });
    const encoded = await Promise.all(cuts.map(encodeArea));
    for (const e of encoded) expect(e.file).toMatch(AREA_FILE);
    const again = await encodeArea(cuts[0]!);
    expect(again.file).toBe(encoded[0]!.file);
    const source = areaManifestSource(areaManifest(encoded));
    expect(source).toContain(`"fire-wall": {"file":"${encoded[0]!.file}"`);
    expect(source.indexOf('"fire-wall"')).toBeLessThan(source.indexOf('"shadow-line"'));
  });
});
