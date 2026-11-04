/**
 * Conditions record their source; Vanishing Act's own endings; Cloaked follow-ups (plan lanes, tracer C2;
 * docs/tasks/TASK-LN-C2.md; beads dcm-bxp.99.19.52 and dcm-bxp.99.19.65).
 *
 * Expected values come from the book and the user's answers:
 * - CB p.42 (Rogue, Cloaked): "After you make an attack or end a move within line of sight of an adversary, you are no
 *   longer Cloaked."
 * - CB p.42 (Nightwalker, Vanishing Act): "Mark a Stress to become Cloaked at any time. When Cloaked from this feature, you
 *   automatically clear the Restrained condition if you have it. You remain Cloaked in this way until you roll with Fear
 *   or until your next rest."
 * - User R5 (dcm-bxp.99.19.52): attacks do not end Vanishing Act's Cloaked; a roll with Fear or the next rest does.
 * - User 2026-10-30 (dcm-bxp.99.19.65): (1) in a dim phase a rogue inside a torch / campfire lit radius is seen clearly
 *   (Cloaked ends, as at night); (4) Charge's 1d12 Stress damage is an attack: it ends (ordinary) Cloaked.
 * - CB p.59 (Firbolg, Charge): "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with
 *   one or more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range."
 * - R8 / R9 (src/lib/domain/combat-map/light.ts): Nautical Twilight (DAY day 7) is a dim phase; a torch lights clearly to
 *   Close (6 squares) and dimly to Far (12 squares) at night.
 * - Server dice: `rollDie` maps a random word w to w % sides + 1; a Duality roll draws the Hope Die, then the Fear Die.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { conditionSources, effectKeyOf, endConditionsOnRoll, lapsedConditions, withoutCondition, writeSheetChanges } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { expire } from "../../src/lib/domain/characters/expiry";
import type { PlanStep } from "../../src/lib/domain/card-effects/run";
import type { RollRecord } from "../../src/lib/domain/duality";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());

const VANISHING_ACT = "subclass:nightwalker:vanishing-act";

/** Vanishing Act's source marker as `writeSheetChanges` writes it (the feature's first effect id). */
const MARKER: Effect = { id: `${effectKeyOf(VANISHING_ACT)}:1`, source: "Vanishing Act", text: "cloaked", until: "rest" };

/** A sheet Cloaked by Vanishing Act (the condition and its marker). */
const vanished = (s: CharacterSheet): Partial<CharacterSheet> => ({ conditions: [...s.conditions.filter((c) => c !== "cloaked"), "cloaked"], effects: [...s.effects, MARKER] });

/** The server's next dice; later dice stay random. */
function serverDice(...values: number[]) {
  const queue = [...values];
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    const next = queue.shift();
    if (next === undefined) return real(buf as never) as T;
    (buf as unknown as Uint32Array)[0] = next - 1;
    return buf;
  });
}

const record = (kind: RollRecord["kind"], outcome: RollRecord["outcome"]): RollRecord => ({ kind, dice: [], modifier: 0, total: 10, outcome, manual: false });

// ---------------------------------------------------------------- the source on the sheet (pure)

