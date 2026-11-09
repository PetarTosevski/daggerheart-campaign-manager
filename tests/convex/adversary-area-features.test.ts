/**
 * dcm-y3mf (user report 2026-11-09): the Cave Ogre's area features from the stat block. Hail of Boulders ("all targets in
 * front of the Ogre within Far", CB p.210) and Rampaging Fury ("all targets in their path") ran on nobody: their targets
 * are `count: "all"` with an `area` shape the server can't measure, the client sent no targets and the server rolled
 * against none. Now the GM names the targets (featureAsk says the list is pickable and carries the area), a use without
 * them is refused before anything is paid, and a plain "all targets within range" use fills itself from the map.
 *
 * Ash and Bryn carry an Evasion effect of -10, so every attack hits.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
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

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const now = Date.now();
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>, id: Id<"characters">) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  for (const id of [w.characterA, w.characterB]) await edit(() => ({ armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, effects: [EASY], domainCards: { owned: [], loadout: [] } }), id);
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Cave", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const adversary = (adversaryId: string, label: string, stats: { difficulty: number; major: number; severe: number; hpMax: number; stressMax: number }) =>
    t.run((ctx) =>
      ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId },
        label,
        order: 0,
        summoned: false,
        stats,
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
  const ogre = await adversary("cave-ogre", "Ogre", { difficulty: 13, major: 8, severe: 15, hpMax: 8, stressMax: 3 });
  const mapId = (await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() })).mapId;
  await t.run(async (ctx) => {
    const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
    await ctx.db.insert("combatTokens", { ...token, ref: { kind: "adversary", adversaryId: ogre }, side: "enemy", x: 10, y: 10, face: 0 });
    await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 11, y: 10, face: 0 });
    await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 13, y: 10, face: 0 });
    // Ramp Up (CB p.210): the Ogre's spotlight costs a Fear.
    const s = await campaignFearState(ctx, campaignId);
    await ctx.db.patch(s._id, { fear: 5 });
  });
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const feature = (instanceId: Id<"encounterAdversaries">, name: string, targets: string[], extra: Record<string, unknown> = {}) =>
    gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId, feature: name, targets, idempotencyKey: key(), spendFear: 12, ...extra });
  const ask = (instanceId: Id<"encounterAdversaries">, name: string) => gm.query(api.adversaryActions.featureAsk, { campaignId, instanceId, feature: name });
  const request = (id: Id<"combatRequests">) => t.run(async (ctx) => (await ctx.db.get("combatRequests", id))!);
  return { w, t, campaignId, gm, ogre, adversary, instance, fear, feature, ask, request };
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

describe("dcm-y3mf: Hail of Boulders (all targets in front within Far)", () => {
  it("featureAsk says the GM names the targets in front", async () => {
    const a = await arena();
    expect((await a.ask(a.ogre, "Hail of Boulders")).targets).toMatchObject({ side: "enemy", range: "far", count: "all", area: "front" });
    expect((await a.ask(a.ogre, "Rampaging Fury")).targets).toMatchObject({ side: "any", range: "close", count: "all", area: "path" });
  });

  it("with no targets named it is refused before the Stress is marked (it never rolls at nobody)", async () => {
    const a = await arena();
    expect(await code(a.feature(a.ogre, "Hail of Boulders", []))).toBe("COMBAT_TARGET_INVALID");
    expect((await a.instance(a.ogre)).stress).toBe(0);
  });

  it("attacks every named target, damages each hit, a Fear for more than one hit", async () => {
    const a = await arena();
    const r = resolved(await a.feature(a.ogre, "Hail of Boulders", [a.w.characterA, a.w.characterB]));
    expect(r.roll).not.toBeNull();
    expect(r.targets).toHaveLength(2);
    for (const target of r.targets) {
      expect(target.hit).toBe(true);
      const row = await a.request(target.requestId!);
      if (row.payload.kind !== "incomingHit") throw new Error("expected an incoming hit");
      expect(row.payload.damage).toBeGreaterThanOrEqual(3);
      expect(row.payload.damage).toBeLessThanOrEqual(24);
    }
    expect((await a.instance(a.ogre)).stress).toBe(1);
    // Ramp Up's spotlight Fear (5 -> 4), then "If they succeed against more than one target, you gain a Fear." (-> 5).
    expect(await a.fear()).toBe(5);
  });

  it("one hit gains no Fear", async () => {
    const a = await arena();
    const r = resolved(await a.feature(a.ogre, "Hail of Boulders", [a.w.characterA]));
    expect(r.targets).toMatchObject([{ hit: true }]);
    expect(await a.fear()).toBe(4);
  });

  it("a full Stress track can't pay its Stress: refused, nothing rolled or marked (the shared cost check)", async () => {
    const a = await arena();
    await a.t.run((ctx) => ctx.db.patch("encounterAdversaries", a.ogre, { stress: 3 }));
    expect(await code(a.feature(a.ogre, "Hail of Boulders", [a.w.characterA]))).toBe("ADVERSARY_FEATURE_UNAVAILABLE");
    const after = await a.instance(a.ogre);
    expect(after.stress).toBe(3);
    expect(after.hp).toBe(0);
  });
});

describe("dcm-y3mf: a plain 'all targets within range' use fills itself from the map", () => {
  it("Death Quake (all targets within Very Close) attacks the PCs in range and leaves the rest", async () => {
    const a = await arena();
    const construct = await a.adversary("construct", "Construct", { difficulty: 13, major: 9, severe: 17, hpMax: 9, stressMax: 4 });
    const mapId = await a.t.run(async (ctx) => (await ctx.db.query("combatMaps").first())!._id);
    await a.t.run((ctx) =>
      ctx.db.insert("combatTokens", { campaignId: a.campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: construct }, side: "enemy", x: 8, y: 10, face: 0 }),
    );
    // Ash stands 3 squares off (Very Close), Bryn 5 (Close).
    const r = resolved(await a.feature(construct, "Death Quake", []));
    expect(r.targets.map((t) => t.characterId)).toEqual([a.w.characterA]);
  });

  it("Trample (all targets in the Construct's path, an attack) is named by the GM too", async () => {
    const a = await arena();
    const construct = await a.adversary("construct", "Construct", { difficulty: 13, major: 9, severe: 17, hpMax: 9, stressMax: 4 });
    expect(await code(a.feature(construct, "Trample", []))).toBe("COMBAT_TARGET_INVALID");
    const r = resolved(await a.feature(construct, "Trample", [a.w.characterB]));
    expect(r.targets).toMatchObject([{ characterId: a.w.characterB, hit: true }]);
  });
});

describe("dcm-y3mf: Rampaging Fury (move within Close, all targets in the path)", () => {
  it("deals 2d6+3 direct physical damage to each named target and asks the GM to move the Ogre", async () => {
    const a = await arena();
    const r = resolved(await a.feature(a.ogre, "Rampaging Fury", [a.w.characterA]));
    expect(r.targets).toHaveLength(1);
    const row = await a.request(r.targets[0]!.requestId!);
    if (row.payload.kind !== "incomingHit") throw new Error("expected an incoming hit");
    expect(row.payload.damage).toBeGreaterThanOrEqual(5);
    expect(row.payload.damage).toBeLessThanOrEqual(15);
    expect(row.payload.direct).toBe(true);
    expect(r.prompts.some((p) => p.kind === "move")).toBe(true);
  });

  it("with nobody named it still asks the GM to move the Ogre and says nobody was in the path", async () => {
    const a = await arena();
    const r = resolved(await a.feature(a.ogre, "Rampaging Fury", []));
    expect(r.targets).toEqual([]);
    expect(r.prompts.some((p) => p.kind === "move")).toBe(true);
    expect(r.prompts.some((p) => p.kind === "manual")).toBe(true);
  });
});
