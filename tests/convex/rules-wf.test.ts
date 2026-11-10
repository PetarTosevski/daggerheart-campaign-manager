/**
 * Plan rule-switches wave 3, tracer WF (docs/tasks/TASK-RULES-WF.md): F4 `adversaryExperienceFear` and F5 `fearFeatures`
 * Manual (no Fear asked, refused or spent; "Spend N Fear by hand"), D7 `hordes` Manual (printed damage at half HP, GM
 * note), C4 `unconscious` Book (an unconscious PC can't be targeted by an adversary attack) and W3 Tier 3 Dark-Hearted.
 * M4 `outOfRange` is in out-of-range-refuse.test.ts.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import { writeTracker } from "../../convex/lib/trackers";
import type { RuleModes } from "../../src/lib/rules/registry";
import { HORIZON_TRACKER_KEY } from "../../src/lib/frames/trackers/horizon";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

const EASY = { id: "test:easy", source: "Test", text: "Easy to hit", until: "manual" as const, mods: { evasion: -10 } };

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

async function arena(modes: Partial<Record<keyof RuleModes, string>> = {}, opts: { frameId?: "journey-to-horizon"; fear?: number } = {}) {
  const w = await buildWorld(opts.frameId ? { frameId: opts.frameId } : {});
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const now = Date.now();
  await t.run(async (ctx) => {
    if (Object.keys(modes).length > 0) await ctx.db.patch("campaigns", campaignId, { ruleModes: modes as never });
    const s = await campaignFearState(ctx, campaignId);
    await ctx.db.patch(s._id, { fear: opts.fear ?? 0 });
    for (const id of [w.characterA, w.characterB]) {
      const sheet = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...sheet, armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, effects: [EASY] } as CharacterSheet);
    }
  });
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Swamp", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  let order = 0;
  const adversary = (adversaryId: string, label: string, stats: { difficulty: number; major: number; severe: number; hpMax: number; stressMax: number }, hp = 0) =>
    t.run((ctx) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId },
        label,
        order: order++,
        summoned: false,
        stats,
        hp,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      }),
    );
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const notes = (ruleId: string) => t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).filter((r) => r.kind === "rule" && r.ruleId === ruleId && r.undoneAt === undefined).map((r) => r.summary));
  const attack = (instanceId: Id<"encounterAdversaries">, targets: string[], extra: Record<string, unknown> = {}) =>
    gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets, idempotencyKey: key(), ...extra });
  const feature = (instanceId: Id<"encounterAdversaries">, name: string, targets: string[], extra: Record<string, unknown> = {}) =>
    gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId, feature: name, targets, idempotencyKey: key(), ...extra });
  const knockOut = (id: Id<"characters">) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, hp: s.hpMax, conditions: [...s.conditions, "unconscious"] });
    });
  return { w, t, campaignId, gm, adversary, fear, notes, attack, feature, knockOut };
}

const MOSQUITOES = { difficulty: 10, major: 5, severe: 9, hpMax: 6, stressMax: 3 };
const RAT = { difficulty: 10, major: 100, severe: 200, hpMax: 1, stressMax: 1 };

describe("rule switches wave 3: GM Fear costs, Hordes, unconscious targets, Dark-Hearted (WF)", () => {
  describe("F5 fearFeatures", () => {
    it("Book: a Fear feature asks for its Fear and is refused past the GM's Fear", async () => {
      const a = await arena();
      const rat = await a.adversary("giant-rat", "Rat", RAT);
      expect(await a.feature(rat, "Group Attack", [a.w.characterA])).toMatchObject({ status: "confirmFear", feature: 1 });
      expect(await code(a.feature(rat, "Group Attack", [a.w.characterA], { spendFear: 1 }))).toBe("NOT_ENOUGH_FEAR");
    });

    it("Manual: used at 0 Fear with no confirm step, no Fear spent, the GM's note says to spend it by hand; undo takes the note", async () => {
      const a = await arena({ fearFeatures: "manual" });
      const rat = await a.adversary("giant-rat", "Rat", RAT);
      const r = await a.feature(rat, "Group Attack", [a.w.characterA]);
      expect(r.status).toBe("resolved");
      expect(await a.fear()).toBe(0);
      expect(await a.notes("fearFeatures")).toEqual(["Rat used Group Attack: Spend 1 Fear by hand"]);
      if (r.status !== "resolved") return;
      await a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
      expect(await a.notes("fearFeatures")).toEqual([]);
    });

    it("featureAsk: Manual asks no feature Fear", async () => {
      const a = await arena({ fearFeatures: "manual" });
      const rat = await a.adversary("giant-rat", "Rat", RAT);
      const ask = await a.gm.query(api.adversaryActions.featureAsk, { campaignId: a.campaignId, instanceId: rat, feature: "Group Attack" });
      expect(ask.fear.feature).toBe(0);
    });

    it("environment: Manual uses a Fear feature at 0 Fear, spends nothing and notes it; Book refuses (FEAR_EMPTY)", async () => {
      const book = await arena();
      expect(await code(book.gm.mutation(api.environmentActions.spendFear, { campaignId: book.campaignId, environmentId: "abandoned-grove", featureName: "Defiler", idempotencyKey: key() }))).toBe("FEAR_EMPTY");
      const a = await arena({ fearFeatures: "manual" });
      const r = await a.gm.mutation(api.environmentActions.spendFear, { campaignId: a.campaignId, environmentId: "abandoned-grove", featureName: "Defiler", idempotencyKey: key() });
      expect(r).toMatchObject({ fear: 0, spent: 0 });
      expect(await a.notes("fearFeatures")).toEqual(["Defiler (Abandoned Grove): Spend 1 Fear by hand"]);
    });
  });

  describe("F4 adversaryExperienceFear", () => {
    it("Book: an Experience asks 1 Fear", async () => {
      const a = await arena();
      const m = await a.adversary("giant-mosquitoes", "Mosquitoes", MOSQUITOES);
      expect(await a.attack(m, [a.w.characterA], { experience: "Camouflage" })).toMatchObject({ status: "confirmFear", experience: 1 });
    });

    it("Manual: the Experience adds its value at 0 Fear, no Fear spent, the GM's note", async () => {
      const a = await arena({ adversaryExperienceFear: "manual" });
      const m = await a.adversary("giant-mosquitoes", "Mosquitoes", MOSQUITOES);
      const r = await a.attack(m, [a.w.characterA], { experience: "Camouflage" });
      expect(r.status).toBe("resolved");
      if (r.status !== "resolved") return;
      expect(r.roll?.modifier).toBe(0); // ATK -2 + Camouflage +2
      expect(await a.fear()).toBe(0);
      expect(await a.notes("adversaryExperienceFear")).toEqual(["Mosquitoes used Camouflage (+2): Spend 1 Fear by hand"]);
    });
  });

  describe("D7 hordes", () => {
    it("Manual: a Horde at half HP keeps its printed damage and the GM is asked about the Horde damage", async () => {
      const a = await arena({ hordes: "manual" });
      const m = await a.adversary("giant-mosquitoes", "Mosquitoes", MOSQUITOES, 3);
      const r = await a.attack(m, [a.w.characterA]);
      expect(r.status).toBe("resolved");
      expect(await a.notes("hordes")).toEqual(["Mosquitoes: Horde at half HP: it deals 1d4+1 instead?"]);
    });

    it("Manual below half HP, and Book: no note", async () => {
      const a = await arena({ hordes: "manual" });
      await a.attack(await a.adversary("giant-mosquitoes", "Mosquitoes", MOSQUITOES, 2), [a.w.characterA]);
      expect(await a.notes("hordes")).toEqual([]);
      const b = await arena();
      await b.attack(await b.adversary("giant-mosquitoes", "Mosquitoes", MOSQUITOES, 3), [b.w.characterA]);
      expect(await b.notes("hordes")).toEqual([]);
    });
  });

  describe("C4 unconscious: can't be targeted by an attack", () => {
    it("Book: an adversary attack on an unconscious PC is COMBAT_TARGET_INVALID, nothing written", async () => {
      const a = await arena();
      const m = await a.adversary("giant-mosquitoes", "Mosquitoes", MOSQUITOES);
      await a.knockOut(a.w.characterA);
      const rows = await a.t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).length);
      expect(await code(a.attack(m, [a.w.characterA]))).toBe("COMBAT_TARGET_INVALID");
      expect(await a.t.run(async (ctx) => (await ctx.db.query("actionLog").collect()).length)).toBe(rows);
      expect((await a.attack(m, [a.w.characterB])).status).toBe("resolved");
    });

    it("Manual: the attack goes through", async () => {
      const a = await arena({ unconscious: "manual" });
      const m = await a.adversary("giant-mosquitoes", "Mosquitoes", MOSQUITOES);
      await a.knockOut(a.w.characterA);
      expect((await a.attack(m, [a.w.characterA])).status).toBe("resolved");
    });
  });

  describe("W3 Tier 3 Dark-Hearted", () => {
    const tierThree = (marked: number) => Object.fromEntries(["3a", "3b", "3c", "3d", "3a1", "3a2"].slice(0, marked).map((id) => [id, { marked: true, occurred: false, markedAt: 1 }]));

    it("outside Journey to Horizon, or before 5 Tier 3 boxes: not offered and INVALID", async () => {
      const a = await arena();
      expect(await a.gm.query(api.adversaryActions.darkHearted, { campaignId: a.campaignId })).toBe(false);
      const m = await a.adversary("giant-mosquitoes", "Mosquitoes", MOSQUITOES);
      expect(await code(a.attack(m, [a.w.characterA], { darkHearted: true, spendFear: 2 }))).toBe("INVALID");
      const h = await arena({}, { frameId: "journey-to-horizon" });
      await h.t.run((ctx) => writeTracker(ctx, h.campaignId, HORIZON_TRACKER_KEY, { boxes: tierThree(4), echoesCollected: 1 }));
      expect(await h.gm.query(api.adversaryActions.darkHearted, { campaignId: h.campaignId })).toBe(false);
    });

    it("Tier 3 active: advantage for 1 Fear, asked with the others and spent; Doom Track Manual: not offered", async () => {
      const a = await arena({}, { frameId: "journey-to-horizon", fear: 3 });
      await a.t.run((ctx) => writeTracker(ctx, a.campaignId, HORIZON_TRACKER_KEY, { boxes: tierThree(5), echoesCollected: 1 }));
      expect(await a.gm.query(api.adversaryActions.darkHearted, { campaignId: a.campaignId })).toBe(true);
      const m = await a.adversary("giant-mosquitoes", "Mosquitoes", MOSQUITOES);
      expect(await a.attack(m, [a.w.characterA], { darkHearted: true })).toMatchObject({ status: "confirmFear", fear: 1, darkHearted: 1 });
      const r = await a.attack(m, [a.w.characterA], { darkHearted: true, spendFear: 1 });
      expect(r.status).toBe("resolved");
      if (r.status !== "resolved") return;
      expect(r.roll?.dice.length).toBe(2);
      expect(await a.fear()).toBe(2);
      await a.t.run((ctx) => ctx.db.patch("campaigns", a.campaignId, { ruleModes: { doomTrack: "manual" } }));
      expect(await a.gm.query(api.adversaryActions.darkHearted, { campaignId: a.campaignId })).toBe(false);
    });
  });
});