describe("a condition records its source on the sheet (dcm-bxp.99.19.52)", () => {
  const base = { conditions: [] as CharacterSheet["conditions"], effects: [] as Effect[] };

  it("Vanishing Act's Cloaked step writes the condition and a marker; a bare Cloaked has no source", async () => {
    const w = await buildWorld();
    const sheet = await w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
    const steps: PlanStep[] = [
      { kind: "condition", targetId: "self", condition: { kind: "standard", condition: "cloaked" }, duration: "rest", endsOn: ["rollWithFear"] },
      { kind: "clearCondition", targetId: "self", condition: { kind: "standard", condition: "restrained" } },
    ];
    const after = writeSheetChanges({ ...sheet, conditions: ["restrained"] }, steps, "self", VANISHING_ACT, "Vanishing Act", false, true);
    expect(after.conditions).toEqual(["cloaked"]);
    expect(after.effects).toEqual([MARKER]);
    expect(conditionSources(after, "cloaked")).toEqual([VANISHING_ACT]);
    // A second use replaces the marker, never stacks it.
    expect(writeSheetChanges(after, steps, "self", VANISHING_ACT, "Vanishing Act", false, true).effects).toEqual([MARKER]);
    expect(conditionSources({ ...base, conditions: ["cloaked"] }, "cloaked")).toEqual([]);
    // A condition without events of its own (a card's plain Hidden) writes no marker.
    const plain = writeSheetChanges(sheet, [{ kind: "condition", targetId: "self", condition: { kind: "standard", condition: "hidden" }, duration: "temporary" }], "self", "card-x", "Card X", false, true);
    expect(plain.effects).toEqual(sheet.effects);
  });

  it("a roll with Fear ends it; with Hope, a critical, a damage roll do not (CB p.42)", () => {
    const sheet = { conditions: ["cloaked"] as CharacterSheet["conditions"], effects: [MARKER] };
    for (const kind of ["action", "reaction"] as const) {
      for (const outcome of ["successFear", "failFear"] as const) {
        const out = endConditionsOnRoll(sheet, record(kind, outcome));
        expect(out.sheet).toEqual({ conditions: [], effects: [] });
        expect(out.ended).toEqual([{ condition: "cloaked", source: "Vanishing Act" }]);
      }
    }
    for (const outcome of ["successHope", "failHope", "critical"] as const) expect(endConditionsOnRoll(sheet, record("action", outcome)).sheet).toBe(sheet);
    expect(endConditionsOnRoll(sheet, record("damage", "none")).sheet).toBe(sheet);
  });

  it("the next rest's expiry takes the marker, and the condition goes with it; a bare Cloaked stays", () => {
    const sheet = { conditions: ["cloaked"] as CharacterSheet["conditions"], effects: [MARKER] };
    const rested = expire(sheet, "shortRest");
    expect(rested.effects).toEqual([]);
    expect(lapsedConditions(sheet, rested)).toEqual({ sheet: { ...rested, conditions: [] }, ended: [{ condition: "cloaked", source: "Vanishing Act" }] });
    const bare = { conditions: ["cloaked"] as CharacterSheet["conditions"], effects: [] as Effect[] };
    expect(lapsedConditions(bare, expire(bare, "shortRest")).sheet.conditions).toEqual(["cloaked"]);
  });

  it("withoutCondition drops the condition and its marker", () => {
    expect(withoutCondition({ conditions: ["cloaked", "vulnerable"] as CharacterSheet["conditions"], effects: [MARKER] }, "cloaked")).toEqual({ conditions: ["vulnerable"], effects: [] });
  });
});

// ---------------------------------------------------------------- attacks (combatActions)

type Stats = { difficulty: number; major: number; severe: number; hpMax: number; stressMax: number };

/** The world plus a live map by day: Ash (characterA, a Nightwalker rogue) at (5, 10) facing east; a running encounter. */
async function attackArena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    await saveSheet(ctx, w.characterA, { ...s, classId: "rogue", subclassId: "nightwalker", subclassRank: "mastery", stress: 0 });
    return { ash, encounterId };
  });
  const enemy = (x: number, y: number, stats: Partial<Stats> = {}) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label: "Bandit",
        order: 0,
        summoned: false,
        stats: { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4, ...stats },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
    });
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch(s) });
    });
  const attack = (c: Client, targetTokenIds: Id<"combatTokens">[]) =>
    c.mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key() });
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const cloaked = async () => (await sheet()).conditions.includes("cloaked");
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, sheet, edit, attack, rows, cloaked };
}

describe("attacks and Vanishing Act's Cloaked (R5)", () => {
  it("Vanishing Act's use records its source; an attack with Hope keeps that Cloaked (Sneak Attack still applies)", async () => {
    const a = await attackArena();
    await a.player.mutation(api.combatFeatures.useFeature, { campaignId: a.campaignId, characterId: a.w.characterA, featureId: VANISHING_ACT, targetTokenIds: [], choices: [], idempotencyKey: key() } as never);
    const used = await a.sheet();
    expect(used.conditions).toContain("cloaked");
    expect(conditionSources(used, "cloaked")).toEqual([VANISHING_ACT]);
    const bandit = await a.enemy(6, 10);
    serverDice(9, 2); // Hope 9, Fear 2: with Hope, a hit against Difficulty 1
    const r = await a.attack(a.player, [bandit]);
    expect(r.status).toBe("resolved");
    expect(r.status === "resolved" ? r.riders : []).toContain("Sneak Attack");
    expect(await a.cloaked()).toBe(true);
  });

  it("an attack with Fear ends Vanishing Act's Cloaked, with a public row; undo brings it back", async () => {
    const a = await attackArena();
    await a.edit(vanished);
    const bandit = await a.enemy(6, 10);
    serverDice(2, 9); // Hope 2, Fear 9: with Fear
    await a.attack(a.player, [bandit]);
    expect(await a.cloaked()).toBe(false);
    expect((await a.sheet()).effects.some((e) => e.id === MARKER.id)).toBe(false);
    const row = (await a.rows()).find((r) => r.summary.includes("Cloaked ends (Vanishing Act)"))!;
    expect(row).toMatchObject({ visibility: "public", undoable: true, characterId: a.w.characterA });
    await a.gm.mutation(api.actionLog.undo, { entryId: row._id, idempotencyKey: key() });
    expect(conditionSources(await a.sheet(), "cloaked")).toEqual([VANISHING_ACT]);
  });

  it("an ordinary Cloaked still ends after an attack, with Hope too (CB p.42)", async () => {
    const a = await attackArena();
    await a.edit(() => ({ conditions: ["cloaked"] }));
    const bandit = await a.enemy(6, 10);
    serverDice(9, 2);
    await a.attack(a.player, [bandit]);
    expect(await a.cloaked()).toBe(false);
  });
});

