/**
 * Rule switches RFA (plan rule-switches; user answers 2026-11-06 on bead dcm-bxp.134):
 *
 * 1. C2 `hiddenEnds` Book ends Hidden like Cloaked. CB p.102 (Hidden): "After an adversary moves to where they would see
 *    you, you move into their line of sight, or you make an attack, you are no longer Hidden." Clear sight on the PC's
 *    own move ends it, dim light asks the Finesse roll Cloaked asks (DA18), an enemy token that moves to where it sees the
 *    PC ends it, an attack ends it. A Cloaked PC stays unseen when an adversary moves (CB p.42: "while Cloaked you remain
 *    unseen if you are stationary when an adversary moves to where they would normally see you"). Manual: nothing ends,
 *    a GM-only note.
 * 2. C1 `conditionDice` Book, adversary side: CB p.102 "While you are Vulnerable, all rolls targeting you have
 *    advantage", per target (like Hidden's disadvantage). Manual: no die, a GM note per target.
 * 3. S1 `spotlightToGm` Manual stops only the PC-roll half: an adversary action always moves the spotlight to the GM.
 *
 * Every dice assertion reads the rolled numbers back (or fixes them with `dice`), so it holds for every roll.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import { uncloakedByAttack } from "../../convex/lib/combatActions";
import { endableHides, hiddenSeenNote, uncloakAfterAttack } from "../../convex/lib/combatMovement";
import { splitTargetDisadvantage, splitTargetEdge, vulnerableTargetNote } from "../../src/lib/domain/adversary-actions/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());

const NIGHT = { cycle: "NIGHT" as const, cycleDay: 3 };
const DAY = { cycle: "DAY" as const, cycleDay: 3 };

/** Server dice: each die takes the next face from `faces`, then 1 (`rollDie` maps v to v % sides + 1). */
function dice(faces: number[]) {
  const queue = [...faces];
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => array.fill((queue.shift() ?? 1) - 1)) as typeof crypto.getRandomValues);
}

type Change = { key: "hiddenEnds" | "conditionDice" | "spotlightToGm"; value: "book" | "manual" };

const EASY = { id: "test:easy", source: "Test", text: "Easy to hit", until: "manual" as const, mods: { evasion: -10 } };

/**
 * The world with a running encounter, a live medium map (30 x 20) and Ash (characterA, the player's) at (2, 10) with
 * `conditions`; `rules` set first. `enemy` places a Bear token; `gmMove` drags a token as the GM.
 */
async function arena(opts: { rules?: Change[]; conditions?: string[] } = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  for (const change of opts.rules ?? []) await gm.mutation(api.ruleSettings.set, { campaignId, change } as never);
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 2, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    await saveSheet(ctx, w.characterA, { ...s, conditions: (opts.conditions ?? ["hidden"]) as CharacterSheet["conditions"], traits: { ...s.traits, finesse: 1 }, hope: 2, stress: 0 });
    return { ash, encounterId };
  });
  const enemy = (x: number, y: number) =>
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
      return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
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
  const move = (x: number, y: number) => player.mutation(api.combatTokens.move, { campaignId, tokenId: ids.ash, x, y });
  const gmMove = (tokenId: Id<"combatTokens">, x: number, y: number) => gm.mutation(api.combatTokens.move, { campaignId, tokenId, x, y });
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const notes = async () => (await rows()).filter((r) => r.kind === "rule");
  const name = async () => (await sheet()).name;
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, setTime, sheet, move, gmMove, rows, notes, name };
}

// ---------------------------------------------------------------- 1. C2 Hidden ends like Cloaked

