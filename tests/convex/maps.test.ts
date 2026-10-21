import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet } from "../../convex/lib/characterSheet";
import { playerTokenFilter } from "../../convex/lib/maps";
import { enduranceOwnerKey } from "../../src/lib/domain/rest/frame-hooks/index";
import { hexToPixel } from "../../src/lib/world/hex";
import { initialMapState } from "../../src/lib/world/map-state";
import { WITHERWILD_TERRAIN, paintTerrain } from "../../src/lib/world/terrain";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const GM = "gm@example.com";
const PLAYER = "player@example.com";
const STRANGER = "stranger@example.com";

describe("World map", () => {
  useAllowlist(`${GM},${PLAYER},${STRANGER}`);

  async function setup(frameId: "witherwild" | "journey-to-horizon" | "custom" = "witherwild") {
    const t = makeTest();
    const ids = await t.run(async (ctx) => ({
      gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
      player: await ctx.db.insert("users", { email: PLAYER, emailVerificationTime: 1 }),
      stranger: await ctx.db.insert("users", { email: STRANGER, emailVerificationTime: 1 }),
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
    for (const attempt of attempts) expect(errorCode(await attempt.catch((e) => e))).toBe("FORBIDDEN");

    expect(errorCode(await stranger.query(api.maps.get, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorCode(await stranger.mutation(api.maps.removeToken, { campaignId, id: visible.id }).catch((e) => e))).toBe("NOT_FOUND");
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

    await gm.mutation(api.maps.setOptions, { campaignId, scaleKm: 250, method: "mount", units: "mi", trail: "boat" });
    const rules = (await gm.query(api.maps.get, { campaignId })).state.options;
    expect(rules).toMatchObject({ method: "mount", units: "mi", trail: "boat", pace: "normal", hours: 8 });
    // An older client's flat pace is stored as the travel method it reads as.
    await gm.mutation(api.maps.setOptions, { campaignId, trail: "80" });
    expect((await gm.query(api.maps.get, { campaignId })).state.options.trail).toBe("mount");
    const table = { road: 50, wilds: 30, marsh: 10, deep: 15, mountains: 8, water: 5 };
    const custom = { speeds: { foot: table, mount: table, wagon: table, boat: table, fly: table }, slow: 0.5, fast: 1.5 };
    // The folded-in trail table from an older client is accepted and not kept.
    await gm.mutation(api.maps.setTravelRules, { campaignId, rules: { ...custom, trail: { foot: table, mount: table } } });
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
    expect(errorCode(await player.mutation(api.maps.paintCells, { campaignId, indexes: [0], codes: "#" }).catch((e) => e))).toBe("FORBIDDEN");
  });

  it("map uploads: images only, a file belongs to one campaign, previous upload deleted", async () => {
    const { t, gm, campaignId } = await setup("custom");
    const other = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const text = await t.run((ctx) => ctx.storage.store(new Blob(["hi"], { type: "text/plain" })));
    // convex-test records no content type, so a stored file always fails the image check here;
    // production uploads carry it.
    expect(await gm.mutation(api.maps.attachMapImage, { campaignId, storageId: text, width: 10, height: 10 })).toEqual({
      ok: false,
      message: "Maps must be PNG, JPEG, WebP or GIF images of at most 8 MB.",
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
    expect(errorCode(await gm.mutation(api.maps.attachMapImage, { campaignId: other.campaignId, storageId: image, width: 8, height: 6 }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorCode(await gm.mutation(api.maps.attachMapImage, { campaignId, storageId: image, width: 8, height: 6 }).catch((e) => e))).toBe("NOT_FOUND");

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
      expect(errorCode(await gm.mutation(api.maps.placePartyHex, { campaignId, q: 0, r: 0 }).catch((e) => e))).toBe("MECHANIC_DISABLED");
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
      expect(errorCode(await player.mutation(api.maps.moveToHex, { campaignId, q: 0, r: 0, terrain: 1, travelMode: "land", idempotencyKey: key() }).catch((e) => e))).toBe("FORBIDDEN");
    });

    it("players see markers only in hexes they can see (HF p.176); sanctuaries everywhere (HF p.169)", async () => {
      const { t, gm, player, campaignId } = await setup("journey-to-horizon");
      const grid ={ originX: 100, originY: 100, size: 40, orientation: "flat" as const };
      await gm.mutation(api.maps.setHexGrid, { campaignId, grid });
      // Marker positions are percentages of the 3400 × 2228 Horizon map, snapped to the hex centre.
      const add = async (type: string, q: number, r: number, hidden = false) => {
        const c = hexToPixel({ q, r }, grid);
        const { id } = await gm.mutation(api.maps.addToken, { campaignId, type, x: (c.x / 3400) * 100, y: (c.y / 2228) * 100, idempotencyKey: key() });
        if (hidden) await gm.mutation(api.maps.updateToken, { campaignId, id, patch: { hidden: true } });
        return id;
      };
      await gm.mutation(api.maps.placePartyHex, { campaignId, q: 0, r: 0 });
      const near = await add("village", 1, 0);
      const far = await add("ruins", 3, 0);
      const explored = await add("camp", 5, 2);
      const sanctuary = await add("sanctuary", 9, 4);
      await add("sanctuary", 9, 5, true);
      await add("cave", 1, -1, true);
      const seen = async () => (await player.query(api.maps.get, { campaignId })).state.tokens.map((t) => t.id);

      expect((await gm.query(api.maps.get, { campaignId })).state.tokens).toHaveLength(6);
      expect(await seen()).toEqual([near, sanctuary]);

      // Explored hexes show their markers wherever the party is.
      await gm.mutation(api.maps.updateHex, { campaignId, q: 5, r: 2, patch: { explored: true } });
      expect(await seen()).toEqual([near, explored, sanctuary]);

      // Moving next to the far marker reveals it; the party's old neighbourhood stays visible only where explored.
      await gm.mutation(api.maps.moveToHex, { campaignId, q: 1, r: 0, terrain: 1, travelMode: "land", idempotencyKey: key() });
      await gm.mutation(api.maps.moveToHex, { campaignId, q: 2, r: 0, terrain: 1, travelMode: "land", idempotencyKey: key() });
      expect(await seen()).toEqual([near, far, explored, sanctuary]);

      // Player views that list markers without the map (codex pins, Locations) use the same filter.
      const tokens = (await gm.query(api.maps.get, { campaignId })).state.tokens;
      const filtered = await t.run(async (ctx) => {
        const canSee = await playerTokenFilter(ctx, (await ctx.db.get(campaignId))!);
        return tokens.filter(canSee).map((tok) => tok.id);
      });
      expect(filtered).toEqual(await seen());
    });
  });

  it("other frames: player marker visibility ignores hexes", async () => {
    const { gm, player, campaignId } = await setup();
    const { id } = await gm.mutation(api.maps.addToken, { campaignId, type: "sanctuary", x: 90, y: 90, idempotencyKey: key() });
    const { id: far } = await gm.mutation(api.maps.addToken, { campaignId, type: "ruins", x: 1, y: 1, idempotencyKey: key() });
    expect((await player.query(api.maps.get, { campaignId })).state.tokens.map((t) => t.id)).toEqual([id, far]);
  });
});

describe("World map rows", () => {
  useAllowlist(`${GM},${PLAYER}`);

  async function setup(frameId: "witherwild" | "journey-to-horizon" = "witherwild") {
    const t = makeTest();
    const ids = await t.run(async (ctx) => ({
      gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
      player: await ctx.db.insert("users", { email: PLAYER, emailVerificationTime: 1 }),
    }));
    const gm = t.withIdentity({ subject: `${ids.gm}|s` });
    const player = t.withIdentity({ subject: `${ids.player}|s` });
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Rows", idempotencyKey: key() });
    await gm.mutation(api.members.invite, { campaignId, email: PLAYER });
    return { t, gm, player, campaignId };
  }

  type T = Awaited<ReturnType<typeof setup>>["t"];
  const TABLES = ["maps", "mapTokens", "mapHexes", "mapTerrain"] as const;

  /** Every row of every map table, by table and id. */
  async function snapshot(t: T) {
    const rows = await t.run(async (ctx) => {
      const out: [string, string][] = [];
      for (const table of TABLES) for (const row of await ctx.db.query(table).collect()) out.push([`${table}:${row._id}`, JSON.stringify(row)]);
      return out;
    });
    return new Map(rows);
  }

  /** The table of every map row `run` inserted, changed or deleted. */
  async function writes(t: T, run: () => Promise<unknown>): Promise<string[]> {
    const before = await snapshot(t);
    await run();
    const after = await snapshot(t);
    const keys = new Set([...before.keys(), ...after.keys()]);
    return [...keys].filter((k) => before.get(k) !== after.get(k)).map((k) => k.split(":")[0]!).sort();
  }

  it("addToken, updateToken and removeToken write only the marker's row; ids are never reused", async () => {
    const { t, gm, campaignId } = await setup();
    await gm.mutation(api.maps.renameType, { campaignId, typeId: "village", label: "Hamlet" });
    let first = 0;
    const add = async () => {
      first = (await gm.mutation(api.maps.addToken, { campaignId, type: "village", x: 1, y: 1, idempotencyKey: key() })).id;
    };
    expect(await writes(t, add)).toEqual(["mapTokens"]);
    expect(await writes(t, () => gm.mutation(api.maps.updateToken, { campaignId, id: first, patch: { name: "Oakhollow", x: 5 } }))).toEqual(["mapTokens"]);
    const { id: second } = await gm.mutation(api.maps.addToken, { campaignId, type: "city", x: 2, y: 2, idempotencyKey: key() });
    expect(await writes(t, () => gm.mutation(api.maps.removeToken, { campaignId, id: first }))).toEqual(["mapTokens"]);
    // Removing the highest marker also raises the stored counter, so its id stays retired.
    expect(await writes(t, () => gm.mutation(api.maps.removeToken, { campaignId, id: second }))).toEqual(["mapTokens", "maps"]);
    const { id: third } = await gm.mutation(api.maps.addToken, { campaignId, type: "camp", x: 3, y: 3, idempotencyKey: key() });
    expect(third).toBe(second + 1);
    expect((await gm.query(api.maps.get, { campaignId })).state.tokens.map((tok) => tok.id)).toEqual([third]);
  });

  it("paintCells writes only the terrain tiles it touches", async () => {
    const { t, gm, campaignId } = await setup();
    expect(await writes(t, () => gm.mutation(api.maps.paintCells, { campaignId, indexes: [0, 1, 500], codes: "##m" }))).toEqual(["mapTerrain"]);
    // A cell in the last tile: one more tile row; the first tile is untouched.
    expect(await writes(t, () => gm.mutation(api.maps.paintCells, { campaignId, indexes: [128 * 97], codes: "#" }))).toEqual(["mapTerrain"]);
    expect(await t.run(async (ctx) => (await ctx.db.query("mapTerrain").collect()).map((row) => row.tile).sort())).toEqual([0, 6]);
    const terrain = (await gm.query(api.maps.get, { campaignId })).state.terrain;
    expect([terrain.slice(0, 2), terrain[500], terrain[128 * 97]]).toEqual(["##", "m", "#"]);
    expect(terrain.slice(2, 500)).toBe(WITHERWILD_TERRAIN.slice(2, 500));
  });

  it("updateHex writes the hex row (and the counter only for a new hex); players get no hidden POI", async () => {
    const { t, gm, player, campaignId } = await setup("journey-to-horizon");
    await gm.mutation(api.maps.placePartyHex, { campaignId, q: 0, r: 0 });
    expect(await writes(t, () => gm.mutation(api.maps.updateHex, { campaignId, q: 0, r: 0, patch: { poi: { text: "Buried bell", hidden: true } } }))).toEqual(["mapHexes"]);
    expect(await writes(t, () => gm.mutation(api.maps.updateHex, { campaignId, q: 9, r: 9, patch: { region: "Far" } }))).toEqual(["mapHexes", "maps"]);
    await gm.mutation(api.maps.updateHex, { campaignId, q: 0, r: 0, patch: { habitat: "Reef", region: null } });
    const gmHex = (await gm.query(api.maps.get, { campaignId })).state.hexCrawl!.hexes.find((h) => h.q === 0 && h.r === 0);
    expect(gmHex).toEqual({ q: 0, r: 0, explored: true, habitat: "Reef", poi: { text: "Buried bell", hidden: true } });
    const view = await player.query(api.maps.get, { campaignId });
    expect(view.state.hexCrawl!.hexes).toEqual([{ q: 0, r: 0, explored: true, habitat: "Reef" }]);
    expect(JSON.stringify(view)).not.toMatch(/Buried bell|Far/);
  });

  describe("Endurance Countdowns on entering a wilderness hex (HF 176)", () => {
    afterEach(() => vi.restoreAllMocks());

    /** Every server die comes up `face` (a d4 shows ((face - 1) mod 4) + 1). */
    const forceDice = (face: number) =>
      vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => array.fill(face - 1)) as typeof crypto.getRandomValues);

    async function crawl() {
      const ctx = await setup("journey-to-horizon");
      const { t, gm, campaignId } = ctx;
      const { characterId } = await gm.mutation(api.characters.create, {
        campaignId,
        draft: {
          classId: "bard",
          subclassId: "troubadour",
          ancestry: { kind: "single", id: "elf" },
          communityId: "loreborne",
          traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
          name: "Liriel",
          pronouns: "",
          description: "",
          primaryWeaponId: "rapier",
          armorId: "gambeson-armor",
          potion: "Minor Health Potion",
          classItem: "",
          background: [],
          experiences: ["Wanderer", "Singer"],
          domainCards: ["deft-deceiver", "book-of-ava"],
          connections: [],
        },
        idempotencyKey: key(),
      });
      await gm.mutation(api.maps.placePartyHex, { campaignId, q: 0, r: 0 });
      const countdown = (value: number) =>
        t.run((c) =>
          c.db.insert("countdowns", {
            campaignId,
            name: "Endurance: Liriel",
            description: "",
            category: "consequence",
            startingValue: 6,
            currentValue: value,
            status: "active",
            consequence: "Vulnerable until the next rest.",
            createdAt: Date.now(),
            ownerKey: enduranceOwnerKey(characterId),
            kind: "endurance",
            revealed: true,
          }),
        );
      const move = (q: number, r: number) => gm.mutation(api.maps.moveToHex, { campaignId, q, r, terrain: 1, travelMode: "land", idempotencyKey: key() });
      const sheet = () => t.run(async (c) => readSheet((await c.db.get("characters", characterId))!.sheet));
      const row = (id: Id<"countdowns">) => t.run((c) => c.db.get("countdowns", id));
      return { ...ctx, characterId, countdown, move, sheet, row };
    }

    it("a Hope Die above the countdown ticks it; at or below it marks a Stress; a trigger makes the PC Vulnerable", async () => {
      const h = await crawl();
      const id = await h.countdown(2);
      forceDice(12);
      await h.move(1, 0);
      expect(await h.row(id)).toMatchObject({ currentValue: 1, status: "active" });
      expect((await h.sheet()).stress).toBe(0);

      vi.restoreAllMocks();
      forceDice(1);
      await h.move(2, 0);
      expect((await h.row(id))?.currentValue).toBe(1);
      expect((await h.sheet()).stress).toBe(1);

      vi.restoreAllMocks();
      forceDice(12);
      await h.move(3, 0);
      expect(await h.row(id)).toMatchObject({ currentValue: 0, status: "completed" });
      expect((await h.sheet()).conditions).toContain("vulnerable");
      const feed = await h.t.run((c) => c.db.query("actionLog").withIndex("by_character_at", (q) => q.eq("characterId", h.characterId)).collect());
      expect(feed.map((r) => r.summary).at(-1)).toMatch(/triggers: Vulnerable/);
    });

    it("a sanctuary hex is not wilderness; nothing rolls with the option off or without a countdown", async () => {
      const h = await crawl();
      const id = await h.countdown(6);
      const c = hexToPixel({ q: 1, r: 0 }, (await h.gm.query(api.maps.get, { campaignId: h.campaignId })).state.hexCrawl!.grid);
      await h.gm.mutation(api.maps.addToken, { campaignId: h.campaignId, type: "sanctuary", x: (c.x / 3400) * 100, y: (c.y / 2228) * 100, idempotencyKey: key() });
      forceDice(1);
      await h.move(1, 0);
      expect((await h.row(id))?.currentValue).toBe(6);
      expect((await h.sheet()).stress).toBe(0);

      await h.gm.mutation(api.campaigns.setOption, { campaignId: h.campaignId, option: "enduranceCountdowns", enabled: false });
      await h.move(2, 0);
      expect((await h.sheet()).stress).toBe(0);

      const bare = await crawl();
      forceDice(1);
      await bare.move(1, 0);
      expect((await bare.sheet()).stress).toBe(0);
    });
  });
});

describe("migrations/mapTrailMode:rewriteTrailMode (PD1)", () => {
  useAllowlist(GM);
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const table = { road: 50, wilds: 30, marsh: 10, deep: 15, mountains: 8, water: 5 };
  const rules = { speeds: { foot: table, mount: table, wagon: table, boat: table, fly: table }, slow: 0.5, fast: 1.5 };

  it("rewrites stored flat paces and drops the old trail table; maps read the same; idempotent", async () => {
    const t = makeTest();
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }));
    const gm = t.withIdentity({ subject: `${userId}|s` });
    const create = async (name: string) => (await gm.mutation(api.campaigns.create, { frameId: "witherwild", name, idempotencyKey: key() })).campaignId;
    const v2 = await create("Version 2");
    const v1 = await create("Version 1");
    const current = await create("Current");
    await gm.mutation(api.maps.setOptions, { campaignId: v2, hours: 6 });
    await gm.mutation(api.maps.setOptions, { campaignId: current, trail: "wagon" });
    const mapRow = (campaignId: Id<"campaigns">) =>
      t.run((ctx) =>
        ctx.db
          .query("maps")
          .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
          .unique(),
      );
    // Stored before PD1: a flat pace and the separate trail table (version 2), and a version 1 document at 80 km/day.
    const row = (await mapRow(v2))!;
    await t.run(async (ctx) => {
      const data = row.data as { options: Record<string, unknown> };
      await ctx.db.patch("maps", row._id, { data: { ...data, options: { ...data.options, trail: "40", rules: { ...rules, trail: { foot: table, mount: table } } } } });
      const old = initialMapState("witherwild");
      await ctx.db.insert("maps", { campaignId: v1, data: { ...old, options: { ...old.options, trail: "80" } }, updatedAt: 0 });
    });
    const untouched = await mapRow(current);

    const before = { v2: await gm.query(api.maps.get, { campaignId: v2 }), v1: await gm.query(api.maps.get, { campaignId: v1 }) };
    expect(before.v2.state.options).toMatchObject({ trail: "foot", hours: 6, rules });
    expect(before.v2.state.options.rules).not.toHaveProperty("trail");
    expect(before.v1.state.options.trail).toBe("mount");

    const migrate = async (reset = false) => {
      await t.mutation(internal.migrations.run.run, { fn: "migrations/mapTrailMode:rewriteTrailMode", reset });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    };
    const stored = async (campaignId: Id<"campaigns">) => ((await mapRow(campaignId))!.data as { options: { trail: string; rules?: object } }).options;
    await migrate();
    expect(await stored(v2)).toMatchObject({ trail: "foot", rules });
    expect((await stored(v2)).rules).not.toHaveProperty("trail");
    expect((await stored(v1)).trail).toBe("mount");
    expect(await mapRow(current)).toEqual(untouched);
    expect(await gm.query(api.maps.get, { campaignId: v2 })).toEqual(before.v2);
    expect(await gm.query(api.maps.get, { campaignId: v1 })).toEqual(before.v1);

    const after = { v2: await mapRow(v2), v1: await mapRow(v1) };
    await migrate(true);
    expect({ v2: await mapRow(v2), v1: await mapRow(v1) }).toEqual(after);
  });
});
