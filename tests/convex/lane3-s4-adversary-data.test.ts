/**
 * Plan lanes-2, wave 9, tracer S4 (docs/tasks/TASK-LN3-S4.md): tier 3-4 adversary data switches proven through the
 * real server path.
 *
 * - Hellwing (Vampire Lord, HF p.88): "replace their standard attack with … Claws: Close | 3d12+6 phy" is stored as an
 *   instance modifier by `useFeature` (dcm-gx3), and the evolved stat block's attack is Claws.
 * - Fire keywords (dcm-dv6): the hit keyword the server reads from the attacking feature (`hitKeyword`); keywords inside
 *   save branches wait on dcm-5gng.
 * - Reality Quake's Unstuck (CB p.237): the condition's mods are readable from the entry by the sheet label
 *   (`lastingModsOf`), and a PC hit reads them from the sheet effect (`pcDamageMods`, dcm-12kx).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { evolvedBlock, type Block } from "../../convex/lib/adversaryFeatures";
import { hitKeyword, pcDamageMods } from "../../convex/lib/adversaryHits";
import { readSheet } from "../../convex/lib/characterSheet";
import { lastingModsOf } from "../../src/lib/domain/adversary-effects/run";
import { adversaryEffects } from "../../src/lib/srd/adversary-effects";
import { buildWorld } from "./authz/world";
import { key } from "./helpers";

async function arena(adversaryId: string, stats: { difficulty: number; major: number; severe: number; hpMax: number; stressMax: number }) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const now = Date.now();
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const instanceId = await t.run((ctx) =>
    ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId },
      label: adversaryId,
      order: 0,
      summoned: false,
      stats,
      hp: Math.ceil(stats.hpMax / 2),
      stress: 0,
      defeated: false,
      conditions: [],
      tags: [],
      spotlights: 0,
      spotlightTurn: 0,
      updatedAt: now,
    }),
  );
  const instance = () => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", instanceId))!);
  return { gm, campaignId, instanceId, instance };
}

describe("S4 dcm-gx3: Hellwing's Claws replace the Vampire Lord's standard attack", () => {
  it("useFeature stores the Claws standard attack as a permanent instance effect; the evolved block attacks with Claws", async () => {
    const { gm, campaignId, instanceId, instance } = await arena("vampire-lord", { difficulty: 17, major: 25, severe: 45, hpMax: 7, stressMax: 5 });
    const res = await gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId, feature: "Hellwing", targets: [], idempotencyKey: key() });
    expect(res.status).toBe("resolved");
    const row = await instance();
    expect(row.tags).toContain("Hellwing");
    expect(row.effects ?? []).toEqual([
      expect.objectContaining({ label: "Hellwing", standardAttack: { name: "Claws", range: "close", damage: "3d12+6 phy" }, until: "permanent" }),
    ]);
    const printed: Block = { adversaryId: "vampire-lord", tier: 3, attack: { name: "Bite", modifier: 5, range: "Melee", damage: "2d10+5 phy" }, experiences: [], features: [], effects: [], resistance: undefined, hordeX: null, relentless: null };
    expect(evolvedBlock(printed, row).attack).toEqual({ name: "Claws", modifier: 5, range: "close", damage: "3d12+6 phy" });
  });
});

describe("S4 dcm-dv6: fire damage steps give the hit its keyword", () => {
  // Fire damage inside a reaction roll's branches (Melting Breath, Flame Breath, Volcanic Breath …) carries the keyword
  // in the data too, but hitKeyword doesn't walk save branches yet (dcm-5gng).
  it("the server reads fire from Conflagration, Unleash Hellfire and Lava Splash; none from a physical blow", () => {
    expect(hitKeyword(adversaryEffects("fallen-sorcerer"), "Conflagration")).toBe("fire");
    expect(hitKeyword(adversaryEffects("vampire-lord"), "Unleash Hellfire")).toBe("fire");
    expect(hitKeyword(adversaryEffects("volcanic-dragon-molten-scourge"), "Lava Splash")).toBe("fire");
    expect(hitKeyword(adversaryEffects("volcanic-dragon-molten-scourge"), "Shattering Might")).toBeUndefined();
    expect(hitKeyword(adversaryEffects("fire-titan"), "Hurl Rock")).toBeUndefined();
  });
});

describe("S4 dcm-fbsr: Unstuck's mods sit on the condition the PC carries", () => {
  it("lastingModsOf finds marksMultiplier x2 by the sheet label 'Unstuck'", () => {
    const steps = adversaryEffects("outer-realms-abomination")
      .filter((e) => e.feature === "Reality Quake")
      .flatMap((e) => e.uses.map((u) => u.steps));
    expect(lastingModsOf(steps, "Unstuck")).toEqual([{ kind: "marksMultiplier", factor: 2, of: ["hope", "armor", "hp", "stress"] }]);
  });

  it("pcDamageMods of a sheet carrying Unstuck returns the x2 marks multiplier (dcm-12kx)", async () => {
    const w = await buildWorld();
    const s = await w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
    const unstuck = { id: "card:outer-realms-abomination/Reality Quake:1", source: "Reality Quake", text: "Unstuck", until: "manual" as const };
    expect(pcDamageMods({ ...s, effects: [unstuck], domainCards: { owned: [], loadout: [] } }, true)).toEqual({
      marksMultiplier: { factor: 2, of: expect.arrayContaining(["hope", "armor", "hp", "stress"]) },
    });
  });
});
