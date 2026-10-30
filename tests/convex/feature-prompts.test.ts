/**
 * Server-decided feature uses (plan drawer-answers DA12; docs/tasks/TASK-DA-DA12.md).
 *
 * Expected values come from the book and the user's answers:
 * - CB p.31, Warden's Protection: "Once per long rest, spend 2 Hope to clear 2 Hit Points on 1d4 allies within Close
 *   range." User 2026-10-29 (dcm-d95): the server rolls the 1d4 first, then the player picks that many allies.
 * - CB p.59, Charge: "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with one or
 *   more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range." User 2026-10-30:
 *   the player picks the Melee square next to the target before rolling; on a success the server moves the token there,
 *   on a failure there is no move.
 * - CB p.103 (Defined Ranges): Melee 1 square, Close 6, Far 12 squares.
 * - Damage (CB p.90): incoming at or above the Major threshold and below Severe marks 2 HP.
 * - Server dice: `rollDie` maps a random word w to w % sides + 1 (convex/lib/dice.ts); the duality roll draws the Hope Die
 *   first, then the Fear Die.
 */
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

afterEach(() => {
  vi.restoreAllMocks();
});

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

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConvexError) return (e.data as { code: string }).code;
    throw e;
  }
  throw new Error("expected a ConvexError");
}

const WARDEN = "subclass:warden-of-renewal:wardens-protection";

/** The world, a live medium map (30 x 20) by day, a running encounter and Ash's token at (2, 10). */
async function arena(patchAsh: (s: CharacterSheet) => Partial<CharacterSheet>) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    const time = await ctx.db
      .query("campaignTime")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .unique();
    if (time === null) await ctx.db.insert("campaignTime", { campaignId, week: 1, cycle: "DAY", cycleDay: 3 });
    else await ctx.db.patch("campaignTime", time._id, { cycle: "DAY", cycleDay: 3 });
    const ash = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 2, y: 10, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
    await saveSheet(ctx, w.characterA, { ...s, ...patchAsh(s) });
    return { ash, encounterId };
  });
  const pcToken = (characterId: Id<"characters">, x: number, y: number) =>
    t.run((ctx) => ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId }, side: "pc", x, y, face: 0 }));
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
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
      return { instanceId, tokenId };
    });
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const editSheet = (id: Id<"characters">, patch: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  const requests = () => t.run((ctx) => ctx.db.query("combatRequests").collect());
  const token = (id: Id<"combatTokens">) => t.run(async (ctx) => (await ctx.db.get("combatTokens", id))!);
  return { w, t, campaignId, mapId, gm, player, ...ids, pcToken, enemy, sheetOf, editSheet, requests, token };
}

// ---------------------------------------------------------------- Warden's Protection

