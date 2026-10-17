import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { WITHERWILD_TERRAIN, paintTerrain } from "../../src/lib/world/terrain";
import { errorCode, errorData, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const GM = "gm@example.com";
const PLAYER = "player@example.com";
const STRANGER = "stranger@example.com";

describe("World map", () => {
  useAllowlist(`${GM},${PLAYER},${STRANGER}`);

  async function setup(frameId: "witherwild" | "journey-to-horizon" | "custom" = "witherwild") {
    const t = makeTest();
    const ids = await t.run(async (ctx) => ({
      gm: await ctx.db.insert("users", { email: GM }),
      player: await ctx.db.insert("users", { email: PLAYER }),
      stranger: await ctx.db.insert("users", { email: STRANGER }),
    }));
    const gm = t.withIdentity({ subject: `${ids.gm}|s` });
    const player = t.withIdentity({ subject: `${ids.player}|s` });
    const stranger = t.withIdentity({ subject: `${ids.stranger}|s` });
    const custom =
      frameId === "custom"
        ? { pitch: "Salt and ruin.", tones: ["Dark"], themes: "", touchstones: "", partySize: 4, startingTier: 1, background: "custom" }
        : undefined;
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Map test", custom, idempotencyKey: key() });
    await gm.mutation(api.members.invite, { campaignId, email: PLAYER });
    return { t, gm, player, stranger, campaignId };
  }

  it("starts from the frame's defaults: Witherwild terrain and 400 km", async () => {
    const { gm, campaignId } = await setup();
    const view = await gm.query(api.maps.get, { campaignId });
    expect(view.role).toBe("gm");
    expect(view.state.terrain).toBe(WITHERWILD_TERRAIN);
    expect(view.state.scaleKm).toBe(400);
    expect(view.state.tokens).toEqual([]);
    expect(view.mapUrl).toBeNull();
  });

  it("players never receive hidden markers or notes; they can't edit; strangers can't read", async () => {
    const { gm, player, stranger, campaignId } = await setup();
    const visible = await gm.mutation(api.maps.addToken, { campaignId, type: "village", x: 10, y: 20, idempotencyKey: key() });
    const hidden = await gm.mutation(api.maps.addToken, { campaignId, type: "cave", x: 30, y: 40, idempotencyKey: key() });
    await gm.mutation(api.maps.updateToken, { campaignId, id: visible.id, patch: { name: "Oakhollow", notes: "The mayor is a spy", location: true } });
    await gm.mutation(api.maps.updateToken, { campaignId, id: hidden.id, patch: { name: "Wyrm lair", hidden: true, location: true } });

    const gmView = await gm.query(api.maps.get, { campaignId });
    expect(gmView.state.tokens.map((t) => t.name)).toEqual(["Oakhollow", "Wyrm lair"]);

    const playerView = await player.query(api.maps.get, { campaignId });
    expect(playerView.role).toBe("player");
    expect(playerView.state.tokens).toEqual([{ id: visible.id, type: "village", x: 10, y: 20, name: "Oakhollow", notes: "", hidden: false, location: true }]);
    expect(JSON.stringify(playerView)).not.toMatch(/Wyrm lair|spy/);
    expect(playerView.state.terrain).toBe(WITHERWILD_TERRAIN);
    expect((await player.query(api.maps.locations, { campaignId })).map((l) => l.name)).toEqual(["Oakhollow"]);
    expect((await gm.query(api.maps.locations, { campaignId })).map((l) => l.name)).toEqual(["Oakhollow", "Wyrm lair"]);

    const attempts = [
      player.mutation(api.maps.addToken, { campaignId, type: "village", x: 1, y: 1, idempotencyKey: key() }),
      player.mutation(api.maps.updateToken, { campaignId, id: visible.id, patch: { name: "Mine" } }),
      player.mutation(api.maps.removeToken, { campaignId, id: visible.id }),
      player.mutation(api.maps.moveParty, { campaignId, x: 5, y: 5, idempotencyKey: key() }),
      player.mutation(api.maps.setTerrain, { campaignId, reset: true }),
      player.mutation(api.maps.setOptions, { campaignId, scaleKm: 10 }),
      player.mutation(api.maps.mapImageUploadUrl, { campaignId }),
    ];
    for (const attempt of attempts) expect(errorData(await attempt.catch((e) => e))).toBe("FORBIDDEN");

    expect(errorData(await stranger.query(api.maps.get, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await stranger.mutation(api.maps.removeToken, { campaignId, id: visible.id }).catch((e) => e))).toBe("NOT_FOUND");
  });

  it("adding a marker or moving the party replays on a retried key", async () => {
    const { gm, campaignId } = await setup();
    const k = key();
    const first = await gm.mutation(api.maps.addToken, { campaignId, type: "camp", x: 50, y: 50, idempotencyKey: k });
    const again = await gm.mutation(api.maps.addToken, { campaignId, type: "camp", x: 50, y: 50, idempotencyKey: k });
    expect(again).toEqual(first);
    expect(errorCode(await gm.mutation(api.maps.addToken, { campaignId, type: "city", x: 50, y: 50, idempotencyKey: k }).catch((e) => e))).toBe(
      "IDEMPOTENCY_MISMATCH",
    );

    const mk = key();
    await gm.mutation(api.maps.moveParty, { campaignId, x: 60, y: 60, idempotencyKey: mk });
    await gm.mutation(api.maps.moveParty, { campaignId, x: 60, y: 60, idempotencyKey: mk });
    const state = (await gm.query(api.maps.get, { campaignId })).state;
    expect(state.tokens).toHaveLength(1);
    expect(state.party).toEqual({ x: 60, y: 60, trail: [{ x: 44, y: 52 }] });
  });

  it("keeps the last 12 trail positions and validates input", async () => {
    const { gm, campaignId } = await setup();
    for (let i = 0; i < 14; i++) await gm.mutation(api.maps.moveParty, { campaignId, x: i, y: i, idempotencyKey: key() });
    const { party } = (await gm.query(api.maps.get, { campaignId })).state;
    expect(party.trail).toHaveLength(12);
    expect(party.trail.at(-1)).toEqual({ x: 12, y: 12 });

    expect(errorCode(await gm.mutation(api.maps.addToken, { campaignId, type: "spaceship", x: 1, y: 1, idempotencyKey: key() }).catch((e) => e))).toBe("INVALID");
    expect(errorCode(await gm.mutation(api.maps.addToken, { campaignId, type: "city", x: 101, y: 1, idempotencyKey: key() }).catch((e) => e))).toBe("INVALID");
    expect(errorCode(await gm.mutation(api.maps.setTerrain, { campaignId, terrain: "xyz" }).catch((e) => e))).toBe("INVALID");
    const { id } = await gm.mutation(api.maps.addToken, { campaignId, type: "city", x: 1, y: 1, idempotencyKey: key() });
    expect(errorCode(await gm.mutation(api.maps.updateToken, { campaignId, id, patch: { notes: "x".repeat(2001) } }).catch((e) => e))).toBe("INVALID");
  });

  it("paints terrain, renames types, adds custom markers and edits travel rules", async () => {
    const { gm, campaignId } = await setup();
    const painted = paintTerrain(WITHERWILD_TERRAIN, 5, 5, 2, "#");
    await gm.mutation(api.maps.setTerrain, { campaignId, terrain: painted });
    expect((await gm.query(api.maps.get, { campaignId })).state.terrain).toBe(painted);
    await gm.mutation(api.maps.setTerrain, { campaignId, reset: true });
    expect((await gm.query(api.maps.get, { campaignId })).state.terrain).toBe(WITHERWILD_TERRAIN);

    await gm.mutation(api.maps.renameType, { campaignId, typeId: "village", label: "Hamlet" });
    const { id: typeId } = await gm.mutation(api.maps.addCustomType, { campaignId, label: "Witch hut", icon: "cave", color: "#5a2a6a", idempotencyKey: key() });
    const { id } = await gm.mutation(api.maps.addToken, { campaignId, type: typeId, x: 3, y: 3, idempotencyKey: key() });
    const { id: hamlet } = await gm.mutation(api.maps.addToken, { campaignId, type: "village", x: 4, y: 4, idempotencyKey: key() });
    const state = (await gm.query(api.maps.get, { campaignId })).state;
    expect(state.tokens.find((t) => t.id === id)!.name).toBe("Witch hut");
    expect(state.tokens.find((t) => t.id === hamlet)!.name).toBe("Hamlet");

    await gm.mutation(api.maps.setOptions, { campaignId, scaleKm: 250, method: "mount", units: "mi", trail: "60" });
    const rules = (await gm.query(api.maps.get, { campaignId })).state.options;
    expect(rules).toMatchObject({ method: "mount", units: "mi", trail: "60", pace: "normal", hours: 8 });
    const custom = {
      speeds: Object.fromEntries(["foot", "mount", "wagon", "boat", "fly"].map((m) => [m, { road: 50, wilds: 30, marsh: 10, deep: 15, mountains: 8, water: 5 }])),
      trail: { foot: { road: 50, wilds: 30, marsh: 10, deep: 15, mountains: 8, water: 5 }, mount: { road: 70, wilds: 50, marsh: 15, deep: 25, mountains: 12, water: 5 } },
      slow: 0.5,
      fast: 1.5,
    };
    await gm.mutation(api.maps.setTravelRules, { campaignId, rules: custom });
    expect((await gm.query(api.maps.get, { campaignId })).state.options.rules).toEqual(custom);
    expect(errorCode(await gm.mutation(api.maps.setTravelRules, { campaignId, rules: { ...custom, slow: 0 } }).catch((e) => e))).toBe("INVALID");
    await gm.mutation(api.maps.setTravelRules, { campaignId, rules: null });
    expect((await gm.query(api.maps.get, { campaignId })).state.options.rules).toBeUndefined();
  });

  it("paints cells onto the stored grid without clobbering other cells", async () => {
    const { gm, player, campaignId } = await setup();
    // Two tabs paint different cells from the same starting grid; both strokes survive.
    await gm.mutation(api.maps.paintCells, { campaignId, indexes: [0, 1], codes: "##" });
    await gm.mutation(api.maps.paintCells, { campaignId, indexes: [500], codes: "m" });
    const terrain = (await gm.query(api.maps.get, { campaignId })).state.terrain;
    expect(terrain.slice(0, 2)).toBe("##");
    expect(terrain[500]).toBe("m");
    expect(terrain.slice(2, 500)).toBe(WITHERWILD_TERRAIN.slice(2, 500));
    // Undo sends the previous codes of only its own cells.
    await gm.mutation(api.maps.paintCells, { campaignId, indexes: [0, 1], codes: WITHERWILD_TERRAIN.slice(0, 2) });
    const undone = (await gm.query(api.maps.get, { campaignId })).state.terrain;
    expect(undone.slice(0, 2)).toBe(WITHERWILD_TERRAIN.slice(0, 2));
    expect(undone[500]).toBe("m");

    for (const bad of [
      { indexes: [0], codes: "x" },
      { indexes: [0, 1], codes: "#" },
      { indexes: [128 * 98], codes: "#" },
      { indexes: [1.5], codes: "#" },
    ]) {
      expect(errorCode(await gm.mutation(api.maps.paintCells, { campaignId, ...bad }).catch((e) => e))).toBe("INVALID");
    }
    expect(errorData(await player.mutation(api.maps.paintCells, { campaignId, indexes: [0], codes: "#" }).catch((e) => e))).toBe("FORBIDDEN");
  });

  it("map uploads: images only, a file belongs to one campaign, previous upload deleted", async () => {
    const { t, gm, campaignId } = await setup("custom");
    const other = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const text = await t.run((ctx) => ctx.storage.store(new Blob(["hi"], { type: "text/plain" })));
    // convex-test records no content type, so a stored file always fails the image check here;
    // production uploads carry it.
    expect(await gm.mutation(api.maps.attachMapImage, { campaignId, storageId: text, width: 10, height: 10 })).toEqual({
      ok: false,
      message: "Maps must be images of at most 8 MB.",
    });
    expect(await t.run((ctx) => ctx.storage.getUrl(text))).toBeNull();

    // Attach two images the way attachMapImage records them.
    const attach = (storageId: Id<"_storage">, campaign: Id<"campaigns">) =>
      t.run(async (ctx) => {
        const owner = (await ctx.db.get(campaign))!.ownerId;
        await ctx.db.insert("files", { storageId, campaignId: campaign, uploadedBy: owner, kind: "map", refId: campaign, createdAt: 0 });
        const row = await ctx.db
          .query("maps")
          .withIndex("by_campaign", (q) => q.eq("campaignId", campaign))
          .unique();
        const data = { ...(await gm.query(api.maps.get, { campaignId: campaign })).state, customMap: { storageId, width: 800, height: 600 } };
        if (row) await ctx.db.patch(row._id, { data });
        else await ctx.db.insert("maps", { campaignId: campaign, data, updatedAt: 0 });
      });
    const image = await t.run((ctx) => ctx.storage.store(new Blob(["png"], { type: "image/png" })));
    await attach(image, campaignId);
    expect((await gm.query(api.maps.get, { campaignId })).mapUrl).toEqual(expect.any(String));

    // The same file can't be claimed again, here or by another campaign.
    expect(errorData(await gm.mutation(api.maps.attachMapImage, { campaignId: other.campaignId, storageId: image, width: 8, height: 6 }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await gm.mutation(api.maps.attachMapImage, { campaignId, storageId: image, width: 8, height: 6 }).catch((e) => e))).toBe("NOT_FOUND");

    // A map pointing at a file recorded for another campaign resolves to no URL and isn't deleted.
    const foreign = await t.run((ctx) => ctx.storage.store(new Blob(["png"], { type: "image/png" })));
    await attach(foreign, other.campaignId);
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query("maps")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .unique())!;
      await ctx.db.patch(row._id, { data: { ...row.data, customMap: { storageId: foreign, width: 8, height: 6 } } });
    });
    expect((await gm.query(api.maps.get, { campaignId })).mapUrl).toBeNull();
    await gm.mutation(api.maps.removeMapImage, { campaignId });
    expect(await t.run((ctx) => ctx.storage.getUrl(foreign))).toEqual(expect.any(String));
    expect((await gm.query(api.maps.get, { campaignId })).state.customMap).toBeUndefined();

    // Removing its own upload deletes the file.
    await attach(image, other.campaignId).catch(() => undefined);
    const own = await t.run((ctx) => ctx.storage.store(new Blob(["png"], { type: "image/png" })));
    await attach(own, campaignId);
    await gm.mutation(api.maps.removeMapImage, { campaignId });
    expect(await t.run((ctx) => ctx.storage.getUrl(own))).toBeNull();
  });

  describe("Journey to Horizon hex crawl", () => {
    it("is Horizon-only", async () => {
      const { gm, campaignId } = await setup();
      expect(errorData(await gm.mutation(api.maps.placePartyHex, { campaignId, q: 0, r: 0 }).catch((e) => e))).toBe("MECHANIC_DISABLED");
    });

    it("moves the party to adjacent hexes, advancing days; players see only explored and nearby hexes", async () => {
      const { gm, player, campaignId } = await setup("journey-to-horizon");
      const start = await gm.query(api.maps.get, { campaignId });
      expect(start.state.hexCrawl).toMatchObject({ day: 1, party: null, hexes: [] });

      await gm.mutation(api.maps.setHexGrid, { campaignId, grid: { originX: 100, originY: 100, size: 40, orientation: "flat" } });
      await gm.mutation(api.maps.updateHex, { campaignId, q: 5, r: 5, patch: { poi: { text: "Echo shrine", hidden: true }, terrain: 3 } });
      await gm.mutation(api.maps.updateHex, { campaignId, q: 1, r: 0, patch: { poi: { text: "Secret cave", hidden: true } } });
      await gm.mutation(api.maps.updateHex, { campaignId, q: -1, r: 2, patch: { poi: { text: "Old tower", hidden: false } } });

      const move = (q: number, r: number) =>
        gm.mutation(api.maps.moveToHex, { campaignId, q, r, terrain: 2, travelMode: "land", idempotencyKey: key() });
      expect(errorCode(await move(1, 0).catch((e) => e))).toBe("INVALID");

      await gm.mutation(api.maps.placePartyHex, { campaignId, q: 0, r: 0 });
      expect(errorCode(await move(3, 0).catch((e) => e))).toBe("INVALID");
      const k = key();
      const result = await gm.mutation(api.maps.moveToHex, { campaignId, q: 1, r: 0, terrain: 2, travelMode: "land", idempotencyKey: k });
      expect(result.days).toBe(2);
      expect(result.day).toBe(3);
      expect(result.dice).toHaveLength(2);
      expect(result.encounter).toBe(result.dice.includes(1));
      // A retried key replays the same rolls without moving again.
      expect(await gm.mutation(api.maps.moveToHex, { campaignId, q: 1, r: 0, terrain: 2, travelMode: "land", idempotencyKey: k })).toEqual(result);

      const gmCrawl = (await gm.query(api.maps.get, { campaignId })).state.hexCrawl!;
      expect(gmCrawl.party).toEqual({ q: 1, r: 0 });
      expect(gmCrawl.day).toBe(3);
      expect(gmCrawl.lastMove).toMatchObject({ q: 1, r: 0, days: 2 });
      expect(gmCrawl.hexes.find((h) => h.q === 1 && h.r === 0)).toMatchObject({ explored: true, terrain: 2 });

      const view = await player.query(api.maps.get, { campaignId });
      const crawl = view.state.hexCrawl!;
      expect(crawl.lastMove).toBeUndefined();
      expect(crawl.party).toEqual({ q: 1, r: 0 });
      const keys = crawl.hexes.map((h) => `${h.q},${h.r}`).sort();
      // explored (0,0) and (1,0); the tower at (-1,2) is two hexes away and unexplored, so it isn't sent
      expect(keys).toEqual(["0,0", "1,0"]);
      expect(JSON.stringify(view)).not.toMatch(/Echo shrine|Secret cave|Old tower/);

      // Move next to the tower: an adjacent, non-hidden POI becomes visible.
      await move(0, 1);
      const later = (await player.query(api.maps.get, { campaignId })).state.hexCrawl!;
      expect(later.hexes.find((h) => h.q === -1 && h.r === 2)?.poi).toEqual({ text: "Old tower", hidden: false });
      expect(errorData(await player.mutation(api.maps.moveToHex, { campaignId, q: 0, r: 0, terrain: 1, travelMode: "land", idempotencyKey: key() }).catch((e) => e))).toBe("FORBIDDEN");
    });
  });
});
