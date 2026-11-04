/**
 * Plan lanes-2, wave 9, tracer S3 (tier 1-2 adversary data): the switches go through the real server paths.
 * - Exile (CB p.216; user answer dcm-72qk (c)): the whole party, both PCs exiled through adversaryActions.useFeature.
 * - Fire keyword (dcm-dv6): the hit's keyword reader (`hitKeyword`, read by the reaction window) finds `fire` on the
 *   tier 1-2 fire features whose damage step it walks, and nothing on a non-fire one.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { hitKeyword } from "../../convex/lib/adversaryHits";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import { adversaryEffects } from "../../src/lib/srd/adversary-effects";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

async function arena(adversaryId: string) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const now = Date.now();
  for (const id of [w.characterA, w.characterB]) {
    await t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, hp: 0, stress: 0, effects: [], domainCards: { owned: [], loadout: [] } });
    });
  }
  const encounterId = await t.run((ctx) => ctx.db.insert("encounters", { campaignId, name: "Court", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }));
  const instanceId = await t.run((ctx) =>
    ctx.db.insert("encounterAdversaries", {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId },
      label: adversaryId,
      order: 0,
      summoned: false,
      stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 4 },
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
  await t.run(async (ctx) => {
    const s = await campaignFearState(ctx, campaignId);
    await ctx.db.patch(s._id, { fear: 5 });
  });
  const sheet = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const feature = (name: string, targets: string[], extra: Record<string, unknown> = {}) =>
    gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId, feature: name, targets, idempotencyKey: key(), ...extra });
  return { w, sheet, feature };
}

describe("lane3 S3: tier 1-2 adversary data on the server", () => {
  allowWorldEmails();

  it("Exile: one Fear exiles the target and the whole party (dcm-72qk (c))", async () => {
    const a = await arena("petty-noble");
    const party = [a.w.characterA, a.w.characterB];
    // The feature's Fear (and the first spotlight's, if the encounter asks one) is confirmed first.
    const ask = await a.feature("Exile", party);
    expect(ask).toMatchObject({ status: "confirmFear", feature: 1 });
    const r = await a.feature("Exile", party, { spendFear: (ask as { fear: number }).fear });
    expect(r.status).toBe("resolved");
    for (const id of party) {
      const s = await a.sheet(id);
      expect(JSON.stringify(s.effects)).toContain("Exiled");
    }
  });

  it("the hit keyword reader finds fire on the tier 1-2 fire features whose damage step it walks (dcm-dv6)", () => {
    // Read today: damage steps at the top of a use (and inside optional / choose / check then-otherwise). Not yet read
    // (the reader skips save onFail / onSuccess and followUp steps; follow-up bead for E2): Hellfire, Scorched Earth,
    // Dance in the Flames, Randomized Tactics' Fire Jets. Their data carries the keyword already.
    const fire: [string, string][] = [
      ["minor-fire-elemental", "Explosion"],
      ["red-ooze", "Ignite"],
      ["tiny-red-ooze", "Burning"],
      ["guahalan-spirit-beast", "Beast Bomb"],
    ];
    for (const [adversaryId, feature] of fire) expect([adversaryId, feature, hitKeyword(adversaryEffects(adversaryId), feature)]).toEqual([adversaryId, feature, "fire"]);
    expect(hitKeyword(adversaryEffects("acid-burrower"), "Spit Acid")).toBeUndefined();
    // A standard attack carries no keyword (the stat block's attack isn't an effect entry).
    expect(hitKeyword(adversaryEffects("minor-fire-elemental"), undefined)).toBeUndefined();
  });
});
