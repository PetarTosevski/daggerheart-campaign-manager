import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

// D8 A4: the live encounter tracker. GM-only: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN for
// every function (TE2's matrix does not exist yet; hardening H25 folds these rows in). Book rules: CB p.91 (thresholds),
// p.92 (Stress overflow, Q2), p.99 (resistance), p.153/p.195 (spotlight), p.154 (Fear), p.201 (Minions, Q4).

const BURROWER = { kind: "srd" as const, adversaryId: "acid-burrower" }; // Solo, Thresholds 8/15, HP 8, Stress 3, Relentless (3)
const BEAR = { kind: "srd" as const, adversaryId: "bear" }; // Bruiser, Thresholds 9/17, HP 7, Stress 2
const LACKEY = { kind: "srd" as const, adversaryId: "jagged-knife-lackey" }; // Minion (3)

type Setup = Awaited<ReturnType<typeof setupWithCampaign>>;
type Client = Setup["gm"];
type Source = typeof BURROWER | { kind: "custom"; customId: Id<"customAdversaries"> };

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

async function running({ start = true }: { start?: boolean } = {}) {
  const ctx = await setupWithCampaign();
  const { campaignId, gm } = ctx;
  const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Ambush", idempotencyKey: key() });
  const add = async (source: Source, count = 1) =>
    (await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source, count, summoned: false, idempotencyKey: key() })).instanceIds[0]!;
  if (start) await gm.mutation(api.encounters.start, { campaignId, encounterId });
  const instance = async (id: string) => (await gm.query(api.encounters.get, { campaignId, encounterId }))!.instances.find((i) => i._id === id)!;
  const fear = async () => (await gm.query(api.campaigns.get, { campaignId }))!.fear;
  return { ...ctx, encounterId, add, instance, fear };
}

/** Every public function of convex/encounterTracking.ts, called as `client` on the fixture's ids. */
function calls(campaignId: Id<"campaigns">, encounterId: string, instanceId: string, minionId: string) {
  return {
    markHp: (c: Client) => c.mutation(api.encounterTracking.markHp, { campaignId, instanceId, delta: 1, idempotencyKey: key() }),
    markStress: (c: Client) => c.mutation(api.encounterTracking.markStress, { campaignId, instanceId, delta: 1, idempotencyKey: key() }),
    applyDamage: (c: Client) => c.mutation(api.encounterTracking.applyDamage, { campaignId, instanceId, amount: 3, resistant: false, idempotencyKey: key() }),
    defeatMinions: (c: Client) => c.mutation(api.encounterTracking.defeatMinions, { campaignId, instanceId: minionId, count: 1, idempotencyKey: key() }),
    toggleCondition: (c: Client) =>
      c.mutation(api.encounterTracking.toggleCondition, { campaignId, instanceId, condition: "hidden", idempotencyKey: key() }),
    setTags: (c: Client) => c.mutation(api.encounterTracking.setTags, { campaignId, instanceId, tags: ["Cursed"], idempotencyKey: key() }),
    setNote: (c: Client) => c.mutation(api.encounterTracking.setNote, { campaignId, instanceId, note: "Wounded", idempotencyKey: key() }),
    spotlight: (c: Client) => c.mutation(api.encounterTracking.spotlight, { campaignId, instanceId, idempotencyKey: key() }),
    endGmTurn: (c: Client) => c.mutation(api.encounterTracking.endGmTurn, { campaignId, encounterId, idempotencyKey: key() }),
    spendFear: (c: Client) =>
      c.mutation(api.encounterTracking.spendFear, { campaignId, encounterId, amount: 1, reason: "move", instanceId, idempotencyKey: key() }),
    customBlocks: (c: Client) => c.query(api.encounterTracking.customBlocks, { campaignId, encounterId }),
  };
}

