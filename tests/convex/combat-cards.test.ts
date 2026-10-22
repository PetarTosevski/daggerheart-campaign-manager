/**
 * Domain cards on the Combat Map (plan combat-actions CA4): the Hand, the refusals, costs and once-per limits, damage /
 * Stress / conditions on the encounter instances, enemy reaction rolls, tokens, sheet effects, manual steps, the GM's
 * sanction for out-of-range targets, undo, the GM playing for a character, one card per domain end to end, and what a
 * player receives (U1: never an enemy's HP, Stress, thresholds or Difficulty). Role checks: combat-cards-authz.test.ts.
 *
 * Dice are the server's own: Difficulty 1 enemies are always hit (2d12 ≥ 2), thresholds 100 / 200 make any damage Minor.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { allowWorldEmails, buildWorld, type Client } from "./authz/world";
import { errorCode, key } from "./helpers";

const STAT_KEYS = ["hp", "hpMax", "stress", "stressMax", "difficulty", "major", "severe", "thresholds", "adversaryBefore"];
const STAT_WORDS = /\b(HP|Stress|Difficulty|threshold|Minor|Major|Severe)\b|\(\d+\/\d+/;

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  return [];
}

/** No enemy stat field anywhere. A card roll's `difficulty` is allowed only when the card prints it (none used here do). */
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
const SOFT: Stats = { difficulty: 1, major: 100, severe: 200, hpMax: 5, stressMax: 3 };

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
  const enemy = (label: string, x: number, y: number, stats: Partial<Stats> = {}) =>
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
  /** Puts the cards in the character's loadout (and owned) with some Hope. */
  const holding = (cards: string[], extra: Partial<CharacterSheet> = {}) => edit(() => ({ domainCards: { owned: cards, loadout: cards.slice(0, 5) }, hope: 4, ...extra }));
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const rows = () => t.run((ctx) => ctx.db.query("actionLog").collect());
  const feed = (c: Client) => c.query(api.feed.list, { campaignId, paginationOpts: { numItems: 50, cursor: null } });
  const use = (c: Client, cardId: string, targetTokenIds: Id<"combatTokens">[], extra: Record<string, unknown> = {}) =>
    c.mutation(api.combatCards.useCard, { campaignId, characterId: w.characterA, mapId, cardId, targetTokenIds, choices: [], idempotencyKey: key(), ...extra });
  return { w, t, campaignId, mapId, gm, player, ...ids, enemy, instance, sheet, edit, holding, fear, rows, feed, use };
}

function resolved<T extends { status: string }>(r: T): Extract<T, { status: "resolved" }> {
  if (r.status !== "resolved") throw new Error(`expected a resolved use, got ${r.status}`);
  return r as Extract<T, { status: "resolved" }>;
}

describe("combatCards.useCard: refusals", () => {
  allowWorldEmails();

  it("refuses a card not in the loadout, an out-of-combat card, a passive use, an exhausted card and an unpaid cost", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    await a.holding(["bolt-beacon", "forager", "untouchable", "rain-of-blades", "hypnotic-shimmer"], { hope: 0 });
    expect(await code(a.use(a.player, "cinder-grasp", [bandit.tokenId]))).toBe("CARD_NOT_IN_LOADOUT");
    expect(await code(a.use(a.player, "forager", []))).toBe("CARD_NOT_COMBAT");
    expect(await code(a.use(a.player, "untouchable", []))).toBe("CARD_NOT_COMBAT");
    // Rain of Blades costs a Hope upfront (CB p.90): with none, refused before any roll.
    expect(await code(a.use(a.player, "rain-of-blades", []))).toBe("CARD_COST_UNPAID");
    await a.edit((s) => ({ featureUses: [...s.featureUses, { key: "card:hypnotic-shimmer", until: "rest" }] }));
    expect(await code(a.use(a.player, "hypnotic-shimmer", [bandit.tokenId]))).toBe("CARD_EXHAUSTED");
    expect((await a.rows()).filter((r) => r.kind === "combat")).toHaveLength(0);
  });

  it("refuses a bad target: an ally for an enemy card, a token out of sight, a bad choice id", async () => {
    const a = await arena();
    await a.holding(["cinder-grasp"]);
    expect(await code(a.use(a.player, "cinder-grasp", [a.bryn]))).toBe("COMBAT_TARGET_INVALID");
    // Behind Ash (facing east), out of the vision cone: not seen.
    const hidden = await a.enemy("Lurker", 1, 10);
    expect(await code(a.use(a.player, "cinder-grasp", [hidden.tokenId]))).toBe("COMBAT_NO_LINE_OF_SIGHT");
    expect(await code(a.use(a.player, "cinder-grasp", [], { choices: [{ id: "bogus", value: 1 }] }))).toBe("INVALID");
  });
});

