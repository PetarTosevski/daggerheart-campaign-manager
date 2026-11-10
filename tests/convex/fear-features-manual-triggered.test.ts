/**
 * Plan finish-in-progress FP4 (bead dcm-bxp.134.4; docs/tasks/TASK-FP4.md): F5 `fearFeatures` Manual for adversary uses
 * that run without the GM's click. Book spends their Fear cost as before; Manual spends none and posts the GM's
 * "Spend N Fear by hand" note (as the clicked uses do, rules-wf.test.ts), never undoable since it changed nothing.
 *
 * No printed adversary has an automatic use with a Fear cost (every Fear-cost trigger is a reaction the GM opts into), so
 * the Giant Rat gets three test-only uses: an automatic one on its own attack's hit or miss (exactly one fires), a
 * reaction before the damage the GM opts into with the attack, and an automatic one on a PC's roll.
 */
import { describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { pcRollAdversaryUses } from "../../convex/lib/adversaryActions";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import type { AdversaryFeatureEffect, AdversaryFeatureUse } from "../../src/lib/domain/adversary-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

const ONE_FEAR = [{ kind: "fear" as const, amount: { kind: "fixed" as const, value: 1 } }];
const testUse = (id: string, kind: "auto" | "reaction", trigger: unknown): AdversaryFeatureUse => ({ id, activation: { kind, trigger } as never, needsSpotlight: false, costs: ONE_FEAR, steps: [] });
const TEST_EFFECTS: AdversaryFeatureEffect[] = [
  { adversaryId: "giant-rat", feature: "Test Pounce", uses: [testUse("hit", "auto", { kind: "onHit", attack: "standard" }), testUse("miss", "auto", { kind: "onMiss", attack: "standard" })] },
  { adversaryId: "giant-rat", feature: "Test Brace", uses: [testUse("main", "reaction", { kind: "onAttack", stage: "beforeDamage", attack: "standard" })] },
  { adversaryId: "giant-rat", feature: "Test Omen", uses: [testUse("main", "auto", { kind: "pcRolls" })] },
];

vi.mock("../../src/lib/srd/adversary-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/adversary-effects/index")>();
  return { ...real, adversaryEffects: (id: string) => (id === "giant-rat" ? [...real.adversaryEffects(id), ...TEST_EFFECTS] : real.adversaryEffects(id)) };
});

/** Every attack hits: Evasion far below any roll (one effect may take -10). */
const EASY = [1, 2, 3, 4].map((n) => ({ id: `test:easy${n}`, source: "Test", text: "Easy to hit", until: "manual" as const, mods: { evasion: -10 } }));
const RAT = { difficulty: 10, major: 100, severe: 200, hpMax: 1, stressMax: 1 };

async function arena(manual: boolean, fear: number) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const now = Date.now();
  await t.run(async (ctx) => {
    if (manual) await ctx.db.patch("campaigns", campaignId, { ruleModes: { fearFeatures: "manual" } as never });
    const s = await campaignFearState(ctx, campaignId);
    await ctx.db.patch(s._id, { fear });
    for (const id of [w.characterA, w.characterB]) {
      const sheet = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...sheet, armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, effects: EASY, domainCards: { owned: [], loadout: [] } } as CharacterSheet);
    }
  });
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Cellar", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const rat = await t.run((ctx) =>
    ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "giant-rat" },
      label: "Rat",
      order: 0,
      summoned: false,
      stats: RAT,
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
  const fearNow = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const notes = () => t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).filter((r) => r.kind === "rule" && r.ruleId === "fearFeatures"));
  const attack = (extra: Record<string, unknown> = {}) => gm.mutation(api.adversaryActions.attack, { campaignId, instanceId: rat, targets: [w.characterA], idempotencyKey: key(), ...extra });
  const pcRolls = () =>
    t.run(async (ctx) => {
      const campaign = (await ctx.db.get("campaigns", campaignId))! as Doc<"campaigns">;
      return pcRollAdversaryUses(ctx, campaign, { characterId: w.characterA, roll: { kind: "action", hope: 5, fear: 7, total: 12, withHope: false, critical: false } as never, actorId: w.users.gm });
    });
  return { w, t, campaignId, gm, rat, fearNow, notes, attack, pcRolls };
}

describe("FP4: F5 fearFeatures for uses that run on their own", () => {
  describe("automatic use on the adversary's own attack (Test Pounce: onHit / onMiss, 1 Fear)", () => {
    it("Book: the automatic use spends its Fear; no note", async () => {
      const a = await arena(false, 3);
      const r = await a.attack();
      expect(r.status).toBe("resolved");
      expect(await a.fearNow()).toBe(2);
      expect(await a.notes()).toEqual([]);
    });

    it("Book: refused past the GM's Fear (NOT_ENOUGH_FEAR), as before", async () => {
      const a = await arena(false, 0);
      let code: unknown = "ok";
      try {
        await a.attack();
      } catch (e) {
        code = errorCode(e);
      }
      expect(code).toBe("NOT_ENOUGH_FEAR");
    });

    it("Manual: at 0 Fear nothing is spent or refused; the GM's note says to spend it by hand, never undoable", async () => {
      const a = await arena(true, 0);
      const r = await a.attack();
      expect(r.status).toBe("resolved");
      expect(await a.fearNow()).toBe(0);
      const notes = await a.notes();
      expect(notes.map((n) => n.summary)).toEqual(["Rat used Test Pounce: Spend 1 Fear by hand"]);
      expect(notes.every((n) => n.undoable === false && n.visibility === "gm")).toBe(true);
    });
  });

  describe("triggered reaction the GM opted into with the attack (Test Brace: before the damage, 1 Fear)", () => {
    it("Book: the reaction and the automatic use each spend 1 Fear", async () => {
      const a = await arena(false, 3);
      expect((await a.attack({ reactions: ["Test Brace"] })).status).toBe("resolved");
      expect(await a.fearNow()).toBe(1);
      expect(await a.notes()).toEqual([]);
    });

    it("Manual: nothing spent; one note per use", async () => {
      const a = await arena(true, 0);
      expect((await a.attack({ reactions: ["Test Brace"] })).status).toBe("resolved");
      expect(await a.fearNow()).toBe(0);
      expect((await a.notes()).map((n) => n.summary).sort()).toEqual(["Rat used Test Brace: Spend 1 Fear by hand", "Rat used Test Pounce: Spend 1 Fear by hand"]);
    });
  });

  describe("triggered automatic use on a PC's roll (Test Omen: pcRolls, 1 Fear)", () => {
    it("Book: spends the Fear; no note", async () => {
      const a = await arena(false, 2);
      const out = await a.pcRolls();
      expect(out.lines.some((l) => l.includes("Test Omen"))).toBe(true);
      expect(await a.fearNow()).toBe(1);
      expect(await a.notes()).toEqual([]);
    });

    it("Manual: runs at 0 Fear, spends nothing, the GM's note", async () => {
      const a = await arena(true, 0);
      const out = await a.pcRolls();
      expect(out.lines.some((l) => l.includes("Test Omen"))).toBe(true);
      expect(await a.fearNow()).toBe(0);
      const notes = await a.notes();
      expect(notes.map((n) => n.summary)).toEqual(["Rat used Test Omen: Spend 1 Fear by hand"]);
      expect(notes[0]!.undoable).toBe(false);
    });
  });
});
