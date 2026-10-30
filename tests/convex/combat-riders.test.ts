/**
 * Riders on map attacks, the after-roll step and Cloaked (plan sheet-drawer SD5; docs/tasks/TASK-SD-SD5.md).
 *
 * Expected values come from the book texts (printed pages, quoted in the task doc):
 * - Rage Up (CB p.330): "mark a Stress to gain a bonus to your damage roll equal to twice your Strength. You can Rage Up
 *   twice per attack."
 * - Hold Them Off (CB p.38): "Spend 3 Hope when you succeed on an attack with a weapon to use that same roll against two
 *   additional adversaries within range of the attack."
 * - Sneak Attack (CB p.42): "When you succeed on an attack while Cloaked or while an ally is within Melee range of your
 *   target, add a number of d6s equal to your tier to your damage roll." Cloaked: "After you make an attack or end a move
 *   within line of sight of an adversary, you are no longer Cloaked." (Q9: the map decides.)
 * - Patron's Boon (HF p.14): "When you fail a roll, you can spend 3 Hope to reroll with advantage." (Q1: the after-roll step.)
 * - True Strike (HF p.8): "Once per long rest when you fail an attack, you can spend a Hope to make it a success instead."
 * - First Strike (HF p.8): "The first time in a scene you succeed on an attack, you deal double damage."
 * - Death Strike (HF p.8): "When you deal Severe damage to a creature, you can mark a Stress to force them to mark an
 *   additional Hit Point."
 * - Kick (CB p.58): "When you succeed on an attack against a target within Melee range, you can mark a Stress to kick
 *   yourself off them, dealing an extra 2d6 damage and knocking back either yourself or the target to Very Close range."
 *
 * Dice are the server's own: tests choose stats that make the outcome certain (Difficulty 1 always hits; 99 misses unless
 * the roll is a critical) or branch on the recorded roll.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { inSightOfAdversary } from "../../convex/lib/combatMovement";
import { loadScene } from "../../convex/lib/combatVision";
import { bindGates, riderUse, splitSteps } from "../../convex/lib/cardRunner";
import { campaignFearState } from "../../convex/lib/fear";
import type { CardUse, Step } from "../../src/lib/domain/card-effects/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, key } from "./helpers";

/** Words and fields a player must never receive about an enemy (U1). */
const STAT_KEYS = ["hp", "hpMax", "stress", "stressMax", "difficulty", "major", "severe", "thresholds", "adversaryBefore"];

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  return [];
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
const SOFT: Stats = { difficulty: 1, major: 100, severe: 200, hpMax: 10, stressMax: 4 };

/**
 * The world plus a live map: Ash (characterA) at (5, 10) facing east, Bryn at (1, 1) (far from everything), a running
 * encounter. `enemy` adds an instance and its token.
 */