describe("combatCards.useCard: resolving", () => {
  allowWorldEmails();

  it("Bolt Beacon: Spellcast vs the target, a Hope spent on success, damage and Vulnerable on the instance, public and GM rows", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    await a.holding(["bolt-beacon"], { hope: 3 });
    const fearBefore = await a.fear();
    const r = resolved(await a.use(a.player, "bolt-beacon", [bandit.tokenId]));
    expect(r.targets).toEqual([{ tokenId: bandit.tokenId, hit: true, defeated: false }]);
    expect(r.damage).toHaveLength(1);
    const withHope = r.roll!.outcome === "critical" || r.roll!.outcome === "successHope";
    // R8: the roll's own Hope can pay the success cost.
    expect((await a.sheet()).hope).toBe(3 + (withHope ? 1 : 0) - 1);
    expect(await a.fear()).toBe(fearBefore + r.fearDelta);
    const inst = await a.instance(bandit.instanceId);
    expect(inst.hp).toBe(1);
    expect(inst.conditions).toContain("vulnerable");
    // Bolt Beacon has no limit: still ready.
    const hand = await a.player.query(api.combatCards.hand, { campaignId: a.campaignId, characterId: a.w.characterA });
    expect(hand.loadout.find((c) => c.cardId === "bolt-beacon")!.state).toBe("ready");

    const combat = (await a.rows()).filter((row) => row.kind === "combat");
    const pub = combat.find((row) => row.visibility === "public")!;
    const gmRow = combat.find((row) => row.visibility === "gm")!;
    expect(pub._id).toBe(r.entryId);
    expect(pub.groupId).toBe(gmRow.groupId);
    expect(pub.summary).toContain("Bolt Beacon");
    expect(pub.summary).toContain("Bandit: Hit");
    expect(pub.summary).not.toMatch(STAT_WORDS);
    expect(gmRow.summary).toContain("Minor");
    expect(gmRow.adversaryBefore).toEqual([{ instanceId: bandit.instanceId, hp: 0, stress: 0, defeated: false, conditions: [], tags: [] }]);
  });

  it("a once-per-rest card on a success records card:<id>, greys on the Hand and is refused after; undo restores it all", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    await a.holding(["hypnotic-shimmer"]);
    const r = resolved(await a.use(a.player, "hypnotic-shimmer", [bandit.tokenId]));
    expect(r.success).toBe(true);
    expect((await a.sheet()).featureUses).toContainEqual({ key: "card:hypnotic-shimmer", until: "rest" });
    expect((await a.instance(bandit.instanceId)).stress).toBe(1);
    const hand = await a.player.query(api.combatCards.hand, { campaignId: a.campaignId, characterId: a.w.characterA });
    expect(hand.loadout[0]).toMatchObject({ cardId: "hypnotic-shimmer", state: "exhausted", resetLabel: "Back after a rest" });
    expect(await code(a.use(a.player, "hypnotic-shimmer", [bandit.tokenId]))).toBe("CARD_EXHAUSTED");

    await a.player.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await a.sheet()).featureUses.some((u) => u.key === "card:hypnotic-shimmer")).toBe(false);
    const inst = await a.instance(bandit.instanceId);
    expect(inst.stress).toBe(0);
    expect(inst.conditions).toEqual([]);
  });

  it("Chain Lightning: 2 Stress upfront, every enemy in Close is targeted, each makes a server reaction roll (GM row)", async () => {
    const a = await arena();
    const one = await a.enemy("Imp", 6, 10);
    const two = await a.enemy("Imp 2", 7, 10);
    await a.holding(["chain-lightning"], { stress: 0 });
    const r = resolved(await a.use(a.player, "chain-lightning", []));
    expect(r.targets.map((t) => t.tokenId).sort()).toEqual([one.tokenId, two.tokenId].sort());
    expect((await a.sheet()).stress).toBeGreaterThanOrEqual(1);
    const gmRow = (await a.rows()).find((row) => row.kind === "combat" && row.visibility === "gm")!;
    expect(gmRow.summary).toMatch(/reaction \d+ vs \d+/);
    const pub = (await a.rows()).find((row) => row.kind === "combat" && row.visibility === "public")!;
    expect(pub.summary).not.toMatch(/reaction/);
  });

  it("tokens on the card: Flight sets tokens and a self effect; undo clears them", async () => {
    const a = await arena();
    await a.holding(["flight"]);
    const r = await a.use(a.player, "flight", []);
    const result = resolved(r);
    const s = await a.sheet();
    if (result.success) {
      expect(s.cardTokens?.find((t) => t.cardId === "flight")?.count).toBeGreaterThanOrEqual(1);
    }
    await a.player.mutation(api.actionLog.undo, { entryId: result.entryId, idempotencyKey: key() });
    expect((await a.sheet()).cardTokens?.find((t) => t.cardId === "flight")).toBeUndefined();
  });

  it("manual steps post a feed row 'Ash used <card>: <text>' and come back as prompts", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    await a.holding(["cinder-grasp"]);
    const r = resolved(await a.use(a.player, "cinder-grasp", [bandit.tokenId]));
    expect(r.prompts.some((p) => p.kind === "manual" && p.text.startsWith("When a creature acts while On Fire"))).toBe(true);
    const manual = (await a.rows()).find((row) => row.kind === "feature")!;
    expect(manual.summary).toMatch(/^Ash used Cinder Grasp: When a creature acts while On Fire/);
    expect((await a.instance(bandit.instanceId)).tags).toContain("On Fire");
  });

  it("an out-of-range target waits for the GM: nothing rolled; decline closes it; approve resolves as the player", async () => {
    const a = await arena();
    const far = await a.enemy("Archer", 9, 10);
    await a.holding(["cinder-grasp"]);
    const r = await a.use(a.player, "cinder-grasp", [far.tokenId]);
    if (r.status !== "pending") throw new Error("expected pending");
    expect(r.outOfRange).toEqual([{ tokenId: far.tokenId, band: "close" }]);
    expect((await a.rows()).filter((row) => row.kind === "combat")).toHaveLength(0);
    const mine = await a.player.query(api.combatCards.pending, { campaignId: a.campaignId });
    expect(mine).toHaveLength(1);
    expectNoStats(mine);
    expect(await code(a.player.mutation(api.combatCards.sanction, { campaignId: a.campaignId, requestId: r.requestId, approve: true, idempotencyKey: key() }))).toBe("FORBIDDEN");
    const approved = await a.gm.mutation(api.combatCards.sanction, { campaignId: a.campaignId, requestId: r.requestId, approve: true, idempotencyKey: key() });
    expect(approved.status).toBe("resolved");
    const pub = (await a.rows()).find((row) => row.kind === "combat" && row.visibility === "public")!;
    expect(pub.actorId).toBe(a.w.users.player);
    expect((await a.instance(far.instanceId)).hp).toBe(1);
    expect(await code(a.gm.mutation(api.combatCards.sanction, { campaignId: a.campaignId, requestId: r.requestId, approve: false, idempotencyKey: key() }))).toBe("REQUEST_NOT_OPEN");

    const again = await a.use(a.player, "cinder-grasp", [far.tokenId]);
    if (again.status !== "pending") throw new Error("expected pending");
    expect(await a.gm.mutation(api.combatCards.sanction, { campaignId: a.campaignId, requestId: again.requestId, approve: false, idempotencyKey: key() })).toEqual({ status: "declined" });
  });

  it("Siphon Essence clears the HP the target marked (Dread notes, dcm-0ib) instead of a manual step", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    await a.holding(["siphon-essence"], { hp: 3 });
    const r = resolved(await a.use(a.player, "siphon-essence", [bandit.tokenId]));
    expect((await a.instance(bandit.instanceId)).hp).toBe(1);
    expect((await a.sheet()).hp).toBe(2);
    expect(r.prompts.some((p) => p.text.startsWith("You clear a number of Hit Points"))).toBe(false);
    expect((await a.sheet()).featureUses).toContainEqual({ key: "card:siphon-essence", until: "longRest" });
  });

  it("Reaper's Strike: a picked creature the roll missed is dropped and the use re-run with the same dice", async () => {
    const a = await arena();
    const ogre = await a.enemy("Ogre", 6, 10, { difficulty: 99, hpMax: 8 });
    const bandit = await a.enemy("Bandit", 6, 9, { hpMax: 8 });
    await a.holding(["reaper-s-strike"]);
    const r = resolved(await a.use(a.player, "reaper-s-strike", [ogre.tokenId, bandit.tokenId], { choices: [{ id: "picked", value: [ogre.tokenId] }] }));
    if (r.roll?.outcome === "critical") return;
    expect(r.targets).toContainEqual({ tokenId: ogre.tokenId, hit: false, defeated: false });
    // Without the re-run the "hit" gate holds for the bandit and the ogre would mark 5 HP.
    expect((await a.instance(ogre.instanceId)).hp).toBe(0);
    // Picking the hit target works.
    const b = await arena();
    const t = await b.enemy("Bandit", 6, 10, { hpMax: 8 });
    await b.holding(["reaper-s-strike"]);
    await b.use(b.player, "reaper-s-strike", [t.tokenId], { choices: [{ id: "picked", value: [t.tokenId] }] });
    expect((await b.instance(t.instanceId)).hp).toBe(5);
  });

  it("the GM plays for a character: the rows carry the character and the GM as actor", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    await a.holding(["cinder-grasp"]);
    const r = resolved(await a.use(a.gm, "cinder-grasp", [bandit.tokenId]));
    const pub = (await a.rows()).find((row) => row._id === r.entryId)!;
    expect(pub.characterId).toBe(a.w.characterA);
    expect(pub.actorId).toBe(a.w.users.gm);
  });

  it("an ally effect lands on the ally's sheet in its own undoable row", async () => {
    const a = await arena();
    await a.holding(["share-the-burden"]);
    await a.edit(() => ({ stress: 2 }), a.w.characterB);
    await a.edit(() => ({ stress: 0 }));
    const r = resolved(await a.use(a.player, "share-the-burden", [a.bryn], { choices: [{ id: "n:stress", value: 5 }] }));
    // Capped at Bryn's marked Stress (Grace notes): 2 cleared on Bryn, 2 marked on Ash, 2 Hope.
    expect((await a.sheet(a.w.characterB)).stress).toBe(0);
    expect((await a.sheet()).stress).toBe(2);
    const allyRow = (await a.rows()).find((row) => row.characterId === a.w.characterB)!;
    expect(allyRow.before).toBeDefined();
    await a.player.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await a.sheet(a.w.characterB)).stress).toBe(2);
  });

  it("what a player receives: the result, the Hand, the pending list and the feed carry no enemy stat", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    await a.holding(["book-of-tyfar"]);
    const r = resolved(await a.use(a.player, "book-of-tyfar", [bandit.tokenId], { spell: "wild-flame" }));
    expectNoStats(r);
    expectNoStats(await a.player.query(api.combatCards.hand, { campaignId: a.campaignId, characterId: a.w.characterA }));
    const page = await a.feed(a.player);
    expect(page.page.every((row) => row.visibility === "public")).toBe(true);
    for (const row of page.page) {
      expect(row.summary).not.toMatch(STAT_WORDS);
      // Wild Flame rolls against each target's Difficulty: the stored roll has none (it is only on the GM's row).
      expectNoStats(row);
    }
  });
});

