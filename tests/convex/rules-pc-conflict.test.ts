/**
 * Plan rule-switches OP (docs/tasks/TASK-RULES-OP.md): the optional rule "Conflict between PCs" (CB p.168, off by
 * default; user answer Q14 a, 2026-11-05).
 *
 * CB p.168: "On an attack roll against a PC, the attacker rolls against the defender's Evasion, just like an adversary.
 * On any other kind of action roll, the instigator makes an action roll and the target makes a reaction roll. To
 * succeed, the instigator must beat a Difficulty equal to the total value of the reaction roll."
 *
 * - Off: another PC's token is not a target (COMBAT_TARGET_INVALID) and `combatActionsReads.targets` lists none;
 *   `combatActions.contest` refuses with MECHANIC_DISABLED.
 * - On: a weapon attack may name another PC's token: the roll is compared with their Evasion, a hit's damage opens their
 *   incoming-hit window (armor, reactions) with the attack's total; out of range is refused (never a GM sanction).
 * - Contest: the target's reaction roll first, then the instigator's action roll with that total as its Difficulty.
 *
 * Dice: the server's CSPRNG is stubbed (`dice`); every value stays within its die (Hope / Fear d12, the weapon's die is
 * at least a d4, edge dice d6).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { conflictEdge } from "../../convex/lib/combatActions";
import { pcCombatant } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { conflictRows } from "../../src/components/combat-map/hud/pick-attack/model";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, handingBack, key } from "./helpers";

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());

/** The server's dice show `values` in turn, then repeat (a value never above its die: callers pick them so). */
function dice(...values: number[]) {
  let i = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(buf: T): T => {
    if (buf instanceof Uint32Array) buf.fill(values[i++ % values.length]! - 1);
    return buf;
  });
}

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

/** Every die of a roll stays within its sides. */
function diceInRange(roll: { dice: readonly { sides: number; value: number }[] }) {
  for (const d of roll.dice) {
    expect(d.value).toBeGreaterThanOrEqual(1);
    expect(d.value).toBeLessThanOrEqual(d.sides);
  }
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected a resolved attack, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

/** A live medium map: Ash at (5, 10) looking east, Bryn (playerB's PC) at `bryn` facing west; the rule on or off. */
async function arena(on: boolean, bryn: { x: number; y: number } = { x: 6, y: 10 }, encounter = false) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = handingBack(w.as("player"), gm, campaignId);
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("campaigns", campaignId, { ruleModes: on ? { pcConflict: true } : {} });
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const brynToken = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: bryn.x, y: bryn.y, face: Math.PI });
    const encounterId = encounter ? await ctx.db.insert("encounters", { campaignId, name: "Brawl", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now }) : null;
    return { ash, bryn: brynToken, encounterId };
  });
  const attack = (targetTokenIds: Id<"combatTokens">[], c: Client = player) =>
    c.mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key() });
  const sheetOf = async (id: Id<"characters">) => readSheet((await t.run((ctx) => ctx.db.get("characters", id)))!.sheet);
  const edit = async (id: Id<"characters">, patch: Partial<CharacterSheet>) => {
    const s = await sheetOf(id);
    await t.run((ctx) => saveSheet(ctx, id, { ...s, ...patch }));
  };
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const hits = async () => (await t.run((ctx) => ctx.db.query("combatRequests").collect())).filter((r) => r.kind === "incomingHit");
  const targets = (c: Client = player) => c.query(api.combatActionsReads.targets, { campaignId, characterId: w.characterA, mapId, slot: "primary" });
  const contest = (c: Client, instigator: { characterId: Id<"characters">; trait: "agility" | "presence" | "instinct"; modifier: number }, target: typeof instigator) =>
    c.mutation(api.combatActions.contest, { campaignId, instigator, target, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, player, ...ids, attack, sheetOf, edit, rows, hits, targets, contest };
}