describe("encounter tracking: access", () => {
  useAllowlist();

  it("refuses anonymous callers, outsiders and players on every function, and lets the GM run each", async () => {
    const { t, gm, other, campaignId, encounterId, add } = await running();
    const bear = await add(BEAR);
    const lackeys = await add(LACKEY, 4);
    await gm.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: key() });
    const all = calls(campaignId, encounterId, bear, lackeys);
    const names = Object.keys(all) as (keyof typeof all)[];
    expect(names).toHaveLength(11);

    for (const name of names) expect([name, await code(all[name](t as unknown as Client))]).toEqual([name, "UNAUTHENTICATED"]);
    for (const name of names) expect([name, await code(all[name](other))]).toEqual([name, "NOT_FOUND"]);
    await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
    for (const name of names) expect([name, await code(all[name](other))]).toEqual([name, "FORBIDDEN"]);
    for (const name of names) expect([name, await code(all[name](gm))]).toEqual([name, "ok"]);
  });

  it("gives NOT_FOUND for another campaign's ids and refuses a draft encounter with ENCOUNTER_NOT_RUNNING", async () => {
    const a = await running({ start: false });
    const bear = await a.add(BEAR);
    const lackeys = await a.add(LACKEY, 2);
    await a.gm.mutation(api.fear.set, { campaignId: a.campaignId, value: 3, idempotencyKey: key() });
    const draft = calls(a.campaignId, a.encounterId, bear, lackeys);
    for (const name of Object.keys(draft).filter((n) => n !== "customBlocks") as (keyof typeof draft)[]) {
      expect([name, await code(draft[name](a.gm))]).toEqual([name, "ENCOUNTER_NOT_RUNNING"]);
    }
    expect(await a.fear()).toBe(3);

    const { campaignId: mine } = await a.gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const cross = calls(mine, a.encounterId, bear, lackeys);
    for (const name of Object.keys(cross).filter((n) => n !== "customBlocks") as (keyof typeof cross)[]) {
      expect([name, await code(cross[name](a.gm))]).toEqual([name, "NOT_FOUND"]);
    }
    expect(await a.gm.query(api.encounterTracking.customBlocks, { campaignId: mine, encounterId: a.encounterId })).toEqual([]);
    expect(await code(a.gm.mutation(api.encounterTracking.markHp, { campaignId: a.campaignId, instanceId: "nope", delta: 1, idempotencyKey: key() }))).toBe(
      "NOT_FOUND",
    );
  });
});

