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
import { rollEnvironment, rollText } from "../../convex/lib/cardRows";
import { attackEnvironment } from "../../convex/lib/combatActions";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { breathEnded, breathTicks, darknessBadge, darknessEdge, darknessLabels, DIM_PHASE_BADGE, underwaterDisadvantage } from "../../src/lib/domain/combat-map/light";
import type { CardEffect, CardUse } from "../../src/lib/domain/card-effects/types";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { errorCode, handingBack, key } from "./helpers";

// Plan OE2: a card attack and a subclass feature attack with the same use (Agility against the target's Difficulty, 1d8).
const injected = vi.hoisted(() => ({ cards: new Map<string, unknown>(), features: new Map<string, unknown>() }));
vi.mock("../../src/lib/srd/card-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/card-effects/index")>();
  return { ...real, cardEffect: (id: string) => (injected.cards.get(id) as CardEffect | undefined) ?? real.cardEffect(id) };
});
vi.mock("../../src/lib/srd/feature-effects/index", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/srd/feature-effects/index")>();
  return { ...real, featureEffect: (id: string) => (injected.features.get(id) as FeatureEffect | undefined) ?? real.featureEffect(id) };
});
const STRIKE: CardUse = {
  id: "strike",
  name: "Strike",
  activation: { kind: "action" as const },
  roll: { kind: "trait" as const, trait: "agility" as const, difficulty: { kind: "target" as const }, attack: true },
  targets: { side: "enemy" as const, range: "far" as const, count: { kind: "one" as const } },
  steps: [{ kind: "damage" as const, to: "targets" as const, when: ["hit" as const], roll: { kind: "dice" as const, dice: { count: { kind: "fixed" as const, value: 1 }, sides: 8 } }, type: "physical" }],
};
/** A card action roll against the GM's Difficulty (no target): not an attack. */
const SEARCH: CardUse = {
  id: "search",
  name: "Search",
  activation: { kind: "action" as const },
  roll: { kind: "trait" as const, trait: "instinct" as const, difficulty: { kind: "gm" as const } },
  targets: { side: "self" as const, range: "melee" as const, count: { kind: "one" as const } },
  steps: [],
};
const ABILITY = "deft-maneuvers";
const FEATURE_ID = "subclass:call-of-the-brave:battle-ritual";
injected.cards.set(ABILITY, { cardId: ABILITY, uses: [STRIKE, SEARCH] } satisfies CardEffect);
injected.features.set(FEATURE_ID, { featureId: FEATURE_ID, source: "subclass", owner: "call-of-the-brave", card: "foundation", uses: [STRIKE] } satisfies FeatureEffect);

