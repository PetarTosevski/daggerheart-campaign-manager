import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import * as serverCells from "../../convex/lib/combatMaps";
import { COMBAT_TERRAINS } from "../../convex/lib/validators/combatMaps";
import * as cells from "../../src/components/combat-map/map-view/cells";
import { imageMapSize } from "../../src/components/combat-map/map-view/grid";
import { toPaintSpec } from "../../src/components/combat-map/map-view/paint-spec";
import { generateFallbackLayout } from "../../src/lib/combat-map/fallback-layout";
import type { PaintSpec } from "../../src/lib/combat-map/raster";
import { clean, TERRAINS, type MapSpec } from "../../src/lib/domain/combat-map/spec";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

// D9 C3: combat maps (list, create, rename, duplicate, delete, live, image upload, grid). Every write and the GM
// reads are GM-only (anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN); `live` is every member's.
// TE2's authz matrix does not exist yet; D12 folds these rows in.

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

async function withMap() {
  const ctx = await setupWithCampaign();
  const { campaignId, gm } = ctx;
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const list = () => gm.query(api.combatMaps.list, { campaignId });
  const get = async (id: Id<"combatMaps"> = mapId) => (await gm.query(api.combatMaps.get, { campaignId, mapId: id }))!;
  // convex-test records no content type, so set the one an upload would carry (as upload-claims.test.ts does).
  const storeImage = (contentType = "image/png", bytes = 64) =>
    ctx.t.run(async (c) => {
      const id = await c.storage.store(new Blob([new Uint8Array(bytes)], { type: contentType }));
      await (c.db as unknown as { patch: (id: Id<"_storage">, value: { contentType: string }) => Promise<void> }).patch(id, { contentType });
      return id;
    });
  const player = async () => {
    await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
    return ctx.other;
  };
  return { ...ctx, mapId, list, get, storeImage, player };
}

/** Every public function of convex/combatMaps.ts, called as `client`. */
function calls(f: Awaited<ReturnType<typeof withMap>>, storageId: Id<"_storage">) {
  const { campaignId, mapId } = f;
  return {
    list: (c: Client) => c.query(api.combatMaps.list, { campaignId }),
    get: (c: Client) => c.query(api.combatMaps.get, { campaignId, mapId }),
    tokenCount: (c: Client) => c.query(api.combatMaps.tokenCount, { campaignId, mapId }),
    create: (c: Client) => c.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() }),
    rename: (c: Client) => c.mutation(api.combatMaps.rename, { campaignId, mapId, name: "Renamed" }),
    setLive: (c: Client) => c.mutation(api.combatMaps.setLive, { campaignId, mapId }),
    duplicate: (c: Client) => c.mutation(api.combatMaps.duplicate, { campaignId, mapId, idempotencyKey: key() }),
    imageUploadUrl: (c: Client) => c.mutation(api.combatMaps.imageUploadUrl, { campaignId }),
    attachImage: (c: Client) => c.mutation(api.combatMaps.attachImage, { campaignId, mapId, storageId, width: 1200, height: 800 }),
    setGrid: (c: Client) =>
      c.mutation(api.combatMaps.setGrid, { campaignId, mapId, grid: { cell: 40, offsetX: 0, offsetY: 0 }, imageWidth: 1200, imageHeight: 800 }),
    remove: (c: Client) => c.mutation(api.combatMaps.remove, { campaignId, mapId }),
  };
}