describe("combatCards (CA4b): ranges from the card's origin, enemy effects, kept dice", () => {
  allowWorldEmails();

  it("Vicious Entangle's extra adversary is measured from the target: near it resolves, beyond Very Close of it waits for the GM", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 7, 10);
    const near = await a.enemy("Thug", 9, 10);
    // 7 squares from Ash (Far: in the pick's range from the caster) but 5 from the target (Close, beyond Very Close).
    const far = await a.enemy("Lookout", 12, 10);
    await a.holding(["vicious-entangle"], { hope: 4 });
    const second = (picked: Id<"combatTokens">) => ({ choices: [{ id: "optional:second", value: true }, { id: "picked", value: [picked] }] });
    const pending = await a.use(a.player, "vicious-entangle", [bandit.tokenId], second(far.tokenId));
    if (pending.status !== "pending") throw new Error(`expected pending, got ${pending.status}`);
    expect(pending.outOfRange).toEqual([{ tokenId: far.tokenId, band: "close" }]);
    expect((await a.rows()).filter((row) => row.kind === "combat")).toHaveLength(0);
    // The GM sanctions it (Q1): it resolves with the waived range.
    const approved = resolved(await a.gm.mutation(api.combatCards.sanction, { campaignId: a.campaignId, requestId: pending.requestId, approve: true, idempotencyKey: key() }));
    expect(approved.targets).toEqual([{ tokenId: bandit.tokenId, hit: true, defeated: false }]);
    expect((await a.instance(far.instanceId)).conditions).toContain("restrained");

    const r = resolved(await a.use(a.player, "vicious-entangle", [bandit.tokenId], second(near.tokenId)));
    expect(r.status).toBe("resolved");
    expect((await a.instance(near.instanceId)).conditions).toContain("restrained");
  });

  it("Chain Lightning checks each jump from the creature before it: a chain in Close links resolves, a gap waits for the GM", async () => {
    const a = await arena();
    const imp = await a.enemy("Imp", 8, 10, { hpMax: 30 });
    const link = await a.enemy("Imp 2", 13, 10, { hpMax: 30 });
    const link2 = await a.enemy("Imp 3", 18, 10, { hpMax: 30 });
    await a.holding(["chain-lightning"], { stress: 0 });
    // Imp 2 is 5 squares from Imp (Close), Imp 3 is 5 from Imp 2: each jump is in range though Imp 3 is Very Far from Ash.
    const chained = resolved(await a.use(a.player, "chain-lightning", [], { choices: [{ id: "followUp", value: [link.tokenId, link2.tokenId] }] }));
    expect(chained.targets.map((t) => t.tokenId)).toEqual([imp.tokenId]);
    await a.edit(() => ({ stress: 0 }));
    // Imp 3 alone is 10 squares from Imp (Far): beyond the chain's Close.
    const gap = await a.use(a.player, "chain-lightning", [], { choices: [{ id: "followUp", value: [link2.tokenId] }] });
    if (gap.status !== "pending") throw new Error(`expected pending, got ${gap.status}`);
    expect(gap.outOfRange).toEqual([{ tokenId: link2.tokenId, band: "far" }]);
  });

  it("Glyph of Nightfall lowers the instance's Difficulty in its effects; undo takes the effect back (adversaryBefore.effects)", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    await a.holding(["glyph-of-nightfall"], { hope: 3 });
    const r = resolved(await a.use(a.player, "glyph-of-nightfall", [bandit.tokenId]));
    const knowledge = Math.max(1, (await a.sheet()).traits.knowledge);
    const effects = (await a.instance(bandit.instanceId)).effects ?? [];
    expect(effects).toEqual([{ id: "card:glyph-of-nightfall:1", source: "Glyph of Nightfall", label: "Glyph of Nightfall", difficulty: -knowledge, until: "temporary" }]);
    expectNoStats(r);
    const gmRow = (await a.rows()).find((row) => row.kind === "combat" && row.visibility === "gm")!;
    expect(gmRow.adversaryBefore).toEqual([{ instanceId: bandit.instanceId, hp: 0, stress: 0, defeated: false, conditions: [], tags: [], effects: [] }]);
    const pub = (await a.rows()).find((row) => row._id === r.entryId)!;
    expect(pub.summary).not.toMatch(STAT_WORDS);

    await a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await a.instance(bandit.instanceId)).effects).toBeUndefined();
  });

  it("Blighting Strike's half damage lands on the instance as a modifier until its next hit", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    await a.holding(["blighting-strike"]);
    resolved(await a.use(a.player, "blighting-strike", [bandit.tokenId]));
    expect((await a.instance(bandit.instanceId)).effects).toEqual([
      { id: "card:blighting-strike:1", source: "Blighting Strike", label: "Blighted: next successful attack deals half damage", halfDamage: true, until: "hit" },
    ]);
  });

  it("a choice after the roll keeps the dice: asking again and answering resolve with the same dice, then they are dropped", async () => {
    const a = await arena();
    const bandit = await a.enemy("Bandit", 6, 10);
    await a.holding(["dark-whispers"], { stress: 0 });
    const touched = { id: "situations", value: ["You've made physical contact with them"] };
    const kept = () => a.t.run(async (ctx) => (await ctx.db.query("operations").collect()).filter((o) => o.kind === "card_dice"));

    const first = await a.use(a.player, "dark-whispers", [bandit.tokenId], { choices: [touched] });
    expect(first.status).toBe("needsChoice");
    expectNoStats(first);
    const [row] = await kept();
    const values = (row!.result as { values: number[] }).values;
    expect(values.length).toBeGreaterThanOrEqual(2);
    expect((await a.sheet()).stress).toBe(0);

    // Asking again (fishing) replays the kept dice: they don't change.
    expect((await a.use(a.player, "dark-whispers", [bandit.tokenId], { choices: [touched] })).status).toBe("needsChoice");
    expect(((await kept())[0]!.result as { values: number[] }).values).toEqual(values);

    // The answer resolves with the same Hope and Fear dice.
    const r = resolved(await a.use(a.player, "dark-whispers", [bandit.tokenId], { choices: [touched, { id: "opt:question", value: ["where"] }] }));
    expect(r.roll!.dice.map((d) => d.value)).toEqual(values.slice(0, r.roll!.dice.length));
    expect(r.prompts.some((p) => p.text === "Ask the GM: Where are they?")).toBe(true);
    expect(await kept()).toEqual([]);
  });
});

