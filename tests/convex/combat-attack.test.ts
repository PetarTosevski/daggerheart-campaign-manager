/**
 * Weapon attacks on the Combat Map (plan combat-actions CA3): hit / miss, damage on the encounter instances, Minion
 * picks, the GM's sanction for out-of-range targets, line of sight, undo, and what a player receives (U1: never an
 * enemy's HP, Stress, thresholds or Difficulty). Role checks are in combat-attack-authz.test.ts.
 *
 * Dice are the server's own: tests choose stats that make the outcome certain (Difficulty 1 always hits; thresholds
 * of 100 / 200 make any damage Minor) or branch on the recorded roll (a critical hits whatever the Difficulty).
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { WITH_HOPE } from "../../src/lib/domain/session-features/index";
import { campaignFearState } from "../../convex/lib/fear";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, key } from "./helpers";

/** Words and fields a player must never receive about an enemy (U1). */
const STAT_KEYS = ["hp", "hpMax", "stress", "stressMax", "difficulty", "major", "severe", "thresholds", "adversaryBefore"];
const STAT_WORDS = /\b(HP|Stress|Difficulty|threshold|Minor|Major|Severe)\b|\(\d+\/\d+/;

/** Every object key anywhere in a value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  return [];
}

function expectNoStats(value: unknown) {
  expect(keysOf(value).filter((k) => STAT_KEYS.includes(k))).toEqual([]);
}

async function code(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

type Stats = { difficulty: number; major: number | null; severe: number | null; hpMax: number; stressMax: number };
const SOFT: Stats = { difficulty: 1, major: 100, severe: 200, hpMax: 5, stressMax: 2 };

/**
 * The world (GM, playerA with Ash, playerB with Bryn) plus a live medium map with Ash's token at (5, 10) looking east,
 * Bryn's at (1, 1), and a running encounter. `enemy` adds an instance and its enemy token.
 */
async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
    const ash = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const bryn = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 6, y: 11, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, bryn, encounterId };
  });
  let order = 0;
  const enemy = async (label: string, x: number, y: number, stats: Partial<Stats> = {}, extra: { source?: { kind: "srd"; adversaryId: string } | { kind: "custom"; customId: Id<"customAdversaries"> }; minionCount?: number; resistance?: { physical: "none" | "resistant" | "immune"; magic: "none" | "resistant" | "immune" } } = {}) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: extra.source ?? { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        ...(extra.minionCount !== undefined ? { minionCount: extra.minionCount } : {}),
        stats: { ...SOFT, ...stats },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: [],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
        ...(extra.resistance ? { resistance: extra.resistance } : {}),
      });
      const tokenId = await ctx.db.insert("combatTokens", { campaignId, mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "adversary", adversaryId: instanceId }, side: "enemy", x, y, face: Math.PI });
      return { instanceId, tokenId };
    });
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const sheet = (id: Id<"characters"> = w.characterA) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const requests = () => t.run((ctx) => ctx.db.query("combatRequests").collect());
  const feed = (c: Client) => c.query(api.feed.list, { campaignId, paginationOpts: { numItems: 50, cursor: null } });
  const attack = (c: Client, targetTokenIds: Id<"combatTokens">[], extra: Record<string, unknown> = {}) =>
    c.mutation(api.combatActions.attack, {
      campaignId,
      characterId: w.characterA,
      mapId,
      targetTokenIds,
      slot: "primary",
      modifier: 0,
      experienceIds: [],
      advantage: 0,
      disadvantage: 0,
      help: 0,
      options: [],
      idempotencyKey: key(),
      ...extra,
    });
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, instance, sheet, fear, rows, requests, feed, attack };
}

type Arena = Awaited<ReturnType<typeof arena>>;

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected a resolved attack, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

/** A custom Minion block: "Minion (1)" so any damage gives extra picks. */
async function minionBlock(a: Arena): Promise<Id<"customAdversaries">> {
  const now = Date.now();
  return a.t.run((ctx) =>
    ctx.db.insert("customAdversaries", {
      campaignId: a.campaignId,
      name: "Rat",
      tier: 1,
      type: "Minion",
      description: "",
      motives: "",
      difficulty: 1,
      thresholds: { major: null, severe: null },
      hp: 1,
      stress: 1,
      attack: { modifier: 0, name: "Bite", range: "Melee", damage: "1 phy" },
      experiences: [],
      features: [{ name: "Minion (1)", kind: "passive", text: "This adversary is defeated when they take any damage." }],
      createdAt: now,
      updatedAt: now,
    }),
  );
}

