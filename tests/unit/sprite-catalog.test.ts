import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MAP_LIGHT_REACH, OBJECT_KINDS, SIGHT_DEFAULTS, TERRAINS, isLightObject } from "@/lib/domain/combat-map";
import {
  CATALOG,
  CATALOG_ENTRIES,
  COMMON_FOLDER,
  DEFAULT_SETTING,
  EMPTY_MANIFEST,
  SETTINGS,
  SETTING_IDS,
  SHEET_COUNTS,
  SPRITE_SIZE_MAX,
  SPRITE_SIZE_MIN,
  TEXTURE_KEY_SUFFIX,
  TEXTURE_SQUARES,
  builtinManifestSchema,
  catalogEntry,
  classicLight,
  defineFolder,
  entriesOnSheet,
  entrySheetId,
  long,
  obj,
  tex,
  createSpriteLookup,
  folderEntries,
  folderOfKey,
  isSettingId,
  pickSetting,
  pickSprite,
  pickTexture,
  slugify,
  spriteCandidates,
  spriteTraits,
  textureCandidates,
  type CatalogEntry,
  type FolderId,
  type Sheet,
  type SpriteTraits,
} from "@/lib/sprite-packs";

// ---------------------------------------------------------------- the prompts doc, parsed

type DocFolder = { folder: string; props: string[]; large: string[]; terrain: string[]; extras: Record<string, string[]> };

function parsePromptsDoc(): DocFolder[] {
  const text = readFileSync(join(process.cwd(), "docs/sprite-packs/prompts.md"), "utf8");
  const lines = text.split("\n");
  const folders: DocFolder[] = [];
  const get = (folder: string) => {
    let f = folders.find((x) => x.folder === folder);
    if (!f) {
      f = { folder, props: [], large: [], terrain: [], extras: {} };
      folders.push(f);
    }
    return f;
  };
  const items = (list: string) =>
    list
      .split("·")
      .map((s) => s.trim().replace(/^\d+\.\s*/, ""))
      .filter((s) => s.length > 0);

  let section: "shared" | "settings" | null = null;
  let shared: { folder: string; sheet: Sheet } | null = null;
  let setting: string | null = null;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      section = line.startsWith("## Shared sheets") ? "shared" : line.startsWith("## Settings") ? "settings" : null;
      shared = null;
      setting = null;
      continue;
    }
    if (section === "shared") {
      const head = /^`([a-z-]+)\/(props|large|terrain)`$/.exec(line.trim());
      if (head) {
        shared = { folder: head[1]!, sheet: head[2] as Sheet };
        continue;
      }
      if (shared && line.trim()) get(shared.folder)[shared.sheet].push(...items(line));
    }
    if (section === "settings") {
      const head = /^### (.+)$/.exec(line);
      if (head) {
        setting = slugify(head[1]!.replace(/\(.*\)/, ""));
        continue;
      }
      const sheet = /^- (props|large|terrain): (.+)$/.exec(line);
      if (setting && sheet) get(setting)[sheet[1] as Sheet].push(...items(sheet[2]!));
      // An extra sheet's new items: `- large-2: cottage · ...`.
      const extra = /^- ((?:props|large|terrain)-[a-z0-9-]+): (.+)$/.exec(line);
      if (setting && extra) (get(setting).extras[extra[1]!] ??= []).push(...items(extra[2]!));
    }
  }
  return folders;
}

const DOC = parsePromptsDoc();
const FOLDER_IDS = Object.keys(CATALOG) as FolderId[];

