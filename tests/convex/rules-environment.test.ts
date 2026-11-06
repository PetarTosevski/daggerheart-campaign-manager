/**
 * Plan rule-switches OE (docs/tasks/TASK-RULES-OE.md): the environment on attacks.
 *
 * - M3 `darkness` (CB p.104: "Darkness can also make certain actions more challenging. The GM should reflect this by
 *   raising the Difficulty of action rolls or imposing disadvantage on rolls made by the PCs."). In dim light a PC's
 *   ranged weapon attack gets a disadvantage die ("disadvantage"), +N Difficulty ("difficulty", N = darknessDifficulty)
 *   or both ("both", not in the books); Book and Manual add nothing; a Melee weapon and day light never.
 * - Underwater (optional rule, CB p.168): the GM marks the live map Underwater (`combatScenes.setUnderwater`); attack
 *   rolls get disadvantage unless the attacker's token "fights underwater"; each PC action roll ticks the breath
 *   countdown once, once more on a failure and once more with Fear; once it has ended each PC action roll marks a Stress
 *   (D4 respected); undo takes the tick and the Stress back.
 *
 * Dice: the server's CSPRNG is stubbed (`dice`): Hope 10, Fear 3 (a success with Hope, never a critical), the edge d6
 * shows 4, the weapon's damage die 4; every value stays within its die (`diceInRange`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { underwaterAttackDisadvantage } from "../../convex/lib/adversaryActions";
import { attackEnvironment } from "../../convex/lib/combatActions";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { breathEnded, breathTicks, darknessBadge, darknessEdge, DIM_PHASE_BADGE, underwaterDisadvantage } from "../../src/lib/domain/combat-map/light";
import { WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, key } from "./helpers";

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
function diceInRange(roll: { dice: readonly { role: string; sides: number; value: number }[] }) {
  for (const d of roll.dice) {
    expect(d.value).toBeGreaterThanOrEqual(1);
    expect(d.value).toBeLessThanOrEqual(d.sides);
  }
}

const FAR_WEAPON = WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && w.range === "Far" && !w.classId)!;

type Modes = Partial<{ darkness: "book" | "disadvantage" | "difficulty" | "both" | "manual"; darknessDifficulty: number; underwater: boolean; stressOverflow: "book" | "manual" }>;
const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

/** The world, a live medium map with Ash at (5, 10) looking east, a running encounter, the light and the rule modes. */
async function arena(modes: Modes = {}, options: { light?: "day" | "dim" | "night"; ranged?: boolean } = {}) {
  // A frame without campaign time: the GM's Day / Dim / Night decides the light (the Witherwild starts at a dim Dawn).
  const w = await buildWorld({ frameId: "beast-feast" });
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("campaigns", campaignId, { ruleModes: modes, timeOfDay: options.light ?? "day" });
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, encounterId };
  });
  const sheetOf = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
  const edit = (patch: Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, ...patch });
    });
  if (options.ranged) await edit({ primaryWeaponId: FAR_WEAPON.id });
  const enemy = (difficulty: number, x = 6, y = 10) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label: "Bear",
        order: 0,
        summoned: false,
        stats: { difficulty, major: 100, severe: 200, hpMax: 10, stressMax: 4 },
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
  // The dice restart for each attack (Hope 10, Fear 3, edge d6 4, damage 4), so every attack rolls the same.
  const attack = (targetTokenIds: Id<"combatTokens">[]) =>
    (dice(10, 3, 4, 4), player).mutation(api.combatActions.attack, { campaignId, characterId: w.characterA, mapId, targetTokenIds, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key() });
  const roll = (values: number[], difficulty?: number) =>
    player.mutation(api.rolls.manualRoll, { characterId: w.characterA, values, roll: { ...agility, ...(difficulty !== undefined ? { difficulty } : {}) }, idempotencyKey: key() });
  const setUnderwater = (underwater: boolean, breath?: number) => gm.mutation(api.combatScenes.setUnderwater, { campaignId, mapId, underwater, ...(breath !== undefined ? { breath } : {}), idempotencyKey: key() });
  const breath = async () => {
    const map = await t.run((ctx) => ctx.db.get("combatMaps", mapId));
    return map?.breathCountdownId ? t.run((ctx) => ctx.db.get("countdowns", map.breathCountdownId!)) : null;
  };
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const undo = (entryId: Id<"actionLog">) => gm.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, player, ...ids, sheetOf, edit, enemy, attack, roll, setUnderwater, breath, rows, undo };
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected a resolved attack, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

const edgeDice = (r: { dice: readonly { role: string }[] }) => r.dice.filter((d) => d.role === "disadvantage" || d.role === "advantage").map((d) => d.role);