describe("Warden's Protection rolls its 1d4 before the pick (dcm-d95)", () => {
  async function wardens() {
    const a = await arena(() => ({ classId: "druid", subclassId: "warden-of-renewal", subclassRank: "specialization", hope: 4 }));
    // A third character (a copy of Bryn) so two allies can stand in Close range.
    const third = await a.t.run(async (ctx) => {
      const { _id, _creationTime, ...rest } = (await ctx.db.get("characters", a.w.characterB))!;
      void _id;
      void _creationTime;
      return ctx.db.insert("characters", rest);
    });
    await a.editSheet(a.w.characterB, () => ({ hp: 3 }));
    await a.editSheet(third, () => ({ hp: 3 }));
    const bryn = await a.pcToken(a.w.characterB, 4, 10);
    const cara = await a.pcToken(third, 3, 12);
    const use = (targetTokenIds: Id<"combatTokens">[]) =>
      a.player.mutation(api.combatFeatures.useFeature, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId, featureId: WARDEN, targetTokenIds, choices: [], idempotencyKey: key() });
    const roll = () => a.player.mutation(api.featurePrompts.rollCount, { campaignId: a.campaignId, characterId: a.w.characterA, featureId: WARDEN, idempotencyKey: key() });
    const stored = () => a.player.query(api.featurePrompts.targetCount, { campaignId: a.campaignId, characterId: a.w.characterA, featureId: WARDEN });
    return { ...a, third, bryn, cara, use, roll, stored };
  }

  it("refuses the use before the count is rolled, and nothing is paid", async () => {
    const a = await wardens();
    expect(await codeOf(a.use([a.bryn]))).toBe("COMBAT_TARGET_INVALID");
    expect((await a.sheetOf(a.w.characterA)).hope).toBe(4);
  });

  it("rolls and stores the count; a second roll waits until it is used; more allies than rolled are refused", async () => {
    const a = await wardens();
    serverDice(1);
    const rolled = await a.roll();
    expect(rolled.count).toBe(1);
    expect(await a.stored()).toMatchObject({ requestId: rolled.requestId, count: 1 });
    expect(await codeOf(a.roll())).toBe("INVALID");
    // Two allies against a roll of 1: refused, nothing written, the roll still stands.
    expect(await codeOf(a.use([a.bryn, a.cara]))).toBe("COMBAT_TARGET_INVALID");
    expect((await a.sheetOf(a.w.characterA)).hope).toBe(4);
    expect(await a.stored()).toMatchObject({ count: 1 });
  });

  it("the use takes the stored roll: up to that many allies clear 2 HP, 2 Hope paid, the roll resolved, once per long rest", async () => {
    const a = await wardens();
    serverDice(2);
    const rolled = await a.roll();
    expect(rolled.count).toBe(2);
    const result = await a.use([a.bryn, a.cara]);
    expect(result).toMatchObject({ status: "resolved", notes: expect.arrayContaining(["rolled 2 targets"]) });
    expect((await a.sheetOf(a.w.characterA)).hope).toBe(2);
    expect((await a.sheetOf(a.w.characterB)).hp).toBe(1);
    expect((await a.sheetOf(a.third)).hp).toBe(1);
    expect((await a.requests()).find((r) => r._id === rolled.requestId)).toMatchObject({ status: "resolved" });
    expect(await a.stored()).toBeNull();
    // Once per long rest: the next roll is refused.
    expect(await codeOf(a.roll())).toBe("FEATURE_EXHAUSTED");
  });

  it("an expired roll is refused by the use and declined by the next roll", async () => {
    const a = await wardens();
    serverDice(3);
    const old = await a.roll();
    await a.t.run(async (ctx) => {
      const row = (await ctx.db.get("combatRequests", old.requestId))!;
      if (row.payload.kind === "targetCount") await ctx.db.patch("combatRequests", row._id, { payload: { ...row.payload, expiresAt: Date.now() - 1 } });
    });
    expect(await a.stored()).toBeNull();
    expect(await codeOf(a.use([a.bryn]))).toBe("COMBAT_TARGET_INVALID");
    serverDice(1);
    const fresh = await a.roll();
    expect(fresh.count).toBe(1);
    expect((await a.requests()).find((r) => r._id === old.requestId)).toMatchObject({ status: "declined" });
  });

  it("the GM rolls and uses it for the player's character; a non-rolled-first feature has no count", async () => {
    const a = await wardens();
    serverDice(1);
    const rolled = await a.gm.mutation(api.featurePrompts.rollCount, { campaignId: a.campaignId, characterId: a.w.characterA, featureId: WARDEN, idempotencyKey: key() });
    expect(rolled.count).toBe(1);
    expect(await codeOf(a.gm.mutation(api.featurePrompts.rollCount, { campaignId: a.campaignId, characterId: a.w.characterA, featureId: "subclass:warden-of-renewal:regeneration", idempotencyKey: key() }))).toBe(
      "INVALID",
    );
  });
});

// ---------------------------------------------------------------- Charge