allowWorldEmails();
afterEach(() => vi.restoreAllMocks());
// A card use loads the whole card and feature runner; on a loaded host that takes longer than the default 15 s.
vi.setConfig({ testTimeout: 60_000 });

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
async function arena(modes: Modes = {}, options: { light?: "day" | "dim" | "night"; ranged?: boolean; cards?: boolean } = {}) {
  // A frame without campaign time: the GM's Day / Dim / Night decides the light (the Witherwild starts at a dim Dawn).
  const w = await buildWorld({ frameId: "beast-feast" });
  const { t, campaignId } = w;
  const gm = w.as("gm");
  // RS2: players wait while the GM holds the spotlight in a running encounter; these tests are about the environment.
  const player = handingBack(w.as("player"), gm, campaignId);
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
  if (options.cards) await edit({ classId: "warrior", subclassId: "call-of-the-brave", subclassRank: "foundation", domainCards: { owned: [ABILITY], loadout: [ABILITY] } } as Partial<CharacterSheet>);
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
  // Plan OE2: a card or feature use (the dice restart: Hope 10, Fear 3, an edge d6 4 when the roll has one, the d8 4).
  const card = async (spell: "strike" | "search", targetTokenIds: Id<"combatTokens">[], roll: { difficulty?: number } = {}) => {
    dice(10, 3, 4, 4);
    const r = await player.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId: ABILITY, spell, targetTokenIds, choices: [], roll, idempotencyKey: key() });
    if (r.status !== "resolved") throw new Error(`expected a resolved card use, got ${r.status}`);
    return r;
  };
  const feature = async (targetTokenIds: Id<"combatTokens">[]) => {
    dice(10, 3, 4, 4);
    const r = await player.mutation(api.combatFeatures.useFeature, { campaignId, characterId: w.characterA, mapId, featureId: FEATURE_ID, useId: "strike", targetTokenIds, choices: [], idempotencyKey: key() });
    if (r.status !== "resolved") throw new Error(`expected a resolved feature use, got ${r.status}`);
    return r;
  };
  const setBreathes = (tokenId: Id<"combatTokens">, breathesUnderwater: boolean, as = gm) => as.mutation(api.combatScenes.setBreathesUnderwater, { campaignId, tokenId, breathesUnderwater, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, player, ...ids, sheetOf, edit, enemy, attack, roll, setUnderwater, breath, rows, undo, card, feature, setBreathes };
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected a resolved attack, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

const edgeDice = (r: { dice: readonly { role: string }[] }) => r.dice.filter((d) => d.role === "disadvantage" || d.role === "advantage").map((d) => d.role);

describe("pure: M3 variants and Underwater", () => {
  it("darknessEdge: only in dim light; per mode; N from the row (default 2)", () => {
    expect(darknessEdge("dim")).toEqual({ disadvantage: 0, difficulty: 0 });
    expect(darknessEdge("dim", "manual")).toEqual({ disadvantage: 0, difficulty: 0 });
    expect(darknessEdge("dim", "disadvantage")).toEqual({ disadvantage: 1, difficulty: 0 });
    expect(darknessEdge("dim", "difficulty")).toEqual({ disadvantage: 0, difficulty: 2 });
    expect(darknessEdge("dim", "difficulty", 5)).toEqual({ disadvantage: 0, difficulty: 5 });
    expect(darknessEdge("dim", "both", 3)).toEqual({ disadvantage: 1, difficulty: 3 });
    expect(darknessEdge("day", "both")).toEqual({ disadvantage: 0, difficulty: 0 });
    expect(darknessEdge("night", "both")).toEqual({ disadvantage: 0, difficulty: 0 });
    expect(darknessLabels({ disadvantage: 1, difficulty: 2 })).toEqual(["dim light: disadvantage", "dim light: +2 Difficulty"]);
    expect(darknessLabels({ disadvantage: 0, difficulty: 0 })).toEqual([]);
  });

  it("darknessBadge names the active mode (every action roll, OE2); none outside dim light or in Manual", () => {
    expect(darknessBadge("dim")).toBe(DIM_PHASE_BADGE);
    expect(darknessBadge("dim", "disadvantage")).toBe("Dim light: action rolls with disadvantage");
    expect(darknessBadge("dim", "difficulty", 3)).toBe("Dim light: action rolls +3 Difficulty");
    expect(darknessBadge("dim", "both")).toBe("Dim light: action rolls with disadvantage, +2 Difficulty");
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
    expect(attackEnvironment(scene(true, false), modes)).toEqual({ disadvantage: 2, difficulty: 2, labels: ["dim light: disadvantage", "dim light: +2 Difficulty", "underwater: disadvantage"] });
    expect(attackEnvironment(scene(true, true), modes)).toEqual({ disadvantage: 1, difficulty: 2, labels: ["dim light: disadvantage", "dim light: +2 Difficulty"] });
    expect(attackEnvironment(scene(true, true, "day"), modes)).toEqual({ disadvantage: 0, difficulty: 0, labels: [] });
    expect(attackEnvironment(scene(true, false, "day"), { ...modes, underwater: false })).toEqual({ disadvantage: 0, difficulty: 0, labels: [] });
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

  it("disadvantage: an attack in dim light rolls a disadvantage die (and names it), a Melee one too (OE2); day light does not", async () => {
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
    expect(edgeDice(m.roll)).toEqual(["disadvantage"]);

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

// ---------------------------------------------------------------- plan rule-switches OE2

describe("OE2: M3 darkness on every PC action roll with a Difficulty (user 2026-11-06)", () => {
  it("dice box: disadvantage adds a typed-in disadvantage die and names it; no Difficulty, a reaction roll, Book or day light add none", async () => {
    const a = await arena({ darkness: "disadvantage" }, { light: "dim" });
    const r = await a.roll([10, 3, 4], 5);
    diceInRange(r.roll);
    expect(edgeDice(r.roll)).toEqual(["disadvantage"]);
    expect(r.roll.difficulty).toBe(5);
    expect((await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!.summary).toContain("dim light: disadvantage");
    // No Difficulty: nothing to raise, no die (the manual roll would refuse a value left over).
    expect(edgeDice((await a.roll([10, 3])).roll)).toEqual([]);
    const reaction = await a.player.mutation(api.rolls.manualRoll, { characterId: a.w.characterA, values: [10, 3], roll: { ...agility, kind: "reaction", difficulty: 5 }, idempotencyKey: key() });
    expect(edgeDice(reaction.roll)).toEqual([]);

    const book = await arena({}, { light: "dim" });
    expect(edgeDice((await book.roll([10, 3], 5)).roll)).toEqual([]);
    const day = await arena({ darkness: "both" }, { light: "day" });
    const d = await day.roll([10, 3], 5);
    expect([edgeDice(d.roll), d.roll.difficulty]).toEqual([[], 5]);
  });

  it("dice box: difficulty raises the roll's Difficulty by N (a roll that beat 13 fails against 13 + 3); both adds the die too", async () => {
    const a = await arena({ darkness: "difficulty", darknessDifficulty: 3 }, { light: "dim" });
    const probe = await (await arena({}, { light: "dim" })).roll([10, 3], 1);
    const total = probe.roll.total;
    const r = await a.roll([10, 3], total);
    diceInRange(r.roll);
    expect([r.roll.total, r.roll.difficulty, r.roll.outcome]).toEqual([total, total + 3, "failHope"]);
    expect((await a.t.run((ctx) => ctx.db.get("actionLog", r.entryId)))!.summary).toContain("dim light: +3 Difficulty");

    const both = await arena({ darkness: "both", darknessDifficulty: 1 }, { light: "dim" });
    const b = await both.roll([10, 3, 4], 5);
    diceInRange(b.roll);
    expect([edgeDice(b.roll), b.roll.difficulty]).toEqual([["disadvantage"], 6]);
  });

  it("Tag Team with a Difficulty: both PCs' rolls get the variant", async () => {
    const a = await arena({ darkness: "both", darknessDifficulty: 2 }, { light: "dim" });
    await a.edit({ hope: 3 });
    dice(10, 3, 4);
    const out = await a.player.mutation(api.rolls.tagTeam, { characterId: a.w.characterA, partnerId: a.w.characterB, difficulty: 10, initiator: { trait: "agility", modifier: 0 }, partner: { trait: "agility", modifier: 0 }, idempotencyKey: key() });
    expect(out.rolls).toHaveLength(2);
    for (const r of out.rolls) {
      diceInRange(r.roll);
      expect([edgeDice(r.roll), r.roll.difficulty]).toEqual([["disadvantage"], 12]);
    }
  });

  it("card and feature attacks: the disadvantage die in dim light; difficulty raises the target's Difficulty", async () => {
    const a = await arena({ darkness: "disadvantage" }, { light: "dim", cards: true });
    const bear = await a.enemy(1);
    const c = await a.card("strike", [bear]);
    diceInRange(c.roll!);
    expect(edgeDice(c.roll!)).toEqual(["disadvantage"]);
    const f = await a.feature([bear]);
    diceInRange(f.roll!);
    expect(edgeDice(f.roll!)).toEqual(["disadvantage"]);

    const book = await arena({}, { light: "dim", cards: true });
    const probe = await book.card("strike", [await book.enemy(1)]);
    expect(edgeDice(probe.roll!)).toEqual([]);
    const total = probe.roll!.total;
    expect((await book.card("strike", [await book.enemy(total - 1, 6, 11)])).success).toBe(true);
    const raised = await arena({ darkness: "difficulty", darknessDifficulty: 2 }, { light: "dim", cards: true });
    const miss = await raised.card("strike", [await raised.enemy(total - 1)]);
    diceInRange(miss.roll!);
    expect([miss.roll!.total, miss.success]).toEqual([total, false]);
    expect((await raised.card("strike", [await raised.enemy(total - 2, 6, 11)])).success).toBe(true);
  });

  it("a card's action roll against the GM's Difficulty gets it too; without a Difficulty it gets none", async () => {
    const a = await arena({ darkness: "both", darknessDifficulty: 2 }, { light: "dim", cards: true });
    const r = await a.card("search", [], { difficulty: 5 });
    diceInRange(r.roll!);
    expect([edgeDice(r.roll!), r.roll!.difficulty]).toEqual([["disadvantage"], 7]);
    const none = await a.card("search", []);
    expect(edgeDice(none.roll!)).toEqual([]);
  });
});

describe("OE2: Underwater on card and feature attacks; 'breathes underwater'", () => {
  it("a card or feature attack underwater rolls a disadvantage die, unless the actor's token fights underwater", async () => {
    const a = await arena({ underwater: true }, { cards: true });
    await a.setUnderwater(true);
    const bear = await a.enemy(1);
    const c = await a.card("strike", [bear]);
    diceInRange(c.roll!);
    expect(edgeDice(c.roll!)).toEqual(["disadvantage"]);
    expect(edgeDice((await a.feature([bear])).roll!)).toEqual(["disadvantage"]);
    // A non-attack card roll gets no Underwater disadvantage.
    expect(edgeDice((await a.card("search", [], { difficulty: 5 })).roll!)).toEqual([]);
    await a.gm.mutation(api.combatScenes.setFightsUnderwater, { campaignId: a.campaignId, tokenId: a.ash, fightsUnderwater: true, idempotencyKey: key() });
    expect(edgeDice((await a.card("strike", [bear])).roll!)).toEqual([]);
  });

  it("setBreathesUnderwater: MECHANIC_DISABLED while off, FORBIDDEN for a player, INVALID on an adversary's token; the GM's list shows it", async () => {
    const off = await arena();
    expect(await code(off.setBreathes(off.ash, true))).toBe("MECHANIC_DISABLED");
    const a = await arena({ underwater: true });
    expect(await code(a.setBreathes(a.ash, true, a.player))).toBe("FORBIDDEN");
    const bear = await a.enemy(1);
    expect(await code(a.setBreathes(bear, true))).toBe("INVALID");
    await a.setBreathes(a.ash, true);
    const env = await a.gm.query(api.combatScenes.environment, { campaignId: a.campaignId });
    expect(env.creatures.map((c) => [c.name, c.pc, c.breathesUnderwater])).toEqual([
      ["Ash", true, true],
      ["Bear", false, false],
    ]);
    await a.setBreathes(a.ash, false);
    expect((await a.t.run((ctx) => ctx.db.get("combatTokens", a.ash)))!.breathesUnderwater).toBeUndefined();
  });

  it("a PC who breathes underwater ticks no breath and marks no Stress at 0; unmarked, the tick comes back", async () => {
    const a = await arena({ underwater: true });
    await a.setUnderwater(true);
    await a.setBreathes(a.ash, true);
    await a.edit({ stress: 0 });
    await a.roll([3, 10], 30); // failure with Fear: would tick 3
    expect((await a.breath())!.currentValue).toBe(3);
    await a.t.run(async (ctx) => {
      const map = (await ctx.db.get("combatMaps", a.mapId))!;
      await ctx.db.patch("countdowns", map.breathCountdownId!, { currentValue: 0, status: "completed" });
    });
    await a.roll([10, 3], 5);
    expect((await a.sheetOf()).stress).toBe(0);
    expect((await a.rows()).some((r) => r.summary.includes("out of breath"))).toBe(false);
    await a.setBreathes(a.ash, false);
    await a.roll([10, 3], 5);
    expect((await a.sheetOf()).stress).toBe(1);
  });
});

/**
 * ODR3 (OE2's notes 1 and 2): card and feature roll lines name what the environment added, as the dice box's do
 * (`rollText` with `rollEnvironment`); the Cloaked move's Finesse roll (DA18) gets M3's variant in the campaign's dim
 * light (CB p.104: "raising the Difficulty of action rolls or imposing disadvantage on rolls made by the PCs").
 */
describe("ODR3: roll lines name the environment; the Cloaked roll in dim light", () => {
  const built = (darkness: { disadvantage: number; difficulty: number } | undefined, map: { underwater?: boolean } | null, fights = false, gmDifficulty?: number) =>
    ({
      context: { ...(darkness ? { darkness } : {}), ...(gmDifficulty !== undefined ? { roll: { difficulty: gmDifficulty } } : {}) },
      creatures: map === null ? { onMap: false } : { onMap: true, scene: { map, attacker: { fightsUnderwater: fights } } },
    }) as never;
  const record = { kind: "action" as const, dice: [], modifier: 0, total: 12, outcome: "successFear" as const, manual: false };

  it("rollEnvironment: dim light on a roll with a Difficulty, underwater on an attack (unless fighting underwater); rollText appends them", () => {
    const dark = { disadvantage: 1, difficulty: 2 };
    expect(rollEnvironment(built(dark, { underwater: true }), STRIKE, true)).toEqual(["dim light: disadvantage", "dim light: +2 Difficulty", "underwater: disadvantage"]);
    expect(rollEnvironment(built(dark, { underwater: true }, true), STRIKE, true)).toEqual(["dim light: disadvantage", "dim light: +2 Difficulty"]);
    expect(rollEnvironment(built(undefined, { underwater: true }), STRIKE, false)).toEqual([]);
    // A GM-Difficulty roll: dim light only with a Difficulty set; never underwater (not an attack).
    expect(rollEnvironment(built(dark, { underwater: true }, false, 5), SEARCH, true)).toEqual(["dim light: disadvantage", "dim light: +2 Difficulty"]);
    expect(rollEnvironment(built(dark, { underwater: true }), SEARCH, true)).toEqual([]);
    expect(rollEnvironment(built(dark, null), STRIKE, true)).toEqual(["dim light: disadvantage", "dim light: +2 Difficulty"]);
    expect(rollText(STRIKE, record, undefined)).toBe("Agility 12 with Fear");
    expect(rollText(STRIKE, record, undefined, ["dim light: disadvantage", "underwater: disadvantage"])).toBe("Agility 12 with Fear (dim light: disadvantage, underwater: disadvantage)");
  });

  /** A Cloaked rogue (Finesse +1) at (2, 10) in the Witherwild's Nautical Twilight (dim light), a Bear far off in line. */
  async function cloakArena(modes: Modes) {
    const w = await buildWorld();
    const { t, campaignId } = w;
    const gm = w.as("gm");
    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
    const now = Date.now();
    const ash = await t.run(async (ctx) => {
      await ctx.db.patch("campaigns", campaignId, { ruleModes: modes });
      await ctx.db.patch("combatMaps", mapId, { live: true });
      const time = await ctx.db
        .query("campaignTime")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .unique();
      if (time === null) await ctx.db.insert("campaignTime", { campaignId, week: 1, cycle: "DAY", cycleDay: 7 });
      else await ctx.db.patch("campaignTime", time._id, { cycle: "DAY", cycleDay: 7 });
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      await saveSheet(ctx, w.characterA, { ...s, classId: "rogue", conditions: ["cloaked"], traits: { ...s.traits, finesse: 1 }, hope: 2, stress: 0 });
      const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
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
      await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x: 20, y: 10, face: Math.PI });
      return ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 2, y: 10, face: 0 });
    });
    await w.as("player").mutation(api.combatTokens.move, { campaignId, tokenId: ash, x: 4, y: 10 });
    const rows = await t.run((ctx) => ctx.db.query("actionLog").collect());
    const roll = rows.find((r) => r.kind === "roll" && r.summary.includes("Finesse"))!;
    const gmRow = rows.find((r) => r.visibility === "gm" && r.groupId === roll.groupId && r.summary.includes("Finesse"))!;
    return { roll, gmRow };
  }

  it("Book: no die, Difficulty 10; disadvantage: a disadvantage die, named; difficulty: Difficulty 12, named", async () => {
    dice(5, 2, 3);
    const book = await cloakArena({});
    diceInRange(book.roll.roll!);
    expect(edgeDice(book.roll.roll!)).toEqual([]);
    expect(book.roll.summary).not.toContain("(dim light");
    expect(book.gmRow.summary).toContain("Difficulty 10");

    dice(5, 2, 3);
    const dis = await cloakArena({ darkness: "disadvantage" });
    diceInRange(dis.roll.roll!);
    expect(edgeDice(dis.roll.roll!)).toEqual(["disadvantage"]);
    expect(dis.roll.summary).toContain("(dim light: disadvantage)");

    dice(5, 2, 3);
    const raised = await cloakArena({ darkness: "difficulty", darknessDifficulty: 2 });
    expect(edgeDice(raised.roll.roll!)).toEqual([]);
    expect(raised.roll.summary).toContain("(dim light: +2 Difficulty)");
    expect(raised.gmRow.summary).toContain("Difficulty 12");
    expect(raised.roll.roll!.difficulty).toBeUndefined();
  });
});
