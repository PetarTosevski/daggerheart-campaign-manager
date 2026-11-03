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
 * - User 2026-10-30 (dcm-bxp.99.19.55): (1) the rolled 1d4 stays valid until it is used or the scene ends (no time
 *   limit); (2) Charge's Stress deals the 1d12 to every enemy within Melee range of the landing square regardless of
 *   facing or sight; a wall on the straight way refuses a player's Charge, the GM passes.
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
import { CELL_TILE_ROWS, CELL_UNPAINTED, codeOfTerrain, indexInTile, tileOf } from "../../src/components/combat-map/map-view/cells";
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
  /** Paints one wall square (the "terrain" layer tile of a 30-wide map). */
  const wall = (x: number, y: number) =>
    t.run(async (ctx) => {
      const cells = CELL_UNPAINTED.repeat(CELL_TILE_ROWS * 30).split("");
      cells[indexInTile(x, y, 30)] = codeOfTerrain("wall");
      await ctx.db.insert("combatMapCells", { mapId, layer: "terrain", tile: tileOf(y), cells: cells.join("") });
    });
  return { w, t, campaignId, mapId, gm, player, ...ids, pcToken, enemy, sheetOf, editSheet, requests, token, wall };
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
    const view = () => a.player.query(api.featurePrompts.targetCount, { campaignId: a.campaignId, characterId: a.w.characterA, featureId: WARDEN, mapId: a.mapId });
    const stored = async () => (await view()).roll;
    return { ...a, third, bryn, cara, use, roll, view, stored };
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
    expect(await a.stored()).toEqual({ requestId: rolled.requestId, count: 1 });
    // The drawer's ally list: Bryn (2 squares) and Cara (2) are within Close range of Ash.
    expect((await a.view()).allies).toEqual(
      expect.arrayContaining([
        { tokenId: a.bryn, name: expect.any(String), inRange: true },
        { tokenId: a.cara, name: expect.any(String), inRange: true },
      ]),
    );
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

  it("the roll holds with no time limit until the scene ends; undoing the scene end brings it back", async () => {
    const a = await wardens();
    serverDice(3);
    const old = await a.roll();
    // Hours later (no TTL): still there.
    await a.t.run((ctx) => ctx.db.patch("combatRequests", old.requestId, { createdAt: Date.now() - 5 * 60 * 60_000 }));
    expect(await a.stored()).toEqual({ requestId: old.requestId, count: 3 });
    // The GM ends the scene: the roll is gone, the use refused with nothing paid.
    const ended = await a.gm.mutation(api.combatScenes.end, { campaignId: a.campaignId, idempotencyKey: key() });
    expect(await a.stored()).toBeNull();
    expect(await codeOf(a.use([a.bryn]))).toBe("COMBAT_TARGET_INVALID");
    expect((await a.sheetOf(a.w.characterA)).hope).toBe(4);
    // Undoing the scene end puts the roll back.
    if (ended.entryId === null) throw new Error("the scene end wrote no row");
    await a.gm.mutation(api.actionLog.undo, { entryId: ended.entryId, idempotencyKey: key() });
    expect(await a.stored()).toEqual({ requestId: old.requestId, count: 3 });
    // A new scene end, then a new roll: the stale row is declined.
    await a.gm.mutation(api.combatScenes.end, { campaignId: a.campaignId, idempotencyKey: key() });
    serverDice(1);
    const fresh = await a.roll();
    expect(fresh.count).toBe(1);
    expect((await a.requests()).find((r) => r._id === old.requestId)).toMatchObject({ status: "declined" });
  });

  it("the use leaves no scene mark on the sheet", async () => {
    const a = await wardens();
    serverDice(1);
    await a.roll();
    expect((await a.sheetOf(a.w.characterA)).featureUses.some((u) => u.key.startsWith("rolledCount:"))).toBe(true);
    await a.use([a.bryn]);
    expect((await a.sheetOf(a.w.characterA)).featureUses.some((u) => u.key.startsWith("rolledCount:"))).toBe(false);
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
    type Over = Partial<{ square: { x: number; y: number }; targetTokenId: Id<"combatTokens">; stress: boolean; difficulty: number }>;
    /** The player's Charge: it goes to the GM as a `difficulty` request (dcm-bxp.99.19.61). */
    const ask = (over: Over = {}) =>
      a.player.mutation(api.featurePrompts.charge, {
        campaignId: a.campaignId,
        characterId: a.w.characterA,
        mapId: a.mapId,
        targetTokenId: over.targetTokenId ?? bear.tokenId,
        square: over.square ?? { x: 11, y: 10 },
        stress: over.stress ?? true,
        roll: over.difficulty === undefined ? {} : { difficulty: over.difficulty },
        idempotencyKey: key(),
      });
    const answer = (requestId: Id<"combatRequests">, difficulty: number | null = 12) =>
      a.gm.mutation(api.featurePrompts.answerDifficulty, { campaignId: a.campaignId, requestId, difficulty, idempotencyKey: key() });
    /** The player asks, then the GM answers with Difficulty 12: the server rolls Agility. */
    const charge = async (over: Over = {}) => {
      const asked = await ask(over);
      if (asked.status !== "requested") throw new Error(`expected a request, got ${asked.status}`);
      const out = await answer(asked.requestId);
      if (out.status !== "charged") throw new Error(`expected a Charge, got ${out.status}`);
      return out;
    };
    const instance = (id: Id<"encounterAdversaries">) => a.t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
    return { ...a, bear, other, charge, ask, answer, instance };
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

  // dcm-bxp.99.19.59; CB p.42 (Rogue, Cloaked): "After you make an attack or end a move within line of sight of an
  // adversary, you are no longer Cloaked." By day the Bears next to the square see the Firbolg in clear light.
  it("a Cloaked Firbolg's Charge that lands in sight ends Cloaked in the Charge's group; one undo reverts both", async () => {
    const a = await firbolg();
    await a.editSheet(a.w.characterA, () => ({ conditions: ["cloaked"] }));
    serverDice(9, 3); // 9 + 3 + 2 = 14 vs 12: success
    const result = await a.charge({ stress: false });
    if (result.status !== "charged") throw new Error("not charged");
    expect(result.moved).toBe(true);
    expect((await a.sheetOf(a.w.characterA)).conditions).not.toContain("cloaked");
    const rows = await a.t.run((ctx) => ctx.db.query("actionLog").collect());
    const use = rows.find((r) => r._id === result.use.entryId)!;
    const cloak = rows.find((r) => r.summary.includes("no longer Cloaked"))!;
    expect(cloak).toMatchObject({ visibility: "public", undoable: true, characterId: a.w.characterA });
    expect(cloak.groupId).toBe(use.groupId);

    await a.gm.mutation(api.actionLog.undo, { entryId: result.use.entryId, idempotencyKey: key() });
    expect((await a.sheetOf(a.w.characterA)).conditions).toContain("cloaked");
    expect(await a.token(a.ash)).toMatchObject({ x: 2, y: 10 });
  });

  it("a failed Charge does not move, so Cloaked stays", async () => {
    const a = await firbolg();
    await a.editSheet(a.w.characterA, () => ({ conditions: ["cloaked"] }));
    serverDice(2, 3);
    const result = await a.charge({ stress: false });
    expect(result).toMatchObject({ status: "charged", moved: false });
    expect((await a.sheetOf(a.w.characterA)).conditions).toContain("cloaked");
  });

  it("refuses a square out of Melee, an occupied square, a target in Close range, a player's Difficulty and a GM's Charge without one", async () => {
    const a = await firbolg();
    expect(await codeOf(a.ask({ square: { x: 9, y: 10 } }))).toBe("INVALID");
    expect(await codeOf(a.ask({ square: { x: 12, y: 11 } }))).toBe("MOVE_BLOCKED");
    // CB p.104: "The GM sets this Difficulty": a player cannot.
    expect(await codeOf(a.ask({ difficulty: 12 }))).toBe("INVALID");
    expect(
      await codeOf(
        a.gm.mutation(api.featurePrompts.charge, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId, targetTokenId: a.bear.tokenId, square: { x: 11, y: 10 }, stress: true, roll: {}, idempotencyKey: key() }),
      ),
    ).toBe("INVALID");
    const near = await a.enemy(6, 10);
    expect(await codeOf(a.ask({ targetTokenId: near.tokenId, square: { x: 6, y: 11 } }))).toBe("INVALID");
    expect(await a.token(a.ash)).toMatchObject({ x: 2, y: 10 });
    expect((await a.requests()).some((r) => r.kind === "difficulty")).toBe(false);
  });

  it("hits every enemy in Melee range of the square, also one behind the token", async () => {
    const a = await firbolg();
    // A third Bear south-west of the square (10, 11): behind the token, which faces east after the run.
    const behind = await a.enemy(10, 11);
    serverDice(9, 3, 7, 1);
    const result = await a.charge();
    if (result.status !== "charged") throw new Error("not charged");
    expect(new Set(result.use.targets.map((t) => t.tokenId))).toEqual(new Set([a.bear.tokenId, a.other.tokenId, behind.tokenId]));
    expect((await a.instance(behind.instanceId)).hp).toBe(2);
  });

  it("a wall on the way refuses the player's Charge; the GM charges through", async () => {
    const a = await firbolg();
    await a.wall(6, 10);
    expect(await codeOf(a.ask())).toBe("MOVE_BLOCKED");
    expect(await a.token(a.ash)).toMatchObject({ x: 2, y: 10 });
    serverDice(9, 3, 7, 1);
    const result = await a.gm.mutation(api.featurePrompts.charge, {
      campaignId: a.campaignId,
      characterId: a.w.characterA,
      mapId: a.mapId,
      targetTokenId: a.bear.tokenId,
      square: { x: 11, y: 10 },
      stress: false,
      roll: { difficulty: 12 },
      idempotencyKey: key(),
    });
    expect(result).toMatchObject({ status: "charged", moved: true });
    expect(await a.token(a.ash)).toMatchObject({ x: 11, y: 10 });
  });

  it("the drawer's options: the enemies at Far range with their free squares in Melee range", async () => {
    const a = await firbolg();
    await a.enemy(6, 10); // Close range: not a Charge target
    const options = await a.player.query(api.featurePrompts.chargeOptions, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId });
    expect(options.map((o) => o.tokenId).sort()).toEqual([a.bear.tokenId, a.other.tokenId].sort());
    const bear = options.find((o) => o.tokenId === a.bear.tokenId)!;
    expect(bear).toMatchObject({ name: "Bear", band: "far" });
    expect(bear.squares).toContainEqual({ x: 11, y: 10, label: "west" });
    expect(bear.squares).toContainEqual({ x: 13, y: 9, label: "north-east" });
    // (12, 11) holds the other Bear; Bear's 8 neighbours less that one.
    expect(bear.squares.some((q) => q.x === 12 && q.y === 11)).toBe(false);
    expect(bear.squares).toHaveLength(7);
  });

  // dcm-bxp.99.19.61 (user 2026-10-30): the player picks target + square; the GM gets a request with a Difficulty box; on
  // submit the server rolls Agility and moves the token on success.
  it("a player's Charge waits for the GM: nothing rolled, paid or moved; both see the request", async () => {
    const a = await firbolg();
    const asked = await a.ask();
    expect(asked.status).toBe("requested");
    expect(await a.token(a.ash)).toMatchObject({ x: 2, y: 10 });
    expect((await a.sheetOf(a.w.characterA)).stress).toBe(0);
    expect((await a.t.run((ctx) => ctx.db.query("actionLog").collect())).length).toBe(0);
    const view = { ask: "charge", characterId: a.w.characterA, characterName: (await a.sheetOf(a.w.characterA)).name, target: { tokenId: a.bear.tokenId, name: "Bear" }, seers: [] };
    expect(await a.gm.query(api.combatRequests.difficulties, { campaignId: a.campaignId })).toMatchObject([view]);
    expect(await a.player.query(api.combatRequests.difficulties, { campaignId: a.campaignId })).toMatchObject([view]);
    expect(await a.w.as("otherPlayer").query(api.combatRequests.difficulties, { campaignId: a.campaignId })).toEqual([]);
  });

  it("the player withdraws the Charge waiting for its Difficulty (HD3, user 2026-11-02): nothing rolled, paid or moved", async () => {
    const a = await firbolg();
    const asked = await a.ask();
    if (asked.status !== "requested") throw new Error("not requested");
    const withdraw = (role: "player" | "otherPlayer") =>
      a.w.as(role).mutation(api.combatWithdraw.withdraw, { campaignId: a.campaignId, requestId: asked.requestId, idempotencyKey: key() });
    expect(await codeOf(withdraw("otherPlayer"))).toBe("FORBIDDEN");
    expect(await withdraw("player")).toEqual({ status: "withdrawn", requestId: asked.requestId });
    expect(await a.gm.query(api.combatRequests.difficulties, { campaignId: a.campaignId })).toEqual([]);
    expect(await codeOf(a.answer(asked.requestId, 12))).toBe("REQUEST_NOT_OPEN");
    expect(await codeOf(withdraw("player"))).toBe("REQUEST_NOT_OPEN");
    expect(await a.token(a.ash)).toMatchObject({ x: 2, y: 10 });
    expect((await a.sheetOf(a.w.characterA)).stress).toBe(0);
    const rows = await a.t.run((ctx) => ctx.db.query("actionLog").collect());
    expect(rows.map((r) => [r.summary, r.undoable, r.roll])).toEqual([[`${(await a.sheetOf(a.w.characterA)).name} withdrew a Charge waiting for the GM`, false, undefined]]);
  });

  it("the GM's Difficulty rolls it: the token moves on a success, the rows are the player's, the request closes", async () => {
    const a = await firbolg();
    const asked = await a.ask({ stress: false });
    if (asked.status !== "requested") throw new Error("not requested");
    // 9 + 3 + 2 = 14 vs the GM's 12: a success.
    serverDice(9, 3);
    const out = await a.answer(asked.requestId, 12);
    expect(out).toMatchObject({ status: "charged", moved: true, use: { success: true } });
    expect(await a.token(a.ash)).toMatchObject({ x: 11, y: 10 });
    const row = await a.t.run(async (ctx) => (await ctx.db.get("combatRequests", asked.requestId))!);
    expect(row.status).toBe("resolved");
    if (out.status !== "charged") throw new Error("not charged");
    const entry = await a.t.run(async (ctx) => (await ctx.db.get("actionLog", out.use.entryId))!);
    expect(entry.actorId).toBe(a.w.users.player);
    expect(await codeOf(a.answer(asked.requestId, 12))).toBe("REQUEST_NOT_OPEN");
    expect(await a.gm.query(api.combatRequests.difficulties, { campaignId: a.campaignId })).toEqual([]);
  });

  it("a Difficulty above the total fails: the token stays", async () => {
    const a = await firbolg();
    const asked = await a.ask();
    if (asked.status !== "requested") throw new Error("not requested");
    serverDice(9, 3); // 14 vs 20
    expect(await a.answer(asked.requestId, 20)).toMatchObject({ status: "charged", moved: false, use: { success: false } });
    expect(await a.token(a.ash)).toMatchObject({ x: 2, y: 10 });
  });

  it("the GM declines; a bad Difficulty is refused and leaves it open; a newer Charge replaces the older request", async () => {
    const a = await firbolg();
    const first = await a.ask();
    const second = await a.ask({ square: { x: 11, y: 9 } });
    if (first.status !== "requested" || second.status !== "requested") throw new Error("not requested");
    expect(await codeOf(a.answer(first.requestId))).toBe("REQUEST_NOT_OPEN");
    expect(await codeOf(a.answer(second.requestId, 0))).toBe("INVALID");
    expect(await codeOf(a.answer(second.requestId, 2.5))).toBe("INVALID");
    expect(await a.answer(second.requestId, null)).toEqual({ status: "declined" });
    expect(await a.token(a.ash)).toMatchObject({ x: 2, y: 10 });
    expect((await a.requests()).filter((r) => r.kind === "difficulty" && r.status === "open")).toHaveLength(0);
  });

  it("the encounter's end leaves the request out of the queue and the answer declines it", async () => {
    const a = await firbolg();
    const asked = await a.ask();
    if (asked.status !== "requested") throw new Error("not requested");
    await a.t.run((ctx) => ctx.db.patch("encounters", a.encounterId, { status: "ended" as never }));
    expect(await a.gm.query(api.combatRequests.difficulties, { campaignId: a.campaignId })).toEqual([]);
    expect(await a.answer(asked.requestId, 12)).toEqual({ status: "declined" });
  });

  it("useFeature refuses Charge: it needs its square", async () => {
    const a = await firbolg();
    const code = await codeOf(
      a.player.mutation(api.combatFeatures.useFeature, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId, featureId: "ancestry:firbolg:charge", targetTokenIds: [], choices: [], idempotencyKey: key() }),
    );
    expect(code).toBe("INVALID");
  });
});

