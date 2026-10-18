import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_ENCOUNTERS, MAX_INSTANCES } from "../../convex/lib/encounters";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

// D8 A3: encounters and the Battle Points inputs. GM-only: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player
// FORBIDDEN, for every function (TE2's matrix does not exist yet; hardening H25 folds these rows in).

const BEAR = { kind: "srd" as const, adversaryId: "bear" };
const LACKEY = { kind: "srd" as const, adversaryId: "jagged-knife-lackey" };

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];

async function withEncounter(name = "Ambush at the ford") {
  const ctx = await setupWithCampaign();
  const { encounterId } = await ctx.gm.mutation(api.encounters.create, { campaignId: ctx.campaignId, name, idempotencyKey: key() });
  const add = (source: typeof BEAR | { kind: "custom"; customId: Id<"customAdversaries"> }, count = 1, summoned = false, client: Client = ctx.gm) =>
    client.mutation(api.encounters.addAdversary, { campaignId: ctx.campaignId, encounterId, source, count, summoned, idempotencyKey: key() });
  const get = async () => (await ctx.gm.query(api.encounters.get, { campaignId: ctx.campaignId, encounterId }))!;
  return { ...ctx, encounterId, add, get };
}

/** Every public function of convex/encounters.ts, called as `client` on the fixture's ids. */
function calls(campaignId: Id<"campaigns">, encounterId: string, instanceId: string) {
  return {
    list: (c: Client) => c.query(api.encounters.list, { campaignId }),
    get: (c: Client) => c.query(api.encounters.get, { campaignId, encounterId }),
    create: (c: Client) => c.mutation(api.encounters.create, { campaignId, name: "Second", idempotencyKey: key() }),
    rename: (c: Client) => c.mutation(api.encounters.rename, { campaignId, encounterId, name: "Renamed" }),
    setNotes: (c: Client) => c.mutation(api.encounters.setNotes, { campaignId, encounterId, notes: "Fog." }),
    setBudget: (c: Client) => c.mutation(api.encounters.setBudget, { campaignId, encounterId, change: { kind: "pcs", delta: 1 } }),
    addAdversary: (c: Client) =>
      c.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: BEAR, count: 1, summoned: false, idempotencyKey: key() }),
    reorder: (c: Client) => c.mutation(api.encounters.reorder, { campaignId, instanceId, direction: "down" }),
    start: (c: Client) => c.mutation(api.encounters.start, { campaignId, encounterId }),
    end: (c: Client) => c.mutation(api.encounters.end, { campaignId, encounterId }),
    removeInstance: (c: Client) => c.mutation(api.encounters.removeInstance, { campaignId, instanceId }),
    remove: (c: Client) => c.mutation(api.encounters.remove, { campaignId, encounterId }),
  };
}

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