async function arena(options: { hopeAndFear?: boolean } = {}) {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  if (options.hopeAndFear) await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const token = { campaignId, mapId, size: 1, light: "none" as const, revealedTo: [] };
    const ash = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10, face: 0 });
    const bryn = await ctx.db.insert("combatTokens", { ...token, ref: { kind: "pc", characterId: w.characterB }, side: "pc", x: 1, y: 1, face: 0 });
    const encounterId = await ctx.db.insert("encounters", { campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
    return { ash, bryn, encounterId };
  });
  let order = 0;
  const enemy = async (label: string, x: number, y: number, stats: Partial<Stats> = {}) =>
    t.run(async (ctx) => {
      const instanceId = await ctx.db.insert("encounterAdversaries", {
        campaignId,
        encounterId: ids.encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label,
        order: order++,
        summoned: false,
        stats: { ...SOFT, ...stats },
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
  const instance = (id: Id<"encounterAdversaries">) => t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", id))!);
  const sheet = (id: Id<"characters"> = w.characterA) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (patch: (s: CharacterSheet) => Partial<CharacterSheet>, id: Id<"characters"> = w.characterA) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await saveSheet(ctx, id, { ...s, ...patch(s) });
    });
  const moveToken = (tokenId: Id<"combatTokens">, x: number, y: number) => t.run((ctx) => ctx.db.patch("combatTokens", tokenId, { x, y }));
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const requests = () => t.run((ctx) => ctx.db.query("combatRequests").collect());
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
  const afterRoll = (c: Client, requestId: Id<"combatRequests">, choice: Record<string, unknown>) => c.mutation(api.combatActions.afterRoll, { campaignId, requestId, choice: choice as never, idempotencyKey: key() });
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, instance, sheet, edit, moveToken, fear, rows, requests, attack, afterRoll };
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected a resolved attack, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

/** The damage modifier without a critical's added maximum (CB p.98: the weapon's dice at their maximum). */
const flatOf = (r: { roll: { outcome: string }; damage: { modifier: number; dice: { sides: number }[] } | null }) =>
  r.damage!.modifier - (r.roll.outcome === "critical" ? r.damage!.dice.reduce((s, d) => s + d.sides, 0) : 0);

/** The damage roll's dice that rolled (the critical's maximum is in the modifier). */
const damageDice = (r: { damage: { dice: { sides: number; dropped?: boolean }[] } | null }) => (r.damage?.dice ?? []).filter((d) => !d.dropped);

describe("riders before the roll", () => {
  allowWorldEmails();

  it("Rage Up (CB p.330): a Stress per Rage Up, +twice Strength to the damage each time; twice is the most", async () => {
    const a = await arena();
    await a.edit((s) => ({ level: 6, stress: 0, traits: { ...s.traits, strength: 2 }, domainCards: { owned: [...s.domainCards.owned, "rage-up"], loadout: [...s.domainCards.loadout, "rage-up"] } }));
    const bandit = await a.enemy("Bandit", 6, 10);
    const plain = resolved(await a.attack(a.player, [bandit.tokenId]));
    const base = flatOf(plain);

    const once = resolved(await a.attack(a.player, [bandit.tokenId], { riders: [{ source: "card", id: "rage-up", choices: [{ id: "n:times", value: 1 }] }] }));
    // Twice Strength 2.
    expect(flatOf(once) - base).toBe(4);
    expect(once.riders).toContain("Rage Up");
    // A critical clears a Stress (CB p.90) after Rage Up marked its own.
    expect((await a.sheet()).stress).toBe(once.roll.outcome === "critical" ? 0 : 1);

    const stressBefore = (await a.sheet()).stress;
    const twice = resolved(await a.attack(a.player, [bandit.tokenId], { riders: [{ source: "card", id: "rage-up", choices: [{ id: "n:times", value: 2 }] }] }));
    expect(flatOf(twice) - base).toBe(8);
    // A critical clears a Stress (CB p.90) after the two Rage Up marked theirs.
    expect((await a.sheet()).stress).toBe(Math.max(0, stressBefore + 2 - (twice.roll.outcome === "critical" ? 1 : 0)));

    expect(await code(a.attack(a.player, [bandit.tokenId], { riders: [{ source: "card", id: "rage-up", choices: [{ id: "n:times", value: 3 }] }] }))).toBe("INVALID");
  });

  it("refuses a rider the character doesn't hold, a use that isn't a rider, and the same rider twice", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    expect(await code(a.attack(a.player, [bandit.tokenId], { riders: [{ source: "card", id: "rage-up", choices: [] }] }))).toBe("CARD_NOT_IN_LOADOUT");
    expect(await code(a.attack(a.player, [bandit.tokenId], { riders: [{ source: "feature", id: "hope:ranger", choices: [] }] }))).toBe("FEATURE_NOT_OWNED");
    // The warrior's Hope feature (No Mercy) is a Use button, not a rider.
    expect(await code(a.attack(a.player, [bandit.tokenId], { riders: [{ source: "feature", id: "hope:warrior", choices: [] }] }))).toBe("INVALID");
    await a.edit((s) => ({ level: 6, domainCards: { owned: [...s.domainCards.owned, "rage-up"], loadout: [...s.domainCards.loadout, "rage-up"] } }));
    const twice = { source: "card", id: "rage-up", choices: [{ id: "n:times", value: 1 }] };
    expect(await code(a.attack(a.player, [bandit.tokenId], { riders: [twice, twice] }))).toBe("INVALID");
    // Nothing was written by the refusals.
    expect((await a.rows()).filter((r) => r.kind === "combat")).toHaveLength(0);
  });
});