describe("combatActions.attack: hit, damage and the two rows", () => {
  allowWorldEmails();

  it("hits, marks HP through the thresholds, applies Hope / Fear, and writes a public and a GM row", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    const fearBefore = await a.fear();
    const hopeBefore = (await a.sheet()).hope;
    const r = resolved(await a.attack(a.player, [bandit.tokenId]));
    expect(r.targets).toEqual([{ tokenId: bandit.tokenId, hit: true, defeated: false }]);
    expect(r.roll.kind).toBe("action");
    expect(r.roll.difficulty).toBeUndefined();
    expect(r.damage?.kind).toBe("damage");
    // Proficiency 1, a d8 weapon: one die (a critical adds the die's maximum to the roll, R2).
    expect(r.damage!.total).toBeGreaterThanOrEqual(1);
    // Thresholds 100 / 200: any damage is Minor, 1 HP (CB p.91).
    expect((await a.instance(bandit.instanceId)).hp).toBe(1);
    const withHope = r.roll.outcome === "critical" || r.roll.outcome === "successHope";
    expect((await a.sheet()).hope).toBe(hopeBefore + (withHope ? 1 : 0));
    expect(await a.fear()).toBe(fearBefore + r.fearGained);
    expect(r.fearGained).toBe(withHope ? 0 : 1);

    const rows = (await a.rows()).filter((row) => row.kind === "combat");
    expect(rows).toHaveLength(2);
    const pub = rows.find((row) => row.visibility === "public")!;
    const gmRow = rows.find((row) => row.visibility === "gm")!;
    expect(pub._id).toBe(r.entryId);
    expect(pub.groupId).toBe(gmRow.groupId);
    expect(pub.summary).toContain("Bandit: Hit");
    expect(pub.summary).toContain(`damage ${r.damage!.total}`);
    expect(pub.summary).not.toMatch(STAT_WORDS);
    expect(pub.adversaryBefore).toBeUndefined();
    expect(gmRow.summary).toContain("Minor");
    expect(gmRow.summary).toContain("1 HP (1/5)");
    expect(gmRow.characterId).toBeUndefined();
    expect(gmRow.adversaryBefore).toEqual([{ instanceId: bandit.instanceId, hp: 0, stress: 0, defeated: false }]);
    expect(gmRow.roll).toEqual(r.damage);
  });

  it("misses below the Difficulty (unless critical): no damage roll, nothing marked", async () => {
    const a = await arena();
    const ogre = await a.enemy("Ogre", 6, 10, { difficulty: 99 });
    const r = resolved(await a.attack(a.player, [ogre.tokenId]));
    if (r.roll.outcome === "critical") {
      // CB p.90: a critical hits whatever the Difficulty.
      expect(r.targets[0]!.hit).toBe(true);
      return;
    }
    expect(r.targets).toEqual([{ tokenId: ogre.tokenId, hit: false, defeated: false }]);
    expect(r.damage).toBeNull();
    expect((await a.instance(ogre.instanceId)).hp).toBe(0);
    const pub = (await a.rows()).find((row) => row.visibility === "public" && row.kind === "combat")!;
    expect(pub.summary).toContain("Ogre: Miss");
    expect(pub.summary).not.toContain("99");
  });

  it("defeats an instance whose last HP is marked and says Defeated", async () => {
    const a = await arena();
    const rat = await a.enemy("Rat", 6, 10, { hpMax: 1 });
    const r = resolved(await a.attack(a.player, [rat.tokenId]));
    expect(r.targets).toEqual([{ tokenId: rat.tokenId, hit: true, defeated: true }]);
    expect(await a.instance(rat.instanceId)).toMatchObject({ hp: 1, defeated: true });
    expect((await a.rows()).find((row) => row.visibility === "public" && row.kind === "combat")!.summary).toContain("Rat: Defeated");
  });

  it("applies immunity (CB p.99): a hit that marks nothing", async () => {
    const a = await arena();
    const ghost = await a.enemy("Ghost", 6, 10, {}, { resistance: { physical: "immune", magic: "none" } });
    const r = resolved(await a.attack(a.player, [ghost.tokenId]));
    expect(r.targets[0]).toMatchObject({ hit: true, defeated: false });
    expect((await a.instance(ghost.instanceId)).hp).toBe(0);
    const gmRow = (await a.rows()).find((row) => row.visibility === "gm")!;
    expect(gmRow.summary).toContain("immune: 0");
  });

  it("applies an SRD adversary's always-on resistance when the instance has none stored (CA2's table)", async () => {
    const a = await arena();
    // Skeleton Warrior: "resistant to physical damage" (CA2). Severe 2 so the halved damage still decides the HP.
    const skeleton = await a.enemy("Skeleton", 6, 10, { major: 1, severe: 100 }, { source: { kind: "srd", adversaryId: "skeleton-warrior" } });
    const r = resolved(await a.attack(a.player, [skeleton.tokenId]));
    const halved = Math.floor(r.damage!.total / 2);
    expect((await a.instance(skeleton.instanceId)).hp).toBe(halved >= 1 ? 2 : 0);
    expect((await a.rows()).find((row) => row.visibility === "gm")!.summary).toContain(`resistant: ${halved}`);
  });

  it("Onslaught in the loadout (CB p.330): a weapon hit marks at least Major, 2 HP; a miss marks nothing (CA4b)", async () => {
    const a = await arena();
    await a.t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", a.w.characterA))!.sheet);
      await saveSheet(ctx, a.w.characterA, { ...s, domainCards: { owned: [...s.domainCards.owned, "onslaught"], loadout: [...s.domainCards.loadout.slice(0, 4), "onslaught"] } });
    });
    // Thresholds 100 / 200: any damage is Minor (1 HP) without the floor.
    const bandit = await a.enemy("Bandit", 6, 10);
    resolved(await a.attack(a.player, [bandit.tokenId]));
    expect((await a.instance(bandit.instanceId)).hp).toBe(2);
    const gmRow = (await a.rows()).find((row) => row.kind === "combat" && row.visibility === "gm")!;
    expect(gmRow.summary).toContain("Major (Onslaught) → 2 HP");
    const pub = (await a.rows()).find((row) => row.kind === "combat" && row.visibility === "public")!;
    expect(pub.summary).not.toMatch(STAT_WORDS);
  });

  it("ticks armed countdowns like an action roll", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    const countdownId = await a.t.run((ctx) =>
      ctx.db.insert("countdowns", {
        campaignId: a.campaignId,
        name: "Reinforcements",
        description: "",
        category: "threat",
        startingValue: 5,
        currentValue: 5,
        status: "active",
        consequence: "",
        createdAt: Date.now(),
        armed: true,
      }),
    );
    await a.attack(a.player, [bandit.tokenId]);
    const after = await a.t.run((ctx) => ctx.db.get("countdowns", countdownId));
    expect(after!.currentValue).toBeLessThan(5);
  });
});

