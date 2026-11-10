/**
 * Plan finish-in-progress FP4 (bead dcm-bxp.134.4; docs/tasks/TASK-FP4.md): F5 `fearFeatures` Manual for adversary uses
 * that run without the GM's click. Book spends their Fear cost as before; Manual spends none and posts the GM's
 * "Spend N Fear by hand" note (as the clicked uses do, rules-wf.test.ts).
 *
 * FP5 (user 2026-11-10): Q5, Manual also drops the Fear inside a use's steps (a `pay` step's, an `optional` step's) for
 * clicked and triggered uses alike, and counts it in the note; Book spends it. Q6, a triggered use's note joins the
 * attack's undo group (undoing the attack removes it); a run with no group (a PC roll's, called without one) keeps a
 * note of its own, never undoable.
 *
 * No printed adversary has an automatic use with a Fear cost (every Fear-cost trigger is a reaction the GM opts into), so
 * the Giant Rat gets test-only uses: an automatic one on its own attack's hit or miss (exactly one fires), a reaction
 * before the damage the GM opts into with the attack, an automatic one on a PC's roll, and (FP5) a clicked action with a
 * Fear `pay` step and a Fear `optional` step, and a reaction before the damage whose only Fear is a `pay` step.
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
  {
    adversaryId: "giant-rat",
    feature: "Test Levy",
    uses: [
      {
        id: "main",
        activation: { kind: "action" },
        needsSpotlight: false,
        steps: [
          { kind: "pay", costs: ONE_FEAR },
          { kind: "optional", id: "more", label: "Spend another Fear", costs: ONE_FEAR, steps: [{ kind: "manual", to: "self", text: "Levy taken" }] },
        ],
      } as AdversaryFeatureUse,
    ],
  },
  { adversaryId: "giant-rat", feature: "Test Ward", uses: [{ ...testUse("main", "reaction", { kind: "onAttack", stage: "beforeDamage", attack: "standard" }), costs: [], steps: [{ kind: "pay", costs: ONE_FEAR }] } as AdversaryFeatureUse] },
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
  const levy = () => gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId: rat, feature: "Test Levy", targets: [], optionals: ["more"], idempotencyKey: key() });
  const groupOf = (entryId: string) => t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).find((r) => r._id === entryId)!.groupId);
  const undo = (entryId: Doc<"actionLog">["_id"]) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  const pcRolls = () =>
    t.run(async (ctx) => {
      const campaign = (await ctx.db.get("campaigns", campaignId))! as Doc<"campaigns">;
      return pcRollAdversaryUses(ctx, campaign, { characterId: w.characterA, roll: { kind: "action", hope: 5, fear: 7, total: 12, withHope: false, critical: false } as never, actorId: w.users.gm });
    });
  return { w, t, campaignId, gm, rat, fearNow, notes, attack, pcRolls, levy, groupOf, undo };
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

    it("Manual: at 0 Fear nothing is spent or refused; the GM's note says to spend it by hand, in the attack's group (FP5 Q6)", async () => {
      const a = await arena(true, 0);
      const r = await a.attack();
      if (r.status !== "resolved") throw new Error(r.status);
      expect(await a.fearNow()).toBe(0);
      const notes = await a.notes();
      expect(notes.map((n) => n.summary)).toEqual(["Rat used Test Pounce: Spend 1 Fear by hand"]);
      expect(notes.every((n) => n.undoable === true && n.visibility === "gm" && n.groupId === r.groupId)).toBe(true);
    });

    it("Manual: undoing the attack removes the triggered use's note (FP5 Q6)", async () => {
      const a = await arena(true, 0);
      const r = await a.attack();
      if (r.status !== "resolved") throw new Error(r.status);
      await a.undo(r.entryId);
      const notes = await a.notes();
      expect(notes).toHaveLength(1);
      expect(notes[0]!.undoneAt).toBeDefined();
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
      // Called without a group: the note keeps none, never undoable.
      expect(notes[0]!.undoable).toBe(false);
    });
  });
});

describe("FP5: F5 fearFeatures and the Fear inside a use's steps (Q5)", () => {
  describe("clicked use (Test Levy: a 1-Fear pay step, a 1-Fear optional step taken)", () => {
    it("Book: both steps spend their Fear; no note", async () => {
      const a = await arena(false, 3);
      expect((await a.levy()).status).toBe("resolved");
      expect(await a.fearNow()).toBe(1);
      expect(await a.notes()).toEqual([]);
    });

    it("Manual: at 0 Fear the steps still run (the optional is taken), nothing is spent, and the note counts both", async () => {
      const a = await arena(true, 0);
      const r = await a.levy();
      if (r.status !== "resolved") throw new Error(r.status);
      expect(r.prompts.some((p) => p.text.includes("Levy taken"))).toBe(true);
      expect(r.prompts.some((p) => p.text.includes("fearFeatures"))).toBe(false);
      expect(await a.fearNow()).toBe(0);
      const notes = await a.notes();
      expect(notes.map((n) => n.summary)).toEqual(["Rat used Test Levy: Spend 2 Fear by hand"]);
      expect(notes[0]!.groupId).toBe(r.groupId);
    });
  });

  describe("triggered reaction opted into (Test Ward: no upfront cost, a 1-Fear pay step)", () => {
    it("Book: the step's Fear is spent (with Test Pounce's 1)", async () => {
      const a = await arena(false, 3);
      expect((await a.attack({ reactions: ["Test Ward"] })).status).toBe("resolved");
      expect(await a.fearNow()).toBe(1);
      expect(await a.notes()).toEqual([]);
    });

    it("Manual: nothing spent; the reaction's note names its step Fear, in the attack's group", async () => {
      const a = await arena(true, 0);
      const r = await a.attack({ reactions: ["Test Ward"] });
      if (r.status !== "resolved") throw new Error(r.status);
      expect(await a.fearNow()).toBe(0);
      const notes = await a.notes();
      expect(notes.map((n) => n.summary).sort()).toEqual(["Rat used Test Pounce: Spend 1 Fear by hand", "Rat used Test Ward: Spend 1 Fear by hand"]);
      expect(notes.every((n) => n.groupId === r.groupId)).toBe(true);
    });
  });
});