describe("catalog vs docs/sprite-packs/prompts.md", () => {
  it("has the doc's 20 folders in the doc's order (common, then the 19 settings)", () => {
    expect(DOC).toHaveLength(20);
    expect(FOLDER_IDS).toEqual(DOC.map((f) => f.folder));
  });

  it.each(DOC.map((f) => [f.folder, f] as const))("%s: every sheet lists the doc's names in grid order", (folder, doc) => {
    const cat = CATALOG[folder as FolderId];
    for (const sheet of ["props", "large", "terrain"] as const) {
      expect(doc[sheet]).toHaveLength(SHEET_COUNTS[sheet]);
      const primary = entriesOnSheet<CatalogEntry>(cat[sheet], sheet);
      expect(primary.map((e) => e.name)).toEqual(doc[sheet]);
      primary.forEach((e, i) => {
        expect(e.sheet).toBe(sheet);
        expect(e.index).toBe(i);
        const slugKey = `${folder}/${slugify(e.name)}`;
        expect([slugKey, `${slugKey}${TEXTURE_KEY_SUFFIX}`]).toContain(e.key);
        if (e.key !== slugKey) expect(sheet).toBe("terrain");
      });
    }
  });

  it.each(DOC.map((f) => [f.folder, f] as const))("%s: extra-sheet items match the doc's extra-sheet lists", (folder, doc) => {
    const cat = CATALOG[folder as FolderId];
    const extras: Record<string, string[]> = {};
    for (const sheet of ["props", "large", "terrain"] as const)
      for (const e of cat[sheet])
        if (e.extraSheet) {
          expect(e.extraSheet.startsWith(`${sheet}-`)).toBe(true);
          expect(e.index).toBe((extras[e.extraSheet] ??= []).length);
          extras[e.extraSheet]!.push(e.name);
        }
    expect(extras).toEqual(doc.extras);
  });

  it("the one extra sheet today is the village sheet (town-street-and-market/large-2, P4V) with nine items", () => {
    const extra = CATALOG_ENTRIES.filter((e) => e.extraSheet !== undefined);
    expect(extra.map((e) => `${folderOfKey(e.key)}/${e.extraSheet}`)).toEqual(Array(9).fill("town-street-and-market/large-2"));
  });

  it("keys are unique and match <folder>/<slug> (D8)", () => {
    const keys = CATALOG_ENTRIES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(20 * (16 + 9 + 4) + 9);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
    expect(catalogEntry("forest/oak-tree")?.name).toBe("oak tree");
    expect(catalogEntry("swamp/will-o-wisp-light")?.name).toBe("will-o'-wisp light");
    expect(catalogEntry("forest/nope")).toBeNull();
    // The one name shared by an object and a texture of one folder.
    expect(catalogEntry("volcanic/cracked-basalt")?.category).toBe("object");
    expect(catalogEntry("volcanic/cracked-basalt-terrain")?.category).toBe("texture");
    expect(keys.filter((k) => k.endsWith(TEXTURE_KEY_SUFFIX))).toEqual(["volcanic/cracked-basalt-terrain"]);
  });
});