describe("pure helpers", () => {
  it("conflictEdge: a named PC's conditions give the roll its edge only when the attack names no adversary and the PCs agree", () => {
    expect(conflictEdge([["vulnerable"]], 0)).toEqual({ advantage: 1, disadvantage: 0 });
    expect(conflictEdge([["hidden"]], 0)).toEqual({ advantage: 0, disadvantage: 1 });
    expect(conflictEdge([["vulnerable"]], 0, "manual")).toEqual({ advantage: 0, disadvantage: 0 });
    expect(conflictEdge([["vulnerable"]], 1)).toEqual({ advantage: 0, disadvantage: 0 });
    expect(conflictEdge([["vulnerable"], []], 0)).toEqual({ advantage: 0, disadvantage: 0 });
    expect(conflictEdge([], 0)).toEqual({ advantage: 0, disadvantage: 0 });
  });

  it("conflictRows: enemies and PCs from the hints, in reach first; no line of sight is los (Manual: pickable, flagged)", () => {
    const bands = new Map([
      ["e", { band: "close" as const, side: "enemy" as const, name: "Bandit" }],
      ["p", { band: "melee" as const, side: "pc" as const, name: "Bryn" }],
      ["n", { band: "melee" as const, side: "neutral" as const, name: "Cart" }],
      ["s", { band: "far" as const, side: "pc" as const, name: "Sly" }],
    ]);
    const hint = (tokenId: string, inRange: boolean, lineOfSight = true) => ({ tokenId: tokenId as Id<"combatTokens">, band: "close" as const, inRange, lineOfSight, cover: false });
    const hints = [hint("e", false), hint("p", true), hint("n", true), hint("s", true, false)];
    expect(conflictRows(bands, hints).map((r) => [r.name, r.side, r.reach])).toEqual([
      ["Bryn", "pc", "in"],
      ["Bandit", "enemy", "out"],
      ["Sly", "pc", "los"],
    ]);
    const manual = conflictRows(bands, hints, "manual").find((r) => r.name === "Sly")!;
    expect([manual.reach, manual.noLineOfSight]).toEqual(["in", true]);
  });
});

describe("off (default): PCs can't attack PCs", () => {
  it("another PC's token is COMBAT_TARGET_INVALID with nothing written, and the target list has no PC", async () => {
    const a = await arena(false);
    expect(await code(a.attack([a.bryn]))).toBe("COMBAT_TARGET_INVALID");
    expect(await a.rows()).toEqual([]);
    expect((await a.targets()).map((h) => h.tokenId)).not.toContain(a.bryn);
  });

  it("contest refuses with MECHANIC_DISABLED", async () => {
    const a = await arena(false);
    expect(await code(a.contest(a.gm, { characterId: a.w.characterA, trait: "presence", modifier: 0 }, { characterId: a.w.characterB, trait: "instinct", modifier: 0 }))).toBe("MECHANIC_DISABLED");
  });
});

