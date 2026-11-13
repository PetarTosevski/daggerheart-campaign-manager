import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { components, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { CombatArea } from "../../convex/lib/validators/combatMaps";
import { setupWithCampaign } from "./helpers";

/**
 * Map editor ME3 (dcm-5rhs.3): `migrations/combatMapAreaIds:fillAreaIds` gives every stored map area a stable id,
 * unique within its map, keeps ids already set, runs in batches and changes nothing on a second run (TE5); the
 * generator's `save` writes ids on new and regenerated maps.
 */

const MIGRATION = "migrations/combatMapAreaIds:fillAreaIds";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;

const rect = (terrain: CombatArea["terrain"], id?: string): CombatArea => ({ ...(id === undefined ? {} : { id }), terrain, shape: "rect", x: 1, y: 1, w: 2, h: 2 });

async function insertMap(env: Setup, name: string, areas: CombatArea[]): Promise<Id<"combatMaps">> {
  return env.t.run((ctx) =>
    ctx.db.insert("combatMaps", { campaignId: env.campaignId, name, live: false, source: "generated", w: 30, h: 20, base: "grass", areas, seed: 1, schemaVersion: 1, updatedAt: 5 }),
  );
}

const mapOf = (env: Setup, id: Id<"combatMaps">) => env.t.run(async (ctx) => (await ctx.db.get("combatMaps", id))!);

async function run(env: Setup, args: { dryRun?: boolean; batchSize?: number; oneBatchOnly?: boolean } = {}) {
  const status = await env.t.mutation(internal.migrations.run.run, { fn: MIGRATION, ...args });
  await env.t.finishAllScheduledFunctions(vi.runAllTimers);
  return status;
}

describe("migrations/combatMapAreaIds:fillAreaIds", () => {
  it("gives old maps unique ids, keeps ids already set, fixes duplicates and leaves updatedAt alone", async () => {
    const env = await setupWithCampaign();
    const old = await insertMap(env, "Old", [rect("water"), rect("dirt"), rect("stone")]);
    const mixed = await insertMap(env, "Mixed", [rect("water", "a7"), rect("dirt"), rect("stone", "a7"), rect("sand", "door-room"), rect("snow", "")]);
    const empty = await insertMap(env, "Empty", []);

    await run(env);

    const oldAreas = (await mapOf(env, old)).areas;
    expect(oldAreas.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(oldAreas.map((a) => a.terrain)).toEqual(["water", "dirt", "stone"]);
    // Set ids stay; the duplicate and the empty one get counters above the highest on the map.
    expect((await mapOf(env, mixed)).areas.map((a) => a.id)).toEqual(["a7", "a8", "a9", "door-room", "a10"]);
    expect((await mapOf(env, empty)).areas).toEqual([]);
    expect((await mapOf(env, old)).updatedAt).toBe(5);
  });

  it("a dry run commits nothing; it runs in batches and resumes; a second run changes nothing", async () => {
    const env = await setupWithCampaign();
    const ids: Id<"combatMaps">[] = [];
    for (let i = 0; i < 5; i++) ids.push(await insertMap(env, `Map ${i}`, [rect("water"), rect("dirt")]));
    const allIds = async () => Promise.all(ids.map(async (id) => (await mapOf(env, id)).areas.map((a) => a.id ?? null)));

    await run(env, { dryRun: true, batchSize: 2 });
    expect((await allIds()).flat()).toEqual(Array(10).fill(null));

    // One batch of two maps, then stop: the rest is left for the resumed run.
    await env.t.mutation(internal.migrations.run.run, { fn: MIGRATION, batchSize: 2, oneBatchOnly: true });
    const [partway] = await env.t.query(components.migrations.lib.getStatus, { names: [MIGRATION] });
    expect(partway).toMatchObject({ processed: 2, isDone: false });
    expect((await allIds()).filter((a) => a[0] !== null)).toHaveLength(2);

    await run(env, { batchSize: 2 });
    const [done] = await env.t.query(components.migrations.lib.getStatus, { names: [MIGRATION] });
    expect(done).toMatchObject({ processed: 5, isDone: true, state: "success" });
    const after = await allIds();
    expect(after).toEqual(Array(5).fill(["a1", "a2"]));

    // Rerun from the start: idempotent.
    await env.t.mutation(internal.migrations.run.run, { fn: MIGRATION, batchSize: 2, reset: true });
    await env.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await allIds()).toEqual(after);
  });
});

describe("combatMapGenerate.save", () => {
  it("writes an id on every area of a new or regenerated layout", async () => {
    const env = await setupWithCampaign();
    const mapId = await insertMap(env, "Map 1", [rect("water")]);
    const userId = await env.t.run(async (ctx) => (await ctx.db.get("campaigns", env.campaignId))!.ownerId);
    const layout = { w: 30, h: 20, base: "grass" as const, plankV: false, title: "Camp", areas: [rect("water"), rect("dirt"), rect("stone")], objects: [] };
    const saved = await env.t.mutation(internal.combatMapGenerate.save, {
      userId,
      campaignId: env.campaignId,
      mapId,
      updatedAt: 5,
      prompt: "A camp",
      seed: 3,
      layout,
      setting: { builtin: "forest" },
      settingPicked: false,
    });
    expect(saved).toBe(true);
    expect((await mapOf(env, mapId)).areas.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });
});
