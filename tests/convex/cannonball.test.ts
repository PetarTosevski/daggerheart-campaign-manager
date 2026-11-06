/**
 * Cannonball through Convex (plan drawer-answers DA13; docs/tasks/TASK-DA-DA13.md; beads dcm-bxp.99.19.21, .5).
 *
 * Expected values come from the book and the user's answers:
 * - CB p.33, Armored Sentry, Cannonball: "Mark a Stress to allow an ally to throw or launch you at an adversary. To do so,
 *   the ally makes an attack roll using Agility or Strength (their choice) against a target within Close range. On a
 *   success, the adversary takes d12+2 physical damage using the thrower's Proficiency. You can spend a Hope to target an
 *   additional adversary within Very Close range of the first. The second target takes half the damage dealt to the first
 *   target."
 * - User 2026-10-30: the druid marks the Stress and is thrown; the THROWING ally gets the prompt in their drawer and rolls;
 *   d12+2 with the ally's Proficiency; the roll's Hope / Fear and a critical are the ally's.
 * - CB p.90: a success with Hope gains a Hope; a roll with Fear gives the GM a Fear; a critical also clears a Stress, and
 *   its damage adds the dice's maximum (CB p.97). CB p.107: round half up.
 * - CB p.103: Very Close 3 squares, Close 6. Damage at or above Major (5) and below Severe (10) marks 2 HP, at or above
 *   Severe 3 HP, below Major 1 HP.
 * - Server dice: `rollDie` maps a random word w to w % sides + 1; the duality roll draws the Hope Die, then the Fear Die.
 */
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

afterEach(() => {
  vi.restoreAllMocks();
});

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

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConvexError) return (e.data as { code: string }).code;
    throw e;
  }
  throw new Error("expected a ConvexError");
}

const CANNONBALL = "beastform:armored-sentry:cannonball";

/**
 * Ash (the player's) is a level 3 druid in Armored Sentry (Stress 1 after the transform, Hope 4); Bryn (the other
 * player's) stands 2 squares east with Strength 2, Agility 0, Proficiency 1, Hope 2, Stress 2. Two Bandits within Close
 * range of Bryn, 1 square apart (Very Close), and one 14 squares away. A live map by day, a running encounter.
 */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const edit = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  await edit(w.characterA, () => ({ classId: "druid", subclassId: "warden-of-the-elements", level: 3, stress: 0, hope: 4 }));
  await edit(w.characterB, (s) => ({ traits: { ...s.traits, strength: 2, agility: 0 }, proficiency: 1, hope: 2, stress: 2 }));
  await gm.mutation(api.classFeatures.use, { characterId: w.characterA, featureKey: "beastform", params: { choice: "armored-sentry" }, idempotencyKey: key() });
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const time = await ctx.db
      .query("campaignTime")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .unique();
    if (time === null) await ctx.db.insert("campaignTime", { campaignId, week: 1, cycle: "DAY", cycleDay: 3 });
    else await ctx.db.patch("campaignTime", time._id, { cycle: "DAY", cycleDay: 3 });
    const pc = (characterId: Id<"characters">, x: number) => ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId }, side: "pc", x, y: 10, face: 0 });
    const ash = await pc(w.characterA, 2);
    const bryn = await pc(w.characterB, 4);
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const bandit = async (label: string, x: number, y: number) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
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
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
      return { instanceId, tokenId };
    };
    return { ash, bryn, first: await bandit("Bandit", 8, 10), second: await bandit("Bandit Two", 9, 11), far: await bandit("Bandit Far", 18, 10) };
  });
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const hpOf = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!.hp);
  const fear = () => t.run((ctx) => campaignFearState(ctx, campaignId).then((s) => s.fear));
  const rows = () => t.run((ctx) => ctx.db.query("combatRequests").collect());
  const open = async () => (await rows()).filter((r) => r.kind === "allyRoll" && r.status === "open");
  const throwAsh = (as: "player" | "gm" = "player") =>
    w.as(as).mutation(api.combatFeatures.useFeature, { campaignId, characterId: w.characterA, mapId, featureId: CANNONBALL, targetTokenIds: [ids.bryn], choices: [], idempotencyKey: key() });
  const view = (as: "player" | "otherPlayer" | "gm", characterId: Id<"characters">) => w.as(as).query(api.featurePromptsReads.allyRolls, { campaignId, characterId, mapId });
  const roll = (requestId: Id<"combatRequests">, over: Partial<{ trait: "agility" | "strength"; target: Id<"combatTokens">; second: Id<"combatTokens"> }> = {}, as: "otherPlayer" | "gm" | "player" = "otherPlayer") =>
    w.as(as).mutation(api.featurePrompts.allyRoll, {
      campaignId,
      requestId,
      trait: over.trait ?? "strength",
      targetTokenId: over.target ?? ids.first.tokenId,
      ...(over.second ? { secondTokenId: over.second } : {}),
      idempotencyKey: key(),
    });
  return { w, t, campaignId, mapId, gm, ...ids, sheetOf, hpOf, fear, rows, open, throwAsh, view, roll };
}