describe("RFA 1: C2 Book ends Hidden like Cloaked (CB p.102)", () => {
  it("pure: endableHides leaves out nothing bare; uncloakedByAttack drops a bare Hidden and Cloaked", () => {
    expect(endableHides({ conditions: ["hidden"], effects: [] })).toEqual(["hidden"]);
    expect(endableHides({ conditions: ["cloaked", "hidden", "vulnerable"], effects: [] })).toEqual(["hidden", "cloaked"]);
    expect(endableHides({ conditions: ["vulnerable"], effects: [] })).toEqual([]);
    const s = { conditions: ["hidden", "vulnerable"], effects: [] } as unknown as CharacterSheet;
    expect(uncloakedByAttack(s).conditions).toEqual(["vulnerable"]);
    expect(hiddenSeenNote("Bear", "Ash", true)).toBe("Bear moved to where it sees Ash in dim light: remove Hidden?");
  });

  it("Book: the PC's move into clear sight ends Hidden (public, undoable row that undo reverts)", async () => {
    const a = await arena();
    await a.setTime(DAY);
    await a.enemy(20, 10);
    await a.move(4, 10);
    expect((await a.sheet()).conditions).not.toContain("hidden");
    const row = (await a.rows()).find((r) => r.summary.includes("ends a move in sight of an adversary and is no longer Hidden"))!;
    expect(row).toMatchObject({ visibility: "public", undoable: true, characterId: a.w.characterA });
    await a.gm.mutation(api.actionLog.undo, { entryId: row._id, idempotencyKey: key() });
    expect((await a.sheet()).conditions).toContain("hidden");
    expect(await a.notes()).toEqual([]);
  });

  it("Book: dim light asks the Finesse roll; a failure ends Hidden", async () => {
    const a = await arena();
    await a.setTime(NIGHT);
    await a.enemy(7, 10); // 3 squares from (4, 10) at night: dim
    dice([2, 3]); // 2 + 3 + 1 = 6 vs Difficulty 10: failure
    await a.move(4, 10);
    const roll = (await a.rows()).find((r) => r.kind === "roll" && r.summary.includes("Finesse"))!;
    expect(roll.roll).toMatchObject({ kind: "action", total: 6 });
    expect(roll.summary).toContain("no longer Hidden");
    expect((await a.sheet()).conditions).not.toContain("hidden");
  });

  it("Book: dim light, a success keeps Hidden", async () => {
    const a = await arena();
    await a.setTime(NIGHT);
    await a.enemy(7, 10);
    dice([11, 2]); // 11 + 2 + 1 = 14 vs 10: success with Hope
    await a.move(4, 10);
    expect((await a.rows()).find((r) => r.kind === "roll")!.summary).toContain("stays Hidden");
    expect((await a.sheet()).conditions).toContain("hidden");
  });

  it("Book: an enemy token that moves to where it sees the Hidden PC ends Hidden", async () => {
    const a = await arena();
    await a.setTime(DAY);
    const bear = await a.enemy(25, 2);
    await a.gmMove(bear, 15, 10);
    expect((await a.sheet()).conditions).not.toContain("hidden");
    const n = await a.name();
    const row = (await a.rows()).find((r) => r.summary === `Bear moves to where it sees ${n}: no longer Hidden`)!;
    expect(row).toMatchObject({ visibility: "public", undoable: true, characterId: a.w.characterA });
  });

  it("Book: an enemy that moves where it sees the PC only dimly asks the Finesse roll", async () => {
    const a = await arena();
    await a.setTime(NIGHT);
    const bear = await a.enemy(25, 2);
    dice([2, 3]); // failure
    await a.gmMove(bear, 5, 10); // 3 squares from (2, 10) at night: dim
    const roll = (await a.rows()).find((r) => r.kind === "roll" && r.summary.includes("Finesse"))!;
    expect(roll.summary).toContain("is seen in dim light by Bear");
    expect(roll.summary).toContain("no longer Hidden");
    expect((await a.sheet()).conditions).not.toContain("hidden");
  });

  it("Book: an enemy moving in darkness ends nothing; a Cloaked PC stays unseen (CB p.42)", async () => {
    const dark = await arena();
    await dark.setTime(NIGHT);
    const bear = await dark.enemy(25, 2);
    await dark.gmMove(bear, 12, 10);
    expect((await dark.sheet()).conditions).toContain("hidden");

    const cloaked = await arena({ conditions: ["cloaked"] });
    await cloaked.setTime(DAY);
    const b2 = await cloaked.enemy(25, 2);
    await cloaked.gmMove(b2, 15, 10);
    expect((await cloaked.sheet()).conditions).toEqual(["cloaked"]);
    expect((await cloaked.rows()).some((r) => r.summary.includes("no longer"))).toBe(false);
  });

  it("Book: an attack ends Hidden (uncloakAfterAttack)", async () => {
    const a = await arena();
    const ended = await a.t.run(async (ctx) => uncloakAfterAttack(ctx, (await ctx.db.get("campaigns", a.campaignId))!, a.w.characterA, (await ctx.db.query("users").first())!._id, "Charge", { groupId: "g-a" }));
    expect(ended).toBe(false); // Cloaked did not end (none)
    expect((await a.sheet()).conditions).not.toContain("hidden");
    expect((await a.rows()).find((r) => r.groupId === "g-a")!.summary).toBe(`${await a.name()} attacks with Charge and is no longer Hidden`);
  });

  it("Manual: the PC's move, an enemy's move and an attack end nothing; one GM note each", async () => {
    const a = await arena({ rules: [{ key: "hiddenEnds", value: "manual" }] });
    await a.setTime(DAY);
    const bear = await a.enemy(25, 2);
    await a.gmMove(bear, 15, 10);
    await a.move(4, 10);
    await a.t.run(async (ctx) => uncloakAfterAttack(ctx, (await ctx.db.get("campaigns", a.campaignId))!, a.w.characterA, (await ctx.db.query("users").first())!._id, "Charge", { groupId: "g-a" }));
    expect((await a.sheet()).conditions).toEqual(["hidden"]);
    const n = await a.name();
    expect((await a.notes()).map((r) => [r.ruleId, r.visibility, r.summary])).toEqual([
      ["hiddenEnds", "gm", `Bear moved to where it sees ${n}: remove Hidden?`],
      ["hiddenEnds", "gm", `${n} moved into Bear's sight: remove Hidden?`],
      ["hiddenEnds", "gm", `${n} attacks with Charge: remove Hidden?`],
    ]);
    expect((await a.rows()).some((r) => r.kind === "roll")).toBe(false);
  });

  it("Manual: an enemy seeing the PC in dim light makes no roll; the note says dim light", async () => {
    const a = await arena({ rules: [{ key: "hiddenEnds", value: "manual" }] });
    await a.setTime(NIGHT);
    const bear = await a.enemy(25, 2);
    await a.gmMove(bear, 5, 10);
    expect((await a.sheet()).conditions).toEqual(["hidden"]);
    expect((await a.notes()).map((r) => r.summary)).toEqual([`Bear moved to where it sees ${await a.name()} in dim light: remove Hidden?`]);
    expect((await a.rows()).some((r) => r.kind === "roll")).toBe(false);
  });
});