describe("extra sheets: new items, not variants (user answer 2026-10-21)", () => {
  const folder = defineFolder("town-street-and-market", {
    props: [obj("barrel", "cover", "low", "barrel")],
    large: [long("market stall", "cover", "tall", "table")],
    terrain: [tex("cobblestones", "stone", true)],
    extras: {
      "large-2": [obj("cottage", "block", "tall", "pillar", { footprint: "rect" }), long("garden fence", "cover", "low", "log")],
      "props-2": [obj("garden plot", "none", "flat", "bush")],
      "terrain-2": [tex("barrel", "dirt", true)],
    },
  });

  it("appends an extra sheet's items to its layout's list with their own keys, sheet id, index and default size", () => {
    expect(folder.large.map((e) => [e.key, entrySheetId(e), e.index, e.w, e.h])).toEqual([
      ["town-street-and-market/market-stall", "large", 0, 2, 1],
      ["town-street-and-market/cottage", "large-2", 0, 2, 2],
      ["town-street-and-market/garden-fence", "large-2", 1, 2, 1],
    ]);
    expect(folder.large[1]).toMatchObject({ sheet: "large", extraSheet: "large-2", sight: "block", footprint: "rect" });
    expect(folder.props.map((e) => [e.key, entrySheetId(e), e.index, e.w])).toEqual([
      ["town-street-and-market/barrel", "props", 0, 1],
      ["town-street-and-market/garden-plot", "props-2", 0, 1],
    ]);
    // A texture on an extra terrain sheet gets the texture suffix when it shares an object's slug.
    expect(folder.terrain.map((e) => [e.key, entrySheetId(e), e.index, e.w])).toEqual([
      ["town-street-and-market/cobblestones", "terrain", 0, TEXTURE_SQUARES],
      [`town-street-and-market/barrel${TEXTURE_KEY_SUFFIX}`, "terrain-2", 0, TEXTURE_SQUARES],
    ]);
    expect(entriesOnSheet(folder.large, "large-2").map((e) => e.name)).toEqual(["cottage", "garden fence"]);
    expect(entriesOnSheet(folder.large, "large").map((e) => e.name)).toEqual(["market stall"]);
    expect(folder.props[0]).not.toHaveProperty("extraSheet");
  });

  it("rejects a bad extra-sheet id and a key that repeats a primary item", () => {
    const base = { props: [], large: [], terrain: [] };
    expect(() => defineFolder("forest", { ...base, extras: { ["large2" as "large-2"]: [] } })).toThrow(/bad extra sheet id/);
    expect(() =>
      defineFolder("forest", {
        ...base,
        large: [obj("oak tree", "block", "tall", "tree")],
        extras: { "large-2": [obj("oak tree", "block", "tall", "tree")] },
      }),
    ).toThrow(/duplicate key forest\/oak-tree/);
  });
});