describe("on: an attack against another PC's Evasion (CB p.168)", () => {
  it("the target list holds the other PC; a hit opens their incoming-hit window with the attack's total, and their answer marks the damage", async () => {
    dice(12, 3, 4);
    const a = await arena(true);
    expect((await a.targets()).find((h) => h.tokenId === a.bryn)).toMatchObject({ inRange: true, lineOfSight: true });
    const evasion = pcCombatant("bryn", await a.sheetOf(a.w.characterB)).evasion!;
    const r = resolved(await a.attack([a.bryn]));
    diceInRange(r.roll);
    expect(r.roll.total).toBeGreaterThanOrEqual(evasion);
    expect(r.targets).toEqual([{ tokenId: a.bryn, hit: true, defeated: false }]);
    expect(r.damage).not.toBeNull();
    diceInRange(r.damage!);
    const row = (await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!;
    expect(row.summary).toContain("Bryn: Hit");
    const [hit] = await a.hits();
    expect(hit).toBeDefined();
    const p = hit!.payload;
    if (p.kind !== "incomingHit") throw new Error("not a hit");
    expect(p.targetCharacterId).toBe(a.w.characterB);
    expect(p.attacker).toMatchObject({ kind: "pc", characterId: a.w.characterA, label: "Ash" });
    expect(p.attackTotal).toBe(r.roll.total);
    expect(p.damage).toBe(r.damage!.total);
    expect(p.groupId).toBe(row.groupId);
    expect(hit!.encounterId).toBeUndefined();
    // The defender answers the window (CB p.113: armor or not); no Armor Slot here, so the hit marks its Hit Points.
    const before = (await a.sheetOf(a.w.characterB)).hp;
    await a.w.as("otherPlayer").mutation(api.adversaryActions.respond, { campaignId: a.campaignId, requestId: hit!._id, characterId: a.w.characterB, choice: { kind: "noArmor" }, idempotencyKey: key() });
    expect((await a.sheetOf(a.w.characterB)).hp).toBeGreaterThan(before);
  });

  it("a roll under the defender's Evasion misses: no damage, no window, the GM line names the Evasion", async () => {
    dice(1, 2);
    const a = await arena(true);
    const evasion = pcCombatant("bryn", await a.sheetOf(a.w.characterB)).evasion!;
    const r = resolved(await a.attack([a.bryn]));
    diceInRange(r.roll);
    expect(r.roll.total).toBeLessThan(evasion);
    expect(r.targets).toEqual([{ tokenId: a.bryn, hit: false, defeated: false }]);
    expect(r.damage).toBeNull();
    expect(await a.hits()).toEqual([]);
    const gmRow = (await a.rows()).find((x) => x.visibility === "gm" && x.kind === "combat")!;
    expect(gmRow.summary).toContain(`Bryn: miss (${r.roll.total} vs Evasion ${evasion})`);
  });

  it("a Vulnerable defender gives the roll an advantage die (C1, CB p.102, as for an adversary)", async () => {
    dice(12, 3, 4);
    const a = await arena(true);
    await a.edit(a.w.characterB, { conditions: ["vulnerable"] });
    const r = resolved(await a.attack([a.bryn]));
    diceInRange(r.roll);
    expect(r.roll.dice.some((d) => d.role === "advantage")).toBe(true);
  });

  it("in a running encounter the hit joins it; acting again after the GM's spotlight works (handingBack)", async () => {
    dice(12, 3, 4);
    const a = await arena(true, { x: 6, y: 10 }, true);
    resolved(await a.attack([a.bryn]));
    resolved(await a.attack([a.bryn]));
    const hits = await a.hits();
    expect(hits.length).toBe(2);
    expect(hits.every((h) => h.encounterId === undefined || h.encounterId === a.encounterId)).toBe(true);
  });

  it("the attacker's own token, or a PC out of the weapon's range, is refused before anything is rolled", async () => {
    const a = await arena(true, { x: 15, y: 10 });
    expect(await code(a.attack([a.ash]))).toBe("COMBAT_TARGET_INVALID");
    expect(await code(a.attack([a.bryn]))).toBe("COMBAT_TARGET_OUT_OF_RANGE");
    expect(await a.rows()).toEqual([]);
  });
});

describe("on: the GM's Contest (CB p.168)", () => {
  it("the target's reaction total is the instigator's Difficulty; a higher action roll succeeds", async () => {
    dice(5, 4, 10, 3);
    const a = await arena(true);
    const r = await a.contest(a.gm, { characterId: a.w.characterA, trait: "agility", modifier: 0 }, { characterId: a.w.characterB, trait: "instinct", modifier: 0 });
    diceInRange(r.reaction.roll);
    diceInRange(r.action.roll);
    expect(r.reaction.roll.kind).toBe("reaction");
    expect(r.action.roll.kind).toBe("action");
    expect(r.difficulty).toBe(r.reaction.roll.total);
    expect(r.action.roll.difficulty).toBe(r.difficulty);
    expect(r.action.roll.total).toBeGreaterThanOrEqual(r.difficulty);
    expect(r.success).toBe(true);
    const rows = await a.rows();
    const reaction = rows.find((x) => x._id === r.reaction.entryId)!;
    const action = rows.find((x) => x._id === r.action.entryId)!;
    expect([reaction.characterId, reaction.visibility, action.characterId, action.visibility]).toEqual([a.w.characterB, "public", a.w.characterA, "public"]);
    expect(action.summary).toContain(`vs ${r.difficulty}`);
  });

  it("a lower action roll fails", async () => {
    dice(10, 3, 2, 1);
    const a = await arena(true);
    const r = await a.contest(a.gm, { characterId: a.w.characterA, trait: "presence", modifier: 0 }, { characterId: a.w.characterB, trait: "instinct", modifier: 0 });
    diceInRange(r.reaction.roll);
    diceInRange(r.action.roll);
    expect(r.action.roll.total).toBeLessThan(r.difficulty);
    expect(r.success).toBe(false);
  });

  it("one character on both sides is INVALID; a player calling a Contest is FORBIDDEN", async () => {
    const a = await arena(true);
    const side = { characterId: a.w.characterA, trait: "presence" as const, modifier: 0 };
    expect(await code(a.contest(a.gm, side, side))).toBe("INVALID");
    expect(await code(a.contest(a.w.as("player"), side, { ...side, characterId: a.w.characterB }))).toBe("FORBIDDEN");
  });
});