describe("Charge rolls first and the server moves the token on a success (dcm-bxp.99.19.16)", () => {
  async function firbolg() {
    const a = await arena((s) => ({ ancestry: { kind: "single", id: "firbolg" }, traits: { ...s.traits, agility: 2 }, stress: 0, hope: 2 }));
    // The target 10 squares away (Far); a second Bear in Melee range of the picked square (11, 10), ahead of the token
    // (the token faces the way it moved, and "all targets" are the enemies it sees there, CB p.104).
    const bear = await a.enemy(12, 10);
    const other = await a.enemy(12, 11);
    const charge = (over: Partial<{ square: { x: number; y: number }; targetTokenId: Id<"combatTokens">; stress: boolean; difficulty: number | undefined }> = {}) =>
      a.player.mutation(api.featurePrompts.charge, {
        campaignId: a.campaignId,
        characterId: a.w.characterA,
        mapId: a.mapId,
        targetTokenId: over.targetTokenId ?? bear.tokenId,
        square: over.square ?? { x: 11, y: 10 },
        stress: over.stress ?? true,
        roll: "difficulty" in over ? (over.difficulty === undefined ? {} : { difficulty: over.difficulty }) : { difficulty: 12 },
        idempotencyKey: key(),
      });
    const instance = (id: Id<"encounterAdversaries">) => a.t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
    return { ...a, bear, other, charge, instance };
  }

  it("on a success the token moves to the picked square and the Stress deals 1d12 to every enemy in Melee there; undo restores all", async () => {
    const a = await firbolg();
    // Hope 9 + Fear 3 + Agility 2 = 14 vs 12: a success with Hope. The 1d12 shows 7: Major for both Bears (2 HP). The
    // Firbolg's Unshakable d6 on the Stress shows 1: it is marked (CB p.59; DA10).
    serverDice(9, 3, 7, 1);
    const result = await a.charge();
    expect(result).toMatchObject({ status: "charged", moved: true, use: { success: true } });
    if (result.status !== "charged") throw new Error("not charged");
    expect(result.use.prompts.some((p) => p.kind === "move")).toBe(false);
    expect(new Set(result.use.targets.map((t) => t.tokenId))).toEqual(new Set([a.bear.tokenId, a.other.tokenId]));
    expect(await a.token(a.ash)).toMatchObject({ x: 11, y: 10 });
    expect((await a.sheetOf(a.w.characterA)).stress).toBe(1);
    expect((await a.instance(a.bear.instanceId)).hp).toBe(2);
    expect((await a.instance(a.other.instanceId)).hp).toBe(2);
    expect((await a.requests()).filter((r) => r.kind === "serverMove" && r.status === "open")).toHaveLength(1);

    await a.gm.mutation(api.actionLog.undo, { entryId: result.use.entryId, idempotencyKey: key() });
    expect(await a.token(a.ash)).toMatchObject({ x: 2, y: 10 });
    expect((await a.sheetOf(a.w.characterA)).stress).toBe(0);
    expect((await a.instance(a.bear.instanceId)).hp).toBe(0);
    expect((await a.requests()).filter((r) => r.kind === "serverMove" && r.status === "open")).toHaveLength(0);
  });

  it("on a failure the token stays and nothing is dealt", async () => {
    const a = await firbolg();
    // Hope 2 + Fear 3 + Agility 2 = 7 < 12.
    serverDice(2, 3);
    const result = await a.charge();
    expect(result).toMatchObject({ status: "charged", moved: false, use: { success: false } });
    expect(await a.token(a.ash)).toMatchObject({ x: 2, y: 10 });
    expect((await a.sheetOf(a.w.characterA)).stress).toBe(0);
    expect((await a.instance(a.bear.instanceId)).hp).toBe(0);
    expect((await a.requests()).some((r) => r.kind === "serverMove")).toBe(false);
  });

  it("refuses a square out of Melee, an occupied square, a target in Close range and a roll without the Difficulty", async () => {
    const a = await firbolg();
    expect(await codeOf(a.charge({ square: { x: 9, y: 10 } }))).toBe("INVALID");
    expect(await codeOf(a.charge({ square: { x: 12, y: 11 } }))).toBe("MOVE_BLOCKED");
    expect(await codeOf(a.charge({ difficulty: undefined }))).toBe("INVALID");
    const near = await a.enemy(6, 10);
    expect(await codeOf(a.charge({ targetTokenId: near.tokenId, square: { x: 6, y: 11 } }))).toBe("INVALID");
    expect(await a.token(a.ash)).toMatchObject({ x: 2, y: 10 });
  });

  it("useFeature refuses Charge: it needs its square", async () => {
    const a = await firbolg();
    const code = await codeOf(
      a.player.mutation(api.combatFeatures.useFeature, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId, featureId: "ancestry:firbolg:charge", targetTokenIds: [], choices: [], idempotencyKey: key() }),
    );
    expect(code).toBe("INVALID");
  });
});