describe("combatActions.attack: targets, line of sight and range", () => {
  allowWorldEmails();

  it("refuses targets without line of sight (Q2) and targets that are not enemy instances of a running encounter", async () => {
    const a = await arena();
    // Behind Ash (who looks east): outside the vision cone, so not seen.
    const behind = await a.enemy("Lurker", 1, 10);
    expect(await code(a.attack(a.player, [behind.tokenId]))).toBe("COMBAT_NO_LINE_OF_SIGHT");
    // A PC token, a custom token, an empty list, a repeated token.
    expect(await code(a.attack(a.player, [a.bryn]))).toBe("COMBAT_TARGET_INVALID");
    const { tokenId: custom } = await a.gm.mutation(api.combatTokens.addCustom, { campaignId: a.campaignId, mapId: a.mapId, name: "Crate", hp: 3, side: "enemy", idempotencyKey: key() });
    await a.t.run((ctx) => ctx.db.patch("combatTokens", custom, { x: 7, y: 10 }));
    expect(await code(a.attack(a.player, [custom]))).toBe("COMBAT_TARGET_INVALID");
    expect(await code(a.attack(a.player, []))).toBe("COMBAT_TARGET_INVALID");
    const bandit = await a.enemy("Bandit", 6, 10);
    expect(await code(a.attack(a.player, [bandit.tokenId, bandit.tokenId]))).toBe("COMBAT_TARGET_INVALID");
    // The encounter ended: its instances can't be attacked.
    await a.t.run((ctx) => ctx.db.patch("encounters", a.encounterId, { status: "ended" }));
    expect(await code(a.attack(a.player, [bandit.tokenId]))).toBe("COMBAT_TARGET_INVALID");
    expect((await a.rows()).filter((row) => row.kind === "combat")).toEqual([]);
  });

  it("a plain weapon attack takes one target (CA4b, bead dcm-bxp.99.18): two are COMBAT_TARGET_INVALID with nothing rolled", async () => {
    const a = await arena();
    const one = await a.enemy("Bandit", 6, 10);
    const two = await a.enemy("Bandit 2", 7, 10);
    const hopeBefore = (await a.sheet()).hope;
    expect(await code(a.attack(a.player, [one.tokenId, two.tokenId]))).toBe("COMBAT_TARGET_INVALID");
    // Out of range too: still refused, not sent to the GM.
    const far = await a.enemy("Archer", 15, 10);
    expect(await code(a.attack(a.player, [one.tokenId, far.tokenId]))).toBe("COMBAT_TARGET_INVALID");
    expect((await a.rows()).filter((row) => row.kind === "combat")).toEqual([]);
    expect(await a.requests()).toEqual([]);
    expect((await a.sheet()).hope).toBe(hopeBefore);
    expect(resolved(await a.attack(a.player, [one.tokenId])).targets).toHaveLength(1);
  });

  it("refuses an attacker with no token on the live map, and a map that is not live", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    await a.t.run((ctx) => ctx.db.delete("combatTokens", a.ash));
    expect(await code(a.attack(a.player, [bandit.tokenId]))).toBe("COMBAT_TOKEN_NOT_FOUND");
    await a.t.run((ctx) => ctx.db.patch("combatMaps", a.mapId, { live: false }));
    expect(await code(a.attack(a.player, [bandit.tokenId]))).toBe("COMBAT_MAP_NOT_FOUND");
  });

  it("targets lists only seen enemy instances, with band, range, sight and cover and no stat", async () => {
    const a = await arena();
    const near = await a.enemy("Near", 6, 10);
    const far = await a.enemy("Far", 8, 10);
    await a.enemy("Lurker", 1, 10);
    const hints = await a.player.query(api.combatActions.targets, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId });
    expect(hints.map((h) => Object.keys(h).sort())).toEqual(hints.map(() => ["band", "cover", "inRange", "lineOfSight", "tokenId"]));
    expect(hints).toEqual(
      expect.arrayContaining([
        { tokenId: near.tokenId, band: "melee", inRange: true, lineOfSight: true, cover: false },
        { tokenId: far.tokenId, band: "veryClose", inRange: false, lineOfSight: true, cover: false },
      ]),
    );
    expect(hints).toHaveLength(2);
    expectNoStats(hints);
  });
});