// ---------------------------------------------------------------- rests

describe("the next rest ends Vanishing Act's Cloaked (CB p.42)", () => {
  it("a short rest drops it with a feed line; a bare Cloaked stays", async () => {
    const w = await buildWorld();
    const gm = w.as("gm");
    const edit = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
      w.t.run(async (ctx) => {
        const s = readSheet((await ctx.db.get("characters", id))!.sheet);
        await saveSheet(ctx, id, { ...s, ...patch(s) });
      });
    const sheetOf = (id: Id<"characters">) => w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
    await edit(w.characterA, vanished);
    await edit(w.characterB, () => ({ conditions: ["cloaked"] }));
    const { restId } = await gm.mutation(api.rests.start, { campaignId: w.campaignId, kind: "short", idempotencyKey: key() });
    await gm.mutation(api.rests.finish, { campaignId: w.campaignId, restId, idempotencyKey: key() });
    const ash = await sheetOf(w.characterA);
    expect(ash.conditions).not.toContain("cloaked");
    expect(ash.effects.some((e) => e.id === MARKER.id)).toBe(false);
    expect((await sheetOf(w.characterB)).conditions).toContain("cloaked");
    const rows = await w.t.run((ctx) => ctx.db.query("actionLog").collect());
    expect(rows.some((r) => r.summary.includes(`${ash.name}: Cloaked ends (Vanishing Act)`))).toBe(true);
  });
});

// ---------------------------------------------------------------- moves (combatMovement)

/** The world plus a live medium map: Ash (characterA, Cloaked) at (2, 10), an encounter running. */
async function moveArena() {
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
    await saveSheet(ctx, w.characterA, { ...s, classId: "rogue", conditions: ["cloaked"], traits: { ...s.traits, finesse: 1 }, hope: 2, stress: 0 });
    return { ash, encounterId };
  });
  const enemy = (x: number, y: number, light: "none" | "torch" = "none") =>
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
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light, revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
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
  const move = (c: Client, x: number, y: number) => c.mutation(api.combatTokens.move, { campaignId, tokenId: ids.ash, x, y });
  const cloaked = async () => (await sheet()).conditions.includes("cloaked");
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  return { w, t, campaignId, gm, player, ...ids, enemy, setTime, sheet, edit, move, cloaked, rows };
}

const TWILIGHT = { cycle: "DAY" as const, cycleDay: 7 };
const DAY = { cycle: "DAY" as const, cycleDay: 3 };

describe("a light in a dim phase shows the rogue clearly (dcm-bxp.99.19.65 (1))", () => {
  it("inside an enemy's torch's clear reach in Nautical Twilight, Cloaked ends outright with no roll", async () => {
    const a = await moveArena();
    await a.setTime(TWILIGHT);
    await a.enemy(9, 10, "torch"); // 5 squares from (4, 10): inside Close (6)
    await a.move(a.player, 4, 10);
    expect(await a.cloaked()).toBe(false);
    const rows = await a.rows();
    expect(rows.some((r) => r.summary.includes("ends a move in sight of an adversary and is no longer Cloaked"))).toBe(true);
    expect(rows.some((r) => r.kind === "roll")).toBe(false);
  });

  it("in the torch's dim reach only, it is still the Finesse roll", async () => {
    const a = await moveArena();
    await a.setTime(TWILIGHT);
    await a.enemy(13, 10, "torch"); // 9 squares: past Close, inside Far
    serverDice(11, 2); // 11 + 2 + 1 = 14 vs 10: success with Hope
    await a.move(a.player, 4, 10);
    expect(await a.cloaked()).toBe(true);
    expect((await a.rows()).some((r) => r.kind === "roll" && r.summary.includes("Finesse"))).toBe(true);
  });

  it("Vanishing Act's Cloaked stays even in the torch's clear light", async () => {
    const a = await moveArena();
    await a.setTime(TWILIGHT);
    await a.edit(vanished);
    await a.enemy(9, 10, "torch");
    await a.move(a.player, 4, 10);
    expect(await a.cloaked()).toBe(true);
  });
});