describe("traits (D2, D3, D4, D5, D6, Q1)", () => {
  it("sizes are within 1..4; props 1 x 1, large 2 x 2 or long 2 x 1 rect (extra-sheet items: any rect size), textures TEXTURE_SQUARES (D4)", () => {
    for (const e of CATALOG_ENTRIES) {
      for (const side of [e.w, e.h]) {
        expect(side).toBeGreaterThanOrEqual(SPRITE_SIZE_MIN);
        expect(side).toBeLessThanOrEqual(SPRITE_SIZE_MAX);
      }
      if (e.sheet === "props") expect([e.w, e.h]).toEqual([1, 1]);
      if (e.sheet === "large" && e.extraSheet) {
        if (e.w !== e.h) expect(e.footprint).toBe("rect");
      } else if (e.sheet === "large") {
        expect([[2, 2], [2, 1]]).toContainEqual([e.w, e.h]);
        if (e.h === 1) expect(e.footprint).toBe("rect");
      }
      if (e.sheet === "terrain") expect([e.w, e.h]).toEqual([TEXTURE_SQUARES, TEXTURE_SQUARES]);
    }
  });

  it("every light sprite's Classic kind is a light kind with the same reach; no other sprite maps to a light kind (D2)", () => {
    for (const e of CATALOG_ENTRIES) {
      if (e.category !== "object") continue;
      const kind = e.classic.kind;
      expect(OBJECT_KINDS).toContain(kind);
      if (e.light === "torch" || e.light === "campfire") {
        expect(isLightObject(kind), e.key).toBe(true);
        expect(MAP_LIGHT_REACH[kind], e.key).toEqual(MAP_LIGHT_REACH[e.light]);
      } else {
        // "none" and "faintglow": no Classic kind has the faint-glow reach (Q1 = b).
        expect(isLightObject(kind), e.key).toBe(false);
      }
    }
  });

  it("gives torch, campfire and faint-glow light exactly to the Q1 lists", () => {
    const withLight = (light: string) =>
      CATALOG_ENTRIES.filter((e) => e.light === light)
        .map((e) => e.key)
        .sort();
    expect(withLight("torch")).toEqual(
      [
        "common/standing-torch-lit",
        "common/iron-brazier-lit",
        "crypt-and-graveyard/lantern-on-a-post",
        "town-street-and-market/street-lamp",
        "castle-interior/floor-brazier",
        "mushroom-cavern/drow-lantern",
        "volcanic/burning-brazier",
        "ship-deck/lantern-on-a-hook",
      ].sort(),
    );
    expect(withLight("campfire")).toEqual(
      [
        "common/campfire-burning",
        "snow-and-tundra/campfire-in-snow",
        "desert/campfire",
        "tavern/hearth-fireplace",
        "castle-interior/grand-fireplace",
        "castle-interior/fireplace-grate",
        "town-street-and-market/blacksmith-forge",
        "volcanic/forge-of-the-fire-giants",
        "tavern/kitchen-stove",
      ].sort(),
    );
    expect(withLight("faintglow")).toEqual(
      [
        "dungeon/candle-cluster",
        "crypt-and-graveyard/candle-cluster",
        "tavern/candle",
        "temple/candle-stand",
        "sewers/candle-stub",
        "castle-interior/candelabra",
        "dungeon/altar-with-candles",
        "cave/glowing-mushroom-cluster",
        "mushroom-cavern/glowing-blue-mushroom",
        "mushroom-cavern/glowing-purple-mushroom",
        "mushroom-cavern/giant-glowing-mushroom",
        "mushroom-cavern/luminous-moss",
        "mushroom-cavern/glowing-lichen",
        "cave/cave-crystal",
        "cave/giant-crystal-cluster",
        "mountain-and-cliffs/crystal-outcrop",
        "mushroom-cavern/crystal-shard",
        "mushroom-cavern/giant-crystal",
        "swamp/will-o-wisp-light",
        "volcanic/lava-pool",
        "volcanic/magma-bubble",
        "volcanic/ember-pile",
        "volcanic/fire-geyser",
        "volcanic/lava-bridge",
      ].sort(),
    );
  });

  it("flat sprites cast no shadow and are not sight blockers; textures are flat, none, rect with a known terrain (D3, D5, D6)", () => {
    for (const e of CATALOG_ENTRIES) {
      if (e.height === "flat") expect(e.sight, e.key).toBe("none");
      if (e.category === "texture") {
        expect(TERRAINS).toContain(e.terrain);
        expect([e.sight, e.light, e.height, e.footprint]).toEqual(["none", "none", "flat", "rect"]);
      }
    }
    expect(catalogEntry("forest/oak-tree")).toMatchObject({ sight: "block", height: "tall" });
    expect(catalogEntry("common/wooden-crate")).toMatchObject({ sight: "cover", height: "low" });
    expect(catalogEntry("temple/sacred-pool")).toMatchObject({ sight: "none", height: "flat" });
    expect(catalogEntry("grassland-and-road/stone-wall-section")).toMatchObject({ sight: "block", w: 2, h: 1, footprint: "rect" });
    expect(catalogEntry("tavern/worn-planks")).toMatchObject({ terrain: "wood", rotatable: false });
  });

  it("sizes from the user's P4 answers: sewer channel crossing 2 x 2, thick hedge 2 x 1, pew row 2 x 2 (all rect)", () => {
    expect(catalogEntry("sewers/sewer-channel-crossing")).toMatchObject({ w: 2, h: 2, footprint: "rect", sight: "none", height: "flat" });
    expect(catalogEntry("sewers/sewer-channel-two-squares")).toBeNull();
    expect(catalogEntry("forest/thick-hedge")).toMatchObject({ w: 2, h: 1, footprint: "rect", sight: "block", height: "tall" });
    expect(catalogEntry("temple/pew-row")).toMatchObject({ w: 2, h: 2, footprint: "rect", sight: "cover", height: "low" });
  });

  it("the village sheet's nine items (P4V): buildings block sight, fence and gate are cover, the garden plot is flat", () => {
    const village = entriesOnSheet(CATALOG["town-street-and-market"].large, "large-2");
    expect(village.map((e) => [e.key.split("/")[1], e.index, e.w, e.h, e.sight, e.height, e.footprint, e.light])).toEqual([
      ["thatched-cottage", 0, 3, 3, "block", "tall", "rect", "none"],
      ["stone-cottage", 1, 3, 3, "block", "tall", "rect", "none"],
      ["timber-barn", 2, 3, 4, "block", "tall", "rect", "none"],
      ["wooden-fence-section", 3, 3, 1, "cover", "low", "rect", "none"],
      ["wooden-fence-gate", 4, 3, 1, "cover", "low", "rect", "none"],
      ["vegetable-garden-plot", 5, 3, 3, "none", "flat", "rect", "none"],
      ["haystack", 6, 2, 2, "block", "tall", "circle", "none"],
      ["woodpile-with-chopping-block", 7, 2, 1, "cover", "low", "rect", "none"],
      ["chicken-coop-with-fenced-run", 8, 2, 2, "cover", "low", "rect", "none"],
    ]);
    for (const e of village) expect(e.category === "object" && e.standIn, e.key).toBe(false);
    // The town haystack matches grassland-and-road's haystack (its nearest existing kind).
    const traits = (key: string) => {
      const e = catalogEntry(key);
      return e && e.category === "object" ? [e.w, e.h, e.sight, e.height, e.footprint, e.light, e.classic, e.standIn] : null;
    };
    expect(traits("town-street-and-market/haystack")).toEqual(traits("grassland-and-road/haystack"));
  });
});