describe("Cannonball: the druid is thrown, the ally rolls from their drawer (dcm-bxp.99.19.21)", { timeout: 60_000 }, () => {
  it("the druid's use marks the Stress and sends Bryn the prompt; nothing is rolled", async () => {
    const a = await arena();
    expect((await a.sheetOf(a.w.characterA)).stress).toBe(1);
    const used = await a.throwAsh();
    expect(used).toMatchObject({ status: "resolved", roll: null, damage: [], notes: ["Bryn makes the roll"] });
    expect((await a.sheetOf(a.w.characterA)).stress).toBe(2);
    const open = await a.open();
    expect(open).toHaveLength(1);
    expect(open[0]!.payload).toMatchObject({ kind: "allyRoll", characterId: a.w.characterA, rollerCharacterId: a.w.characterB, rollerTokenId: a.bryn, featureId: CANNONBALL, useId: "main" });

    // Bryn's drawer: the ask with the targets Bryn sees, Close range and Very Close neighbours; names only (U1).
    const bryn = await a.view("otherPlayer", a.w.characterB);
    expect(bryn.asks).toHaveLength(1);
    const ask = bryn.asks[0]!;
    expect(ask).toMatchObject({ characterName: "Ash", featureName: "Cannonball", hope: 4 });
    const byName = new Map(ask.enemies.map((e) => [e.name, e]));
    expect(byName.get("Bandit")).toMatchObject({ inRange: true, near: [a.second.tokenId] });
    expect(byName.get("Bandit Two")).toMatchObject({ inRange: true, near: [a.first.tokenId] });
    expect(byName.get("Bandit Far")).toMatchObject({ inRange: false, near: [] });
    expect(JSON.stringify(bryn)).not.toMatch(/difficulty|major|severe|hpMax|"hp"/);
    // Ash's drawer says it waits; the GM sees it pending; Ash is not asked.
    const ash = await a.view("player", a.w.characterA);
    expect(ash.asks).toEqual([]);
    expect(ash.waiting).toMatchObject([{ rollerName: "Bryn", featureName: "Cannonball" }]);
    expect(ash.allies).toEqual([{ tokenId: a.bryn, name: "Bryn" }]);
    expect((await a.view("gm", a.w.characterB)).pending).toMatchObject([{ characterName: "Ash", rollerName: "Bryn" }]);
    expect(ash.pending).toEqual([]);
  });

  it("Bryn rolls Strength: a hit with Hope deals d12+2 with Bryn's Proficiency; the Hope is Bryn's", async () => {
    const a = await arena();
    await a.throwAsh();
    const [row] = await a.open();
    const fearBefore = await a.fear();
    // Hope 10 + Fear 4 + Strength 2 = 16 vs Difficulty 10: hit with Hope. Damage 1d12+2 (Proficiency 1): 7 + 2 = 9, Major: 2 HP.
    serverDice(10, 4, 7);
    const out = await a.roll(row!._id);
    expect(out).toMatchObject({ status: "resolved", success: true, targets: [{ tokenId: a.first.tokenId, hit: true, defeated: false }] });
    if (out.status !== "resolved") throw new Error("not resolved");
    expect(out.roll?.total).toBe(16);
    expect(out.damage.map((d) => d.total)).toEqual([9]);
    expect(await a.hpOf(a.first.instanceId)).toBe(2);
    expect(await a.hpOf(a.second.instanceId)).toBe(0);
    expect((await a.sheetOf(a.w.characterB)).hope).toBe(3);
    expect((await a.sheetOf(a.w.characterA)).hope).toBe(4);
    expect(await a.fear()).toBe(fearBefore);
    expect(await a.open()).toHaveLength(0);
    const log = await a.t.run((ctx) => ctx.db.get("actionLog", out.entryId));
    expect(log?.summary).toMatch(/^Bryn throws Ash \(Cannonball\)/);
  });

  it("Agility the ally's choice: a miss with Fear deals nothing and gives the GM a Fear", async () => {
    const a = await arena();
    await a.throwAsh();
    const [row] = await a.open();
    const fearBefore = await a.fear();
    // Hope 2 + Fear 5 + Agility 0 = 7 < 10: a miss with Fear.
    serverDice(2, 5);
    const out = await a.roll(row!._id, { trait: "agility" });
    expect(out).toMatchObject({ status: "resolved", success: false, damage: [], targets: [{ hit: false }] });
    expect(await a.hpOf(a.first.instanceId)).toBe(0);
    expect(await a.fear()).toBe(fearBefore + 1);
    expect((await a.sheetOf(a.w.characterB)).hope).toBe(2);
  });

  it("a critical is Bryn's: the damage adds the die's maximum and Bryn clears a Stress", async () => {
    const a = await arena();
    await a.throwAsh();
    const [row] = await a.open();
    // Hope 6 = Fear 6: a critical. Damage 12 (maximum) + 5 + 2 = 19, Severe: 3 HP. Bryn: Hope 2 + 1, Stress 2 - 1.
    serverDice(6, 6, 5);
    const out = await a.roll(row!._id);
    if (out.status !== "resolved") throw new Error("not resolved");
    expect(out.damage.map((d) => d.total)).toEqual([19]);
    expect(await a.hpOf(a.first.instanceId)).toBe(3);
    const bryn = await a.sheetOf(a.w.characterB);
    expect([bryn.hope, bryn.stress]).toEqual([3, 1]);
    expect((await a.sheetOf(a.w.characterA)).stress).toBe(2);
  });

  it("a Hope of Ash's adds the second target within Very Close range, at half damage rounded up; undo restores everything", async () => {
    const a = await arena();
    await a.throwAsh();
    const [row] = await a.open();
    // 16 vs 10: hit. Damage 7 + 2 = 9 to the first (Major, 2 HP); the second takes ceil(9 / 2) = 5 (Major, 2 HP).
    serverDice(10, 4, 7);
    const out = await a.roll(row!._id, { second: a.second.tokenId });
    if (out.status !== "resolved") throw new Error("not resolved");
    expect(out.damage.map((d) => d.total)).toEqual([9]);
    expect(await a.hpOf(a.first.instanceId)).toBe(2);
    expect(await a.hpOf(a.second.instanceId)).toBe(2);
    expect((await a.sheetOf(a.w.characterA)).hope).toBe(3);

    await a.gm.mutation(api.actionLog.undo, { entryId: out.entryId, idempotencyKey: key() });
    expect(await a.hpOf(a.first.instanceId)).toBe(0);
    expect(await a.hpOf(a.second.instanceId)).toBe(0);
    expect((await a.sheetOf(a.w.characterA)).hope).toBe(4);
    expect((await a.sheetOf(a.w.characterB)).hope).toBe(2);
  });

  it("refuses a target out of Close range, a far second target, a second without Ash's Hope, and another player; nothing is written", async () => {
    const a = await arena();
    await a.throwAsh();
    const [row] = await a.open();
    expect(await codeOf(a.roll(row!._id, { target: a.far.tokenId }))).toBe("COMBAT_TARGET_INVALID");
    expect(await codeOf(a.roll(row!._id, { second: a.far.tokenId }))).toBe("COMBAT_TARGET_INVALID");
    expect(await codeOf(a.roll(row!._id, { second: a.first.tokenId }))).toBe("COMBAT_TARGET_INVALID");
    expect(await codeOf(a.roll(row!._id, {}, "player"))).toBe("FORBIDDEN");
    await a.t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", a.w.characterA))!.sheet);
      await saveSheet(ctx, a.w.characterA, { ...s, hope: 0 });
    });
    expect(await codeOf(a.roll(row!._id, { second: a.second.tokenId }))).toBe("FEATURE_COST_UNPAID");
    expect(await a.hpOf(a.first.instanceId)).toBe(0);
    expect(await a.open()).toHaveLength(1);
  });

  it("the GM rolls for Bryn (Play for this character) and can cancel a throw", async () => {
    const a = await arena();
    await a.throwAsh();
    const [row] = await a.open();
    serverDice(10, 4, 7);
    expect(await a.roll(row!._id, {}, "gm")).toMatchObject({ status: "resolved", success: true });

    await a.throwAsh();
    const [next] = await a.open();
    await a.gm.mutation(api.featurePrompts.cancelAllyRoll, { campaignId: a.campaignId, requestId: next!._id, idempotencyKey: key() });
    expect(await a.open()).toHaveLength(0);
    expect(await codeOf(a.roll(next!._id))).toBe("REQUEST_NOT_OPEN");
    expect((await a.view("otherPlayer", a.w.characterB)).asks).toEqual([]);
  });

  it("undoing the druid's use gives the Stress back and withdraws the prompt", async () => {
    const a = await arena();
    const used = await a.throwAsh();
    if (used.status !== "resolved") throw new Error("not resolved");
    const [row] = await a.open();
    await a.gm.mutation(api.actionLog.undo, { entryId: used.entryId, idempotencyKey: key() });
    expect((await a.sheetOf(a.w.characterA)).stress).toBe(1);
    expect((await a.view("otherPlayer", a.w.characterB)).asks).toEqual([]);
    expect(await a.roll(row!._id)).toEqual({ status: "closed" });
    expect(await a.open()).toHaveLength(0);
  });

  it("a second throw by Ash replaces the first prompt", async () => {
    const a = await arena();
    await a.throwAsh();
    await a.throwAsh();
    expect(await a.open()).toHaveLength(1);
    expect((await a.sheetOf(a.w.characterA)).stress).toBe(3);
  });
});