describe("unconscious or dead drops Vanishing Act's Cloaked with its source (dcm-bxp.99.19.65 (3), as built)", () => {
  it("the GM's drag of an unconscious rogue drops Cloaked and the marker; a conscious one keeps it (2)", async () => {
    const a = await moveArena();
    await a.setTime(DAY);
    await a.edit(vanished);
    await a.enemy(20, 10);
    await a.move(a.gm, 3, 10);
    expect(await a.cloaked()).toBe(true);
    await a.edit((s) => ({ conditions: [...s.conditions, "unconscious"] }));
    await a.move(a.gm, 4, 10);
    const s = await a.sheet();
    expect(s.conditions).not.toContain("cloaked");
    expect(s.effects.some((e) => e.id === MARKER.id)).toBe(false);
  });
});

// ---------------------------------------------------------------- Charge (featurePrompts)

describe("Charge's Stress damage is an attack (dcm-bxp.99.19.65 (4))", () => {
  /** Ash as a Firbolg rogue at (2, 10) with Agility 2; Bears at (12, 10) (the target, Far) and (12, 11). */
  async function firbolg() {
    const a = await moveArena();
    await a.setTime(DAY);
    await a.edit((s) => ({ ancestry: { kind: "single", id: "firbolg" }, traits: { ...s.traits, agility: 2 }, stress: 0, hope: 2 }));
    const bear = await a.enemy(12, 10);
    await a.enemy(12, 11);
    const charge = async (stress: boolean) => {
      const asked = await a.player.mutation(api.featurePrompts.charge, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: (await a.t.run(async (ctx) => (await ctx.db.get("combatTokens", a.ash))!.mapId)), targetTokenId: bear, square: { x: 11, y: 10 }, stress, roll: {}, idempotencyKey: key() });
      if (asked.status !== "requested") throw new Error(`expected a request, got ${asked.status}`);
      return a.gm.mutation(api.featurePrompts.answerDifficulty, { campaignId: a.campaignId, requestId: asked.requestId, difficulty: 12, idempotencyKey: key() });
    };
    return { ...a, charge };
  }

  it("with the Stress, an ordinary Cloaked ends as an attack, in the Charge's group; one undo reverts both", async () => {
    const a = await firbolg();
    serverDice(9, 3, 7, 1); // 9 + 3 + 2 = 14 vs 12: success with Hope; the 1d12 shows 7; Unshakable's d6 shows 1
    const out = await a.charge(true);
    if (out.status !== "charged") throw new Error(`expected a Charge, got ${out.status}`);
    expect(await a.cloaked()).toBe(false);
    const rows = await a.rows();
    const row = rows.find((r) => r.summary.includes("attacks with Charge and is no longer Cloaked"))!;
    expect(row).toMatchObject({ visibility: "public", undoable: true, characterId: a.w.characterA });
    expect(row.groupId).toBe(rows.find((r) => r._id === out.use.entryId)!.groupId);
    expect(rows.some((r) => r.summary.includes("ends a move in sight"))).toBe(false);
    await a.gm.mutation(api.actionLog.undo, { entryId: out.use.entryId, idempotencyKey: key() });
    expect(await a.cloaked()).toBe(true);
  });

  it("with the Stress and a roll with Hope, Vanishing Act's Cloaked stays", async () => {
    const a = await firbolg();
    await a.edit(vanished);
    serverDice(9, 3, 7, 1);
    const out = await a.charge(true);
    expect(out.status).toBe("charged");
    expect(await a.cloaked()).toBe(true);
  });

  it("a Charge rolled with Fear ends Vanishing Act's Cloaked", async () => {
    const a = await firbolg();
    await a.edit(vanished);
    serverDice(3, 9); // 3 + 9 + 2 = 14 vs 12: success with Fear
    const out = await a.charge(false);
    expect(out.status).toBe("charged");
    const s = await a.sheet();
    expect(s.conditions).not.toContain("cloaked");
    expect(s.effects.some((e) => e.id === MARKER.id)).toBe(false);
  });
});