describe("riders on a card's roll (useCard)", () => {
  allowWorldEmails();

  it("Rage Up on Whirlwind (CB p.330): a Stress, +twice Strength to the card's damage; any damage then reaches Major", async () => {
    const a = await arena();
    await a.edit((s) => ({ level: 6, stress: 0, traits: { ...s.traits, strength: 2 }, domainCards: { owned: [...s.domainCards.owned, "rage-up", "whirlwind"], loadout: ["whirlwind", "rage-up"] } }));
    // Major 5: a d8 weapon roll alone may stay Minor; with +4 any damage (1 or more) is at least 5.
    const bandit = await a.enemy("Bandit", 6, 10, { major: 5, severe: 100 });
    const r = await a.player.mutation(api.combatCards.useCard, {
      campaignId: a.campaignId,
      characterId: a.w.characterA,
      mapId: a.mapId,
      cardId: "whirlwind",
      targetTokenIds: [bandit.tokenId],
      choices: [],
      riders: [{ source: "card", id: "rage-up", choices: [{ id: "n:times", value: 1 }] }],
      idempotencyKey: key(),
    });
    if (r.status !== "resolved") throw new Error(`expected resolved, got ${r.status}`);
    expect(r.targets[0]!.hit).toBe(true);
    expect((await a.instance(bandit.instanceId)).hp).toBe(2);
    expect((await a.sheet()).stress).toBe(r.roll?.outcome === "critical" ? 0 : 1);
    const pub = (await a.rows()).find((row) => row._id === r.entryId)!;
    expect(pub.summary).toContain("Rage Up");
    // Undo restores the sheet from before Rage Up's Stress (U4).
    await a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await a.sheet()).stress).toBe(0);
    expect((await a.instance(bandit.instanceId)).hp).toBe(0);
  });

  it("refuses a rider on a card that makes no roll", async () => {
    const a = await arena();
    await a.edit((s) => ({ level: 6, domainCards: { owned: [...s.domainCards.owned, "rage-up"], loadout: [...s.domainCards.loadout, "rage-up"] } }));
    const bandit = await a.enemy("Bandit", 6, 10);
    const sheet = await a.sheet();
    const noRoll = sheet.domainCards.loadout.find((c) => c !== "rage-up")!;
    const r = await code(
      a.player.mutation(api.combatCards.useCard, { campaignId: a.campaignId, characterId: a.w.characterA, mapId: a.mapId, cardId: noRoll, targetTokenIds: [bandit.tokenId], choices: [], riders: [{ source: "card", id: "rage-up", choices: [] }], idempotencyKey: key() }),
    );
    expect(["INVALID", "CARD_NOT_COMBAT"]).toContain(r);
  });
});

describe("riders on the result", () => {
  allowWorldEmails();

  it("Hold Them Off (CB p.38): 3 Hope, the same roll against two more adversaries in range, damage on each", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "ranger", subclassId: "wayfinder", hope: 5 }));
    const one = await a.enemy("One", 6, 10);
    const two = await a.enemy("Two", 6, 9);
    const three = await a.enemy("Three", 6, 11);
    const r = resolved(await a.attack(a.player, [one.tokenId], { riders: [{ source: "feature", id: "hope:ranger", choices: [{ id: "picked", value: [two.tokenId, three.tokenId] }] }] }));
    expect(r.targets.map((x) => x.tokenId)).toEqual([one.tokenId, two.tokenId, three.tokenId]);
    expect(r.targets.every((x) => x.hit)).toBe(true);
    for (const e of [one, two, three]) expect((await a.instance(e.instanceId)).hp).toBe(1);
    const gained = r.roll.outcome === "critical" || r.roll.outcome === "successHope" ? 1 : 0;
    expect((await a.sheet()).hope).toBe(Math.min(6, 5 + gained) - 3);
    expect(r.riders).toContain("Hold Them Off");
    // U1: the player learns Hit / Miss only.
    expect(keysOf(r).filter((k) => STAT_KEYS.includes(k))).toEqual([]);
  });

  it("Hold Them Off on a miss is not used: nothing paid, no extra target", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "ranger", subclassId: "wayfinder", hope: 5 }));
    const ogre = await a.enemy("Ogre", 6, 10, { difficulty: 99 });
    const two = await a.enemy("Two", 6, 9, { difficulty: 99 });
    const r = resolved(await a.attack(a.player, [ogre.tokenId], { riders: [{ source: "feature", id: "hope:ranger", choices: [{ id: "picked", value: [two.tokenId] }] }] }));
    if (r.roll.outcome === "critical") return; // CB p.90: a critical hits, so Hold Them Off applies.
    expect(r.skipped).toEqual(["Hold Them Off"]);
    expect(r.targets).toHaveLength(1);
    const gained = r.roll.outcome === "successHope" || r.roll.outcome === "failHope" ? 1 : 0;
    expect((await a.sheet()).hope).toBe(5 + gained);
  });

  it("Hold Them Off refuses a target out of the weapon's range (no GM wait for an added target)", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "ranger", subclassId: "wayfinder", hope: 5 }));
    const one = await a.enemy("One", 6, 10);
    const far = await a.enemy("Far", 15, 10);
    const r = await code(a.attack(a.player, [one.tokenId], { riders: [{ source: "feature", id: "hope:ranger", choices: [{ id: "picked", value: [far.tokenId] }] }] }));
    // A critical or any success reaches the check; the attack is refused as a whole.
    expect(r).toBe("COMBAT_TARGET_INVALID");
  });

  it("Kick (CB p.58): the map confirms Melee; a Stress, +2d6 damage and the knock-back prompt", async () => {
    const a = await arena();
    await a.edit(() => ({ ancestry: { kind: "single", id: "faun" }, stress: 0 }));
    const bandit = await a.enemy("Bandit", 6, 10);
    const r = resolved(await a.attack(a.player, [bandit.tokenId], { riders: [{ source: "feature", id: "ancestry:faun:kick", choices: [{ id: "opt:knock", value: ["target"] }] }] }));
    expect(r.riders).toContain("Kick");
    // The weapon's dice plus Kick's 2d6 (as a total: the extra damage is added, R2).
    expect(r.damage!.modifier).toBeGreaterThanOrEqual(2);
    expect(r.riderPrompts?.some((p) => p.kind === "move")).toBe(true);
    expect((await a.sheet()).stress).toBe(r.roll.outcome === "critical" ? 0 : 1);
  });
});

