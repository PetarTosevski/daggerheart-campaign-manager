import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_COMBAT_OBJECTS } from "../../convex/lib/combatMaps";
import {
  brushSquares,
  objectAt,
  paintLayoutCells,
  PLACEABLE_KINDS,
  squareIndex,
} from "../../src/components/combat-map/editor/edit-model";
import { decodeCells, type CellTile } from "../../src/components/combat-map/map-view/cells";
import { sightOf } from "../../src/lib/domain/combat-map/sight";
import { OBJECT_KINDS } from "../../src/lib/domain/combat-map/spec";
import { los, prepareMap } from "../../src/lib/domain/combat-map/vision";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

// D9 C5: editing a map by hand (paint terrain and sight blockers, place / move / resize / turn / remove objects,
// their sight setting; R2, R7). Every function is GM-only (anonymous UNAUTHENTICATED, outsider NOT_FOUND, player
// FORBIDDEN). TE2's authz matrix does not exist yet; D12 folds these rows in.

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

async function withMap(size: "small" | "medium" | "large" = "medium") {
  const ctx = await setupWithCampaign();
  const { campaignId, gm } = ctx;
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size, idempotencyKey: key() });
  const get = async () => (await gm.query(api.combatMaps.get, { campaignId, mapId }))!;
  const tiles = () => ctx.t.run((c) => c.db.query("combatMapCells").withIndex("by_map_layer_tile", (q) => q.eq("mapId", mapId)).collect());
  const paint = (squares: number[], value: "block" | "eraseTerrain" | "eraseBlock" | "stone" | "water" | "wall") =>
    gm.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares, paint: value });
  const add = async (kind: (typeof PLACEABLE_KINDS)[number], x: number, y: number) =>
    (await gm.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind, x, y })).objectId;
  const player = async () => {
    await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
    return ctx.other;
  };
  return { ...ctx, mapId, get, tiles, paint, add, player };
}

/** Every public function of convex/combatMapEdit.ts, called as `client`. */
function calls(f: Awaited<ReturnType<typeof withMap>>, objectId: Id<"combatMapObjects">) {
  const { campaignId, mapId } = f;
  return {
    paintCells: (c: Client) => c.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: [0, 1], paint: "stone" }),
    clearPaint: (c: Client) => c.mutation(api.combatMapEdit.clearPaint, { campaignId, mapId, layer: "terrain" }),
    addObject: (c: Client) => c.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "crate", x: 3, y: 3 }),
    moveObject: (c: Client) => c.mutation(api.combatMapEdit.moveObject, { campaignId, objectId, x: 5, y: 5 }),
    setObjectSight: (c: Client) => c.mutation(api.combatMapEdit.setObjectSight, { campaignId, objectId, sight: "block" }),
    updateObject: (c: Client) => c.mutation(api.combatMapEdit.updateObject, { campaignId, objectId, r: 1.2 }),
    removeObject: (c: Client) => c.mutation(api.combatMapEdit.removeObject, { campaignId, objectId }),
  };
}