// ---------------------------------------------------------------- 2. C1 Vulnerable PCs, adversary side

/** A custom adversary that always hits (ATK +20) for 1d4+9 physical. */
const BRUTE = {
  name: "Brute",
  tier: 1 as const,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 10,
  thresholds: { major: 5, severe: 10 },
  hp: 5,
  stress: 3,
  attack: { modifier: 20, name: "Club", range: "Melee" as const, damage: "1d4+9 phy" },
  experiences: [],
  features: [],
};

/** Ash and Bryn (easy to hit, `conditions` each), a running encounter, one Brute, no map. */
async function brawl(opts: { rules?: Change[]; ash?: string[]; bryn?: string[]; map?: boolean } = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  for (const change of opts.rules ?? []) await gm.mutation(api.ruleSettings.set, { campaignId, change } as never);
  await t.run(async (ctx) => {
    for (const [id, conditions] of [
      [w.characterA, opts.ash ?? []],
      [w.characterB, opts.bryn ?? []],
    ] as const) {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, armorId: "chainmail-armor", armorMarked: 0, hp: 0, stress: 0, conditions: conditions as CharacterSheet["conditions"], effects: [EASY], domainCards: { owned: [], loadout: [] } });
    }
  });
  const { customId } = await gm.mutation(api.customAdversaries.create, { campaignId, adversary: BRUTE, idempotencyKey: key() });
  const now = Date.now();
  const { instanceId, burrower } = await t.run(async (ctx) => {
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const base = { campaignId, encounterId, summoned: false, hp: 0, stress: 0, defeated: false, conditions: [], tags: [], spotlights: 0, spotlightTurn: 0, updatedAt: now };
    const fear = await campaignFearState(ctx, campaignId);
    await ctx.db.patch("campaignState", fear._id, { fear: 6 });
    return {
      instanceId: await ctx.db.insert("encounterAdversaries", { ...base, source: { kind: "custom", customId }, label: "Brute", order: 0, stats: { difficulty: 10, major: 5, severe: 10, hpMax: 5, stressMax: 3 } }),
      // Acid Burrower (CB p.210), Spit Acid: "Make an attack against all targets in front of the Burrower within Close range."
      burrower: await ctx.db.insert("encounterAdversaries", { ...base, source: { kind: "srd", adversaryId: "acid-burrower" }, label: "Burrower", order: 1, stats: { difficulty: 14, major: 8, severe: 15, hpMax: 8, stressMax: 3 } }),
    };
  });
  let tokenId: Id<"combatTokens"> | null = null;
  if (opts.map) {
    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
    tokenId = await t.run(async (ctx) => {
      await ctx.db.patch("combatMaps", mapId, { live: true });
      await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
      return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x: 6, y: 10, face: Math.PI });
    });
  }
  const attack = async (targets: Id<"characters">[]) => {
    let r = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets, idempotencyKey: key() });
    if (r.status === "confirmFear") r = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets, spendFear: r.fear, idempotencyKey: key() });
    if (r.status !== "resolved") throw new Error(`attack not resolved: ${r.status}`);
    return r;
  };
  /** The Burrower's Spit Acid against several PCs (one attack roll for all, CB p.161). */
  const spit = async (targets: Id<"characters">[]) => {
    const r = await gm.mutation(api.adversaryActions.useFeature, { campaignId, instanceId: burrower, feature: "Spit Acid", targets, spendFear: 1, idempotencyKey: key() });
    if (r.status !== "resolved") throw new Error(`spit not resolved: ${r.status}`);
    return r;
  };
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const notes = async () => (await rows()).filter((r) => r.kind === "rule");
  const gmRow = async (groupId: string) => (await rows()).find((r) => r.kind === "adversary" && r.visibility === "gm" && r.groupId === groupId)!;
  const spotlight = () => gm.query(api.combatSpotlight.state, { campaignId });
  return { w, t, gm, campaignId, instanceId, tokenId, attack, spit, rows, notes, gmRow, spotlight };
}