describe("combat maps: access", () => {
  useAllowlist();

  it("refuses anonymous callers, outsiders and players on every GM function, and lets the GM run each", async () => {
    const f = await withMap();
    const storageId = await f.storeImage();
    const all = calls(f, storageId);
    const names = Object.keys(all) as (keyof typeof all)[];
    expect(names).toHaveLength(11);

    for (const name of names) expect([name, await code(all[name](f.t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
    for (const name of names) expect([name, await code(all[name](f.other))]).toEqual([name, "NOT_FOUND"]);
    const player = await f.player();
    for (const name of names) expect([name, await code(all[name](player))]).toEqual([name, "FORBIDDEN"]);
    // In this order every GM call is valid (setGrid needs the image attached before it; remove comes last).
    for (const name of names) expect([name, await code(all[name](f.gm))]).toEqual([name, "ok"]);
  });

  it("lets every member read the live map, and nobody outside the campaign", async () => {
    const f = await withMap();
    const live = (c: Client) => c.query(api.combatMaps.live, { campaignId: f.campaignId });
    expect(await code(live(f.t as unknown as Client))).toBe("UNAUTHENTICATED");
    expect(await code(live(f.other))).toBe("NOT_FOUND");
    const player = await f.player();
    expect((await live(player))?._id).toBe(f.mapId);
    expect((await live(f.gm))?._id).toBe(f.mapId);
  });

  it("gives NOT_FOUND for another campaign's map ids and null from get", async () => {
    const a = await withMap();
    const { campaignId: mine } = await a.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    expect(await a.gm.query(api.combatMaps.get, { campaignId: mine, mapId: a.mapId })).toBeNull();
    expect(await a.gm.query(api.combatMaps.get, { campaignId: mine, mapId: "not-an-id" })).toBeNull();
    for (const run of [
      () => a.gm.mutation(api.combatMaps.rename, { campaignId: mine, mapId: a.mapId, name: "x" }),
      () => a.gm.mutation(api.combatMaps.setLive, { campaignId: mine, mapId: a.mapId }),
      () => a.gm.mutation(api.combatMaps.duplicate, { campaignId: mine, mapId: a.mapId, idempotencyKey: key() }),
      () => a.gm.mutation(api.combatMaps.remove, { campaignId: mine, mapId: a.mapId }),
      () => a.gm.query(api.combatMaps.tokenCount, { campaignId: mine, mapId: a.mapId }),
      () => a.gm.mutation(api.combatMaps.rename, { campaignId: a.campaignId, mapId: "not-an-id", name: "x" }),
    ]) {
      expect(await code(run())).toBe("COMBAT_MAP_NOT_FOUND");
    }
  });
});

describe("combat maps: list, create, rename, live", () => {
  useAllowlist();

  it("creates blank maps of the board's sizes; the first is live, later ones are not", async () => {
    const { gm, campaignId, mapId, list, get } = await withMap();
    const { mapId: small } = await gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
    const { mapId: large } = await gm.mutation(api.combatMaps.create, { campaignId, size: "large", name: "  Ford  ", idempotencyKey: key() });
    expect((await list()).map(({ _id, name, live, source, w, h }) => ({ _id, name, live, source, w, h }))).toEqual([
      { _id: mapId, name: "Map 1", live: true, source: "blank", w: 30, h: 20 },
      { _id: small, name: "Map 2", live: false, source: "blank", w: 22, h: 15 },
      { _id: large, name: "Ford", live: false, source: "blank", w: 40, h: 27 },
    ]);
    expect(await get(large)).toMatchObject({ base: "grass", areas: [], objects: [], cells: [], image: null, seed: 1 });
  });

  it("replays a create with the same idempotency key once", async () => {
    const { gm, campaignId, list } = await withMap();
    const idempotencyKey = key();
    const first = await gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey });
    const again = await gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey });
    expect(again).toEqual(first);
    expect(await list()).toHaveLength(2);
  });

  it("refuses the 31st map with COMBAT_MAP_LIMIT", async () => {
    const { t, gm, campaignId, list } = await withMap();
    const row = (await list())[0]!;
    await t.run(async (ctx) => {
      const base = await ctx.db.get("combatMaps", row._id);
      const { _id, _creationTime, ...fields } = base!;
      void _id;
      void _creationTime;
      for (let i = 1; i < serverCells.MAX_COMBAT_MAPS; i++) await ctx.db.insert("combatMaps", { ...fields, live: false, name: `M${i}` });
    });
    expect(await list()).toHaveLength(serverCells.MAX_COMBAT_MAPS);
    expect(await code(gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() }))).toBe("COMBAT_MAP_LIMIT");
    expect(await code(gm.mutation(api.combatMaps.duplicate, { campaignId, mapId: row._id, idempotencyKey: key() }))).toBe("COMBAT_MAP_LIMIT");
  });

  it("renames with a trimmed name of 1 to 80 characters", async () => {
    const { gm, campaignId, mapId, get } = await withMap();
    await gm.mutation(api.combatMaps.rename, { campaignId, mapId, name: "  The ford  " });
    expect((await get()).name).toBe("The ford");
    for (const name of ["   ", "x".repeat(81)]) expect(await code(gm.mutation(api.combatMaps.rename, { campaignId, mapId, name }))).toBe("INVALID");
  });

  it("keeps exactly one live map: setLive moves the mark and players follow it", async () => {
    const f = await withMap();
    const { gm, campaignId, mapId, list } = f;
    const { mapId: second } = await gm.mutation(api.combatMaps.create, { campaignId, size: "small", idempotencyKey: key() });
    const player = await f.player();
    expect((await player.query(api.combatMaps.live, { campaignId }))?._id).toBe(mapId);
    await gm.mutation(api.combatMaps.setLive, { campaignId, mapId: second });
    expect((await list()).filter((m) => m.live).map((m) => m._id)).toEqual([second]);
    const seen = await player.query(api.combatMaps.live, { campaignId });
    expect(seen?._id).toBe(second);
    // The player's layout never carries the GM's scene description.
    await f.t.run((ctx) => ctx.db.patch("combatMaps", second, { prompt: "Hidden archers in the trees" }));
    expect(await player.query(api.combatMaps.live, { campaignId })).not.toHaveProperty("prompt");
    expect((await f.get(second)).prompt).toBe("Hidden archers in the trees");
    await gm.mutation(api.combatMaps.setLive, { campaignId, mapId: second });
    expect((await list()).filter((m) => m.live)).toHaveLength(1);
  });

  it("shows players an empty state (null) until a map is live", async () => {
    const { t, gm, campaignId, mapId } = await withMap();
    await t.run((ctx) => ctx.db.patch("combatMaps", mapId, { live: false }));
    expect(await gm.query(api.combatMaps.live, { campaignId })).toBeNull();
  });
});

