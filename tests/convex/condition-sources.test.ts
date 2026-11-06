import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { readSheet, saveSheet, storedSheet } from "../../convex/lib/characterSheet";
import { conditionSourceSchema } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";

/**
 * dcm-bxp.99.32.1: conditions with provenance (widened, optional). A sheet condition and an instance condition can carry
 * where they came from (`source`, `casterId`) and when they end (`until`, `endsWhen`); old rows without it still read; a
 * cleared condition's provenance goes with it; the sheet view returns it.
 */

const VICIOUS = { condition: "restrained" as const, source: "Vicious Entangle", casterId: "moss", until: "temporary" as const, endsWhen: "it breaks free" };

describe("condition provenance on the sheet", () => {
  allowWorldEmails();

  it("validates an entry: a known condition, a short source, a CONDITION_UNTIL end", () => {
    expect(conditionSourceSchema.parse(VICIOUS)).toEqual(VICIOUS);
    expect(conditionSourceSchema.safeParse({ ...VICIOUS, until: "forever" }).success).toBe(false);
    expect(conditionSourceSchema.safeParse({ ...VICIOUS, condition: "sleepy" }).success).toBe(false);
    expect(conditionSourceSchema.safeParse({ condition: "vulnerable", source: "Pin Down" }).success).toBe(true);
  });

  it("is kept with its condition, dropped once the condition is cleared, and returned by the sheet view", async () => {
    const w = await buildWorld();
    const sheet = await w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
    // A sheet stored before the field still reads, without it.
    expect(sheet.conditionSources).toBeUndefined();

    const withBoth = { ...sheet, conditions: ["restrained" as const, "vulnerable" as const], conditionSources: [VICIOUS, { condition: "hidden" as const, source: "Stale" }] };
    // The orphan (Hidden is not on the sheet) is dropped on save.
    expect(storedSheet(withBoth).conditionSources).toEqual([VICIOUS]);
    await w.t.run((ctx) => saveSheet(ctx, w.characterA, withBoth));
    const view = await w.as("player").query(api.charactersReads.get, { characterId: w.characterA });
    expect(view?.sheet.conditionSources).toEqual([VICIOUS]);

    // Clearing Restrained by any path takes its provenance with it.
    await w.t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, conditions: ["vulnerable"] });
    });
    const after = await w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
    expect(after.conditions).toEqual(["vulnerable"]);
    expect(after.conditionSources).toBeUndefined();
  });
});

describe("condition provenance on an encounter instance", () => {
  allowWorldEmails();

  it("stores an instance condition's source and end; a row without it stays valid", async () => {
    const w = await buildWorld();
    const now = Date.now();
    const row = await w.t.run(async (ctx) => {
      const encounterId = await ctx.db.insert("encounters", { campaignId: w.campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
      const base = { campaignId: w.campaignId, encounterId, source: { kind: "srd" as const, adversaryId: "bear" }, order: 0, summoned: false, stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 }, hp: 0, stress: 0, defeated: false, tags: [], spotlights: 0, spotlightTurn: 0, updatedAt: now };
      await ctx.db.insert("encounterAdversaries", { ...base, label: "Old", conditions: ["vulnerable"] });
      const id = await ctx.db.insert("encounterAdversaries", { ...base, label: "Bear", conditions: ["restrained"], conditionSources: [{ condition: "restrained", source: "Vicious Entangle", casterId: String(w.characterA), until: "temporary", endsWhen: "it breaks free" }] });
      return ctx.db.get("encounterAdversaries", id);
    });
    expect(row?.conditionSources).toEqual([{ condition: "restrained", source: "Vicious Entangle", casterId: String(w.characterA), until: "temporary", endsWhen: "it breaks free" }]);
    await expect(
      w.t.run(async (ctx) => {
        const encounterId = (await ctx.db.query("encounters").first())!._id;
        await ctx.db.insert("encounterAdversaries", { campaignId: w.campaignId, encounterId, source: { kind: "srd", adversaryId: "bear" }, label: "Bad", order: 0, summoned: false, stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 }, hp: 0, stress: 0, defeated: false, conditions: [], conditionSources: [{ condition: "restrained", source: "x", until: "forever" }] as never, tags: [], spotlights: 0, spotlightTurn: 0, updatedAt: now });
      }),
    ).rejects.toThrow();
  });
});
