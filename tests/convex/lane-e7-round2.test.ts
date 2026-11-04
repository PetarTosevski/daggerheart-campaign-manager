/**
 * Plan lanes-2, tracer E7 (docs/tasks/TASK-LN2-E7.md): the adversary server, round 2. An adversary's `effect` on itself
 * is stored as an instance modifier (Evolution: Enraged Mountain Troll, HF p.65; dcm-gx3), and a GM-controlled PC attacks
 * like an adversary (dcm-idz; user answer 2026-10-31). Role checks: the matrix entry the orchestrator adds.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

/** Evasion -10: every attack hits (as adversary-actions.test.ts). */
const EASY = { id: "test:easy", source: "Test", text: "Easy to hit", until: "manual" as const, mods: { evasion: -10 } };
const CONTROLLED = { id: "test:control", source: "Gaze into the Abyss", text: "GM-controlled", until: "manual" as const };

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
  const troll = await t.run((ctx) =>
    ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "mountain-troll" },
      label: "Troll",
      order: 0,
      summoned: false,
      stats: { difficulty: 14, major: 10, severe: 18, hpMax: 7, stressMax: 4 },
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
  const instance = () => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", troll))!);
  return { w, t, gm, campaignId, troll, edit, instance };
}

describe("dcm-gx3: an adversary's effect on itself becomes an instance modifier", () => {
  it("Enraged Mountain Troll: +1 Difficulty, Claw Swipe and the feature swap are stored; undo-able", async () => {
    const { gm, campaignId, troll, instance } = await arena();
    const res = await gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId: troll, feature: "Enraged Mountain Troll", targets: [], idempotencyKey: key() });
    expect(res.status).toBe("resolved");
    const effects = (await instance()).effects ?? [];
    expect(effects).toEqual([
      expect.objectContaining({
        label: "Enraged",
        difficulty: 1,
        standardAttack: { name: "Claw Swipe", range: "veryClose", damage: "1d10+3 phy" },
        featuresRemoved: ["Stolen Armor", "Flail Swipe"],
        featuresAdded: ["Double Swipe"],
        until: "permanent",
      }),
    ]);
    expect(effects[0]!.id).toMatch(/^adv:mountain-troll\/Enraged Mountain Troll:1$/);
  });
});

describe("dcm-idz: a GM-controlled PC attacks like an adversary", () => {
  it("refuses a PC the GM doesn't control (INVALID)", async () => {
    const { w, gm, campaignId } = await arena();
    let code: unknown = "ok";
    try {
      await gm.mutation(api.adversaryActions.gmControlledAttack, { campaignId, characterId: w.characterA, targets: [w.characterB], idempotencyKey: key() });
    } catch (e) {
      code = errorCode(e);
    }
    expect(code).toBe("INVALID");
  });

  it("an Enthralled PC's weapon attack on another PC opens that PC's reaction window", async () => {
    const { w, t, gm, campaignId, edit } = await arena();
    await edit(w.characterA, (s) => ({ effects: [...s.effects, CONTROLLED] }));
    const res = await gm.mutation(api.adversaryActions.gmControlledAttack, { campaignId, characterId: w.characterA, targets: [w.characterB], idempotencyKey: key() });
    expect(res.status).toBe("resolved");
    expect(res.targets).toEqual([expect.objectContaining({ characterId: w.characterB, hit: true })]);
    const rows = await t.run((ctx) => ctx.db.query("combatRequests").collect());
    const hit = rows.find((r) => r.kind === "incomingHit");
    expect(hit?.payload).toMatchObject({ attacker: { kind: "pc", characterId: w.characterA, cardId: "gm-control" }, targetCharacterId: w.characterB });
  });

  it("refuses itself as a target (COMBAT_TARGET_INVALID)", async () => {
    const { w, gm, campaignId, edit } = await arena();
    await edit(w.characterA, (s) => ({ effects: [...s.effects, CONTROLLED] }));
    let code: unknown = "ok";
    try {
      await gm.mutation(api.adversaryActions.gmControlledAttack, { campaignId, characterId: w.characterA, targets: [w.characterA], idempotencyKey: key() });
    } catch (e) {
      code = errorCode(e);
    }
    expect(code).toBe("COMBAT_TARGET_INVALID");
  });
});