describe("GM sanction for out-of-range targets (Q1)", () => {
  allowWorldEmails();

  it("waits for the GM with nothing rolled or charged; approval resolves it as the player's action", async () => {
    const a = await arena();
    const far = await a.enemy("Archer", 8, 10);
    const sheetBefore = await a.sheet();
    const fearBefore = await a.fear();
    const pending = await a.attack(a.player, [far.tokenId], { experienceIds: [] });
    expect(pending).toMatchObject({ status: "pending", outOfRange: [{ tokenId: far.tokenId, band: "veryClose" }] });
    if (pending.status !== "pending") throw new Error("expected pending");
    expect(await a.rows()).toEqual([]);
    expect(await a.sheet()).toEqual(sheetBefore);
    expect(await a.fear()).toBe(fearBefore);
    expect((await a.instance(far.instanceId)).hp).toBe(0);

    const mine = await a.player.query(api.combatRequests.mine, { campaignId: a.campaignId });
    expect(mine).toEqual([expect.objectContaining({ kind: "sanction", requestId: pending.requestId, characterName: "Ash", targets: [{ tokenId: far.tokenId, name: "Archer" }] })]);
    expectNoStats(mine);
    expect(await a.w.as("otherPlayer").query(api.combatRequests.mine, { campaignId: a.campaignId })).toEqual([]);
    expect((await a.gm.query(api.combatRequests.mine, { campaignId: a.campaignId })).map((m) => m.requestId)).toEqual([pending.requestId]);

    const approved = await a.gm.mutation(api.combatRequests.sanction, { campaignId: a.campaignId, requestId: pending.requestId, approve: true, idempotencyKey: key() });
    expect(approved.status).toBe("resolved");
    const pub = (await a.rows()).find((row) => row.visibility === "public" && row.kind === "combat")!;
    expect(pub.actorId).toBe(a.w.users.player);
    expect((await a.requests())[0]).toMatchObject({ status: "resolved", resolvedBy: a.w.users.gm });
    expect(await a.player.query(api.combatRequests.mine, { campaignId: a.campaignId })).toEqual([]);
    expect(await code(a.gm.mutation(api.combatRequests.sanction, { campaignId: a.campaignId, requestId: pending.requestId, approve: true, idempotencyKey: key() }))).toBe("REQUEST_NOT_OPEN");
  });

  it("a decline closes it with nothing rolled; an ended encounter declines on approval", async () => {
    const a = await arena();
    const far = await a.enemy("Archer", 8, 10);
    const first = await a.attack(a.player, [far.tokenId]);
    const second = await a.attack(a.player, [far.tokenId]);
    if (first.status !== "pending" || second.status !== "pending") throw new Error("expected pending");
    expect(await a.gm.mutation(api.combatRequests.sanction, { campaignId: a.campaignId, requestId: first.requestId, approve: false, idempotencyKey: key() })).toEqual({ status: "declined" });
    await a.t.run((ctx) => ctx.db.patch("encounters", a.encounterId, { status: "ended" }));
    expect(await a.player.query(api.combatRequests.mine, { campaignId: a.campaignId })).toEqual([]);
    expect(await a.gm.mutation(api.combatRequests.sanction, { campaignId: a.campaignId, requestId: second.requestId, approve: true, idempotencyKey: key() })).toEqual({ status: "declined" });
    expect(await a.rows()).toEqual([]);
    expect((await a.requests()).map((r) => r.status)).toEqual(["declined", "declined"]);
    expect((await a.requests()).every((r) => r.resolvedAt !== undefined)).toBe(true);
  });

  it("ending the encounter declines its open sanctions and Minion offers; deleting it does too", async () => {
    const a = await arena();
    const far = await a.enemy("Archer", 8, 10);
    const customId = await minionBlock(a);
    const pack = await a.enemy("Rats", 6, 10, { hpMax: 4, major: null, severe: null }, { source: { kind: "custom", customId }, minionCount: 4 });
    const pending = await a.attack(a.player, [far.tokenId]);
    const hit = resolved(await a.attack(a.player, [pack.tokenId]));
    expect(pending.status).toBe("pending");
    expect(hit.minionOffer).not.toBeNull();
    await a.gm.mutation(api.encounters.end, { campaignId: a.campaignId, encounterId: a.encounterId });
    const closed = await a.requests();
    expect(closed.map((r) => [r.kind, r.status])).toEqual([
      ["sanction", "declined"],
      ["minionOffer", "declined"],
    ]);
    expect(closed.every((r) => r.resolvedAt !== undefined && r.resolvedBy === a.w.users.gm)).toBe(true);

    const b = await arena();
    const archer = await b.enemy("Archer", 8, 10);
    await b.attack(b.player, [archer.tokenId]);
    await b.gm.mutation(api.encounters.remove, { campaignId: b.campaignId, encounterId: b.encounterId });
    expect((await b.requests()).map((r) => r.status)).toEqual(["declined"]);
  });

  it("an approval that has lost line of sight refuses and leaves the request open", async () => {
    const a = await arena();
    const far = await a.enemy("Archer", 8, 10);
    const pending = await a.attack(a.player, [far.tokenId]);
    if (pending.status !== "pending") throw new Error("expected pending");
    await a.t.run((ctx) => ctx.db.patch("combatTokens", far.tokenId, { x: 1, y: 10 }));
    expect(await code(a.gm.mutation(api.combatRequests.sanction, { campaignId: a.campaignId, requestId: pending.requestId, approve: true, idempotencyKey: key() }))).toBe("COMBAT_NO_LINE_OF_SIGHT");
    expect((await a.requests())[0]!.status).toBe("open");
  });
});

