import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { StoredRuleModes } from "../../src/lib/rules/registry";
import { errorCode, key, setupWithCampaign, useAllowlist } from "./helpers";

// Plan rule-switches, tracer RDM: the encounter tracker follows the campaign's damage modes. Book = today (the existing
// tests in encounter-tracking.test.ts); Manual = the app does not apply the rule and posts a GM-only `rule` note.
// D2 CB p.99, D4 CB p.92, D5 CB p.178, D8 CB p.208, F3 CB p.153, Massive Damage CB p.91. Refusals assert error codes.

const BEAR = { kind: "srd" as const, adversaryId: "bear" }; // Bruiser, Thresholds 9/17, HP 7, Stress 2

const code = (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => errorCode(e));

async function running(modes: StoredRuleModes = {}) {
  const ctx = await setupWithCampaign();
  const { t, campaignId, gm } = ctx;
  await t.run((c) => c.db.patch("campaigns", campaignId, { ruleModes: modes }));
  const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Ambush", idempotencyKey: key() });
  const add = async () =>
    (await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: BEAR, count: 1, summoned: false, idempotencyKey: key() })).instanceIds[0]!;
  await gm.mutation(api.encounters.start, { campaignId, encounterId });
  const instance = async (id: string) => (await gm.query(api.encounters.get, { campaignId, encounterId }))!.instances.find((i) => i._id === id)!;
  const notes = () => t.run(async (c) => (await c.db.query("actionLog").collect()).filter((r) => r.kind === "rule"));
  const damage = (instanceId: string, amount: number, resistant = false) =>
    gm.mutation(api.encounterTracking.applyDamage, { campaignId, instanceId, amount, resistant, idempotencyKey: key() });
  const markHp = (instanceId: string, delta: number) => gm.mutation(api.encounterTracking.markHp, { campaignId, instanceId, delta, idempotencyKey: key() });
  const markStress = (instanceId: string, delta: number) =>
    gm.mutation(api.encounterTracking.markStress, { campaignId, instanceId, delta, idempotencyKey: key() });
  const spotlight = (instanceId: string) => gm.mutation(api.encounterTracking.spotlight, { campaignId, instanceId, idempotencyKey: key() });
  const fear = () => gm.query(api.campaigns.fear, { campaignId });
  const setFear = (value: number) => gm.mutation(api.fear.set, { campaignId, value, idempotencyKey: key() });
  return { ...ctx, encounterId, add, instance, notes, damage, markHp, markStress, spotlight, fear, setFear };
}

describe("D2 resistance in the tracker", () => {
  useAllowlist();

  it("Book halves (rounded up) with no note; Manual applies the full damage and tells the GM", async () => {
    const book = await running();
    expect(await book.damage(await book.add(), 17, true)).toMatchObject({ taken: 9, severity: "major", marked: 2, resistanceApplied: true });
    expect(await book.notes()).toEqual([]);

    const manual = await running({ resistance: "manual" });
    const id = await manual.add();
    expect(await manual.damage(id, 17, true)).toMatchObject({ taken: 17, severity: "severe", marked: 3, resistanceApplied: false });
    expect(await manual.notes()).toMatchObject([{ ruleId: "resistance", visibility: "gm", undoable: false, summary: "Bear resists: halve? (17 taken in full; halved: 9)" }]);
    // Not resistant: nothing to tell.
    await manual.damage(id, 3, false);
    expect(await manual.notes()).toHaveLength(1);
  });
});

describe("D4 Stress overflow in the tracker", () => {
  useAllowlist();

  it("Manual drops the extra Stress, marks no HP and tells the GM", async () => {
    const a = await running({ stressOverflow: "manual" });
    const id = await a.add();
    expect(await a.markStress(id, 2)).toEqual({ hp: 0, stress: 2, defeated: false });
    expect(await a.notes()).toEqual([]);
    expect(await a.markStress(id, 1)).toEqual({ hp: 0, stress: 2, defeated: false });
    expect(await a.notes()).toMatchObject([{ ruleId: "stressOverflow", summary: "Bear: Stress full, mark 1 HP?" }]);
  });
});

describe("D8 adversary defeated at its last HP in the tracker", () => {
  useAllowlist();

  it("Book defeats with no note", async () => {
    const a = await running();
    const id = await a.add();
    expect(await a.markHp(id, 7)).toEqual({ hp: 7, stress: 0, defeated: true });
    expect(await a.notes()).toEqual([]);
    expect(await code(a.spotlight(id))).toBe("ADVERSARY_DEFEATED");
  });

  it("Manual marks the last HP, leaves it up, tells the GM once, and it can still take the spotlight", async () => {
    const a = await running({ adversaryDefeated: "manual" });
    const id = await a.add();
    await a.damage(id, 20);
    await a.damage(id, 20);
    expect(await a.damage(id, 20)).toMatchObject({ marked: 1, hp: 7, defeated: false, lastHp: true });
    expect(await a.instance(id)).toMatchObject({ hp: 7, defeated: false });
    expect(await a.notes()).toMatchObject([{ ruleId: "adversaryDefeated", summary: "Bear marked its last HP: defeated?" }]);
    // Already at its last HP: no second note.
    await a.markHp(id, 1);
    expect(await a.notes()).toHaveLength(1);
    expect(await code(a.spotlight(id))).toBe("ok");
  });
});

describe("F3 extra adversary spotlight in the tracker", () => {
  useAllowlist();

  it("Book takes 1 Fear for the second spotlight; Manual counts it, takes none and tells the GM", async () => {
    const book = await running();
    await book.setFear(2);
    const [b1, b2] = [await book.add(), await book.add()];
    expect(await book.spotlight(b1)).toMatchObject({ fearSpent: false });
    expect(await book.spotlight(b2)).toMatchObject({ fearSpent: true, spotlights: 1 });
    expect(await book.fear()).toBe(1);
    expect(await book.notes()).toEqual([]);

    const manual = await running({ extraSpotlightFear: "manual" });
    await manual.setFear(0);
    const [m1, m2] = [await manual.add(), await manual.add()];
    await manual.spotlight(m1);
    expect(await manual.notes()).toEqual([]);
    // No Fear at all: Book would refuse (FEAR_EMPTY); Manual counts it.
    expect(await manual.spotlight(m2)).toMatchObject({ fearSpent: false, spotlights: 1 });
    expect(await manual.fear()).toBe(0);
    expect(await manual.notes()).toMatchObject([{ ruleId: "extraSpotlightFear", summary: "Extra spotlight on Bear 2: spend 1 Fear?" }]);
  });
});

describe("Massive Damage in the tracker (optional, CB p.91)", () => {
  useAllowlist();

  it("off marks 3 for twice the Severe threshold; on marks 4", async () => {
    const off = await running();
    expect(await off.damage(await off.add(), 34)).toMatchObject({ severity: "severe", marked: 3, massive: false });
    const on = await running({ massiveDamage: true });
    const id = await on.add();
    expect(await on.damage(id, 34)).toMatchObject({ severity: "severe", marked: 4, massive: true, hp: 4 });
    expect(await on.damage(id, 33)).toMatchObject({ marked: 3, massive: false });
  });
});