describe("pure: M3 variants and Underwater", () => {
  it("darknessEdge: only a ranged attack in dim light; per mode; N from the row (default 2)", () => {
    expect(darknessEdge("dim", true)).toEqual({ disadvantage: 0, difficulty: 0 });
    expect(darknessEdge("dim", true, "manual")).toEqual({ disadvantage: 0, difficulty: 0 });
    expect(darknessEdge("dim", true, "disadvantage")).toEqual({ disadvantage: 1, difficulty: 0 });
    expect(darknessEdge("dim", true, "difficulty")).toEqual({ disadvantage: 0, difficulty: 2 });
    expect(darknessEdge("dim", true, "difficulty", 5)).toEqual({ disadvantage: 0, difficulty: 5 });
    expect(darknessEdge("dim", true, "both", 3)).toEqual({ disadvantage: 1, difficulty: 3 });
    expect(darknessEdge("dim", false, "both")).toEqual({ disadvantage: 0, difficulty: 0 });
    expect(darknessEdge("day", true, "both")).toEqual({ disadvantage: 0, difficulty: 0 });
    expect(darknessEdge("night", true, "both")).toEqual({ disadvantage: 0, difficulty: 0 });
  });

  it("darknessBadge names the active mode; none outside dim light or in Manual", () => {
    expect(darknessBadge("dim")).toBe(DIM_PHASE_BADGE);
    expect(darknessBadge("dim", "disadvantage")).toBe("Dim light: ranged attacks roll with disadvantage");
    expect(darknessBadge("dim", "difficulty", 3)).toBe("Dim light: ranged attacks +3 Difficulty");
    expect(darknessBadge("dim", "both")).toBe("Dim light: ranged attacks roll with disadvantage, +2 Difficulty");
    expect(darknessBadge("dim", "manual")).toBeNull();
    expect(darknessBadge("day", "both")).toBeNull();
  });

  it("Underwater: disadvantage unless fighting underwater; breath ticks 1 / 2 / 3; ended at 0 unless paused", () => {
    expect(underwaterDisadvantage(true, false)).toBe(1);
    expect(underwaterDisadvantage(true, true)).toBe(0);
    expect(underwaterDisadvantage(false, false)).toBe(0);
    expect(breathTicks({ success: true, withFear: false })).toBe(1);
    expect(breathTicks({ success: false, withFear: false })).toBe(2);
    expect(breathTicks({ success: true, withFear: true })).toBe(2);
    expect(breathTicks({ success: false, withFear: true })).toBe(3);
    expect(breathEnded({ currentValue: 0, status: "completed" })).toBe(true);
    expect(breathEnded({ currentValue: 0, status: "paused" })).toBe(false);
    expect(breathEnded({ currentValue: 1, status: "active" })).toBe(false);
  });

  it("attackEnvironment and underwaterAttackDisadvantage read the scene, the token and the modes", () => {
    const scene = (underwater: boolean, fights: boolean, light: "day" | "dim" = "dim") => ({ map: { underwater } as never, attacker: { fightsUnderwater: fights } as never, scene: { light } });
    const modes = { darkness: "both" as const, darknessDifficulty: 2, underwater: true };
    expect(attackEnvironment(scene(true, false), { weaponRange: "far" }, modes)).toEqual({ disadvantage: 2, difficulty: 2, labels: ["dim light: disadvantage", "dim light: +2 Difficulty", "underwater: disadvantage"] });
    expect(attackEnvironment(scene(true, true), { weaponRange: "melee" }, modes)).toEqual({ disadvantage: 0, difficulty: 0, labels: [] });
    expect(attackEnvironment(scene(true, false, "day"), { weaponRange: "far" }, { ...modes, underwater: false })).toEqual({ disadvantage: 0, difficulty: 0, labels: [] });
    const on = { frameId: "core", ruleModes: { underwater: true } } as never;
    const adv = (underwater: boolean, fights: boolean) => ({ map: { scene: { map: { underwater } }, selfToken: { fightsUnderwater: fights } } as never });
    expect(underwaterAttackDisadvantage(on, adv(true, false))).toBe(1);
    expect(underwaterAttackDisadvantage(on, adv(true, true))).toBe(0);
    expect(underwaterAttackDisadvantage({ frameId: "core", ruleModes: {} } as never, adv(true, false))).toBe(0);
    expect(underwaterAttackDisadvantage(on, { map: null })).toBe(0);
  });
});