describe("settings (D7)", () => {
  it("has the 19 setting folders and never offers common", () => {
    expect(SETTING_IDS).toHaveLength(19);
    expect(SETTINGS.map((s) => s.id)).toEqual(FOLDER_IDS.filter((f) => f !== COMMON_FOLDER));
    expect(SETTINGS.every((s) => s.label.length > 0)).toBe(true);
    expect(isSettingId("common")).toBe(false);
    expect(isSettingId("forest")).toBe(true);
    expect(DEFAULT_SETTING).toBe("grassland-and-road");
  });
});

describe("mapping (D1)", () => {
  it("maps a Classic kind to the setting's sprites, by variant when one matches", () => {
    expect(spriteCandidates("tree", undefined, "forest").map((e) => e.key)).toEqual([
      "forest/oak-tree",
      "forest/pine-tree",
      "forest/birch-tree",
      "forest/autumn-maple-tree",
      "forest/ancient-tree-with-roots",
    ]);
    expect(spriteCandidates("tree", "pine", "forest").map((e) => e.key)).toEqual(["forest/pine-tree"]);
    expect(spriteCandidates("tree", "pink", "forest")).toHaveLength(5);
  });

  it("falls back to common when the setting has no candidate, and to null when neither has one", () => {
    expect(spriteCandidates("chest", undefined, "forest").map((e) => e.key)).toEqual([
      "common/treasure-chest-closed",
      "common/treasure-chest-open-coins-inside",
    ]);
    expect(pickSprite("hull", undefined, "forest", "o1", 7)).toBeNull();
    expect(spriteCandidates("tree", undefined, "not-a-setting")).toEqual([]);
    expect(spriteCandidates("barrel", undefined, "not-a-setting").map((e) => e.key)).toEqual(["common/barrel"]);
  });

  it("only maps sprites whose sight and light equal the Classic kind's, so vision matches the drawing", () => {
    for (const setting of FOLDER_IDS) {
      for (const kind of OBJECT_KINDS) {
        for (const e of spriteCandidates(kind, undefined, setting)) {
          expect(e.classic.kind).toBe(kind);
          expect(e.sight, e.key).toBe(SIGHT_DEFAULTS[kind]);
          expect(e.light, e.key).toBe(classicLight(kind));
        }
      }
    }
    expect(spriteCandidates("campfire", undefined, "castle-interior").map((e) => e.key)).toEqual([
      "castle-interior/fireplace-grate",
    ]);
    expect(spriteCandidates("walltorch", undefined, "dungeon")).toEqual([]);
  });

  it("pickSprite is deterministic per object id and seed and spreads over the candidates", () => {
    const a = pickSprite("tree", undefined, "forest", "obj-1", 42);
    expect(pickSprite("tree", undefined, "forest", "obj-1", 42)).toBe(a);
    const picks = new Set(Array.from({ length: 200 }, (_, i) => pickSprite("tree", undefined, "forest", `obj-${i}`, 42)));
    expect(picks.size).toBe(5);
    const seeds = new Set(Array.from({ length: 50 }, (_, s) => pickSprite("tree", undefined, "forest", "obj-1", s)));
    expect(seeds.size).toBeGreaterThan(1);
  });

  it("maps terrains to the setting's textures, else common's, else null", () => {
    expect(textureCandidates("grass", "forest").map((e) => e.key)).toEqual([
      "forest/forest-floor-with-leaves",
      "forest/moss",
      "forest/tall-grass",
    ]);
    expect(pickTexture("dirt", "forest", 3, 3, 1)).toBe("common/packed-dirt");
    expect(pickTexture("lava", "forest", 0, 0, 1)).toBeNull();
    expect(pickTexture("lava", "volcanic", 0, 0, 1)).toBe("volcanic/glowing-lava");
    for (const t of ["wall", "void"] as const) {
      for (const s of FOLDER_IDS) expect(pickTexture(t, s, 0, 0, 1)).toBeNull();
    }
  });

  it("pickTexture is deterministic and shares one pick per TEXTURE_SQUARES block", () => {
    const k = pickTexture("grass", "forest", 5, 6, 9);
    expect(pickTexture("grass", "forest", 5, 6, 9)).toBe(k);
    expect(pickTexture("grass", "forest", 4, 7, 9)).toBe(k);
    const blocks = new Set(Array.from({ length: 100 }, (_, i) => pickTexture("grass", "forest", i * TEXTURE_SQUARES, 0, 9)));
    expect(blocks.size).toBe(3);
  });
});