describe("Minion picks (Q6, CB p.201)", () => {
  allowWorldEmails();

  it("a hit Minion falls, the attacker picks extra Minions in range once, and undo takes it all back", async () => {
    const a = await arena();
    const customId = await minionBlock(a);
    const pack = await a.enemy("Rats", 6, 10, { hpMax: 4, major: null, severe: null }, { source: { kind: "custom", customId }, minionCount: 4 });
    const more = await a.enemy("More rats", 6, 9, { hpMax: 3, major: null, severe: null }, { source: { kind: "custom", customId }, minionCount: 3 });
    const r = resolved(await a.attack(a.player, [pack.tokenId]));
    expect((await a.instance(pack.instanceId)).hp).toBe(1);
    // Minion (1): every point of damage defeats one more Minion.
    const extra = r.damage!.total;
    expect(r.minionOffer).not.toBeNull();
    expect(r.minionOffer!.extra).toBe(extra);
    expect(r.minionOffer!.candidates).toEqual(
      expect.arrayContaining([
        { instanceId: pack.instanceId, tokenId: pack.tokenId, name: "Rats", available: Math.min(extra, 3) },
        { instanceId: more.instanceId, tokenId: more.tokenId, name: "More rats", available: Math.min(extra, 3) },
      ]),
    );
    expectNoStats(r);
    const mine = await a.player.query(api.combatRequests.mine, { campaignId: a.campaignId });
    expect(mine).toEqual([expect.objectContaining({ kind: "minionOffer", entryId: r.entryId, extra })]);

    // Too many picks, and a pick outside the offer, are refused.
    expect(await code(a.player.mutation(api.combatActions.pickMinions, { campaignId: a.campaignId, entryId: r.entryId, instanceIds: Array(extra + 1).fill(more.instanceId), idempotencyKey: key() }))).toBe("COMBAT_TARGET_INVALID");
    const bear = await a.enemy("Bear", 7, 10);
    expect(await code(a.player.mutation(api.combatActions.pickMinions, { campaignId: a.campaignId, entryId: r.entryId, instanceIds: [bear.instanceId], idempotencyKey: key() }))).toBe("COMBAT_TARGET_INVALID");

    const picked = await a.player.mutation(api.combatActions.pickMinions, { campaignId: a.campaignId, entryId: r.entryId, instanceIds: [more.instanceId], idempotencyKey: key() });
    expect(picked).toEqual({ status: "resolved", defeated: 1, targets: [{ tokenId: more.tokenId, defeated: false }] });
    expectNoStats(picked);
    expect((await a.instance(more.instanceId)).hp).toBe(1);
    expect(await code(a.player.mutation(api.combatActions.pickMinions, { campaignId: a.campaignId, entryId: r.entryId, instanceIds: [more.instanceId], idempotencyKey: key() }))).toBe("REQUEST_NOT_OPEN");
    const pickRows = (await a.rows()).filter((row) => row.summary.includes("Minion"));
    expect(pickRows.every((row) => row.groupId === pickRows[0]!.groupId)).toBe(true);
    expect(pickRows.find((row) => row.visibility === "public")!.summary).not.toMatch(STAT_WORDS);

    await a.player.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect(await a.instance(pack.instanceId)).toMatchObject({ hp: 0, defeated: false });
    expect(await a.instance(more.instanceId)).toMatchObject({ hp: 0, defeated: false });
  });

  it("undoing the attack declines an offer not yet picked", async () => {
    const a = await arena();
    const customId = await minionBlock(a);
    const pack = await a.enemy("Rats", 6, 10, { hpMax: 4, major: null, severe: null }, { source: { kind: "custom", customId }, minionCount: 4 });
    const r = resolved(await a.attack(a.player, [pack.tokenId]));
    expect(r.minionOffer).not.toBeNull();
    await a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await a.requests())[0]).toMatchObject({ kind: "minionOffer", status: "declined" });
    expect(await code(a.player.mutation(api.combatActions.pickMinions, { campaignId: a.campaignId, entryId: r.entryId, instanceIds: [pack.instanceId], idempotencyKey: key() }))).toBe("REQUEST_NOT_OPEN");
  });
});