describe("combat map editing: access", () => {
  useAllowlist();

  it("refuses anonymous callers, outsiders and players on every function, and lets the GM run each", async () => {
    const f = await withMap();
    const objectId = await f.add("tree", 4, 4);
    const all = calls(f, objectId);
    const names = Object.keys(all) as (keyof typeof all)[];
    expect(names).toHaveLength(7);

    for (const name of names) expect([name, await code(all[name](f.t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
    for (const name of names) expect([name, await code(all[name](f.other))]).toEqual([name, "NOT_FOUND"]);
    const player = await f.player();
    for (const name of names) expect([name, await code(all[name](player))]).toEqual([name, "FORBIDDEN"]);
    // In this order every GM call is valid (removeObject comes last).
    for (const name of names) expect([name, await code(all[name](f.gm))]).toEqual([name, "ok"]);
  });

  it("gives COMBAT_MAP_NOT_FOUND / COMBAT_OBJECT_NOT_FOUND for another campaign's map and object ids", async () => {
    const a = await withMap();
    const objectId = await a.add("crate", 2, 2);
    const { campaignId: mine } = await a.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    for (const run of [
      () => a.gm.mutation(api.combatMapEdit.paintCells, { campaignId: mine, mapId: a.mapId, squares: [0], paint: "stone" }),
      () => a.gm.mutation(api.combatMapEdit.clearPaint, { campaignId: mine, mapId: a.mapId, layer: "block" }),
      () => a.gm.mutation(api.combatMapEdit.addObject, { campaignId: mine, mapId: a.mapId, kind: "tree", x: 1, y: 1 }),
      () => a.gm.mutation(api.combatMapEdit.addObject, { campaignId: a.campaignId, mapId: "not-an-id", kind: "tree", x: 1, y: 1 }),
    ]) {
      expect(await code(run())).toBe("COMBAT_MAP_NOT_FOUND");
    }
    for (const run of [
      () => a.gm.mutation(api.combatMapEdit.moveObject, { campaignId: mine, objectId, x: 1, y: 1 }),
      () => a.gm.mutation(api.combatMapEdit.removeObject, { campaignId: mine, objectId }),
      () => a.gm.mutation(api.combatMapEdit.setObjectSight, { campaignId: mine, objectId, sight: "none" }),
      () => a.gm.mutation(api.combatMapEdit.updateObject, { campaignId: mine, objectId, rot: 1 }),
      () => a.gm.mutation(api.combatMapEdit.removeObject, { campaignId: a.campaignId, objectId: "not-an-id" }),
    ]) {
      expect(await code(run())).toBe("COMBAT_OBJECT_NOT_FOUND");
    }
    expect((await a.get()).objects).toHaveLength(1);
  });
});

describe("combat map editing: painting", () => {
  useAllowlist();

  it("paints terrain into only the tiles a stroke touches, and players' live layout shows it (R2)", async () => {
    const f = await withMap(); // 30 x 20: tiles 0 (rows 0-7), 1 (8-15), 2 (16-19)
    await f.paint([squareIndex(0, 0, 30), squareIndex(1, 0, 30), squareIndex(29, 7, 30)], "stone");
    let rows = await f.tiles();
    expect(rows.map(({ layer, tile }) => ({ layer, tile }))).toEqual([{ layer: "terrain", tile: 0 }]);
    const first = rows[0]!;
    expect(first.cells).toHaveLength(8 * 30);

    // A stroke on row 10 writes tile 1 only; tile 0 keeps its row untouched.
    await f.paint([squareIndex(4, 10, 30)], "water");
    rows = await f.tiles();
    expect(rows.map(({ tile }) => tile)).toEqual([0, 1]);
    expect(rows[0]).toEqual(first);

    const layout = await f.get();
    expect(decodeCells(layout.cells, layout.w, layout.h).paint).toEqual({ "0,0": "stone", "1,0": "stone", "29,7": "stone", "4,10": "water" });
    const player = await f.player();
    const live = await player.query(api.combatMaps.live, { campaignId: f.campaignId });
    expect(decodeCells(live!.cells, live!.w, live!.h).paint["4,10"]).toBe("water");
  });

  it("paints and erases; Erase terrain and Clear sight each clear their own layer and drop tiles left empty (R7)", async () => {
    const f = await withMap();
    const a = squareIndex(3, 3, 30);
    const b = squareIndex(4, 3, 30);
    await f.paint([a, b], "block");
    await f.paint([a], "stone");
    let layout = await f.get();
    let decoded = decodeCells(layout.cells, layout.w, layout.h);
    expect([...decoded.block].sort()).toEqual(["3,3", "4,3"]);
    expect(decoded.paint).toEqual({ "3,3": "stone" });

    await f.paint([a], "eraseTerrain");
    layout = await f.get();
    decoded = decodeCells(layout.cells, layout.w, layout.h);
    expect([...decoded.block].sort()).toEqual(["3,3", "4,3"]);
    expect(decoded.paint).toEqual({});
    expect((await f.tiles()).map(({ layer }) => layer)).toEqual(["block"]);

    await f.paint([a], "eraseBlock");
    decoded = decodeCells((await f.get()).cells, 30, 20);
    expect([...decoded.block]).toEqual(["4,3"]);
    await f.paint([b], "eraseBlock");
    expect(await f.tiles()).toEqual([]);
  });

  it("a painted blocker and a painted wall block line of sight in the vision engine (C1)", async () => {
    const f = await withMap();
    const layout0 = await f.get();
    const vision = (l: typeof layout0) => {
      const cells = decodeCells(l.cells, l.w, l.h);
      return prepareMap({ w: l.w, h: l.h, base: l.base, areas: l.areas, objects: l.objects, paint: cells.paint, block: cells.block });
    };
    expect(los(vision(layout0), 2.5, 5.5, 8.5, 5.5)).toBe(true);
    await f.paint([squareIndex(5, 5, 30)], "block");
    expect(los(vision(await f.get()), 2.5, 5.5, 8.5, 5.5)).toBe(false);
    await f.paint([squareIndex(5, 5, 30)], "eraseBlock");
    await f.paint([squareIndex(5, 5, 30)], "wall");
    expect(los(vision(await f.get()), 2.5, 5.5, 8.5, 5.5)).toBe(false);
  });

  it("clears a whole layer (Undo all painting) and leaves the other", async () => {
    const f = await withMap();
    await f.paint([0, 1, 2, squareIndex(0, 12, 30)], "stone");
    await f.paint([5], "block");
    await f.gm.mutation(api.combatMapEdit.clearPaint, { campaignId: f.campaignId, mapId: f.mapId, layer: "terrain" });
    expect((await f.tiles()).map(({ layer }) => layer)).toEqual(["block"]);
  });

  it("refuses squares outside the map with INVALID and writes nothing; an empty stroke is a no-op", async () => {
    const f = await withMap();
    expect(await code(f.paint([30 * 20], "stone"))).toBe("INVALID");
    expect(await code(f.paint([-1], "stone"))).toBe("INVALID");
    expect(await code(f.paint([1.5], "stone"))).toBe("INVALID");
    expect(await code(f.paint([], "stone"))).toBe("ok");
    expect(await f.tiles()).toEqual([]);
  });

  it("refuses a texture stroke on a Classic-style map with INVALID and writes nothing (G14)", async () => {
    const f = await withMap();
    await f.gm.mutation(api.combatMapStyle.setStyle, { campaignId: f.campaignId, mapId: f.mapId, style: "classic" });
    const stroke = { campaignId: f.campaignId, mapId: f.mapId, squares: [0, 1], paint: { layer: "texture" as const, texture: { builtin: "forest/moss" } } };
    expect(await code(f.gm.mutation(api.combatMapEdit.paintCells, stroke))).toBe("INVALID");
    expect(await f.tiles()).toEqual([]);
    expect((await f.get()).texturePalette).toBeUndefined();
    // The same stroke paints once the map is in the Sprites style.
    await f.gm.mutation(api.combatMapStyle.setStyle, { campaignId: f.campaignId, mapId: f.mapId, style: "sprites" });
    expect(await code(f.gm.mutation(api.combatMapEdit.paintCells, stroke))).toBe("ok");
  });

  it("paints every square of the largest map in one stroke", async () => {
    const ctx = await setupWithCampaign();
    // Large is 40 x 27; a map that grows to 44 x 32 only comes from an image, so the largest blank one is used.
    const { mapId } = await ctx.gm.mutation(api.combatMaps.create, { campaignId: ctx.campaignId, size: "large", idempotencyKey: key() });
    const all = Array.from({ length: 40 * 27 }, (_, i) => i);
    await ctx.gm.mutation(api.combatMapEdit.paintCells, { campaignId: ctx.campaignId, mapId, squares: all, paint: "snow" });
    const layout = (await ctx.gm.query(api.combatMaps.get, { campaignId: ctx.campaignId, mapId }))!;
    expect(layout.cells).toHaveLength(4);
    expect(Object.keys(decodeCells(layout.cells, 40, 27).paint)).toHaveLength(40 * 27);
  });

  it("the client's optimistic copy of a stroke equals what the server stores", async () => {
    const f = await withMap();
    const strokes: [number[], "stone" | "block" | "eraseTerrain" | "eraseBlock" | "water"][] = [
      [brushSquares(4.2, 6.7, 3, 30, 20), "stone"],
      [brushSquares(4.2, 7.9, 2, 30, 20), "block"],
      [brushSquares(29.5, 19.5, 3, 30, 20), "water"],
      [brushSquares(4.2, 6.7, 1, 30, 20), "eraseTerrain"],
      [brushSquares(3.2, 7.1, 2, 30, 20), "eraseBlock"],
    ];
    let optimistic: CellTile[] = [];
    for (const [squares, value] of strokes) {
      optimistic = paintLayoutCells(optimistic, 30, squares, value);
      await f.paint(squares, value);
      const stored = (await f.get()).cells;
      const sort = (t: readonly CellTile[]) => [...t].map(({ layer, tile, cells }) => ({ layer, tile, cells })).sort((x, y) => `${x.layer}${x.tile}`.localeCompare(`${y.layer}${y.tile}`));
      expect(sort(optimistic)).toEqual(sort(stored));
    }
  });
});

describe("combat map editing: objects", () => {
  useAllowlist();

  it("places objects at half squares with the board's default sizes, inside the map", async () => {
    const f = await withMap();
    const tree = await f.add("tree", 4.3, 6.8);
    const crate = await f.add("crate", -3, 99);
    const objects = (await f.get()).objects;
    expect(objects.find((o) => o._id === tree)).toMatchObject({ kind: "tree", x: 4.5, y: 7, r: 1.6, rot: 0 });
    expect(objects.find((o) => o._id === crate)).toMatchObject({ kind: "crate", x: 0, y: 20, r: 0.8 });
    expect(objects.find((o) => o._id === crate)?.sight).toBeUndefined();
  });

  it("refuses the 301st object with COMBAT_OBJECT_LIMIT", async () => {
    const f = await withMap();
    await f.t.run(async (c) => {
      for (let i = 0; i < MAX_COMBAT_OBJECTS; i++) await c.db.insert("combatMapObjects", { mapId: f.mapId, kind: "rock", x: i % 30, y: 1, r: 0.8, rot: 0 });
    });
    expect(await code(f.gm.mutation(api.combatMapEdit.addObject, { campaignId: f.campaignId, mapId: f.mapId, kind: "tree", x: 2, y: 2 }))).toBe(
      "COMBAT_OBJECT_LIMIT",
    );
  });

  it("moves (quarter squares, clamped), resizes (0.3..4), turns and removes an object", async () => {
    const f = await withMap();
    const id = await f.add("log", 3, 3);
    const one = async () => (await f.get()).objects.find((o) => o._id === id);
    await f.gm.mutation(api.combatMapEdit.moveObject, { campaignId: f.campaignId, objectId: id, x: 7.13, y: 8.4 });
    expect(await one()).toMatchObject({ x: 7.25, y: 8.5 });
    await f.gm.mutation(api.combatMapEdit.moveObject, { campaignId: f.campaignId, objectId: id, x: 50, y: -2 });
    expect(await one()).toMatchObject({ x: 30, y: 0 });

    await f.gm.mutation(api.combatMapEdit.updateObject, { campaignId: f.campaignId, objectId: id, r: 9 });
    expect((await one())?.r).toBe(4);
    await f.gm.mutation(api.combatMapEdit.updateObject, { campaignId: f.campaignId, objectId: id, r: 0.1 });
    expect((await one())?.r).toBe(0.3);
    await f.gm.mutation(api.combatMapEdit.updateObject, { campaignId: f.campaignId, objectId: id, rot: -Math.PI / 12 });
    expect((await one())?.rot).toBeCloseTo((23 * Math.PI) / 12, 3);
    expect(await code(f.gm.mutation(api.combatMapEdit.updateObject, { campaignId: f.campaignId, objectId: id, r: Number.NaN }))).toBe("INVALID");

    await f.gm.mutation(api.combatMapEdit.removeObject, { campaignId: f.campaignId, objectId: id });
    expect(await one()).toBeUndefined();
    expect(await code(f.gm.mutation(api.combatMapEdit.removeObject, { campaignId: f.campaignId, objectId: id }))).toBe("COMBAT_OBJECT_NOT_FOUND");
  });

  it("switches lights only (R9): a campfire can be put out, a crate cannot be lit", async () => {
    const f = await withMap();
    const fire = await f.add("campfire", 5, 5);
    const crate = await f.add("crate", 8, 8);
    await f.gm.mutation(api.combatMapEdit.updateObject, { campaignId: f.campaignId, objectId: fire, lit: false });
    expect((await f.get()).objects.find((o) => o._id === fire)?.lit).toBe(false);
    expect(await code(f.gm.mutation(api.combatMapEdit.updateObject, { campaignId: f.campaignId, objectId: crate, lit: true }))).toBe("INVALID");
  });

  it("sets an object's sight (R7): a crate set to block sight blocks it; default goes back to the kind's rule", async () => {
    const f = await withMap();
    const crate = await f.add("crate", 5.5, 5.5);
    const tree = await f.add("tree", 12, 12);
    const vision = async () => {
      const l = await f.get();
      return prepareMap({ w: l.w, h: l.h, base: l.base, areas: l.areas, objects: l.objects });
    };
    const crateRow = async () => (await f.get()).objects.find((o) => o._id === crate)!;

    expect(sightOf(await crateRow())).toBe("cover");
    expect(los(await vision(), 2.5, 5.5, 8.5, 5.5)).toBe(true);

    await f.gm.mutation(api.combatMapEdit.setObjectSight, { campaignId: f.campaignId, objectId: crate, sight: "block" });
    expect((await crateRow()).sight).toBe("block");
    expect(los(await vision(), 2.5, 5.5, 8.5, 5.5)).toBe(false);

    await f.gm.mutation(api.combatMapEdit.setObjectSight, { campaignId: f.campaignId, objectId: tree, sight: "none" });
    expect(los(await vision(), 9, 12, 15, 12)).toBe(true);

    await f.gm.mutation(api.combatMapEdit.setObjectSight, { campaignId: f.campaignId, objectId: crate, sight: "default" });
    expect((await crateRow()).sight).toBeUndefined();
    expect(los(await vision(), 2.5, 5.5, 8.5, 5.5)).toBe(true);
  });

  it("keeps a dead tree's default at no effect on sight (user 2026-10-20) and lets the GM switch it", async () => {
    const f = await withMap();
    const dead = await f.add("deadtree", 6, 6);
    expect(sightOf((await f.get()).objects.find((o) => o._id === dead)!)).toBe("none");
    await f.gm.mutation(api.combatMapEdit.setObjectSight, { campaignId: f.campaignId, objectId: dead, sight: "block" });
    expect(sightOf((await f.get()).objects.find((o) => o._id === dead)!)).toBe("block");
  });
});

describe("combat map editing: shared rules", () => {
  it("offers every board kind but the hull and mast for placing, all of them real object kinds", () => {
    expect(PLACEABLE_KINDS).toHaveLength(19);
    for (const kind of PLACEABLE_KINDS) expect(OBJECT_KINDS).toContain(kind);
    expect(PLACEABLE_KINDS).not.toContain("hull");
  });

  it("brushes cover 1, 2 or 3 squares a side around the point, clipped to the map", () => {
    expect(brushSquares(5.5, 5.5, 1, 30, 20)).toEqual([squareIndex(5, 5, 30)]);
    expect(brushSquares(5.5, 5.5, 2, 30, 20)).toEqual([155, 156, 185, 186]);
    expect(brushSquares(5.5, 5.5, 3, 30, 20)).toHaveLength(9);
    expect(brushSquares(0.2, 0.2, 3, 30, 20)).toEqual([0, 1, 30, 31]);
  });

  it("picks the nearest object under a point and never a hull", () => {
    const objects = [
      { _id: "a", kind: "tree", x: 5, y: 5, r: 1.6 },
      { _id: "b", kind: "crate", x: 6, y: 5, r: 0.8 },
      { _id: "h", kind: "hull", x: 10, y: 10, r: 4 },
    ];
    expect(objectAt(objects, 5.9, 5)?._id).toBe("b");
    expect(objectAt(objects, 4.2, 5)?._id).toBe("a");
    expect(objectAt(objects, 10, 10)).toBeNull();
  });
});