describe("combatCards: one card per domain end to end", () => {
  allowWorldEmails();

  const CASES: { domain: string; cardId: string; spell?: string; check: (a: Awaited<ReturnType<typeof arena>>, inst: { hp: number; stress: number; conditions: string[]; tags: string[] }) => void }[] = [
    { domain: "arcana", cardId: "cinder-grasp", check: (_a, i) => expect(i.hp).toBe(1) },
    { domain: "blade", cardId: "whirlwind", check: (_a, i) => expect(i.hp).toBe(1) },
    { domain: "bone", cardId: "know-thy-enemy", check: (_a, i) => expect(i.hp).toBe(0) },
    { domain: "codex", cardId: "book-of-tyfar", spell: "wild-flame", check: (_a, i) => expect([i.hp, i.stress]).toEqual([1, 1]) },
    { domain: "grace", cardId: "hypnotic-shimmer", check: (_a, i) => expect(i.stress).toBe(1) },
    { domain: "midnight", cardId: "rain-of-blades", check: (_a, i) => expect(i.hp).toBe(1) },
    { domain: "sage", cardId: "corrosive-projectile", check: (_a, i) => expect(i.hp).toBeGreaterThanOrEqual(1) },
    { domain: "splendor", cardId: "bolt-beacon", check: (_a, i) => expect(i.conditions).toContain("vulnerable") },
    { domain: "valor", cardId: "goad-them-on", check: (_a, i) => expect(i.stress).toBe(1) },
    { domain: "dread", cardId: "blighting-strike", check: (_a, i) => expect(i.hp).toBe(1) },
  ];

  for (const c of CASES) {
    it(`${c.domain}: ${c.cardId}`, async () => {
      const a = await arena();
      const bandit = await a.enemy("Bandit", 6, 10);
      await a.holding([c.cardId]);
      const targets = c.cardId === "rain-of-blades" ? [] : [bandit.tokenId];
      const r = resolved(await a.use(a.player, c.cardId, targets, c.spell ? { spell: c.spell } : {}));
      expect(r.targets).toContainEqual({ tokenId: bandit.tokenId, hit: true, defeated: false });
      expectNoStats(r);
      c.check(a, await a.instance(bandit.instanceId));
      const pub = (await a.rows()).find((row) => row._id === r.entryId)!;
      expect(pub.summary).not.toMatch(STAT_WORDS);
    });
  }
});