describe("encounter tracking: rules", () => {
  useAllowlist();

  it("marks HP by thresholds 8/15: 7 → 1, 8 → 2, 15 → 3, resistant 15 → 1, 0 → none", async () => {
    const { gm, campaignId, add } = await running();
    const damage = async (amount: number, resistant = false) => {
      const id = await add(BURROWER);
      return gm.mutation(api.encounterTracking.applyDamage, { campaignId, instanceId: id, amount, resistant, idempotencyKey: key() });
    };
    expect(await damage(7)).toMatchObject({ severity: "minor", marked: 1, hp: 1, defeated: false, suggestedDefeats: null });
    expect(await damage(8)).toMatchObject({ severity: "major", marked: 2, hp: 2 });
    expect(await damage(15)).toMatchObject({ severity: "severe", marked: 3, hp: 3 });
    expect(await damage(15, true)).toMatchObject({ taken: 7, severity: "minor", marked: 1 });
    expect(await damage(0)).toMatchObject({ severity: "none", marked: 0, hp: 0 });
    expect(await damage(1000).catch((e: unknown) => errorCode(e))).toBe("ENCOUNTER_RULE");
  });

  it("defeats an adversary on its last HP and keeps marks within the track", async () => {
    const { gm, campaignId, add, instance } = await running();
    const id = await add(BEAR);
    for (let i = 0; i < 3; i++) await gm.mutation(api.encounterTracking.applyDamage, { campaignId, instanceId: id, amount: 20, resistant: false, idempotencyKey: key() });
    expect(await instance(id)).toMatchObject({ hp: 7, defeated: true });
    expect(await gm.mutation(api.encounterTracking.markHp, { campaignId, instanceId: id, delta: -2, idempotencyKey: key() })).toEqual({ hp: 5, stress: 0, defeated: false });
    expect(await gm.mutation(api.encounterTracking.markHp, { campaignId, instanceId: id, delta: -9, idempotencyKey: key() })).toMatchObject({ hp: 0 });
  });

  it("marks 1 HP instead when Stress overflows (Q2): Bear with 2 Stress", async () => {
    const { gm, campaignId, add } = await running();
    const id = await add(BEAR);
    const stress = (delta: number) => gm.mutation(api.encounterTracking.markStress, { campaignId, instanceId: id, delta, idempotencyKey: key() });
    expect(await stress(1)).toEqual({ hp: 0, stress: 1, defeated: false });
    // 2 Stress with 1 slot left: 1 Stress and 1 HP (CB p.92).
    expect(await stress(2)).toEqual({ hp: 1, stress: 2, defeated: false });
    expect(await stress(3)).toEqual({ hp: 2, stress: 2, defeated: false });
    expect(await stress(-1)).toEqual({ hp: 2, stress: 1, defeated: false });
  });

  it("suggests Minion defeats (6 Lackeys, Minion (3), hit for 7 → 3) and defeatMinions(3) leaves 3", async () => {
    const { gm, campaignId, add, instance } = await running();
    const group = await add(LACKEY, 6);
    const hit = await gm.mutation(api.encounterTracking.applyDamage, { campaignId, instanceId: group, amount: 7, resistant: false, idempotencyKey: key() });
    expect(hit).toMatchObject({ severity: "defeat", marked: 0, suggestedDefeats: 3, hp: 0 });
    expect(await gm.mutation(api.encounterTracking.defeatMinions, { campaignId, instanceId: group, count: 3, idempotencyKey: key() })).toEqual({
      remaining: 3,
      defeated: false,
    });
    expect(await instance(group)).toMatchObject({ hp: 3, minionCount: 6, defeated: false });
    // A big hit never suggests more Minions than remain.
    const big = await gm.mutation(api.encounterTracking.applyDamage, { campaignId, instanceId: group, amount: 30, resistant: false, idempotencyKey: key() });
    expect(big.suggestedDefeats).toBe(3);
    expect(await gm.mutation(api.encounterTracking.defeatMinions, { campaignId, instanceId: group, count: 5, idempotencyKey: key() })).toEqual({
      remaining: 0,
      defeated: true,
    });
    const bear = await add(BEAR);
    expect(await code(gm.mutation(api.encounterTracking.defeatMinions, { campaignId, instanceId: bear, count: 1, idempotencyKey: key() }))).toBe("ENCOUNTER_RULE");
  });

  it("toggles conditions, sets tags and notes within their caps", async () => {
    const { gm, campaignId, add, instance } = await running();
    const id = await add(BEAR);
    const toggle = (condition: "hidden" | "vulnerable") =>
      gm.mutation(api.encounterTracking.toggleCondition, { campaignId, instanceId: id, condition, idempotencyKey: key() });
    expect(await toggle("vulnerable")).toEqual({ conditions: ["vulnerable"] });
    expect(await toggle("hidden")).toEqual({ conditions: ["vulnerable", "hidden"] });
    expect(await toggle("vulnerable")).toEqual({ conditions: ["hidden"] });

    const tags = (list: string[]) => gm.mutation(api.encounterTracking.setTags, { campaignId, instanceId: id, tags: list, idempotencyKey: key() });
    expect(await tags([" Cursed ", "", "Cursed", "Glowing"])).toEqual({ tags: ["Cursed", "Glowing"] });
    expect(await code(tags(["a", "b", "c", "d", "e", "f", "g"]))).toBe("ENCOUNTER_RULE");
    expect(await code(tags(["x".repeat(31)]))).toBe("ENCOUNTER_RULE");

    await gm.mutation(api.encounterTracking.setNote, { campaignId, instanceId: id, note: "Fled north", idempotencyKey: key() });
    expect((await instance(id)).note).toBe("Fled north");
    await gm.mutation(api.encounterTracking.setNote, { campaignId, instanceId: id, note: "  ", idempotencyKey: key() });
    expect((await instance(id)).note).toBeUndefined();
    expect(await code(gm.mutation(api.encounterTracking.setNote, { campaignId, instanceId: id, note: "x".repeat(501), idempotencyKey: key() }))).toBe(
      "ENCOUNTER_RULE",
    );
  });

  it("counts spotlights per GM turn; every spotlight after the first spends 1 Fear (CB p.153); End GM turn resets", async () => {
    const { gm, campaignId, encounterId, add, instance, fear } = await running();
    const id = await add(BURROWER);
    const other = await add(BEAR);
    await gm.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: key() });
    const spot = (instanceId = id) => gm.mutation(api.encounterTracking.spotlight, { campaignId, instanceId, idempotencyKey: key() });
    expect(await spot()).toEqual({ spotlights: 1, gmTurn: 1, fearSpent: false });
    expect(await fear()).toBe(3);
    // Another adversary in the same GM turn: an additional move, 1 Fear.
    expect(await spot(other)).toEqual({ spotlights: 1, gmTurn: 1, fearSpent: true });
    expect(await spot()).toEqual({ spotlights: 2, gmTurn: 1, fearSpent: true });
    expect(await spot()).toEqual({ spotlights: 3, gmTurn: 1, fearSpent: true });
    expect(await fear()).toBe(0);
    // No Fear left: refused, nothing counted.
    expect(await code(spot())).toBe("FEAR_EMPTY");
    expect((await instance(id)).spotlights).toBe(3);
    const before = await instance(id);
    expect(await gm.mutation(api.encounterTracking.endGmTurn, { campaignId, encounterId, idempotencyKey: key() })).toEqual({ gmTurn: 2 });
    expect((await instance(id)).updatedAt).toBe(before.updatedAt);
    // A new GM turn: the first spotlight is free again.
    expect(await spot()).toEqual({ spotlights: 1, gmTurn: 2, fearSpent: false });
  });

  it("spends Fear: lowers campaign Fear, writes history 'spend', FEAR_EMPTY past what is held", async () => {
    const { t, gm, campaignId, encounterId, add, fear } = await running();
    const id = await add(BEAR);
    await gm.mutation(api.fear.set, { campaignId, value: 2, idempotencyKey: key() });
    const spend = (amount: number, instanceId?: string) =>
      gm.mutation(api.encounterTracking.spendFear, { campaignId, encounterId, amount, reason: "feature", instanceId, idempotencyKey: key() });
    expect(await spend(1, id)).toEqual({ fear: 1 });
    expect(await fear()).toBe(1);
    expect(await code(spend(2))).toBe("FEAR_EMPTY");
    expect(await code(spend(0))).toBe("FEAR_RANGE");
    expect(await fear()).toBe(1);
    const spends = await t.run((ctx) =>
      ctx.db
        .query("history")
        .withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId))
        .collect(),
    );
    expect(spends.filter((r) => r.action === "spend")).toEqual([expect.objectContaining({ kind: "fear", action: "spend", before: 2, after: 1 })]);

    // An instance of another encounter is refused.
    const { encounterId: second } = await gm.mutation(api.encounters.create, { campaignId, name: "Second", idempotencyKey: key() });
    const elsewhere = (await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId: second, source: BEAR, count: 1, summoned: false, idempotencyKey: key() }))
      .instanceIds[0]!;
    expect(await code(spend(1, elsewhere))).toBe("NOT_FOUND");
  });

  it("applies a double markHp with one idempotency key once", async () => {
    const { gm, campaignId, add, instance } = await running();
    const id = await add(BEAR);
    const args = { campaignId, instanceId: id, delta: 1, idempotencyKey: key() };
    await gm.mutation(api.encounterTracking.markHp, args);
    await gm.mutation(api.encounterTracking.markHp, args);
    expect((await instance(id)).hp).toBe(1);
  });

  it("returns the encounter's custom stat blocks only", async () => {
    const { t, gm, campaignId, encounterId, add } = await running();
    const customId = await t.run((ctx) =>
      ctx.db.insert("customAdversaries", {
        campaignId,
        name: "Cave Bear",
        tier: 1,
        type: "Bruiser",
        description: "",
        motives: "",
        difficulty: 13,
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
    await add(BEAR);
    await add({ kind: "custom", customId }, 2);
    const blocks = await gm.query(api.encounterTracking.customBlocks, { campaignId, encounterId });
    expect(blocks.map((b) => b.name)).toEqual(["Cave Bear"]);
  });
});