describe("encounters: access", () => {
  useAllowlist();

  it("refuses anonymous callers, outsiders and players on every function, and lets the GM run each", async () => {
    const { t, gm, other, campaignId, encounterId, add } = await withEncounter();
    const { instanceIds } = await add(BEAR, 2);
    const all = calls(campaignId, encounterId, instanceIds[0]!);
    const names = Object.keys(all) as (keyof typeof all)[];
    expect(names).toHaveLength(12);

    for (const name of names) expect([name, await code(all[name](t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
    for (const name of names) expect([name, await code(all[name](other))]).toEqual([name, "NOT_FOUND"]);
    await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
    for (const name of names) expect([name, await code(all[name](other))]).toEqual([name, "FORBIDDEN"]);
    // In this order every GM call is valid (end needs the start before it; remove comes last).
    for (const name of names) expect([name, await code(all[name](gm))]).toEqual([name, "ok"]);
  });

  it("gives NOT_FOUND for another campaign's encounter and instance ids, and null from get", async () => {
    const a = await withEncounter();
    const { instanceIds } = await a.add(BEAR);
    // The same GM's second campaign: authorized there, but the ids belong to the first one.
    const { campaignId: mine } = await a.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const cross = calls(mine, a.encounterId, instanceIds[0]!);
    expect(await a.gm.query(api.encounters.get, { campaignId: mine, encounterId: a.encounterId })).toBeNull();
    for (const name of ["rename", "setNotes", "setBudget", "addAdversary", "reorder", "start", "end", "removeInstance", "remove"] as const) {
      expect([name, await code(cross[name](a.gm))]).toEqual([name, "NOT_FOUND"]);
    }
    expect(await a.gm.query(api.encounters.get, { campaignId: a.campaignId, encounterId: "not-an-id" })).toBeNull();
    expect(await code(a.gm.mutation(api.encounters.rename, { campaignId: a.campaignId, encounterId: "not-an-id", name: "x" }))).toBe("NOT_FOUND");
  });
});

describe("encounters: builder", () => {
  useAllowlist();

  it("creates a draft with 4 PCs when the campaign has no active character, or the given party size", async () => {
    const { gm, campaignId, get } = await withEncounter("  The bridge  ");
    expect((await get()).encounter).toMatchObject({ name: "The bridge", status: "draft", pcs: 4, adjustments: [], gmTurn: 1 });
    const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Five", pcs: 5, idempotencyKey: key() });
    expect((await gm.query(api.encounters.get, { campaignId, encounterId }))!.encounter.pcs).toBe(5);
    for (const bad of [{ name: " " }, { name: "x".repeat(81) }, { name: "ok", pcs: 0 }, { name: "ok", pcs: 13 }, { name: "ok", pcs: 2.5 }]) {
      expect(await code(gm.mutation(api.encounters.create, { campaignId, ...bad, idempotencyKey: key() }))).toBe("ENCOUNTER_RULE");
    }
  });

  it("defaults the party size to the campaign's active characters", async () => {
    const { t, gm, campaignId } = await setupWithCampaign();
    await t.run(async (ctx) => {
      const user = (await ctx.db.query("users").first())!;
      for (const status of ["active", "active", "active", "dead"] as const) {
        await ctx.db.insert("characters", { campaignId, ownerId: user._id, createdBy: user._id, status, sheet: {}, createdAt: 0, updatedAt: 0 });
      }
    });
    const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Party", idempotencyKey: key() });
    expect((await gm.query(api.encounters.get, { campaignId, encounterId }))!.encounter.pcs).toBe(3);
  });

  it("adds 2 Bears and a Lackey group of 4 with numbered labels and snapshotted stats", async () => {
    const { add, get } = await withEncounter();
    await add(BEAR, 2);
    await add(LACKEY, 4);
    await add(BEAR, 1, true);
    const { instances } = await get();
    expect(instances.map((i) => [i.label, i.type, i.order, i.summoned, i.minionCount])).toEqual([
      ["Bear", "Bruiser", 1, false, undefined],
      ["Bear 2", "Bruiser", 2, false, undefined],
      ["Jagged Knife Lackey", "Minion", 3, false, 4],
      ["Bear 3", "Bruiser", 4, true, undefined],
    ]);
    expect(instances[0]).toMatchObject({ name: "Bear", tier: 1, stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 }, hp: 0, stress: 0 });
    expect(instances[2]!.stats).toEqual({ difficulty: 9, major: null, severe: null, hpMax: 4, stressMax: 1 });
  });

  it("validates counts: 1..10 adversaries, 1..30 Minions", async () => {
    const { add } = await withEncounter();
    for (const [source, count] of [[BEAR, 0], [BEAR, 11], [BEAR, 1.5], [LACKEY, 31], [LACKEY, 0]] as const) {
      expect(await code(add(source, count))).toBe("ENCOUNTER_RULE");
    }
    expect(await code(add(LACKEY, 30))).toBe("ok");
  });

  it("refuses unknown adversaries, Hope & Fear entries with the switch off, other frames' entries and other campaigns' customs", async () => {
    const { t, gm, campaignId, add } = await withEncounter();
    expect(await code(add({ kind: "srd", adversaryId: "no-such-adversary" }))).toBe("ADVERSARY_UNKNOWN");
    expect(await code(add({ kind: "srd", adversaryId: "ahuizotl" }))).toBe("ADVERSARY_UNKNOWN");
    expect(await code(add({ kind: "srd", adversaryId: "weredrake" }))).toBe("ADVERSARY_UNKNOWN");
    await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { options: { hopeAndFear: true } }));
    expect(await code(add({ kind: "srd", adversaryId: "ahuizotl" }))).toBe("ok");
    expect(await code(add({ kind: "srd", adversaryId: "weredrake" }))).toBe("ADVERSARY_UNKNOWN");

    const { campaignId: otherCampaign } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const custom = (campaign: Id<"campaigns">) =>
      t.run((ctx) =>
        ctx.db.insert("customAdversaries", {
          campaignId: campaign,
          name: "Cave Bear",
          tier: 1,
          type: "Bruiser",
          description: "",
          motives: "",
          difficulty: 14,
          thresholds: { major: 9, severe: 17 },
          hp: 9,
          stress: 2,
          attack: { modifier: 1, name: "Claws", range: "Melee", damage: "1d8+3 phy" },
          experiences: [],
          features: [],
          createdAt: 0,
          updatedAt: 0,
        }),
      );
    expect(await code(add({ kind: "custom", customId: await custom(otherCampaign) }))).toBe("ADVERSARY_UNKNOWN");
    expect(await code(add({ kind: "custom", customId: await custom(campaignId) }))).toBe("ok");
  });

  it("shows a custom adversary's name, type and tier, and nulls once the custom block is deleted", async () => {
    const { t, campaignId, add, get } = await withEncounter();
    const customId = await t.run((ctx) =>
      ctx.db.insert("customAdversaries", {
        campaignId,
        name: "Cave Bear",
        tier: 2,
        type: "Bruiser",
        description: "",
        motives: "",
        difficulty: 14,
        thresholds: { major: 9, severe: 17 },
        hp: 9,
        stress: 2,
        attack: { modifier: 1, name: "Claws", range: "Melee", damage: "1d8+3 phy" },
        experiences: [],
        features: [],
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    await add({ kind: "custom", customId }, 2);
    expect((await get()).instances.map((i) => [i.label, i.name, i.type, i.tier, i.stats.hpMax])).toEqual([
      ["Cave Bear", "Cave Bear", "Bruiser", 2, 9],
      ["Cave Bear 2", "Cave Bear", "Bruiser", 2, 9],
    ]);
    await t.run((ctx) => ctx.db.delete("customAdversaries", customId));
    expect((await get()).instances.map((i) => [i.label, i.name, i.type, i.tier, i.stats.hpMax])).toEqual([
      ["Cave Bear", null, null, null, 9],
      ["Cave Bear 2", null, null, null, 9],
    ]);
  });

  it("applies an addAdversary once per idempotency key", async () => {
    const { gm, campaignId, encounterId, get } = await withEncounter();
    const args = { campaignId, encounterId, source: BEAR, count: 2, summoned: false, idempotencyKey: key() };
    const first = await gm.mutation(api.encounters.addAdversary, args);
    expect(await gm.mutation(api.encounters.addAdversary, args)).toEqual(first);
    expect((await get()).instances).toHaveLength(2);
  });

  it(`refuses past ${MAX_INSTANCES} instances with ENCOUNTER_FULL`, async () => {
    const { add, get } = await withEncounter();
    for (let i = 0; i < MAX_INSTANCES / 10; i++) await add(BEAR, 10);
    expect((await get()).instances).toHaveLength(MAX_INSTANCES);
    expect(await code(add(BEAR))).toBe("ENCOUNTER_FULL");
    expect(await code(add(LACKEY, 4))).toBe("ENCOUNTER_FULL");
  });

  it(`refuses a new encounter past ${MAX_ENCOUNTERS} with ENCOUNTER_LIMIT`, async () => {
    const { t, gm, campaignId } = await setupWithCampaign();
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_ENCOUNTERS; i++) {
        await ctx.db.insert("encounters", { campaignId, name: `E${i}`, status: "ended", pcs: 4, adjustments: [], gmTurn: 1, createdAt: i, updatedAt: i });
      }
    });
    expect(await code(gm.mutation(api.encounters.create, { campaignId, name: "One more", idempotencyKey: key() }))).toBe("ENCOUNTER_LIMIT");
  });

  it("renames, sets and clears notes, and changes the budget by intents", async () => {
    const { gm, campaignId, encounterId, get } = await withEncounter();
    await gm.mutation(api.encounters.rename, { campaignId, encounterId, name: " Night raid " });
    await gm.mutation(api.encounters.setNotes, { campaignId, encounterId, notes: "Rain." });
    expect((await get()).encounter).toMatchObject({ name: "Night raid", notes: "Rain." });
    await gm.mutation(api.encounters.setNotes, { campaignId, encounterId, notes: "  " });
    expect((await get()).encounter.notes).toBeUndefined();
    expect(await code(gm.mutation(api.encounters.setNotes, { campaignId, encounterId, notes: "x".repeat(2001) }))).toBe("ENCOUNTER_RULE");
    expect(await code(gm.mutation(api.encounters.rename, { campaignId, encounterId, name: "" }))).toBe("ENCOUNTER_RULE");

    const budget = (change: { kind: "pcs"; delta: number } | { kind: "adjustment"; adjustment: "hard" | "easy"; on: boolean }) =>
      gm.mutation(api.encounters.setBudget, { campaignId, encounterId, change });
    expect(await budget({ kind: "pcs", delta: 1 })).toEqual({ pcs: 5, adjustments: [] });
    expect(await budget({ kind: "pcs", delta: 1 })).toEqual({ pcs: 6, adjustments: [] });
    expect(await budget({ kind: "pcs", delta: -12 })).toEqual({ pcs: 1, adjustments: [] });
    expect(await budget({ kind: "pcs", delta: 12 })).toEqual({ pcs: 12, adjustments: [] });
    expect(await code(budget({ kind: "pcs", delta: 0.5 }))).toBe("ENCOUNTER_RULE");
    expect(await budget({ kind: "adjustment", adjustment: "hard", on: true })).toEqual({ pcs: 12, adjustments: ["hard"] });
    expect(await budget({ kind: "adjustment", adjustment: "hard", on: true })).toEqual({ pcs: 12, adjustments: ["hard"] });
    expect(await budget({ kind: "adjustment", adjustment: "easy", on: true })).toEqual({ pcs: 12, adjustments: ["hard", "easy"] });
    expect(await budget({ kind: "adjustment", adjustment: "hard", on: false })).toEqual({ pcs: 12, adjustments: ["easy"] });
  });

  it("starts one encounter at a time and ends it", async () => {
    const { gm, campaignId, encounterId, get } = await withEncounter();
    const { encounterId: second } = await gm.mutation(api.encounters.create, { campaignId, name: "Second", idempotencyKey: key() });
    expect(await code(gm.mutation(api.encounters.end, { campaignId, encounterId }))).toBe("ENCOUNTER_NOT_RUNNING");
    await gm.mutation(api.encounters.start, { campaignId, encounterId });
    expect((await get()).encounter).toMatchObject({ status: "running", startedAt: expect.any(Number) });
    expect(await code(gm.mutation(api.encounters.start, { campaignId, encounterId }))).toBe("ok");
    expect(await code(gm.mutation(api.encounters.start, { campaignId, encounterId: second }))).toBe("ENCOUNTER_RUNNING");
    const listed = await gm.query(api.encounters.list, { campaignId });
    expect(listed.active.map((e) => [e.name, e.status])).toEqual([
      ["Ambush at the ford", "running"],
      ["Second", "draft"],
    ]);
    await gm.mutation(api.encounters.end, { campaignId, encounterId });
    expect((await get()).encounter).toMatchObject({ status: "ended", endedAt: expect.any(Number) });
    expect(await code(gm.mutation(api.encounters.start, { campaignId, encounterId: second }))).toBe("ok");
    const after = await gm.query(api.encounters.list, { campaignId });
    expect(after.ended.map((e) => e.name)).toEqual(["Ambush at the ford"]);
    expect(after.moreEnded).toBe(false);
  });

  it("lists ended encounters newest first, endedLimit at a time", async () => {
    const { t, gm, campaignId } = await setupWithCampaign();
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("encounters", { campaignId, name: `E${i}`, status: "ended", pcs: 4, adjustments: [], gmTurn: 1, createdAt: i, updatedAt: i });
      }
    });
    const page = await gm.query(api.encounters.list, { campaignId, endedLimit: 2 });
    expect([page.ended.map((e) => e.name), page.moreEnded]).toEqual([["E2", "E1"], true]);
    const all = await gm.query(api.encounters.list, { campaignId, endedLimit: 3 });
    expect([all.ended.map((e) => e.name), all.moreEnded]).toEqual([["E2", "E1", "E0"], false]);
    expect(await code(gm.query(api.encounters.list, { campaignId, endedLimit: 0 }))).toBe("ENCOUNTER_RULE");
  });

  it("reorders and removes instances, and deletes an encounter with its instances", async () => {
    const { t, gm, campaignId, encounterId, add, get } = await withEncounter();
    const { instanceIds } = await add(BEAR, 3);
    await gm.mutation(api.encounters.reorder, { campaignId, instanceId: instanceIds[2]!, direction: "up" });
    expect((await get()).instances.map((i) => i.label)).toEqual(["Bear", "Bear 3", "Bear 2"]);
    await gm.mutation(api.encounters.reorder, { campaignId, instanceId: instanceIds[0]!, direction: "up" });
    expect((await get()).instances.map((i) => i.label)).toEqual(["Bear", "Bear 3", "Bear 2"]);
    await gm.mutation(api.encounters.removeInstance, { campaignId, instanceId: instanceIds[0]! });
    expect((await get()).instances.map((i) => i.label)).toEqual(["Bear 3", "Bear 2"]);
    await add(BEAR);
    expect((await get()).instances.map((i) => i.label)).toEqual(["Bear 3", "Bear 2", "Bear 4"]);

    await gm.mutation(api.encounters.remove, { campaignId, encounterId });
    expect(await gm.query(api.encounters.get, { campaignId, encounterId })).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("encounterAdversaries").collect())).toEqual([]);
    expect(await code(gm.mutation(api.encounters.removeInstance, { campaignId, instanceId: instanceIds[1]! }))).toBe("NOT_FOUND");
  });

  it("reads one encounter and its instances only: each added SRD instance adds one document read", async () => {
    const { gm, campaignId, encounterId, add } = await withEncounter();
    const reads = () =>
      gm.run(async (ctx) => {
        const before = await ctx.meta.getTransactionMetrics();
        await ctx.runQuery(api.encounters.get, { campaignId, encounterId });
        const after = await ctx.meta.getTransactionMetrics();
        return after.documentsRead.used - before.documentsRead.used;
      });
    const empty = await reads();
    await add(BEAR, 3);
    await add(LACKEY, 6);
    expect((await reads()) - empty).toBe(4);
    // A second encounter's instances are not read.
    const { encounterId: other } = await gm.mutation(api.encounters.create, { campaignId, name: "Other", idempotencyKey: key() });
    await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId: other, source: BEAR, count: 5, summoned: false, idempotencyKey: key() });
    expect((await reads()) - empty).toBe(4);
  });
});