describe("undo (U4)", () => {
  allowWorldEmails();

  it("the player or the GM undoes the group: instances, sheet and Fear come back", async () => {
    for (const who of ["player", "gm"] as const) {
      const a = await arena();
      const bandit = await a.enemy("Bandit", 6, 10);
      const sheetBefore = await a.sheet();
      const fearBefore = await a.fear();
      const r = resolved(await a.attack(a.player, [bandit.tokenId]));
      const res = await a.w.as(who).mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
      expect(res.undone).toHaveLength(2);
      expect(await a.instance(bandit.instanceId)).toMatchObject({ hp: 0, stress: 0, defeated: false });
      expect(await a.sheet()).toEqual(sheetBefore);
      expect(await a.fear()).toBe(fearBefore);
    }
  });

  it("refuses with UNDO_STALE once the instance changed after the attack; another player can't undo it", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    const r = resolved(await a.attack(a.player, [bandit.tokenId]));
    expect(await code(a.w.as("otherPlayer").mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() }))).toBe("FORBIDDEN");
    const gmRow = (await a.rows()).find((row) => row.visibility === "gm")!;
    expect(await code(a.player.mutation(api.actionLog.undo, { entryId: gmRow._id, idempotencyKey: key() }))).toBe("NOT_FOUND");
    await a.t.run((ctx) => ctx.db.patch("encounterAdversaries", bandit.instanceId, { stress: 1, updatedAt: Date.now() + 1000 }));
    expect(await code(a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() }))).toBe("UNDO_STALE");
  });

  it("a player gets the dice row's minute; the GM any time", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    const r = resolved(await a.attack(a.player, [bandit.tokenId]));
    await a.t.run(async (ctx) => {
      for (const row of await ctx.db.query("actionLog").collect()) await ctx.db.patch("actionLog", row._id, { at: row.at - 120_000 });
    });
    expect(await code(a.player.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() }))).toBe("UNDO_STALE");
  });
});