describe("automatic riders", () => {
  allowWorldEmails();

  it("Sneak Attack (Q9): added when an ally's token is within Melee of the target, not otherwise; Cloaked ends after the attack", async () => {
    const a = await arena();
    await a.edit(() => ({ classId: "rogue", subclassId: "nightwalker" }));
    const bandit = await a.enemy("Bandit", 6, 10);
    // Bryn far away, Ash not Cloaked: no Sneak Attack, even when the player ticks it.
    const none = resolved(await a.attack(a.player, [bandit.tokenId], { damageOptions: ["sneakAttack"] }));
    expect(none.riders ?? []).not.toContain("Sneak Attack");
    expect(damageDice(none).filter((d) => d.sides === 6)).toHaveLength(0);

    // Bryn next to the Bandit: one d6 at tier 1 (CB p.42: "a number of d6s equal to your tier").
    await a.moveToken(a.bryn, 7, 10);
    const ally = resolved(await a.attack(a.player, [bandit.tokenId]));
    expect(ally.riders).toContain("Sneak Attack");
    expect(damageDice(ally).filter((d) => d.sides === 6).length).toBeGreaterThanOrEqual(1);

    // Cloaked, no ally near: Sneak Attack, then Cloaked ends (CB p.42).
    await a.moveToken(a.bryn, 1, 1);
    await a.edit(() => ({ conditions: ["cloaked"] }));
    const cloaked = resolved(await a.attack(a.player, [bandit.tokenId]));
    expect(cloaked.riders).toContain("Sneak Attack");
    expect((await a.sheet()).conditions).not.toContain("cloaked");
  });

  it("First Strike (HF p.8): the first success in a scene deals double damage, once", async () => {
    const a = await arena({ hopeAndFear: true });
    await a.edit(() => ({ classId: "assassin", subclassId: "executioners-guild" }));
    const bandit = await a.enemy("Bandit", 6, 10);
    const first = resolved(await a.attack(a.player, [bandit.tokenId]));
    expect(first.riders).toContain("First Strike");
    const second = resolved(await a.attack(a.player, [bandit.tokenId]));
    expect(second.riders ?? []).not.toContain("First Strike");
    expect((await a.sheet()).featureUses.some((u) => u.key === "feat:subclass:executioners-guild:first-strike" && u.until === "scene")).toBe(true);
    const gm = (await a.rows()).filter((r) => r.kind === "combat" && r.visibility === "public");
    expect(gm[0]!.summary).toContain("×2");
  });

  it("Death Strike (HF p.8): Severe damage, a Stress, one more Hit Point", async () => {
    const a = await arena({ hopeAndFear: true });
    await a.edit(() => ({ classId: "assassin", subclassId: "executioners-guild", subclassRank: "specialization", stress: 0 }));
    // Major 1, Severe 2: any 2+ damage is Severe (3 HP).
    const bandit = await a.enemy("Bandit", 6, 10, { major: 1, severe: 2, hpMax: 12 });
    const r = resolved(await a.attack(a.player, [bandit.tokenId], { riders: [{ source: "feature", id: "subclass:executioners-guild:death-strike", choices: [] }] }));
    if (r.damage!.total < 2) return;
    // First Strike doubles the first success too (HF p.8), still Severe.
    expect((await a.instance(bandit.instanceId)).hp).toBe(4);
    expect(r.riders).toContain("Death Strike");
    // Death Strike's Stress comes after the damage, so a critical's cleared Stress (CB p.90) doesn't cancel it.
    expect((await a.sheet()).stress).toBe(1);
    // Undo puts the instance back as it was before the attack (U4).
    const pub = (await a.rows()).find((row) => row.kind === "combat" && row.visibility === "public")!;
    await a.gm.mutation(api.actionLog.undo, { entryId: pub._id, idempotencyKey: key() });
    expect((await a.instance(bandit.instanceId)).hp).toBe(0);
  });
});

