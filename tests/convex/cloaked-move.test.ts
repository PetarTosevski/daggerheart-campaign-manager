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
import { afterEach, describe, expect, it, vi } from "vitest";

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
  const enemy = (x: number, y: number, extra: { conditions?: ("hidden" | "restrained" | "vulnerable" | "distracted")[]; light?: "none" | "torch"; difficulty?: number } = {}) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label: "Bear",
        order: 0,
        summoned: false,
        stats: { difficulty: extra.difficulty ?? 10, major: 5, severe: 10, hpMax: 6, stressMax: 2 },
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

/**
 * Server dice (as tests/convex/rests-features.test.ts): each die takes the next face from `faces`, then 1. `rollDie` maps a
 * buffer value v to v % sides + 1. A Duality roll draws the Hope Die, then the Fear Die.
 */
function dice(faces: number[]) {
  const queue = [...faces];
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => array.fill((queue.shift() ?? 1) - 1)) as typeof crypto.getRandomValues);
}

/**
 * DA18 (plan drawer-answers; user 2026-10-30, dcm-bxp.99.19.53 (4)): "when a Cloaked rogue ends a move on a DIM-light square
 * in a revealed enemy's clear line, the rogue makes ONE Finesse action roll (Hope/Fear apply as usual) against the HIGHEST
 * Difficulty among the enemies that have that line. Success keeps Cloaked; failure ends it (public, undoable row). Clear
 * light still ends it outright; darkness keeps it."
 *
 * R9 (light.ts): at night a token without a light sees clearly in Melee (1 square) and dimly to Very Close (3 squares), so
 * an enemy 3 squares from the rogue sees it in dim light. The rogue's Finesse is set to +1: total = Hope + Fear + 1.
 */
describe("Cloaked in dim light makes a Finesse roll (DA18)", () => {
  allowWorldEmails();
  afterEach(() => vi.restoreAllMocks());

  const fear = (a: Awaited<ReturnType<typeof arena>>) =>
    a.t.run(async (ctx) => (await ctx.db.query("campaignState").withIndex("by_campaign", (q) => q.eq("campaignId", a.campaignId)).unique())!.fear);

  async function dimArena() {
    const a = await arena();
    await a.setTime(NIGHT);
    await a.edit((s) => ({ traits: { ...s.traits, finesse: 1 }, hope: 2, stress: 0 }));
    return a;
  }

  it("a success with Hope keeps Cloaked and gives Hope; the public row hides the Difficulty, the GM row names it", async () => {
    const a = await dimArena();
    await a.enemy(7, 10); // 3 squares from (4, 10): dim
    dice([11, 2]); // 11 + 2 + 1 = 14 vs Difficulty 10: success with Hope
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(true);
    expect((await a.sheet()).hope).toBe(3);
    const rows = await a.rows();
    const roll = rows.find((r) => r.kind === "roll" && r.summary.includes("Finesse"))!;
    expect(roll).toMatchObject({ visibility: "public", undoable: true, characterId: a.w.characterA });
    expect(roll.roll).toMatchObject({ kind: "action", total: 14, outcome: "successHope" });
    expect(roll.roll!.difficulty).toBeUndefined();
    expect(roll.summary).not.toContain("10");
    const gmRow = rows.find((r) => r.visibility === "gm" && r.groupId === roll.groupId)!;
    expect(gmRow.summary).toContain("Difficulty 10");
  });

  it("rolls against the HIGHEST Difficulty among the dim seers; a failure with Fear ends Cloaked, gives Fear, and undo reverts both", async () => {
    const a = await dimArena();
    await a.enemy(7, 10); // Difficulty 10
    await a.enemy(4, 13, { difficulty: 18 }); // 3 squares below (4, 10): dim
    const fearBefore = await fear(a);
    dice([3, 8]); // 3 + 8 + 1 = 12: beats 10, fails 18 -> failure with Fear
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(false);
    expect(await fear(a)).toBe(fearBefore + 1);
    const roll = (await a.rows()).find((r) => r.kind === "roll" && r.summary.includes("Finesse"))!;
    expect(roll.roll).toMatchObject({ total: 12, outcome: "failFear" });
    expect(roll.summary).toContain("no longer Cloaked");
    expect((await a.rows()).find((r) => r.visibility === "gm" && r.groupId === roll.groupId)!.summary).toContain("Difficulty 18");
    await a.gm.mutation(api.actionLog.undo, { entryId: roll._id, idempotencyKey: key() });
    expect(await a.cloaked()).toBe(true);
    expect(await fear(a)).toBe(fearBefore);
  });

  it("clear light still ends it outright with no roll", async () => {
    const a = await dimArena();
    await a.enemy(5, 10); // Melee: clear even without a light
    await a.enemy(7, 10);
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(false);
    const rows = await a.rows();
    expect(rows.some((r) => r.summary.includes("ends a move in sight of an adversary and is no longer Cloaked"))).toBe(true);
    expect(rows.some((r) => r.kind === "roll")).toBe(false);
  });

  it("a Hidden enemy in dim range asks for no roll", async () => {
    const a = await dimArena();
    await a.enemy(7, 10, { conditions: ["hidden"] });
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(true);
    expect((await a.rows()).some((r) => r.kind === "roll")).toBe(false);
  });

  it("Vanishing Act's Cloaked makes no roll in dim light (CB p.42)", async () => {
    const a = await dimArena();
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
    await a.enemy(7, 10);
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(true);
    expect((await a.rows()).some((r) => r.kind === "roll" && r.summary.includes("Finesse"))).toBe(false);
  });
});

