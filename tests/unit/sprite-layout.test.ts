import { describe, expect, it } from "vitest";

import { generateFallbackLayout } from "../../src/lib/combat-map/fallback-layout";
import { rasterize } from "../../src/lib/combat-map/raster";
import { clean, MAX_OBJECTS, mapSpecSchema } from "../../src/lib/domain/combat-map/spec";
import { CATALOG, folderOfKey } from "../../src/lib/sprite-packs/index";
import { fallbackDescription, MAX_SCATTERED_PROPS, SETTING_LAYOUT_HINT, spriteFallback, type ClassicLayout } from "../../src/lib/sprite-packs/sprite-fallback";
import { buildPalette, cleanSpriteLayout, spritePrompt, type UploadedPaletteRow } from "../../src/lib/sprite-packs/sprite-layout";

// Sprite packs P7: the sprite layout palette, prompt and cleaner (sprite-layout.ts) and the keyword fallback that
// maps the Classic keyword layout to a setting (sprite-fallback.ts).

const uploaded: UploadedPaletteRow[] = [
  { _id: "u1", name: "Standing stone", category: "object", w: 1, h: 1, sight: "block", classicKind: "boulder" },
  { _id: "u2", name: "Standing stone", category: "object", w: 1, h: 1, sight: "cover", classicKind: "rock", classicVariant: "pink" },
  { _id: "u3", name: "Moss", category: "texture", w: 4, h: 4, sight: "none", classicKind: "rubble", terrain: "grass" },
  { _id: "u4", name: "Odd", category: "object", w: 1, h: 1, sight: "none", classicKind: "dragon" },
  { _id: "u5", name: "No terrain", category: "texture", w: 4, h: 4, sight: "none", classicKind: "rubble" },
];

/** A Classic layout as convex `toLayout` makes it from the keyword layout. */
function classicLayout(desc: string, seed: number, w = 30, h = 20): ClassicLayout {
  const spec = clean({ ...generateFallbackLayout(desc, { seed, w, h }), w, h }, seed)!;
  return {
    w: spec.w,
    h: spec.h,
    base: spec.base,
    plankV: spec.plankV,
    title: spec.title,
    areas: spec.areas,
    objects: spec.objects.map(({ points, ...rest }) => (points.length > 0 ? { ...rest, points } : rest)),
  };
}

describe("buildPalette", () => {
  it("holds the setting's and common's built-ins, marking the setting's as its own", () => {
    const palette = buildPalette("tavern");
    const tavern = CATALOG.tavern;
    expect(palette.entries).toHaveLength([tavern, CATALOG.common].reduce((n, f) => n + f.props.length + f.large.length + f.terrain.length, 0));
    expect(palette.byToken.get("tavern/keg")).toMatchObject({ ref: { builtin: "tavern/keg" }, category: "object", classicKind: "barrel", own: true });
    expect(palette.byToken.get("common/barrel")).toMatchObject({ own: false });
    expect(palette.byToken.get("tavern/tavern-floorboards")).toMatchObject({ category: "texture", terrain: "wood" });
    expect(palette.entries.some((e) => folderOfKey(e.token) === "forest")).toBe(false);
  });

  it("a pack setting of its own, or an unknown id, uses common only", () => {
    for (const folder of [null, "moon", "common"]) {
      expect(new Set(buildPalette(folder).entries.map((e) => folderOfKey(e.token)))).toEqual(new Set(["common"]));
    }
  });

  it("adds uploaded sprites as custom tokens, unique, skipping unknown kinds and textures without terrain", () => {
    const palette = buildPalette("forest", uploaded);
    const custom = palette.entries.filter((e) => e.token.startsWith("custom/"));
    expect(custom.map((e) => [e.token, e.ref])).toEqual([
      ["custom/standing-stone", { uploaded: "u1" }],
      ["custom/standing-stone-2", { uploaded: "u2" }],
      ["custom/moss", { uploaded: "u3" }],
    ]);
    expect(palette.byToken.get("custom/standing-stone-2")).toMatchObject({ classicKind: "rock", classicVariant: "pink", own: true });
    expect(palette.byToken.get("custom/moss")).toMatchObject({ category: "texture", terrain: "grass", sight: "none" });
  });
});