describe("pickSetting (keyword picker, D7)", () => {
  it.each([
    ["Bandits ambush the party in a dense pine forest", "forest"],
    ["a frozen lake ambush", "snow-and-tundra"],
    ["Goblins attack the caravan on the old road", "grassland-and-road"],
    ["A bar fight breaks out in the Prancing Pony tavern", "tavern"],
    ["Skeletons rise among the gravestones of the old cemetery", "crypt-and-graveyard"],
    ["Pirates board the galleon's deck at dawn", "ship-deck"],
    ["Wererats in the sewers beneath the city", "sewers"],
    ["Drow patrol a glowing mushroom cavern in the Underdark", "mushroom-cavern"],
    ["The cultists' temple altar", "temple"],
    ["A lava river flows past the obsidian spires of the volcano", "volcanic"],
    ["Dungeon halls with torture cells", "dungeon"],
    ["Overgrown ruins of an old watchtower", "ruins"],
    ["A quiet afternoon", "grassland-and-road"],
  ])("%s -> %s", (description, expected) => {
    expect(pickSetting(description)).toBe(expected);
  });

  it("reads the map name too", () => {
    expect(pickSetting("ambush at dusk", "Desert oasis")).toBe("desert");
  });
});

describe("manifest schema and lookup", () => {
  const sample = {
    schemaVersion: 1,
    folders: {
      forest: [
        { key: "forest/oak-tree", file: "forest/oak-tree.1a2b3c4d.webp", px: { w: 320, h: 316 } },
        {
          key: "forest/moss",
          file: "forest/moss.0f0f0f0f.webp",
          px: { w: 512, h: 512 },
          seam: 0.92,
          variants: [{ file: "forest/moss-2.abcdef12.webp", px: { w: 512, h: 512 } }],
        },
        { key: "forest/retired-thing", file: "forest/retired-thing.12345678.webp", px: { w: 10, h: 10 } },
      ],
    },
  };

  it("accepts an empty manifest and a filled one", () => {
    expect(builtinManifestSchema.safeParse(EMPTY_MANIFEST).success).toBe(true);
    const parsed = builtinManifestSchema.parse(sample);
    expect(parsed.folders.forest?.[0]?.variants).toEqual([]);
  });

  it("rejects a key outside its folder, duplicate keys, a wrong version and bad sizes", () => {
    const wrongFolder = { schemaVersion: 1, folders: { cave: [sample.folders.forest[0]] } };
    expect(builtinManifestSchema.safeParse(wrongFolder).success).toBe(false);
    const dup = { schemaVersion: 1, folders: { forest: [sample.folders.forest[0], sample.folders.forest[0]] } };
    expect(builtinManifestSchema.safeParse(dup).success).toBe(false);
    expect(builtinManifestSchema.safeParse({ ...sample, schemaVersion: 2 }).success).toBe(false);
    const badPx = { schemaVersion: 1, folders: { forest: [{ ...sample.folders.forest[0], px: { w: 0, h: 5 } }] } };
    expect(builtinManifestSchema.safeParse(badPx).success).toBe(false);
  });

  it("joins the manifest with the catalog", () => {
    const lookup = createSpriteLookup(builtinManifestSchema.parse(sample));
    expect(lookup.get("forest/oak-tree")?.art?.file).toBe("forest/oak-tree.1a2b3c4d.webp");
    expect(lookup.get("forest/oak-tree")?.entry.sight).toBe("block");
    expect(lookup.get("forest/pine-tree")).toMatchObject({ art: null });
    expect(lookup.get("forest/retired-thing")).toBeNull();
    expect(lookup.unknownKeys).toEqual(["forest/retired-thing"]);
    expect(createSpriteLookup(EMPTY_MANIFEST).get("common/barrel")?.art).toBeNull();
  });
});