/**
 * C3 (user 2026-10-30, dcm-bxp.99.19.62):
 * (2) "a rogue who is unconscious or dead drops Cloaked (a GM drag of a conscious rogue stays: no roll)";
 * (3) "Witherwild dusk and dawn count as dim light, so being seen then asks for the Finesse roll instead of ending Cloaked".
 * The dim phases are R8's Nautical Twilight (DAY day 7) and Nightfall (NIGHT day 1); Morning (DAY day 3) is day.
 */
describe("Cloaked follow-ups: dim phases, unconscious or dead, the GM's drag (C3)", () => {
  allowWorldEmails();
  afterEach(() => vi.restoreAllMocks());

  const TWILIGHT = { cycle: "DAY" as const, cycleDay: 7 };
  const NIGHTFALL = { cycle: "NIGHT" as const, cycleDay: 1 };
  const gmMove = (a: Awaited<ReturnType<typeof arena>>, x: number, y: number) => a.gm.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: a.ash, x, y });

  it("in Nautical Twilight an enemy far off sees the rogue dimly: a Finesse roll, and a success keeps Cloaked", async () => {
    const a = await arena();
    await a.setTime(TWILIGHT);
    await a.edit((s) => ({ traits: { ...s.traits, finesse: 1 }, hope: 2, stress: 0 }));
    await a.enemy(20, 10);
    dice([11, 2]); // 14 vs 10: success with Hope
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(true);
    const roll = (await a.rows()).find((r) => r.kind === "roll" && r.summary.includes("Finesse"))!;
    expect(roll.roll).toMatchObject({ total: 14, outcome: "successHope" });
  });

  it("at Nightfall a failure ends Cloaked; no outright end without a roll", async () => {
    const a = await arena();
    await a.setTime(NIGHTFALL);
    await a.edit((s) => ({ traits: { ...s.traits, finesse: 1 }, hope: 2, stress: 0 }));
    await a.enemy(20, 10);
    dice([2, 3]); // 6 vs 10: failure with Fear
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(false);
    const rows = await a.rows();
    expect(rows.some((r) => r.kind === "roll" && r.summary.includes("no longer Cloaked"))).toBe(true);
    expect(rows.some((r) => r.summary.includes("ends a move in sight of an adversary"))).toBe(false);
  });

  it("an unconscious rogue's token moved by the GM drops Cloaked, with no enemy in sight; undo restores it", async () => {
    const a = await arena();
    await a.setTime(DAY);
    await a.edit(() => ({ conditions: ["cloaked", "unconscious"] }));
    await gmMove(a, 4, 10);
    expect(await a.cloaked()).toBe(false);
    const row = (await a.rows()).find((r) => r.summary.includes("unconscious and no longer Cloaked"))!;
    expect(row).toMatchObject({ visibility: "public", undoable: true, characterId: a.w.characterA });
    await a.gm.mutation(api.actionLog.undo, { entryId: row._id, idempotencyKey: key() });
    expect(await a.cloaked()).toBe(true);
  });

  it("a dead rogue's token that moves drops Cloaked", async () => {
    const a = await arena();
    await a.setTime(DAY);
    await a.t.run((ctx) => ctx.db.patch("characters", a.w.characterA, { status: "dead" }));
    await gmMove(a, 4, 10);
    expect(await a.cloaked()).toBe(false);
    expect((await a.rows()).some((r) => r.summary.includes("dead and no longer Cloaked"))).toBe(true);
  });

  it("the GM's drag of a conscious rogue is not the rogue's move: in clear or dim sight Cloaked stays, no roll", async () => {
    const a = await arena();
    await a.setTime(DAY);
    await a.enemy(20, 10);
    await gmMove(a, 4, 10);
    expect(await a.cloaked()).toBe(true);
    await a.setTime(NIGHT);
    await a.enemy(7, 11); // dim at night
    await gmMove(a, 4, 11);
    expect(await a.cloaked()).toBe(true);
    expect((await a.rows()).some((r) => r.characterId === a.w.characterA)).toBe(false);
  });
});