describe("spritePrompt", () => {
  it("names the setting, lists objects with size and sight and textures with terrain, and keeps the GM's scene last", () => {
    const prompt = spritePrompt("A brawl in the inn", 30, 20, "Tavern", buildPalette("tavern", uploaded));
    expect(prompt).toContain('The SETTING is "Tavern"');
    expect(prompt).toContain("GRID: 30 columns x 20 rows");
    expect(prompt).toContain("tavern/bar-counter-two-squares (bar counter (two squares); 2x1; cover)");
    expect(prompt).toContain("tavern/candle (candle; 1x1; flat)");
    expect(prompt).toContain("custom/standing-stone (Standing stone; 1x1; blocks sight)");
    expect(prompt).toContain("tavern/kitchen-tiles (kitchen tiles; paints stone)");
    expect(prompt.endsWith("SCENE: A brawl in the inn")).toBe(true);
    expect(spritePrompt("x", 22, 15, "Tavern", buildPalette("tavern"), 42)).toMatch(/\(Variation #42: make a different layout from before\.\)$/);
  });
});

describe("cleanSpriteLayout", () => {
  const palette = buildPalette("forest", uploaded);

  it("drops unknown sprites, forces the size, clamps numbers and fills the Classic kind (D1)", () => {
    const layout = cleanSpriteLayout(
      {
        title: "  Old wood  ",
        w: 99,
        h: 1,
        base: "grass",
        areas: [
          { terrain: "dirt", texture: "custom/moss", shape: "ellipse", x: 10, y: 8, rx: 3, ry: 2 },
          { terrain: "path", shape: "path", points: [[-50, 10], [80, 12]], width: 2 },
          { terrain: "lava", shape: "star" },
        ],
        objects: [
          { sprite: "custom/standing-stone-2", x: 500, y: -500, rot: "spin", scale: 0.01 },
          { sprite: "forest/does-not-exist", x: 1, y: 1 },
          { sprite: "custom/moss", x: 2, y: 2 },
          { sprite: 7, x: 3, y: 3 },
          "nonsense",
        ],
      },
      palette,
      22,
      15,
      5,
    )!;
    expect(layout).toMatchObject({ w: 22, h: 15, base: "grass", title: "Old wood", plankV: false });
    expect(layout.areas.map((a) => [a.terrain, a.texture])).toEqual([
      ["grass", { uploaded: "u3" }],
      ["path", undefined],
    ]);
    expect(layout.areas[1]!.points).toEqual([[-4, 10], [26, 12]]);
    expect(layout.objects).toEqual([{ kind: "rock", variant: "pink", x: 26, y: -4, r: 0.3, rot: 0, sprite: { uploaded: "u2" } }]);
    // The Classic part passes C1's spec schema, so Classic draws the same map.
    const spec = { ...layout, seed: 5, objects: layout.objects.map((o) => ({ len: 2.5, span: 4, points: [], ...o })) };
    expect(mapSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("caps objects and refuses non-objects and near-empty replies", () => {
    const many = Array.from({ length: MAX_OBJECTS + 50 }, (_, i) => ({ sprite: "common/barrel", x: i % 30, y: 5 }));
    expect(cleanSpriteLayout({ objects: many }, palette, 30, 20, 1)!.objects).toHaveLength(MAX_OBJECTS);
    expect(cleanSpriteLayout(null, palette, 30, 20, 1)).toBeNull();
    expect(cleanSpriteLayout([{ objects: many }], palette, 30, 20, 1)).toBeNull();
    expect(cleanSpriteLayout({ objects: [{ sprite: "common/barrel", x: 1, y: 1 }, { sprite: "nope", x: 1, y: 1 }] }, palette, 30, 20, 1)).toBeNull();
  });
});

describe("spriteFallback", () => {
  it("steers the keyword layout with the setting's hint (built-in settings only)", () => {
    expect(fallbackDescription("A brawl", "tavern")).toBe(`A brawl (${SETTING_LAYOUT_HINT.tavern})`);
    expect(fallbackDescription("A brawl", null)).toBe("A brawl");
    expect(generateFallbackLayout(fallbackDescription("A brawl", "ship-deck"), { seed: 3, w: 30, h: 20 }).base).toBe("deep");
    expect(generateFallbackLayout(fallbackDescription("A brawl", "snow-and-tundra"), { seed: 3, w: 30, h: 20 }).base).toBe("snow");
  });

  it.each(["forest", "tavern", "snow-and-tundra", "ship-deck", "town-street-and-market", "volcanic"])(
    "maps the %s keyword layout to the setting, deterministic per seed",
    (setting) => {
      const palette = buildPalette(setting);
      for (const seed of [1, 2, 3, 77, 4242]) {
        const classic = classicLayout(fallbackDescription("A fight", setting), seed);
        const a = spriteFallback(classic, palette, setting, "Label", seed);
        expect(spriteFallback(classic, palette, setting, "Label", seed)).toEqual(a);
        expect(a.title).toBe("Label");
        expect(a.areas).toHaveLength(classic.areas.length);
        const refs = [...a.objects.flatMap((o) => ("sprite" in o ? [o.sprite] : [])), ...a.areas.flatMap((x) => (x.texture ? [x.texture] : []))];
        for (const ref of refs) expect([setting, "common"]).toContain("builtin" in ref ? folderOfKey(ref.builtin) : "uploaded");
        // The scattered props: 0-6, the setting's own 1 x 1 flat or cover props, on open squares.
        const scattered = a.objects.slice(classic.objects.length);
        expect(scattered.length).toBeLessThanOrEqual(MAX_SCATTERED_PROPS);
        const grid = rasterize({ w: classic.w, h: classic.h, base: classic.base, areas: classic.areas });
        for (const o of scattered) {
          if (!("sprite" in o) || !("builtin" in o.sprite)) throw new Error("scattered prop without a built-in sprite");
          const entry = palette.byToken.get(o.sprite.builtin)!;
          expect(entry).toMatchObject({ own: true, w: 1, h: 1 });
          expect(["none", "cover"]).toContain(entry.sight);
          expect(["wall", "void", "deep", "water", "lava"]).not.toContain(grid[Math.floor(o.y)]![Math.floor(o.x)]);
        }
      }
    },
  );

  it("scatters a varying number of props over seeds (0 to 6)", () => {
    const palette = buildPalette("tavern");
    const counts = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const classic = classicLayout(fallbackDescription("A brawl", "tavern"), seed);
      counts.add(spriteFallback(classic, palette, "tavern", "Tavern", seed).objects.length - classic.objects.length);
    }
    expect(Math.min(...counts)).toBe(0);
    expect(Math.max(...counts)).toBe(MAX_SCATTERED_PROPS);
  });

  it("a tavern keeps no trees, and objects without a stand-in stay Classic", () => {
    const classic = classicLayout(fallbackDescription("A brawl", "tavern"), 9);
    const layout = spriteFallback(classic, buildPalette("tavern"), "tavern", "Tavern", 9);
    expect(layout.objects.some((o) => o.kind === "tree")).toBe(false);
    expect(layout.areas.some((a) => a.texture !== undefined && "builtin" in a.texture && a.texture.builtin.startsWith("tavern/"))).toBe(true);
    expect(layout.objects.some((o) => !("sprite" in o))).toBe(true);
  });

  it("a pack of its own maps through common and scatters the pack's uploaded props", () => {
    const palette = buildPalette(null, [{ _id: "cog", name: "Cog", category: "object", w: 1, h: 1, sight: "cover", classicKind: "crate" }]);
    const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
    const layouts = seeds.map((seed) => spriteFallback(classicLayout("A camp with crates and barrels", seed), palette, null, "Clockwork", seed));
    const refs = layouts.flatMap((l) => l.objects.flatMap((o) => ("sprite" in o ? [o.sprite] : [])));
    expect(refs.every((r) => ("builtin" in r ? r.builtin.startsWith("common/") : r.uploaded === "cog"))).toBe(true);
    expect(refs.some((r) => "uploaded" in r)).toBe(true);
  });
});
