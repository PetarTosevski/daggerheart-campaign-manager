import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { initialMapState, type MapState } from "../../src/lib/world/map-state";
import { WITHERWILD_TERRAIN, paintTerrain } from "../../src/lib/world/terrain";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const GM = "gm@example.com";
const PLAYER = "player@example.com";
const MIGRATION = "migrations/maps:splitMaps";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A version 1 map document (one whole `MapState`, no `schemaVersion`) as stored before the split. */
function horizonV1(): MapState {
  const base = initialMapState("journey-to-horizon");
  return {
    ...base,
    // Stored out of order, as arrays may be: reads come back by id and by (q, r).
    tokens: [
      { id: 3, type: "c1", x: 4.71, y: 6.04, name: "Shrine", notes: "", hidden: false, location: true },
      { id: 1, type: "village", x: 2.94, y: 4.49, name: "Oakhollow", notes: "The mayor is a spy", hidden: false, location: true },
      { id: 2, type: "cave", x: 20, y: 20, name: "Wyrm lair", notes: "", hidden: true, location: true },
    ],
    nextId: 6,
    party: { x: 12, y: 14, trail: [{ x: 1, y: 2 }] },
    terrain: paintTerrain(base.terrain, 40, 60, 3, "#"),
    customTypes: [{ id: "c1", label: "Shrine", icon: "temple", color: "#5a2a6a" }],
    typeLabels: { village: "Hamlet", cave: "Secret lair" },
    hexCrawl: {
      grid: { originX: 100, originY: 100, size: 40, orientation: "flat" },
      hexes: [
        { q: 1, r: 0, explored: true, terrain: 2, poi: { text: "Secret cave", hidden: true } },
        { q: 0, r: 0, explored: true, habitat: "Reef" },
        { q: -1, r: 2, explored: false, poi: { text: "Old tower", hidden: false } },
        { q: 5, r: 5, explored: false, poi: { text: "Echo shrine", hidden: true } },
      ],
      party: { q: 1, r: 0 },
      day: 3,
      travelMode: "land",
      lastMove: { q: 1, r: 0, days: 2, dice: [3, 4], encounter: false },
    },
  };
}

describe("migrations/maps:splitMaps", () => {
  useAllowlist(`${GM},${PLAYER}`);

  async function setup() {
    const t = makeTest();
    const ids = await t.run(async (ctx) => ({
      gm: await ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }),
      player: await ctx.db.insert("users", { email: PLAYER, emailVerificationTime: 1 }),
    }));
    const gm = t.withIdentity({ subject: `${ids.gm}|s` });
    const player = t.withIdentity({ subject: `${ids.player}|s` });
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "journey-to-horizon", name: "Old map", idempotencyKey: key() });
    const { campaignId: plain } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Plain", idempotencyKey: key() });
    await gm.mutation(api.members.invite, { campaignId, email: PLAYER });
    await t.run(async (ctx) => {
      await ctx.db.insert("maps", { campaignId, data: horizonV1(), updatedAt: 0 });
      await ctx.db.insert("maps", { campaignId: plain, data: { ...initialMapState("witherwild"), nextId: 1 }, updatedAt: 0 });
    });
    return { t, gm, player, campaignId, plain };
  }

  type T = Awaited<ReturnType<typeof setup>>["t"];

  async function rows(t: T, campaignId: Id<"campaigns">) {
    return t.run(async (ctx) => {
      const map = await ctx.db
        .query("maps")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .unique();
      const count = async (table: "mapTokens" | "mapHexes" | "mapTerrain") => (await ctx.db.query(table).collect()).filter((r) => r.campaignId === campaignId).length;
      return { version: (map!.data as { schemaVersion?: number }).schemaVersion ?? 1, tokens: await count("mapTokens"), hexes: await count("mapHexes"), tiles: await count("mapTerrain") };
    });
  }

  async function migrate(t: T, reset = false) {
    await t.mutation(internal.migrations.run.run, { fn: MIGRATION, batchSize: 1, reset });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  }

  it("turns old map documents into rows, and every view reads the same afterwards", async () => {
    const { t, gm, player, campaignId, plain } = await setup();
    const before = {
      gm: await gm.query(api.maps.get, { campaignId }),
      player: await player.query(api.maps.get, { campaignId }),
      locations: await player.query(api.maps.locations, { campaignId }),
      plain: await gm.query(api.maps.get, { campaignId: plain }),
    };
    // Version 1 already reads normalised and server-filtered.
    expect(before.gm.state.tokens.map((tok) => tok.id)).toEqual([1, 2, 3]);
    expect(before.player.state.tokens.map((tok) => tok.name)).toEqual(["Oakhollow", "Shrine"]);
    expect(JSON.stringify(before.player)).not.toMatch(/spy|Wyrm lair|Secret|Echo shrine|Old tower/);

    await migrate(t);

    expect(await rows(t, campaignId)).toEqual({ version: 2, tokens: 3, hexes: 4, tiles: 1 });
    expect(await rows(t, plain)).toEqual({ version: 2, tokens: 0, hexes: 0, tiles: 0 });
    expect(await gm.query(api.maps.get, { campaignId })).toEqual(before.gm);
    expect(await player.query(api.maps.get, { campaignId })).toEqual(before.player);
    expect(await player.query(api.maps.locations, { campaignId })).toEqual(before.locations);
    expect(await gm.query(api.maps.get, { campaignId: plain })).toEqual(before.plain);
    expect((await gm.query(api.maps.get, { campaignId: plain })).state.terrain).toBe(WITHERWILD_TERRAIN);

    // Idempotent: a reset run splits nothing twice.
    await migrate(t, true);
    expect(await rows(t, campaignId)).toEqual({ version: 2, tokens: 3, hexes: 4, tiles: 1 });
    expect(await gm.query(api.maps.get, { campaignId })).toEqual(before.gm);
  });

  it("the first edit of an old map splits it, keeping the marker counter", async () => {
    const { t, gm, campaignId } = await setup();
    const { id } = await gm.mutation(api.maps.addToken, { campaignId, type: "camp", x: 50, y: 50, idempotencyKey: key() });
    expect(id).toBe(6);
    expect(await rows(t, campaignId)).toEqual({ version: 2, tokens: 4, hexes: 4, tiles: 1 });
    const state = (await gm.query(api.maps.get, { campaignId })).state;
    expect(state.tokens.map((tok) => tok.id)).toEqual([1, 2, 3, 6]);
    expect(state.nextId).toBe(7);
  });

  it("a damaged document reads and edits as MAP_CORRUPT", async () => {
    const { t, gm, campaignId } = await setup();
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query("maps")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .unique())!;
      await ctx.db.patch(row._id, { data: { tokens: "nope" } });
    });
    expect(errorCode(await gm.query(api.maps.get, { campaignId }).catch((e) => e))).toBe("MAP_CORRUPT");
    expect(errorCode(await gm.mutation(api.maps.clearTrail, { campaignId }).catch((e) => e))).toBe("MAP_CORRUPT");
  });
});