describe("AA2b: card damage to another PC, Onslaught on card attacks", () => {
  allowWorldEmails();

  const WALL = { spell: "wall-of-flame-cross", choices: [{ id: "situations", value: ["A creature passes through your Wall of Flame"] }] };
  const hitRows = (a: Awaited<ReturnType<typeof arena>>) => a.t.run(async (ctx) => (await ctx.db.query("combatRequests").collect()).filter((h) => h.kind === "incomingHit"));

  it("card damage to an ally opens the same incoming hit (user answer 2026-10-22): the ally answers, the hit resolves; undo reverts it", async () => {
    const a = await arena();
    await a.holding(["book-of-grynn"]);
    await a.edit(() => ({ hp: 0, armorMarked: 0, armorId: "chainmail-armor" }), a.w.characterB);
    const other = a.w.as("otherPlayer");
    const r = resolved(await a.use(a.player, "book-of-grynn", [a.bryn], WALL));
    // No manual "mark it on the sheet" prompt: the damage waits in Bryn's reaction window.
    expect(r.prompts.filter((p) => p.kind === "pcDamage")).toEqual([]);
    const [hit] = await hitRows(a);
    expect(hit!.payload.kind === "incomingHit" && hit!.payload.attacker).toEqual({ kind: "pc", characterId: a.w.characterA, label: "Ash", cardId: "book-of-grynn", feature: "Book of Grynn" });
    expect(hit!.payload.kind === "incomingHit" && hit!.payload.targetCharacterId).toBe(a.w.characterB);
    expect(hit!.status).toBe("open");
    const windows = await a.gm.query(api.adversaryActions.windows, { campaignId: a.campaignId });
    expect(windows[0]).toMatchObject({ requestId: hit!._id, attackerCharacterId: a.w.characterA, attackerLabel: "Ash", targetName: "Bryn" });
    expect("instanceId" in windows[0]!).toBe(false);
    // Ash doesn't answer their own card's hit; Bryn sees their own numbers.
    expect(await a.player.query(api.adversaryActions.pending, { campaignId: a.campaignId, characterId: a.w.characterA })).toEqual([]);
    const [view] = await other.query(api.adversaryActions.pending, { campaignId: a.campaignId, characterId: a.w.characterB });
    expect(view).toMatchObject({ requestId: hit!._id, role: "target", attackerLabel: "Ash", maxSlots: 1 });
    const answer = await other.mutation(api.adversaryActions.respond, { campaignId: a.campaignId, requestId: hit!._id, characterId: a.w.characterB, choice: { kind: "noArmor" }, idempotencyKey: key() });
    expect(answer.status).toBe("resolved");
    expect((await a.sheet(a.w.characterB)).hp).toBeGreaterThan(0);
    const all = await a.rows();
    const took = all.find((row) => row.characterId === a.w.characterB && row.summary.startsWith("Bryn took Ash's hit"));
    expect(took?.groupId).toBe(all.find((row) => row._id === r.entryId)!.groupId);
    // The card use's undo takes the hit back with it.
    await a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await a.sheet(a.w.characterB)).hp).toBe(0);
  });

  it("undoing a card use with the ally's hit still open declines the hit", async () => {
    const a = await arena();
    await a.holding(["book-of-grynn"]);
    await a.edit(() => ({ hp: 0, armorMarked: 0, armorId: "chainmail-armor" }), a.w.characterB);
    const r = resolved(await a.use(a.player, "book-of-grynn", [a.bryn], WALL));
    const [hit] = await hitRows(a);
    expect(hit!.status).toBe("open");
    await a.gm.mutation(api.actionLog.undo, { entryId: r.entryId, idempotencyKey: key() });
    expect((await a.t.run((ctx) => ctx.db.get("combatRequests", hit!._id)))!.status).toBe("declined");
    expect((await a.sheet(a.w.characterB)).hp).toBe(0);
  });

  it("Onslaught (CB p.330): a card attacking with the weapon's damage never deals beneath Major (user answer 2026-10-22)", async () => {
    const a = await arena();
    const plain = await a.enemy("Bandit", 6, 10);
    await a.holding(["whirlwind"]);
    resolved(await a.use(a.player, "whirlwind", [plain.tokenId]));
    expect((await a.instance(plain.instanceId)).hp).toBe(1);

    const b = await arena();
    const bandit = await b.enemy("Bandit", 6, 10);
    await b.holding(["whirlwind", "onslaught"]);
    resolved(await b.use(b.player, "whirlwind", [bandit.tokenId]));
    expect((await b.instance(bandit.instanceId)).hp).toBe(2);
    expect((await b.rows()).find((row) => row.visibility === "gm")!.summary).toMatch(/Major/);
  });
});
