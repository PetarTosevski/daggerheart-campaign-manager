import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { assertMapSize, CELL_TILE_ROWS, MAX_MAP_H, MAX_MAP_W, MIN_MAP_H, MIN_MAP_W } from "../../convex/lib/combatMaps";
import { movementGrid } from "../../convex/lib/combatMovement";
import { loadScene } from "../../convex/lib/combatVision";
import { CELL_LAYERS } from "../../convex/lib/validators/combatMaps";
import { cellKey, decodeCells } from "../../src/components/combat-map/map-view/cells";
import { errorCode, key, setupWithCampaign, useAllowlist } from "./helpers";

// Plan map-editor ME2 (dcm-5rhs.2): maps up to 64 x 64 squares (user 2026-11-13; was 44 x 32). The minimums stay
// 12 x 10. Every reader of a map's painted tiles caps its read at ceil(MAX_MAP_H / CELL_TILE_ROWS) tiles per layer
// (convex/combatMaps.ts, combatMapEdit.ts, combatMapStyle.ts, combatMapGenerate.ts, lib/combatMovement.ts,
// lib/combatVision.ts); these tests paint every tile of the tallest map and check each reader sees all of them.

const thrown = (f: () => void) => {
  try {
    f();
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
};

describe("combat map size bounds (ME2)", () => {
  it("accepts 12..64 x 10..64 whole squares and refuses anything else with COMBAT_MAP_SIZE", () => {
    expect([MIN_MAP_W, MAX_MAP_W, MIN_MAP_H, MAX_MAP_H]).toEqual([12, 64, 10, 64]);
    for (const [w, h] of [
      [64, 64],
      [12, 10],
      [64, 10],
      [12, 64],
      [44, 32],
      [64, 48],
    ]) {
      expect([w, h, thrown(() => assertMapSize(w!, h!))]).toEqual([w, h, "ok"]);
    }
    for (const [w, h] of [
      [65, 64],
      [64, 65],
      [65, 65],
      [11, 10],
      [12, 9],
      [63.5, 64],
      [64, Number.NaN],
    ]) {
      expect([w, h, thrown(() => assertMapSize(w!, h!))]).toEqual([w, h, "COMBAT_MAP_SIZE"]);
    }
  });
});

describe("the tallest map's painted tiles (ME2)", () => {
  useAllowlist();

  /** A 64 x 64 map: a blank map stretched to the bounds (no create path makes one yet: see TASK-ME2.md). */
  async function tallestMap() {
    const ctx = await setupWithCampaign();
    const { campaignId, gm, t } = ctx;
    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
    await t.run((c) => c.db.patch("combatMaps", mapId, { w: MAX_MAP_W, h: MAX_MAP_H }));
    const all = Array.from({ length: MAX_MAP_W * MAX_MAP_H }, (_, i) => i);
    const column0 = Array.from({ length: MAX_MAP_H }, (_, y) => y * MAX_MAP_W);
    await gm.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
    // One stroke over every square: MAX_MAP_W x MAX_MAP_H is exactly the stroke cap.
    await gm.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: all, paint: { layer: "texture", texture: { builtin: "forest/moss" } } });
    await gm.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: column0, paint: "block" });
    await gm.mutation(api.combatVision.paintFog, { campaignId, mapId, squares: all, mark: "hide" });
    const rows = (id: Id<"combatMaps"> = mapId) =>
      t.run((c) =>
        c.db
          .query("combatMapCells")
          .withIndex("by_map_layer_tile", (q) => q.eq("mapId", id))
          .collect(),
      );
    return { ...ctx, mapId, rows };
  }

  /** Tiles per layer of a 64-square-tall map (a literal, so a lower read cap fails these tests). */
  const TILES = 8;

  it("stores 8 tiles per layer, 32 in all, and the map's layout returns every one", async () => {
    const f = await tallestMap();
    expect(Math.ceil(MAX_MAP_H / CELL_TILE_ROWS)).toBe(TILES);
    const stored = await f.rows();
    expect(stored).toHaveLength(CELL_LAYERS.length * TILES);
    const layout = (await f.gm.query(api.combatMaps.get, { campaignId: f.campaignId, mapId: f.mapId }))!;
    expect(layout).toMatchObject({ w: 64, h: 64 });
    expect(layout.cells).toHaveLength(3 * TILES);
    expect(layout.textureCells).toHaveLength(TILES);
    const decoded = decodeCells(layout.cells, 64, 64);
    expect(Object.keys(decoded.paint)).toHaveLength(64 * 64);
    expect(decoded.block.has(cellKey(0, 63))).toBe(true);
    expect(decoded.block.size).toBe(64);
    expect(Object.keys(decoded.fog)).toHaveLength(64 * 64);
  });

  it("the thumbnail reads every terrain and texture tile", async () => {
    const f = await tallestMap();
    const thumb = (await f.gm.query(api.combatMapStyle.thumbnail, { campaignId: f.campaignId, mapId: f.mapId }))!;
    expect(thumb.tiles.filter((x) => x.layer === "terrain")).toHaveLength(TILES);
    expect(thumb.tiles.filter((x) => x.layer === "texture")).toHaveLength(TILES);
  });

  it("movement and vision read the bottom tile", async () => {
    const f = await tallestMap();
    const { blocked, fog } = await f.t.run(async (c) => {
      const map = (await c.db.get("combatMaps", f.mapId))!;
      const campaign = (await c.db.get("campaigns", f.campaignId))!;
      const grid = await movementGrid(c, f.campaignId, map);
      const scene = await loadScene(c, campaign, map);
      return { blocked: [grid.blocked[63 * 64]!, grid.blocked[63 * 64 + 1]!], fog: Object.keys(scene.fog).length };
    });
    // The painted blocker in the last row stops tokens; the square beside it does not.
    expect(blocked).toEqual([1, 0]);
    expect(fog).toBe(64 * 64);
  });

  it("duplicating copies every tile and clearing the painting deletes every terrain tile", async () => {
    const f = await tallestMap();
    const { mapId: copyId } = await f.gm.mutation(api.combatMaps.duplicate, { campaignId: f.campaignId, mapId: f.mapId, idempotencyKey: key() });
    expect(await f.rows(copyId)).toHaveLength(CELL_LAYERS.length * TILES);
    await f.gm.mutation(api.combatMapEdit.clearPaint, { campaignId: f.campaignId, mapId: f.mapId, layer: "terrain" });
    const left = await f.rows();
    expect(left.filter((r) => r.layer === "terrain" || r.layer === "texture")).toEqual([]);
    expect(left).toHaveLength(2 * TILES);
  });
});