describe("the after-roll step (Q1)", () => {
  allowWorldEmails();

  /** A warlock (Patron's Boon) attacking a Difficulty 99 Ogre until the roll fails (a critical hits, CB p.90). */
  async function heldMiss() {
    const a = await arena({ hopeAndFear: true });
    await a.edit(() => ({ classId: "warlock", subclassId: "pact-of-the-endless", hope: 6 }));
    const ogre = await a.enemy("Ogre", 6, 10, { difficulty: 99 });
    for (let i = 0; i < 8; i++) {
      const r = await a.attack(a.player, [ogre.tokenId]);
      if (r.status === "awaiting") return { a, ogre, held: r };
      await a.edit(() => ({ hope: 6 }));
    }
    throw new Error("no failed roll in eight attacks");
  }

  it("holds a failed attack for Patron's Boon: Hit / Miss only, nothing written until answered", async () => {
    const { a, held } = await heldMiss();
    expect(held.targets).toEqual([{ tokenId: expect.any(String), hit: false }]);
    expect(held.options.map((o) => o.name)).toContain("Patron’s Boon");
    expect(keysOf(held).filter((k) => STAT_KEYS.includes(k))).toEqual([]);
    const open = (await a.requests()).filter((r) => r.status === "open" && r.kind === "afterRoll");
    expect(open).toHaveLength(1);
    // Earlier attacks may have hit with a critical; the held one wrote nothing.
    const before = (await a.rows()).length;
    const mine = await a.player.query(api.combatRequests.mine, { campaignId: a.campaignId });
    expect(mine.some((r) => r.kind === "afterRoll" && r.requestId === held.requestId)).toBe(true);
    expect((await a.rows()).length).toBe(before);
  });

  it("Use: 3 Hope, the roll is rerolled with advantage, and the attack resolves", async () => {
    const { a, held } = await heldMiss();
    const r = resolved(await a.afterRoll(a.player, held.requestId, { kind: "use", featureId: "hope:warlock", choices: [] }));
    expect(r.riders).toContain("Patron’s Boon");
    expect(r.roll.dice.some((d) => d.role === "advantage")).toBe(true);
    const gained = r.roll.outcome === "critical" || r.roll.outcome === "successHope" || r.roll.outcome === "failHope" ? 1 : 0;
    // CB p.90: the failed roll's Hope could pay; the roll was replaced, so only the new roll's Hope stays.
    expect((await a.sheet()).hope).toBe(6 - 3 + gained);
    expect(await code(a.afterRoll(a.player, held.requestId, { kind: "pass" }))).toBe("REQUEST_NOT_OPEN");
  });

  it("Pass: the same dice resolve the miss; the GM's Resolve now does the same for the player", async () => {
    const { a, held } = await heldMiss();
    const r = resolved(await a.afterRoll(a.player, held.requestId, { kind: "pass" }));
    expect(r.roll).toEqual(held.roll);
    expect(r.targets[0]!.hit).toBe(false);

    await a.edit(() => ({ hope: 6 }));
    const ogre2 = await a.enemy("Ogre 2", 6, 9, { difficulty: 99 });
    for (let i = 0; i < 8; i++) {
      const again = await a.attack(a.player, [ogre2.tokenId]);
      if (again.status !== "awaiting") continue;
      expect(await code(a.afterRoll(a.w.as("otherPlayer"), again.requestId, { kind: "pass" }))).toBe("FORBIDDEN");
      const gm = resolved(await a.afterRoll(a.gm, again.requestId, { kind: "pass" }));
      expect(gm.roll).toEqual(again.roll);
      const pub = (await a.rows()).find((row) => row._id === gm.entryId)!;
      expect(pub.actorId).toBe(a.w.users.player);
      return;
    }
  });

  it("refuses a feature the held roll doesn't offer", async () => {
    const { a, held } = await heldMiss();
    expect(await code(a.afterRoll(a.player, held.requestId, { kind: "use", featureId: "hope:witch", choices: [] }))).toBe("INVALID");
  });

  it("no after-roll feature ready: the attack resolves at once as before", async () => {
    const a = await arena({ hopeAndFear: true });
    // One Hope: even a failure with Hope (+1, CB p.90) leaves Patron's Boon's 3 Hope out of reach.
    await a.edit(() => ({ classId: "warlock", subclassId: "pact-of-the-endless", hope: 1 }));
    const ogre = await a.enemy("Ogre", 6, 10, { difficulty: 99 });
    const r = await a.attack(a.player, [ogre.tokenId]);
    expect(r.status).toBe("resolved");
  });
});