describe("combat maps: duplicate and delete", () => {
  useAllowlist();

  async function seedChildren(f: Awaited<ReturnType<typeof withMap>>, objects: number) {
    return f.t.run(async (ctx) => {
      const userId = (await ctx.db.query("users").first())!._id;
      const now = Date.now();
      const characterId = await ctx.db.insert("characters", {
        campaignId: f.campaignId,
        ownerId: userId,
        createdBy: userId,
        status: "active",
        sheet: {},
        createdAt: now,
        updatedAt: now,
      } as never);
      for (let i = 0; i < objects; i++) {
        await ctx.db.insert("combatMapObjects", { mapId: f.mapId, kind: i % 2 ? "tree" : "walltorch", x: i % 30, y: Math.floor(i / 30), r: 0.6, rot: 0, lit: false });
      }
      await ctx.db.insert("combatMapCells", { mapId: f.mapId, layer: "terrain", tile: 0, cells: "h" + ".".repeat(8 * 30 - 1) });
      await ctx.db.insert("combatMapCells", { mapId: f.mapId, layer: "block", tile: 1, cells: "#".repeat(8 * 30) });
      for (let i = 0; i < serverCells.MAX_COMBAT_TOKENS; i++) {
        await ctx.db.insert("combatTokens", {
          campaignId: f.campaignId,
          mapId: f.mapId,
          ref: { kind: "custom", name: `T${i}`, hp: 3, hpMax: 3, stress: 0, stressMax: 2, conditions: [] },
          side: "enemy",
          x: i % 30,
          y: Math.floor(i / 30),
          size: 1,
          face: 0,
          light: "none",
          revealedTo: [],
        });
      }
      await ctx.db.insert("combatExplored", { mapId: f.mapId, characterId, bits: "AAAA", updatedAt: now });
    });
  }

  const childCounts = (f: Awaited<ReturnType<typeof withMap>>, mapId: Id<"combatMaps">) =>
    f.t.run(async (ctx) => ({
      objects: (await ctx.db.query("combatMapObjects").withIndex("by_map", (q) => q.eq("mapId", mapId)).collect()).length,
      cells: (await ctx.db.query("combatMapCells").withIndex("by_map_layer_tile", (q) => q.eq("mapId", mapId)).collect()).length,
      tokens: (await ctx.db.query("combatTokens").withIndex("by_map", (q) => q.eq("mapId", mapId)).collect()).length,
      explored: (await ctx.db.query("combatExplored").withIndex("by_map_character", (q) => q.eq("mapId", mapId)).collect()).length,
    }));

  it("duplicates the largest map's layout, objects and cells, without tokens, explored areas or the live mark", async () => {
    const f = await withMap();
    await seedChildren(f, serverCells.MAX_COMBAT_OBJECTS);
    expect(await f.gm.query(api.combatMaps.tokenCount, { campaignId: f.campaignId, mapId: f.mapId })).toBe(80);
    const { mapId: copy } = await f.gm.mutation(api.combatMaps.duplicate, { campaignId: f.campaignId, mapId: f.mapId, idempotencyKey: key() });
    expect(await childCounts(f, copy)).toEqual({ objects: 300, cells: 2, tokens: 0, explored: 0 });
    const [orig, dup] = [await f.get(), await f.get(copy)];
    expect(dup).toMatchObject({ name: "Map 1 (copy)", live: false, w: orig.w, h: orig.h, base: orig.base, seed: orig.seed });
    expect(dup.objects.map(({ _id, ...o }) => (void _id, o))).toEqual(orig.objects.map(({ _id, ...o }) => (void _id, o)));
    expect(dup.cells).toEqual(orig.cells);
  });

  it("deletes the largest map with every child row in one call; the oldest remaining map becomes live", async () => {
    const f = await withMap();
    const { mapId: second } = await f.gm.mutation(api.combatMaps.create, { campaignId: f.campaignId, size: "small", idempotencyKey: key() });
    await seedChildren(f, serverCells.MAX_COMBAT_OBJECTS);
    await f.gm.mutation(api.combatMaps.remove, { campaignId: f.campaignId, mapId: f.mapId });
    expect(await childCounts(f, f.mapId)).toEqual({ objects: 0, cells: 0, tokens: 0, explored: 0 });
    expect((await f.list()).map((m) => [m._id, m.live])).toEqual([[second, true]]);
  });

  it("continues a delete in scheduled batches when the child rows exceed one transaction's budget", async () => {
    vi.useFakeTimers();
    try {
      const f = await withMap();
      // More objects than the cap (a corrupt map) still go: 1100 objects + 80 tokens + cells + explored.
      await seedChildren(f, 1100);
      await f.gm.mutation(api.combatMaps.remove, { campaignId: f.campaignId, mapId: f.mapId });
      expect((await childCounts(f, f.mapId)).objects + (await childCounts(f, f.mapId)).tokens).toBeGreaterThan(0);
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await childCounts(f, f.mapId)).toEqual({ objects: 0, cells: 0, tokens: 0, explored: 0 });
      expect(await f.list()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes a map's image file with it", async () => {
    const f = await withMap();
    const storageId = await f.storeImage();
    await f.gm.mutation(api.combatMaps.attachImage, { campaignId: f.campaignId, mapId: f.mapId, storageId, width: 1200, height: 800 });
    await f.gm.mutation(api.combatMaps.remove, { campaignId: f.campaignId, mapId: f.mapId });
    expect(await f.t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.query("files").collect())).toEqual([]);
  });

  it("copies an image map's file into the duplicate's own file", async () => {
    vi.useFakeTimers();
    try {
      const f = await withMap();
      const storageId = await f.storeImage();
      await f.gm.mutation(api.combatMaps.attachImage, { campaignId: f.campaignId, mapId: f.mapId, storageId, width: 1200, height: 800 });
      const { mapId: copy } = await f.gm.mutation(api.combatMaps.duplicate, { campaignId: f.campaignId, mapId: f.mapId, idempotencyKey: key() });
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      const files = await f.t.run((ctx) => ctx.db.query("files").collect());
      expect(files.map((r) => r.refId).sort()).toEqual([f.mapId, copy].sort());
      expect(new Set(files.map((r) => r.storageId)).size).toBe(2);
      const dup = await f.get(copy);
      expect(dup.source).toBe("image");
      expect(dup.image?.url).toEqual(expect.any(String));
      expect(dup.image?.grid).toEqual((await f.get()).image?.grid);
      // Deleting the original keeps the copy's image.
      await f.gm.mutation(api.combatMaps.remove, { campaignId: f.campaignId, mapId: f.mapId });
      expect((await f.get(copy)).image?.url).toEqual(expect.any(String));
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a copied image when the duplicate was deleted before the copy landed", async () => {
    const f = await withMap();
    const storageId = await f.storeImage();
    await f.t.mutation(internal.combatMaps.attachCopiedImage, {
      mapId: f.mapId,
      storageId,
      uploadedBy: (await f.t.run((ctx) => ctx.db.query("users").first()))!._id,
      grid: { cell: 40, offsetX: 0, offsetY: 0 },
    });
    expect((await f.get()).image).not.toBeNull();
    const other = await f.storeImage();
    // A map that already has an image (or is gone) deletes the late copy.
    await f.t.mutation(internal.combatMaps.attachCopiedImage, {
      mapId: f.mapId,
      storageId: other,
      uploadedBy: (await f.t.run((ctx) => ctx.db.query("users").first()))!._id,
      grid: { cell: 40, offsetX: 0, offsetY: 0 },
    });
    expect(await f.t.run((ctx) => ctx.storage.getUrl(other))).toBeNull();
  });
});

describe("combat maps: image upload and grid", () => {
  useAllowlist();

  it("attaches an image to a new map named after it, with the board's first grid; refId is the map id", async () => {
    const f = await withMap();
    const storageId = await f.storeImage("image/webp");
    const result = await f.gm.mutation(api.combatMaps.attachImage, { campaignId: f.campaignId, storageId, width: 1500, height: 1000, name: "Ruins", size: "medium" });
    expect(result.ok).toBe(true);
    const mapId = (result as { mapId: Id<"combatMaps"> }).mapId;
    const map = await f.get(mapId);
    // cell = round(1500 / 30) = 50 → 30 x 20 squares.
    expect(map).toMatchObject({ name: "Ruins", source: "image", live: false, w: 30, h: 20, image: { grid: { cell: 50, offsetX: 0, offsetY: 0 } } });
    expect(map.image?.url).toEqual(expect.any(String));
    const files = await f.t.run((ctx) => ctx.db.query("files").collect());
    expect(files).toMatchObject([{ kind: "combatMap", refId: mapId, campaignId: f.campaignId, storageId }]);
  });

  it("replaces a map's layout with the image: objects, cells and explored areas go, tokens move inside, the old image is deleted", async () => {
    const f = await withMap();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("combatMapObjects", { mapId: f.mapId, kind: "tree", x: 3, y: 3, r: 1, rot: 0 });
      await ctx.db.insert("combatMapCells", { mapId: f.mapId, layer: "terrain", tile: 0, cells: "a".repeat(240) });
      await ctx.db.insert("combatTokens", {
        campaignId: f.campaignId,
        mapId: f.mapId,
        ref: { kind: "custom", name: "Far", hp: 1, hpMax: 1, stress: 0, stressMax: 1, conditions: [] },
        side: "enemy",
        x: 29,
        y: 19,
        size: 2,
        face: 0,
        light: "none",
        revealedTo: [],
      });
    });
    const first = await f.storeImage();
    await f.gm.mutation(api.combatMaps.attachImage, { campaignId: f.campaignId, mapId: f.mapId, storageId: first, width: 600, height: 400, size: "small" });
    const map = await f.get();
    // cell = round(600 / 22) = 27 → floor(600/27) = 22 x floor(400/27) = 14 squares.
    expect(map).toMatchObject({ source: "image", w: 22, h: 14, objects: [], cells: [], areas: [] });
    const token = await f.t.run(async (ctx) => (await ctx.db.query("combatTokens").first())!);
    expect([token.x, token.y]).toEqual([20, 12]);

    const second = await f.storeImage();
    await f.gm.mutation(api.combatMaps.attachImage, { campaignId: f.campaignId, mapId: f.mapId, storageId: second, width: 600, height: 400 });
    expect(await f.t.run((ctx) => ctx.storage.getUrl(first))).toBeNull();
    expect((await f.t.run((ctx) => ctx.db.query("files").collect())).map((r) => r.storageId)).toEqual([second]);
  });

  it("deletes a rejected file and returns ok: false instead of throwing (type, size, image size)", async () => {
    const f = await withMap();
    const rejected = [
      { storageId: await f.storeImage("image/svg+xml"), width: 100, height: 100 },
      { storageId: await f.storeImage("text/plain"), width: 100, height: 100 },
      { storageId: await f.storeImage("image/png", serverCells.MAX_COMBAT_IMAGE_BYTES + 1), width: 100, height: 100 },
      { storageId: await f.storeImage("image/png"), width: 0, height: 100 },
      { storageId: await f.storeImage("image/png"), width: 100.5, height: 100 },
    ];
    for (const attempt of rejected) {
      const result = await f.gm.mutation(api.combatMaps.attachImage, { campaignId: f.campaignId, mapId: f.mapId, ...attempt });
      expect(result).toMatchObject({ ok: false, code: "INVALID" });
      expect(await f.t.run((ctx) => ctx.storage.getUrl(attempt.storageId))).toBeNull();
    }
    expect((await f.get()).source).toBe("blank");
    expect(await f.t.run((ctx) => ctx.db.query("files").collect())).toEqual([]);
  });

  it("refuses a claimed or missing file with NOT_FOUND and keeps it", async () => {
    const f = await withMap();
    const storageId = await f.storeImage();
    await f.gm.mutation(api.combatMaps.attachImage, { campaignId: f.campaignId, mapId: f.mapId, storageId, width: 600, height: 400 });
    expect(await code(f.gm.mutation(api.combatMaps.attachImage, { campaignId: f.campaignId, storageId, width: 600, height: 400 }))).toBe("NOT_FOUND");
    expect(await f.t.run((ctx) => ctx.storage.getUrl(storageId))).not.toBeNull();
  });

  it("refuses an image upload for a map of another campaign before touching the file", async () => {
    const a = await withMap();
    const { campaignId: mine } = await a.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const storageId = await a.storeImage();
    expect(await code(a.gm.mutation(api.combatMaps.attachImage, { campaignId: mine, mapId: a.mapId, storageId, width: 600, height: 400 }))).toBe(
      "COMBAT_MAP_NOT_FOUND",
    );
    expect(await a.t.run((ctx) => ctx.storage.getUrl(storageId))).not.toBeNull();
  });

  it("sets the grid: square size and offset change the map's size in squares, within the bounds", async () => {
    const f = await withMap();
    const storageId = await f.storeImage();
    await f.gm.mutation(api.combatMaps.attachImage, { campaignId: f.campaignId, mapId: f.mapId, storageId, width: 1200, height: 800 });
    const setGrid = (cell: number, offsetX = 0, offsetY = 0) =>
      f.gm.mutation(api.combatMaps.setGrid, { campaignId: f.campaignId, mapId: f.mapId, grid: { cell, offsetX, offsetY }, imageWidth: 1200, imageHeight: 800 });
    await setGrid(48, 12, 20);
    // floor((1200 - 12) / 48) = 24, floor((800 - 20) / 48) = 16.
    expect(await f.get()).toMatchObject({ w: 24, h: 16, image: { grid: { cell: 48, offsetX: 12, offsetY: 20 } } });
    await setGrid(10);
    expect(await f.get()).toMatchObject({ w: 44, h: 32 });
    await setGrid(200);
    expect(await f.get()).toMatchObject({ w: 12, h: 10 });
    for (const bad of [() => setGrid(7), () => setGrid(40.5), () => setGrid(40, 1.5), () => setGrid(40, 5000), () => setGrid(5000)]) {
      expect(await code(bad())).toBe("COMBAT_MAP_SIZE");
    }
  });

  it("refuses a grid on a map without an image with INVALID", async () => {
    const f = await withMap();
    expect(
      await code(
        f.gm.mutation(api.combatMaps.setGrid, { campaignId: f.campaignId, mapId: f.mapId, grid: { cell: 40, offsetX: 0, offsetY: 0 }, imageWidth: 1200, imageHeight: 800 }),
      ),
    ).toBe("INVALID");
  });
});

