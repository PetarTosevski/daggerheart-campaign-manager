import { describe, expect, it } from "vitest";

import {
  MAX_MAP_JSON_BYTES,
  TERRAIN_TILE_CELLS,
  TERRAIN_TILES,
  assembleTerrain,
  checkMapState,
  initialMapState,
  joinMapState,
  mapImageSize,
  playerMapView,
  splitMapState,
  terrainTile,
  terrainTileOf,
  tokenHex,
  type MapToken,
} from "@/lib/world/map-state";
import { hexToPixel } from "@/lib/world/hex";
import { TERRAIN_COLUMNS, TERRAIN_ROWS } from "@/lib/world/terrain";

const token = (id: number, over: Partial<MapToken> = {}): MapToken => ({ id, type: "village", x: 1, y: 1, name: "", notes: "", hidden: false, location: false, ...over });

describe("map size budget", () => {
  it("counts UTF-8 bytes, not characters", () => {
    // 200 markers × 2000 three-byte characters: 400 000 characters, but 1.2 MB of UTF-8.
    const tokens = Array.from({ length: 200 }, (_, i) => token(i + 1, { notes: "€".repeat(2000) }));
    const state = { ...initialMapState("witherwild"), tokens, nextId: 201 };
    expect(JSON.stringify(state).length).toBeLessThan(MAX_MAP_JSON_BYTES);
    expect(checkMapState(state)).toEqual({ ok: false, message: "The map is too large. Shorten some notes or remove markers." });

    const ascii = { ...state, tokens: tokens.map((t) => ({ ...t, notes: "e".repeat(2000) })) };
    expect(checkMapState(ascii).ok).toBe(true);
  });

  it("reports schema problems without throwing", () => {
    expect(checkMapState({ ...initialMapState("witherwild"), terrain: "xyz" }).ok).toBe(false);
  });
});

describe("map rows", () => {
  it("terrain tiles cover the grid exactly", () => {
    expect(TERRAIN_TILES * TERRAIN_TILE_CELLS).toBe(TERRAIN_COLUMNS * TERRAIN_ROWS);
    expect([terrainTileOf(0), terrainTileOf(TERRAIN_TILE_CELLS - 1), terrainTileOf(TERRAIN_TILE_CELLS), terrainTileOf(TERRAIN_COLUMNS * TERRAIN_ROWS - 1)]).toEqual([0, 0, 1, TERRAIN_TILES - 1]);
    const base = initialMapState("witherwild").terrain;
    const painted = "#".repeat(TERRAIN_TILE_CELLS);
    const grid = assembleTerrain(base, [{ tile: 2, cells: painted }]);
    expect(terrainTile(grid, 2)).toBe(painted);
    expect(grid.slice(0, 2 * TERRAIN_TILE_CELLS)).toBe(base.slice(0, 2 * TERRAIN_TILE_CELLS));
    expect(grid.slice(3 * TERRAIN_TILE_CELLS)).toBe(base.slice(3 * TERRAIN_TILE_CELLS));
  });

  it("split then join gives the map back, markers by id and hexes by (q, r), duplicates dropped", () => {
    const state = {
      ...initialMapState("journey-to-horizon"),
      tokens: [token(4), token(2, { hidden: true })],
      nextId: 3,
      hexCrawl: {
        ...initialMapState("journey-to-horizon").hexCrawl!,
        hexes: [
          { q: 2, r: 1, explored: true },
          { q: -1, r: 5, explored: false, poi: { text: "Bell", hidden: true } },
          { q: 2, r: 1, explored: false },
        ],
      },
    };
    const { scalars, tokens, hexes, terrain } = splitMapState(state);
    expect(scalars).toMatchObject({ schemaVersion: 2, nextId: 3, hexCrawl: { hexCount: 2 } });
    expect(scalars).not.toHaveProperty("tokens");
    expect(scalars.hexCrawl).not.toHaveProperty("hexes");
    const joined = joinMapState(scalars, tokens, hexes, terrain);
    expect(joined.tokens.map((t) => t.id)).toEqual([2, 4]);
    // nextId is past every marker even when the stored counter lags behind.
    expect(joined.nextId).toBe(5);
    expect(joined.hexCrawl!.hexes).toEqual([
      { q: -1, r: 5, explored: false, poi: { text: "Bell", hidden: true } },
      { q: 2, r: 1, explored: true },
    ]);
    expect(joined).not.toHaveProperty("schemaVersion");
    expect(joined.hexCrawl).not.toHaveProperty("hexCount");
  });
});

describe("player map view", () => {
  it("drops the upload's storage id, the marker counter and types or labels no visible marker uses", () => {
    const state = {
      ...initialMapState("witherwild"),
      tokens: [token(1, { type: "c1" }), token(2, { type: "c2", hidden: true }), token(3, { type: "cave" })],
      nextId: 9,
      customTypes: [
        { id: "c1", label: "Shrine", icon: "temple", color: "#5a2a6a" },
        { id: "c2", label: "Dragon nest", icon: "cave", color: "#5a2a6a" },
      ],
      typeLabels: { cave: "Grotto", city: "Secret capital", c2: "Lair" },
      customMap: { storageId: "kg2abc", width: 800, height: 600 },
    };
    const view = playerMapView(state);
    expect(view.customMap).toEqual({ width: 800, height: 600 });
    expect(view.nextId).toBe(1);
    expect(view.customTypes.map((c) => c.id)).toEqual(["c1"]);
    expect(view.typeLabels).toEqual({ cave: "Grotto" });
    expect(view.options).toEqual(state.options);
    expect(JSON.stringify(view)).not.toMatch(/kg2abc|Dragon nest|Secret capital|Lair/);
  });

  it("hex crawl: markers only in explored hexes or the party's neighbourhood, sanctuaries anywhere unless hidden", () => {
    const base = initialMapState("journey-to-horizon");
    const grid = { originX: 100, originY: 100, size: 40, orientation: "flat" as const };
    const image = mapImageSize("journey-to-horizon", base);
    const at = (q: number, r: number) => {
      const c = hexToPixel({ q, r }, grid);
      return { x: (c.x / image.width) * 100, y: (c.y / image.height) * 100 };
    };
    expect(tokenHex(at(4, -2), image, grid)).toEqual({ q: 4, r: -2 });
    const state = {
      ...base,
      tokens: [
        token(1, at(0, 1)),
        token(2, at(4, 0)),
        token(3, at(6, 1)),
        token(4, { ...at(8, 8), type: "sanctuary" }),
        token(5, { ...at(8, 8), type: "sanctuary", hidden: true }),
      ],
      hexCrawl: { ...base.hexCrawl!, grid, party: { q: 0, r: 0 }, hexes: [{ q: 6, r: 1, explored: true }] },
    };
    expect(playerMapView(state).tokens.map((t) => t.id)).toEqual([1, 3, 4]);
    // Before the party is placed only explored hexes (and sanctuaries) show markers.
    expect(playerMapView({ ...state, hexCrawl: { ...state.hexCrawl, party: null } }).tokens.map((t) => t.id)).toEqual([3, 4]);
  });
});