// ---------------------------------------------------------------- Cloaked: the GM's Difficulty (B2)

/**
 * dcm-bxp.99.19.62 (1), user 2026-10-30: "an enemy with no Difficulty (custom token, enemy-side PC/companion) that is the
 * only one seeing the rogue dimly -> the GM gets a prompt to enter a Difficulty, then the Finesse roll happens". CB p.42
 * (Rogue, Cloaked): "After you make an attack or end a move within line of sight of an adversary, you are no longer
 * Cloaked." DA18 (dcm-bxp.99.19.53 (4)): seen only in dim light, ONE Finesse action roll; success keeps Cloaked. R9: at
 * night a token with no light sees clearly only in Melee; 3 squares off is dim.
 */
describe("Cloaked seen dimly only by enemies without a Difficulty asks the GM for one (dcm-bxp.99.19.62 (1))", () => {
  async function dim() {
    const a = await arena((s) => ({ classId: "rogue", conditions: ["cloaked"], traits: { ...s.traits, finesse: 1 }, hope: 2, stress: 0 }));
    await a.t.run(async (ctx) => {
      const time = await ctx.db
        .query("campaignTime")
        .withIndex("by_campaign", (q) => q.eq("campaignId", a.campaignId))
        .unique();
      await ctx.db.patch("campaignTime", time!._id, { cycle: "NIGHT", cycleDay: 3 });
    });
    const custom = (x: number, y: number) =>
      a.t.run((ctx) =>
        ctx.db.insert("combatTokens", {
          campaignId: a.campaignId,
          mapId: a.mapId,
          size: 1,
          light: "none",
          revealedTo: [],
          ref: { kind: "custom", name: "Shade", hp: 3, hpMax: 3, stress: 0, stressMax: 1, conditions: [] },
          side: "enemy",
          x,
          y,
          face: Math.PI,
        }),
      );
    const move = (x: number, y: number) => a.player.mutation(api.combatTokens.move, { campaignId: a.campaignId, tokenId: a.ash, x, y });
    const answer = (requestId: Id<"combatRequests">, difficulty: number | null) =>
      a.gm.mutation(api.featurePrompts.answerDifficulty, { campaignId: a.campaignId, requestId, difficulty, idempotencyKey: key() });
    const cloaked = async () => (await a.sheetOf(a.w.characterA)).conditions.includes("cloaked");
    const open = async () => (await a.requests()).filter((r) => r.kind === "difficulty" && r.status === "open");
    const rows = () => a.t.run((ctx) => ctx.db.query("actionLog").collect());
    return { ...a, custom, move, answer, cloaked, open, rows };
  }

  it("a custom token alone sees the rogue dimly: no roll yet, the GM gets the request; the GM's Difficulty rolls it", async () => {
    const a = await dim();
    const shade = await a.custom(7, 10); // 3 squares from (4, 10): dim
    await a.move(4, 10);
    expect(await a.cloaked()).toBe(true);
    expect((await a.rows()).some((r) => r.kind === "roll")).toBe(false);
    const [row] = await a.open();
    expect(row).toBeDefined();
    expect(await a.gm.query(api.combatRequests.difficulties, { campaignId: a.campaignId })).toMatchObject([{ ask: "cloak", target: null, seers: [{ tokenId: shade, name: "Shade" }] }]);
    // 3 + 8 + 1 = 12 vs the GM's 14: failure with Fear, Cloaked ends.
    serverDice(3, 8);
    expect(await a.answer(row!._id, 14)).toEqual({ status: "rolled", cloaked: false });
    expect(await a.cloaked()).toBe(false);
    const roll = (await a.rows()).find((r) => r.kind === "roll" && r.summary.includes("Finesse"))!;
    expect(roll).toMatchObject({ visibility: "public", actorId: a.w.users.player, characterId: a.w.characterA });
    expect(roll.roll!.difficulty).toBeUndefined();
    expect((await a.rows()).find((r) => r.visibility === "gm" && r.groupId === roll.groupId)!.summary).toContain("Difficulty 14");
    expect(await a.open()).toHaveLength(0);
  });

  it("a success keeps Cloaked", async () => {
    const a = await dim();
    await a.custom(7, 10);
    await a.move(4, 10);
    const [row] = await a.open();
    serverDice(11, 2); // 11 + 2 + 1 = 14 vs 10
    expect(await a.answer(row!._id, 10)).toEqual({ status: "rolled", cloaked: true });
    expect(await a.cloaked()).toBe(true);
  });

  it("an adversary with a Difficulty among the dim seers rolls at once: no request", async () => {
    const a = await dim();
    await a.custom(7, 10);
    await a.enemy(4, 13); // Difficulty 10, 3 squares below: dim
    serverDice(11, 2);
    await a.move(4, 10);
    expect(await a.open()).toHaveLength(0);
    expect((await a.rows()).some((r) => r.kind === "roll" && r.summary.includes("Finesse"))).toBe(true);
  });

  it("the rogue moved on: the request is replaced, and an answer to a stale one rolls nothing", async () => {
    const a = await dim();
    await a.custom(7, 10);
    await a.move(4, 10);
    const [first] = await a.open();
    await a.move(4, 9); // still dim for the Shade (3 squares and a bit)
    const now = await a.open();
    expect(now).toHaveLength(1);
    expect(now[0]!._id).not.toBe(first!._id);
    // The token leaves the dim square without a new request: the answer finds the move gone.
    await a.t.run((ctx) => ctx.db.patch("combatTokens", a.ash, { x: 2, y: 2 }));
    expect(await a.answer(now[0]!._id, 10)).toEqual({ status: "stale" });
    expect(await a.cloaked()).toBe(true);
    expect((await a.rows()).some((r) => r.kind === "roll")).toBe(false);
  });

  it("the GM declines: Cloaked stays, no roll", async () => {
    const a = await dim();
    await a.custom(7, 10);
    await a.move(4, 10);
    const [row] = await a.open();
    expect(await a.answer(row!._id, null)).toEqual({ status: "declined" });
    expect(await a.cloaked()).toBe(true);
  });

  it("a player cannot answer it", async () => {
    const a = await dim();
    await a.custom(7, 10);
    await a.move(4, 10);
    const [row] = await a.open();
    expect(await codeOf(a.player.mutation(api.featurePrompts.answerDifficulty, { campaignId: a.campaignId, requestId: row!._id, difficulty: 10, idempotencyKey: key() }))).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------- the target count payload (dcm-bxp.99.19.60)

describe("a rolled target count writes no expiresAt (dcm-bxp.99.19.60)", () => {
  it("the targetCount payload has no expiresAt", async () => {
    const a = await arena(() => ({ classId: "druid", subclassId: "warden-of-renewal", subclassRank: "specialization", hope: 4 }));
    await a.player.mutation(api.featurePrompts.rollCount, { campaignId: a.campaignId, characterId: a.w.characterA, featureId: WARDEN, idempotencyKey: key() });
    const [row] = (await a.requests()).filter((r) => r.kind === "targetCount");
    expect(row!.payload).not.toHaveProperty("expiresAt");
  });
});