describe("combat maps: shared shapes", () => {
  it("decodes painted cells the way C0 encodes them (same constants, every layer, clipped to the map)", () => {
    expect(cells.CELL_TILE_ROWS).toBe(serverCells.CELL_TILE_ROWS);
    expect(cells.CELL_UNPAINTED).toBe(serverCells.CELL_UNPAINTED);
    expect(cells.TERRAIN_CODES).toBe(serverCells.TERRAIN_CODES);
    expect(cells.BLOCK_CODE).toBe(serverCells.BLOCK_CODE);
    expect(cells.FOG_REVEAL).toBe(serverCells.FOG_REVEAL);
    expect(cells.FOG_HIDE).toBe(serverCells.FOG_HIDE);
    expect([...TERRAINS]).toEqual([...COMBAT_TERRAINS]);
    for (const terrain of COMBAT_TERRAINS) {
      expect(cells.codeOfTerrain(terrain)).toBe(serverCells.codeOfTerrain(terrain));
      expect(cells.terrainOfCode(serverCells.codeOfTerrain(terrain))).toBe(terrain);
    }

    const w = 12;
    const h = 10;
    const tile0 = serverCells.emptyTile(w).split("");
    tile0[cells.indexInTile(3, 2, w)] = serverCells.codeOfTerrain("water");
    tile0[cells.indexInTile(0, 0, w)] = "z"; // unknown code: ignored
    const tile1 = serverCells.emptyTile(w).split("");
    tile1[cells.indexInTile(5, 9, w)] = serverCells.codeOfTerrain("stone");
    tile1[cells.indexInTile(1, 11, w)] = serverCells.codeOfTerrain("lava"); // row 11 is below the map
    const decoded = cells.decodeCells(
      [
        { layer: "terrain", tile: 0, cells: tile0.join("") },
        { layer: "terrain", tile: 1, cells: tile1.join("") },
        { layer: "block", tile: 0, cells: "#" + ".".repeat(w - 1) + "#" },
        { layer: "fog", tile: 1, cells: "r.h" },
      ],
      w,
      h,
    );
    expect(decoded.paint).toEqual({ "3,2": "water", "5,9": "stone" });
    expect([...decoded.block].sort()).toEqual(["0,0", "0,1"]);
    expect(decoded.fog).toEqual({ "0,8": "reveal", "2,8": "hide" });
    expect(cells.tileOf(15)).toBe(1);
  });

  it("C1's MapSpec is a C2 PaintSpec, and a stored layout becomes one", () => {
    expectTypeOf<MapSpec>().toMatchTypeOf<PaintSpec>();
    const spec: MapSpec | null = clean(generateFallbackLayout("a forest camp", { seed: 7, w: 30, h: 20 }), 7);
    const paint: PaintSpec | null = spec;
    expect(paint?.w).toBe(30);
    const layout = {
      w: 22,
      h: 15,
      seed: 3,
      base: "grass" as const,
      areas: [{ terrain: "water" as const, shape: "rect" as const, x: 1, y: 1, w: 3, h: 2 }],
      objects: [{ _id: "o1", kind: "walltorch" as const, x: 2, y: 2, r: 0.5, rot: 0, lit: false }],
    };
    expect(toPaintSpec(layout)).toEqual({
      w: 22,
      h: 15,
      seed: 3,
      base: "grass",
      areas: layout.areas,
      objects: [{ kind: "walltorch", x: 2, y: 2, r: 0.5, rot: 0, lit: false }],
    });
  });

  it("sizes an image map from its grid within the bounds", () => {
    expect(imageMapSize({ width: 1500, height: 1000 }, { cell: 50, offsetX: 0, offsetY: 0 })).toEqual({ w: 30, h: 20 });
    expect(imageMapSize({ width: 100, height: 100 }, { cell: 50, offsetX: 0, offsetY: 0 })).toEqual({ w: 12, h: 10 });
    expect(imageMapSize({ width: 9000, height: 9000 }, { cell: 50, offsetX: 0, offsetY: 0 })).toEqual({ w: 44, h: 32 });
  });
});