describe("the Slayer choice after an attack with Hope (K2, U2)", () => {
  allowWorldEmails();

  it("pendingChoices offers the attack's public row and storeSlayerDie takes back the Hope it gave", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10, { hpMax: 100 });
    const setSheet = (change: Record<string, unknown>) =>
      a.t.run(async (ctx) => saveSheet(ctx, a.w.characterA, { ...readSheet((await ctx.db.get("characters", a.w.characterA))!.sheet), ...change } as never));
    await setSheet({ subclassId: "call-of-the-slayer", proficiency: 2, sessionFeatures: {} });
    // The server's own dice: attack until a roll with Hope (each roll is one with Hope about half the time).
    let r: { entryId: Id<"actionLog"> } | undefined;
    for (let i = 0; i < 40 && r === undefined; i++) {
      await setSheet({ hope: 0 });
      const next = resolved(await a.attack(a.player, [bandit.tokenId]));
      if (WITH_HOPE.includes(next.roll.outcome)) r = next;
    }
    if (r === undefined) throw new Error("no roll with Hope in 40 attacks");
    const choices = await a.player.query(api.rolls.pendingChoices, { characterId: a.w.characterA });
    expect(choices.slayer?.entryId).toBe(r.entryId);
    const hope = (await a.sheet()).hope;
    expect(await a.player.mutation(api.rolls.storeSlayerDie, { characterId: a.w.characterA, entryId: r.entryId, idempotencyKey: key() })).toEqual({ slayerDice: 1, capacity: 2, hope: hope - 1 });
    expect((await a.player.query(api.rolls.pendingChoices, { characterId: a.w.characterA })).slayer).toBeNull();
  });
});

describe("what a player receives (U1)", () => {
  allowWorldEmails();

  it("the attack result and the player's feed hold no enemy HP, Stress, thresholds or Difficulty", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10, { difficulty: 3, hpMax: 7, major: 4, severe: 9 });
    const r = await a.attack(a.player, [bandit.tokenId]);
    expectNoStats(r);
    const page = await a.feed(a.player);
    expect(page.page.every((row) => row.visibility === "public")).toBe(true);
    const combat = page.page.filter((row) => row.kind === "combat");
    expect(combat).toHaveLength(1);
    for (const row of combat) {
      expect(row.summary).not.toMatch(STAT_WORDS);
      expect(row.roll?.difficulty).toBeUndefined();
    }
    expectNoStats(page.page);
    // The GM sees both rows.
    expect((await a.feed(a.gm)).page.filter((row) => row.kind === "combat")).toHaveLength(2);
  });
});