describe("rider parts (pure)", () => {
  const fixed = (value: number) => ({ kind: "fixed" as const, value });
  const steps: Step[] = [
    { kind: "modifyDamage", to: "targets", change: { kind: "add", amount: fixed(3) } },
    { kind: "markStress", to: "targets", amount: fixed(1) },
    { kind: "fear", to: "self", when: ["success"], change: "lose", amount: fixed(1) },
    { kind: "hope", to: "self", change: "gain", amount: fixed(1) },
  ];

  it("bindGates keeps the steps the host roll meets, without their move gates", () => {
    const hit = bindGates(steps, { success: true, critical: false, withHope: true, withFear: false });
    expect(hit.map((s) => s.kind)).toEqual(["modifyDamage", "markStress", "fear", "hope"]);
    expect(hit[2]!.when).toBeUndefined();
    expect(bindGates(steps, { success: false, critical: false, withHope: false, withFear: true }).map((s) => s.kind)).toEqual(["modifyDamage", "markStress", "hope"]);
  });

  it("splitSteps: folds and the actor's own steps before the damage, the rest after; a before-roll rider's gated steps wait", () => {
    expect(splitSteps(steps, "pre", false).map((s) => s.kind)).toEqual(["modifyDamage", "fear", "hope"]);
    expect(splitSteps(steps, "post", false).map((s) => s.kind)).toEqual(["markStress"]);
    expect(splitSteps(steps, "pre", true).map((s) => s.kind)).toEqual(["modifyDamage", "hope"]);
    expect(splitSteps(steps, "post", true).map((s) => s.kind)).toEqual(["markStress", "fear"]);
  });

  it("riderUse: `post` drops the costs, limit and requirements paid and checked in `pre`", () => {
    const use: CardUse = { id: "main", name: "X", activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } }, costs: [{ kind: "hope", amount: fixed(1) }], limit: { per: "rest" }, steps };
    const post = riderUse(use, "post", false, { success: true, critical: false, withHope: false, withFear: true });
    expect(post.costs).toBeUndefined();
    expect(post.limit).toBeUndefined();
    expect(riderUse(use, "pre", false, null).costs).toHaveLength(1);
  });
});

describe("Cloaked ends on a move in sight of an adversary (Q9, CB p.42)", () => {
  allowWorldEmails();

  it("inSightOfAdversary reads the map's line of sight from the enemy tokens", async () => {
    const a = await arena();
    await a.enemy("Bandit", 12, 10);
    const seen = await a.t.run(async (ctx) => {
      const campaign = (await ctx.db.get("campaigns", a.campaignId))!;
      const map = (await ctx.db.get("combatMaps", a.mapId))!;
      const scene = await loadScene(ctx, campaign, map);
      const ash = (await ctx.db.get("combatTokens", a.ash))!;
      return [inSightOfAdversary(scene, ash), inSightOfAdversary({ ...scene, tokens: scene.tokens.filter((t) => t.side !== "enemy") }, ash)];
    });
    expect(seen).toEqual([true, false]);
  });
});
