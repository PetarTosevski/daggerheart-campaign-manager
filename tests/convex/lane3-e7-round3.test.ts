/**
 * Plan lanes-2, tracer E7.3 (docs/tasks/TASK-LN3-E7.md): the adversary server, round 3. A forced standard attack outside
 * the spotlight (dcm-f70y; Words of Discord, CB p.335), a GM-picked trait for a "choice" weapon of a GM-controlled PC
 * (dcm-grqt; user answer 2026-10-31), Transform's form modifier (dcm-3ag5, HF p.142-143), condition modifiers that go
 * with their condition (dcm-iedr), named creature tokens (dcm-n3mp) and adversary uses on a PC's roll (dcm-of7v).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { creatureTokensOf, pcRollAdversaryUses } from "../../convex/lib/adversaryActions";
import { conditionInstanceEffect, formInstanceEffect, instanceModFields, instanceStatsOf, withoutClearedConditions } from "../../convex/lib/adversaryFeatures";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

/** Evasion -10: every attack hits (as adversary-actions.test.ts). */
const EASY = { id: "test:easy", source: "Test", text: "Easy to hit", until: "manual" as const, mods: { evasion: -10 } };
const CONTROLLED = { id: "test:control", source: "Gaze into the Abyss", text: "GM-controlled", until: "manual" as const };
const STATS = { difficulty: 14, major: 10, severe: 18, hpMax: 7, stressMax: 4 };

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const now = Date.now();
  const edit = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  for (const id of [w.characterA, w.characterB]) await edit(id, () => ({ armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, effects: [EASY], domainCards: { owned: [], loadout: [] } }));
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const add = (adversaryId: string, label: string, order: number) =>
    t.run((ctx) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId },
        label,
        order,
        summoned: false,
        stats: STATS,
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      }),
    );
  const troll = await add("mountain-troll", "Troll", 0);
  const get = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  return { w, t, gm, campaignId, encounterId, troll, add, edit, get };
}

describe("dcm-f70y: a forced standard attack outside the spotlight", () => {
  it("hits the PC without spotlighting the instance or asking for Fear", async () => {
    const { w, gm, campaignId, troll, get } = await arena();
    const res = await gm.mutation(api.adversaryActions.forcedAttack, { campaignId, instanceId: troll, targets: [w.characterA], idempotencyKey: key() });
    expect(res.status).toBe("resolved");
    expect(res.fearDelta).toBe(0);
    expect(res.targets).toEqual([expect.objectContaining({ characterId: w.characterA, hit: true })]);
    expect((await get(troll)).spotlights).toBe(0);
  });

  it("refuses a target that is not in the encounter (COMBAT_TARGET_INVALID)", async () => {
    const { gm, campaignId, troll } = await arena();
    let code: unknown = "ok";
    try {
      await gm.mutation(api.adversaryActions.forcedAttack, { campaignId, instanceId: troll, targets: ["nobody"], idempotencyKey: key() });
    } catch (e) {
      code = errorCode(e);
    }
    expect(code).toBe("COMBAT_TARGET_INVALID");
  });
});

describe("dcm-grqt: a choice weapon of a GM-controlled PC takes the GM-picked trait", () => {
  it("asks for the trait (INVALID), then attacks with it", async () => {
    const { w, gm, campaignId, edit } = await arena();
    await edit(w.characterA, (s) => ({ effects: [...s.effects, CONTROLLED], primaryWeaponId: "brawler-s-strike" }));
    let code: unknown = "ok";
    try {
      await gm.mutation(api.adversaryActions.gmControlledAttack, { campaignId, characterId: w.characterA, targets: [w.characterB], idempotencyKey: key() });
    } catch (e) {
      code = errorCode(e);
    }
    expect(code).toBe("INVALID");
    const res = await gm.mutation(api.adversaryActions.gmControlledAttack, { campaignId, characterId: w.characterA, targets: [w.characterB], trait: "strength", idempotencyKey: key() });
    expect(res.status).toBe("resolved");
  });
});

describe("dcm-3ag5: Transform's form modifier", () => {
  it("the latest form's stat block gives the numbers; the stored stats otherwise", () => {
    const effects = formInstanceEffect([], "mountain-troll", "Transform");
    expect(effects).toEqual([expect.objectContaining({ form: "mountain-troll", until: "permanent" })]);
    expect(instanceStatsOf({ stats: STATS, effects })).toEqual({ difficulty: 14, major: 8, severe: 15, hpMax: 8, stressMax: 3 });
    expect(instanceStatsOf({ stats: STATS, effects: [] })).toEqual(STATS);
    // A second form replaces the first.
    expect(formInstanceEffect(effects, "mountain-troll", "Transform").filter((e) => e.form !== undefined)).toHaveLength(1);
  });
});

describe("dcm-iedr / dcm-b77: a condition's entry fields on an instance", () => {
  it("is stored with its ends and goes when the condition goes", () => {
    const next = conditionInstanceEffect([], "card:test", "Test", "pc-1", {
      condition: { kind: "tag", tag: "Bramble" },
      mods: [{ kind: "stat", stat: "difficulty", delta: -1 }],
      endsOn: ["bearerMoves"],
    });
    expect(next).toEqual([expect.objectContaining({ condition: "Bramble", casterId: "pc-1", difficulty: -1, endsOn: ["bearerMoves"], until: "temporary" })]);
    expect(withoutClearedConditions(next!, [], ["Bramble"])).toHaveLength(1);
    expect(withoutClearedConditions(next!, [], [])).toHaveLength(0);
    // Nothing beyond its name: the stored condition is enough.
    expect(conditionInstanceEffect([], "card:test", "Test", "pc-1", { condition: { kind: "standard", condition: "vulnerable" } })).toBeNull();
  });

  it("moveLimit reads the wind direction from the use's choice (Hurricane, CB p.339)", () => {
    expect(instanceModFields([{ kind: "moveLimit", direction: { choice: "wind" } } as never], { wind: ["north-east"] })).toEqual({ moveLimit: { direction: "north-east" } });
    expect(instanceModFields([{ kind: "forcedMoveReduce", steps: 2 } as never])).toEqual({ forcedMoveReduce: 2 });
  });
});

describe("dcm-n3mp: named creature tokens", () => {
  it("the run context reads every instance's tokens by id", () => {
    expect(creatureTokensOf([{ _id: "a", creatureTokens: [{ name: "Bramble", count: 2 }] }, { _id: "b" }])).toEqual({ a: { Bramble: 2 } });
  });
});

describe("dcm-of7v: adversary uses on a PC's roll", () => {
  it("Ill Omen (HF p.95) runs automatically on a PC's action roll; nothing without a running encounter", async () => {
    const { w, t, add, encounterId } = await arena();
    await add("owl-witch", "Owl Witch", 1);
    const campaign = await t.run(async (ctx) => (await ctx.db.get("campaigns", w.campaignId))! as Doc<"campaigns">);
    const roll = { kind: "action" as const, hope: 5, fear: 7, total: 12, withHope: false, critical: false };
    const out = await t.run((ctx) => pcRollAdversaryUses(ctx, campaign, { characterId: w.characterA, roll: roll as never }));
    expect(out.lines.some((l) => l.includes("Ill Omen"))).toBe(true);
    await t.run((ctx) => ctx.db.patch("encounters", encounterId, { status: "ended" }));
    const none = await t.run((ctx) => pcRollAdversaryUses(ctx, campaign, { characterId: w.characterA, roll: roll as never }));
    expect(none).toEqual({ bonuses: [], lines: [], offers: [] });
  });
});