describe("spriteTraits", () => {
  // The shape P3's VisionTraits takes (compile-time check of structural compatibility).
  type VisionTraitsShape = {
    sight: "block" | "cover" | "none";
    light: "none" | "faintglow" | "torch" | "campfire";
    footprint: "circle" | "rect";
    w: number;
    h: number;
  };
  const asVision = (t: SpriteTraits): VisionTraitsShape => t;

  it("resolves built-in keys from the catalog", () => {
    const t = spriteTraits({ builtin: "grassland-and-road/stone-wall-section" });
    expect(t).toEqual({ sight: "block", light: "none", height: "tall", footprint: "rect", w: 2, h: 1 });
    expect(asVision(t!).footprint).toBe("rect");
    expect(spriteTraits({ builtin: "volcanic/burning-brazier" })?.light).toBe("torch");
    expect(spriteTraits({ builtin: "tavern/candle" })?.light).toBe("faintglow");
    expect(spriteTraits({ builtin: "forest/unknown" })).toBeNull();
  });

  it("resolves uploaded rows through the lookup; a deleted row is null (D9)", () => {
    const row = { sight: "cover", light: "none", height: "low", footprint: "circle", w: 1, h: 1, name: "Standing stone" } as const;
    const lookup = { uploaded: (id: string) => (id === "s1" ? row : null) };
    expect(spriteTraits({ uploaded: "s1" }, lookup)).toEqual({
      sight: "cover",
      light: "none",
      height: "low",
      footprint: "circle",
      w: 1,
      h: 1,
    });
    expect(spriteTraits({ uploaded: "gone" }, lookup)).toBeNull();
    expect(spriteTraits({ uploaded: "s1" })).toBeNull();
  });
});

describe("catalog helpers", () => {
  it("folderEntries lists props, large, terrain in order", () => {
    const entries = folderEntries(CATALOG.forest);
    expect(entries).toHaveLength(29);
    expect(entries[0]?.key).toBe("forest/bush");
    expect(entries[28]?.key).toBe("forest/muddy-path");
  });
});
