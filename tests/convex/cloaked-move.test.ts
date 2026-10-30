/**
 * Cloaked ends on a move only when a revealed enemy sees the rogue (plan drawer-answers DA3; docs/tasks/TASK-DA-DA3.md).
 *
 * Expected values come from the book and the user's answer:
 * - CB p.42 (Rogue, Cloaked): "After you make an attack or end a move within line of sight of an adversary, you are no
 *   longer Cloaked."
 * - User 2026-10-30 (dcm-bxp.99.19.48 (1)): only a revealed (not Hidden) enemy token with a clear line AND able to see the
 *   rogue under the map's day / dim / night and lights ends it.
 * - CB p.42 (Vanishing Act): "You remain Cloaked in this way until you roll with Fear or until your next rest." (pin
 *   dcm-bxp.99.19.42: a move in sight does not end it.)
 * - R9 (light.ts): at night a token without a light sees clearly only in Melee (1 square); a torch lights clearly to Close
 *   (6 squares).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

/** Campaign time (Witherwild, R8): Deep Night and Morning. */
const NIGHT = { cycle: "NIGHT" as const, cycleDay: 3 };
const DAY = { cycle: "DAY" as const, cycleDay: 3 };

/** A medium map's squares of column x (30 x 20). */
const column = (x: number) => Array.from({ length: 20 }, (_, y) => y * 30 + x);

/** The world plus a live medium map: Ash (the player's rogue, Cloaked) at (2, 10), an encounter running. */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 2, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    await saveSheet(ctx, w.characterA, { ...s, classId: "rogue", conditions: ["cloaked"] });
    return { ash, encounterId };
  });
  const enemy = (x: number, y: number, extra: { conditions?: ("hidden" | "restrained" | "vulnerable" | "distracted")[]; light?: "none" | "torch" } = {}) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label: "Bear",
        order: 0,
        summoned: false,
        stats: { difficulty: 10, major: 5, severe: 10, hpMax: 6, stressMax: 2 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: extra.conditions ?? [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: extra.light ?? "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
    });
  const setTime = (time: { cycle: "DAY" | "NIGHT"; cycleDay: number }) =>
    t.run(async (ctx) => {
      const row = await ctx.db
        .query("campaignTime")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .unique();
      if (row === null) await ctx.db.insert("campaignTime", { campaignId, week: 1, ...time });
      else await ctx.db.patch("campaignTime", row._id, time);
    });
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch(s) });
    });
  const move = (x: number, y: number) => player.mutation(api.combatTokens.move, { campaignId, tokenId: ids.ash, x, y });
  const cloaked = async () => (await sheet()).conditions.includes("cloaked");
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, setTime, sheet, edit, move, cloaked, rows };
}

describe("Cloaked ends on a move in an enemy's sight (DA3)", () => {
  allowWorldEmails();

  it("ends on a lit square in line, with a public undoable feed row that undo reverts", async () => {
    const a = await arena();
    await a.setTime(DAY);
    await a.enemy(20, 10);
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(false);
    const row = (await a.rows()).find((r) => r.summary.includes("no longer Cloaked"))!;
    expect(row).toMatchObject({ visibility: "public", undoable: true, characterId: a.w.characterA });
    await a.gm.mutation(api.actionLog.undo, { entryId: row._id, idempotencyKey: key() });
    expect(await a.cloaked()).toBe(true);
  });

  it("ends at night when a torch lights the rogue clearly", async () => {
    const a = await arena();
    await a.setTime(NIGHT);
    // A torch-bearing enemy 5 squares away: the rogue stands in its clear light (Close, 6 squares).
    await a.enemy(9, 10, { light: "torch" });
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(false);
  });

  it("stays on a dark square at night when the enemy carries no light", async () => {
    const a = await arena();
    await a.setTime(NIGHT);
    await a.enemy(12, 10);
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(true);
    expect((await a.rows()).some((r) => r.summary.includes("no longer Cloaked"))).toBe(false);
  });

  it("stays when the only enemy in sight is Hidden", async () => {
    const a = await arena();
    await a.setTime(DAY);
    await a.enemy(20, 10, { conditions: ["hidden"] });
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(true);
  });

  it("stays when a wall stands between the rogue and the enemy", async () => {
    const a = await arena();
    await a.setTime(DAY);
    await a.gm.mutation(api.combatMapEdit.paintCells, { campaignId: a.campaignId, mapId: a.mapId, squares: column(10), paint: "wall" });
    await a.enemy(20, 10);
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(true);
  });

  it("keeps Vanishing Act's Cloaked on a move in sight (CB p.42)", async () => {
    const a = await arena();
    await a.setTime(DAY);
    await a.edit(() => ({ conditions: [], subclassId: "nightwalker", subclassRank: "mastery", stress: 0 }));
    await a.player.mutation(api.combatFeatures.useFeature, {
      campaignId: a.campaignId,
      characterId: a.w.characterA,
      featureId: "subclass:nightwalker:vanishing-act",
      targetTokenIds: [],
      choices: [],
      idempotencyKey: key(),
    } as never);
    expect(await a.cloaked()).toBe(true);
    await a.enemy(20, 10);
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(true);
  });

  it("does nothing to a token that stays put or a rogue who is not Cloaked", async () => {
    const a = await arena();
    await a.setTime(DAY);
    await a.enemy(20, 10);
    await a.move(2, 10);
    expect(await a.cloaked()).toBe(true);
    await a.edit(() => ({ conditions: [] }));
    await a.move(4, 10);
    expect((await a.rows()).some((r) => r.summary.includes("no longer Cloaked"))).toBe(false);
  });
});