describe("M3 darkness on a PC's weapon attack (CB p.104)", () => {
  it("Book (default): no die and no Difficulty in dim light; the attack hits as by day", async () => {
    dice(10, 3, 4, 4);
    const a = await arena({}, { light: "dim", ranged: true });
    const bear = await a.enemy(1, 12, 10);
    const r = resolved(await a.attack([bear]));
    diceInRange(r.roll);
    expect(edgeDice(r.roll)).toEqual([]);
    expect(r.targets[0]!.hit).toBe(true);
  });

  it("disadvantage: a ranged attack in dim light rolls a disadvantage die (and names it); a Melee one does not; day light does not", async () => {
    dice(10, 3, 4, 4);
    const a = await arena({ darkness: "disadvantage" }, { light: "dim", ranged: true });
    const bear = await a.enemy(1, 12, 10);
    const r = resolved(await a.attack([bear]));
    diceInRange(r.roll);
    expect(edgeDice(r.roll)).toEqual(["disadvantage"]);
    expect((await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!.summary).toContain("dim light: disadvantage");

    const melee = await arena({ darkness: "both" }, { light: "dim" });
    const near = await melee.enemy(1);
    const m = resolved(await melee.attack([near]));
    diceInRange(m.roll);
    expect(edgeDice(m.roll)).toEqual([]);

    const day = await arena({ darkness: "both" }, { light: "day", ranged: true });
    const far = await day.enemy(1, 12, 10);
    expect(edgeDice(resolved(await day.attack([far])).roll)).toEqual([]);
  });

  it("difficulty: N (the row's number) is added to the target's Difficulty: a target the Book roll beats by 1 is missed at +2", async () => {
    dice(10, 3, 4, 4);
    const book = await arena({}, { light: "dim", ranged: true });
    const probe = resolved(await book.attack([await book.enemy(1, 12, 10)]));
    const total = probe.roll.total;
    expect(resolved(await book.attack([await book.enemy(total - 1, 12, 11)])).targets[0]!.hit).toBe(true);

    const a = await arena({ darkness: "difficulty", darknessDifficulty: 2 }, { light: "dim", ranged: true });
    const r = resolved(await a.attack([await a.enemy(total - 1, 12, 10)]));
    diceInRange(r.roll);
    expect(r.roll.total).toBe(total);
    expect(edgeDice(r.roll)).toEqual([]);
    expect(r.targets[0]!.hit).toBe(false);
    expect(resolved(await a.attack([await a.enemy(total - 2, 12, 11)])).targets[0]!.hit).toBe(true);
  });

  it("both: the disadvantage die and the raised Difficulty; Manual: neither", async () => {
    dice(10, 3, 4, 4);
    const both = await arena({ darkness: "both", darknessDifficulty: 1 }, { light: "dim", ranged: true });
    const r = resolved(await both.attack([await both.enemy(1, 12, 10)]));
    diceInRange(r.roll);
    expect(edgeDice(r.roll)).toEqual(["disadvantage"]);
    expect((await both.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!.summary).toContain("dim light: +1 Difficulty");

    const manual = await arena({ darkness: "manual" }, { light: "dim", ranged: true });
    const m = resolved(await manual.attack([await manual.enemy(1, 12, 10)]));
    expect(edgeDice(m.roll)).toEqual([]);
    expect((await manual.rows()).some((x) => x.kind === "rule")).toBe(false);
  });
});

describe("Underwater (optional rule, CB p.168)", () => {
  it("off: setUnderwater and setFightsUnderwater are MECHANIC_DISABLED; a player is FORBIDDEN; a start under 3 is INVALID", async () => {
    const off = await arena();
    expect(await code(off.setUnderwater(true))).toBe("MECHANIC_DISABLED");
    expect(await code(off.gm.mutation(api.combatScenes.setFightsUnderwater, { campaignId: off.campaignId, tokenId: off.ash, fightsUnderwater: true, idempotencyKey: key() }))).toBe("MECHANIC_DISABLED");
    const on = await arena({ underwater: true });
    expect(await code(on.player.mutation(api.combatScenes.setUnderwater, { campaignId: on.campaignId, mapId: on.mapId, underwater: true, idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await code(on.setUnderwater(true, 2))).toBe("INVALID");
  });

  it("on: marks the map, creates a public unarmed Breath countdown (start 3); off cancels it; the HUD reads both", async () => {
    const a = await arena({ underwater: true });
    const { breathCountdownId } = await a.setUnderwater(true);
    const c = (await a.breath())!;
    expect(c._id).toBe(breathCountdownId);
    expect([c.name, c.startingValue, c.currentValue, c.status, c.armed, c.visibility]).toEqual(["Breath", 3, 3, "active", undefined, undefined]);
    const env = await a.player.query(api.combatScenes.environment, { campaignId: a.campaignId });
    expect(env).toMatchObject({ underwaterRule: true, underwater: true, breath: { current: 3, start: 3 }, canEdit: false, creatures: [] });
    const gmEnv = await a.gm.query(api.combatScenes.environment, { campaignId: a.campaignId });
    expect(gmEnv.canEdit).toBe(true);
    expect(gmEnv.creatures.map((x) => x.name)).toEqual(["Ash"]);
    await a.setUnderwater(true, 5);
    expect([(await a.t.run((ctx) => ctx.db.get("countdowns", breathCountdownId!)))!.startingValue]).toEqual([5]);
    await a.setUnderwater(false);
    expect((await a.t.run((ctx) => ctx.db.get("countdowns", breathCountdownId!)))!.status).toBe("cancelled");
    expect((await a.t.run((ctx) => ctx.db.get("combatMaps", a.mapId)))!.underwater).toBeUndefined();
    expect((await a.player.query(api.combatScenes.environment, { campaignId: a.campaignId })).underwater).toBe(false);
  });

  it("an attack underwater rolls a disadvantage die, unless the attacker's token fights underwater", async () => {
    dice(10, 3, 4, 4);
    const a = await arena({ underwater: true });
    await a.setUnderwater(true);
    const bear = await a.enemy(1);
    const r = resolved(await a.attack([bear]));
    diceInRange(r.roll);
    expect(edgeDice(r.roll)).toEqual(["disadvantage"]);
    await a.gm.mutation(api.combatScenes.setFightsUnderwater, { campaignId: a.campaignId, tokenId: a.ash, fightsUnderwater: true, idempotencyKey: key() });
    expect(edgeDice(resolved(await a.attack([bear])).roll)).toEqual([]);
  });

  it("each PC action roll ticks breath (1, +1 failure, +1 Fear); at 0 each action marks a Stress; undo takes both back", async () => {
    const a = await arena({ underwater: true });
    await a.setUnderwater(true, 5);
    await a.edit({ stress: 0 });
    await a.roll([10, 3], 5); // success with Hope: 1
    expect((await a.breath())!.currentValue).toBe(4);
    await a.roll([3, 10], 30); // failure with Fear: 3
    expect((await a.breath())!.currentValue).toBe(1);
    expect((await a.sheetOf()).stress).toBe(0);
    await a.roll([10, 3], 30); // failure with Hope: 2, clamps at 0 and ends
    const ended = (await a.breath())!;
    expect([ended.currentValue, ended.status]).toEqual([0, "completed"]);
    expect((await a.sheetOf()).stress).toBe(0);
    const out = await a.roll([10, 3], 5);
    expect((await a.sheetOf()).stress).toBe(1);
    const row = (await a.rows()).find((r) => r.summary.includes("out of breath"))!;
    expect([row.visibility, row.characterId, row.groupId !== undefined]).toEqual(["public", a.w.characterA, true]);
    await a.undo(out.entryId);
    expect((await a.sheetOf()).stress).toBe(0);
  });

  it("undo of a roll takes its breath tick back; a reaction roll never ticks; a PC off the map never ticks", async () => {
    const a = await arena({ underwater: true });
    await a.setUnderwater(true);
    const r = await a.roll([10, 3], 5);
    expect((await a.breath())!.currentValue).toBe(2);
    await a.undo(r.entryId);
    expect((await a.breath())!.currentValue).toBe(3);
    await a.player.mutation(api.rolls.manualRoll, { characterId: a.w.characterA, values: [10, 3], roll: { ...agility, kind: "reaction", difficulty: 5 }, idempotencyKey: key() });
    expect((await a.breath())!.currentValue).toBe(3);
    await a.t.run((ctx) => ctx.db.delete("combatTokens", a.ash));
    await a.roll([10, 3], 5);
    expect((await a.breath())!.currentValue).toBe(3);
  });

  it("D4 Manual: a full Stress track marks no HP at 0 breath; the GM gets the overflow note", async () => {
    const a = await arena({ underwater: true, stressOverflow: "manual" });
    await a.setUnderwater(true);
    await a.t.run(async (ctx) => {
      const map = (await ctx.db.get("combatMaps", a.mapId))!;
      await ctx.db.patch("countdowns", map.breathCountdownId!, { currentValue: 0, status: "completed" });
    });
    const s = await a.sheetOf();
    await a.edit({ stress: s.stressMax });
    const hp = (await a.sheetOf()).hp;
    await a.roll([10, 3], 5);
    expect((await a.sheetOf()).hp).toBe(hp);
    expect((await a.rows()).filter((r) => r.kind === "rule").map((r) => [r.ruleId, r.summary])).toEqual([["stressOverflow", "Ash: Stress full, mark 1 HP?"]]);
  });
});