type Die = { sides: number; value: number; dropped?: boolean };
const d20s = (r: { roll: { dice: Die[] } | null }) => r.roll!.dice.filter((d) => d.sides === 20);

describe("RFA 2: C1 Book, an adversary attack on a Vulnerable PC has advantage (CB p.102)", () => {
  it("pure: splitTargetEdge shares what every target has and keeps the rest per target, signed", () => {
    expect(splitTargetEdge([{ id: "a", disadvantage: 0, advantage: 1 }])).toEqual({ advantage: 1, disadvantage: 0, residual: new Map() });
    expect(splitTargetEdge([{ id: "a", disadvantage: 0, advantage: 1 }, { id: "b", disadvantage: 0 }])).toEqual({ advantage: 0, disadvantage: 0, residual: new Map([["a", -1]]) });
    expect(splitTargetEdge([{ id: "a", disadvantage: 0, advantage: 1 }, { id: "b", disadvantage: 1 }])).toEqual({ advantage: 0, disadvantage: 0, residual: new Map([["a", -1], ["b", 1]]) });
    // Hidden and Vulnerable on one target cancel (one advantage source cancels its own disadvantage, DA17).
    expect(splitTargetEdge([{ id: "a", disadvantage: 1, advantage: 1 }])).toEqual({ advantage: 0, disadvantage: 0, residual: new Map() });
    // Unchanged for disadvantage only.
    expect(splitTargetDisadvantage([{ id: "a", disadvantage: 2 }, { id: "b", disadvantage: 0 }])).toEqual({ common: 0, residual: new Map([["a", 1]]) });
    expect(vulnerableTargetNote("Brute", "Ash")).toBe("Brute attacks Ash (Vulnerable): roll with advantage?");
  });

  it("Book: one Vulnerable target, two d20s, the higher kept; no note", async () => {
    const a = await brawl({ ash: ["vulnerable"] });
    const r = await a.attack([a.w.characterA]);
    const dice = d20s(r);
    expect(dice).toHaveLength(2);
    const kept = dice.filter((d) => !d.dropped);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.value).toBe(Math.max(...dice.map((d) => d.value)));
    expect(await a.notes()).toEqual([]);
  });

  it("Book: Hidden and Vulnerable cancel (one d20)", async () => {
    const a = await brawl({ ash: ["vulnerable", "hidden"] });
    expect(d20s(await a.attack([a.w.characterA]))).toHaveLength(1);
  });

  it("Book: per target, only the Vulnerable target reads the higher die", async () => {
    const a = await brawl({ ash: ["vulnerable"] });
    const r = await a.spit([a.w.characterA, a.w.characterB]);
    const dice = d20s(r);
    expect(dice).toHaveLength(2);
    const high = Math.max(...dice.map((d) => d.value));
    const row = await a.gmRow(r.groupId);
    expect(row.summary).toContain(`(advantage against them: ${high}, total ${high + 3}`); // Burrower ATK +3
    expect(row.summary).not.toMatch(/Bryn [^:,]*\(advantage/);
  });

  it("Book: all targets Vulnerable, the whole roll has advantage (two d20s, the higher kept)", async () => {
    const a = await brawl({ ash: ["vulnerable"], bryn: ["vulnerable"] });
    const r = await a.spit([a.w.characterA, a.w.characterB]);
    const dice = d20s(r);
    expect(dice).toHaveLength(2);
    expect(dice.find((d) => !d.dropped)!.value).toBe(Math.max(...dice.map((d) => d.value)));
    expect((await a.gmRow(r.groupId)).summary).not.toContain("against them");
  });

  it("Book: a 20 only the Vulnerable target keeps is critical for that target alone", async () => {
    const a = await brawl({ ash: ["vulnerable"] });
    dice([5, 20, 2, 3]); // the roll keeps 5; Ash (Vulnerable) keeps 20; the 2d6 damage roll 2 and 3
    const r = await a.spit([a.w.characterA, a.w.characterB]);
    const row = await a.gmRow(r.groupId);
    expect(row.summary).toContain("(advantage against them: 20, total 23 critical)");
    // Same damage dice; the critical adds the dice's maximum (CB p.148): 12 + 5 against 5.
    expect(row.summary).toContain("Ash: 17 phy");
    expect(row.summary).toContain("Bryn: 5 phy");
  });

  it("Manual: no advantage die; a GM note per Vulnerable target in the attack's group", async () => {
    const a = await brawl({ rules: [{ key: "conditionDice", value: "manual" }], ash: ["vulnerable"], bryn: ["vulnerable", "hidden"] });
    const r = await a.spit([a.w.characterA, a.w.characterB]);
    expect(d20s(r)).toHaveLength(1);
    expect((await a.notes()).map((n) => [n.ruleId, n.visibility, n.groupId, n.characterId, n.summary])).toEqual([
      ["conditionDice", "gm", r.groupId, a.w.characterA, "Burrower attacks Ash (Vulnerable): roll with advantage?"],
      ["conditionDice", "gm", r.groupId, a.w.characterB, "Burrower attacks Bryn (Hidden): roll with disadvantage?"],
      ["conditionDice", "gm", r.groupId, a.w.characterB, "Burrower attacks Bryn (Vulnerable): roll with advantage?"],
    ]);
  });
});

// ---------------------------------------------------------------- 3. S1: adversary actions always take the spotlight

describe("RFA 3: S1 Manual stops only the PC-roll half; an adversary action always takes the spotlight", () => {
  for (const mode of ["book", "manual"] as const) {
    it(`${mode}: the attack moves the spotlight to the GM and lights the adversary's token; no note`, async () => {
      const a = await brawl({ rules: [{ key: "spotlightToGm", value: mode }], map: true });
      expect((await a.spotlight()).holder).toBeNull();
      await a.attack([a.w.characterA]);
      expect(await a.spotlight()).toMatchObject({ holder: { kind: "gm" }, reason: "adversary", adversaryTokenId: a.tokenId });
      expect((await a.notes()).filter((n) => n.ruleId === "spotlightToGm")).toEqual([]);
    });
  }
});
