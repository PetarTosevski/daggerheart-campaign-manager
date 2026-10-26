import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,p2@example.com,out@example.com";

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId: WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

/**
 * The next dice the server rolls (`rollDie` reads one Uint32 per die; value − 1
 * gives that face on any die). Other random reads pass through.
 */
function forceDice(...faces: number[]) {
  const real = crypto.getRandomValues.bind(crypto);
  vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array && array.length === 1 && faces.length > 0) {
      array[0] = faces.shift()! - 1;
      return array;
    }
    return real(array as never) as T;
  });
}

/** A campaign with a GM, two players who each own a level-1 warrior at their last Hit Point, and an outsider. */
async function setup(frameId: "witherwild" | "castle-high" = "witherwild") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2, out] = [as(ids.gm), as(ids.p1), as(ids.p2), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;

  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const characterOf = (id: Id<"characters">) => t.run(async (ctx) => (await ctx.db.get("characters", id))!);
  const edit = (id: Id<"characters">, change: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, change(readSheet((await ctx.db.get("characters", id))!.sheet))));
  const lastHp = (s: CharacterSheet) => ({ ...s, hp: s.hpMax, stress: 3 });
  await edit(a, lastHp);
  await edit(b, lastHp);
  const row = (id: Id<"actionLog">) => t.run((ctx) => ctx.db.get("actionLog", id));
  return { t, ids, gm, p1, p2, out, campaignId, a, b, sheetOf, characterOf, edit, row };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("deathMoves", () => {
  useAllowlist(EMAILS);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows a death move only at the last Hit Point of an active, conscious character", async () => {
    const { p1, a, edit } = await setup();
    await edit(a, (s) => ({ ...s, hp: s.hpMax - 1 }));
    expect(await codeOf(p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
    await edit(a, (s) => ({ ...s, hp: s.hpMax, conditions: ["unconscious"] }));
    expect(await codeOf(p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
  });

  it("Avoid Death: unconscious, and a Hope Die at or under the level adds a scar", async () => {
    const { p1, p2, a, b, sheetOf } = await setup();
    forceDice(1, 12);
    const scarred = await p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() });
    expect(scarred).toMatchObject({ hopeDie: 1, scarred: true, journeyEnds: false, pending: null, status: "active" });
    expect((await sheetOf(a)).conditions).toContain("unconscious");
    expect((await sheetOf(a)).scars).toBe(1);

    const clean = await p2.mutation(api.deathMoves.choose, { characterId: b, move: "avoidDeath", idempotencyKey: key() });
    expect(clean).toMatchObject({ hopeDie: 12, scarred: false });
    expect((await sheetOf(b)).scars).toBe(0);
  });

  it("Avoid Death: a scar on the last Hope slot flags the journey's end; clearing a Hit Point wakes them", async () => {
    const { p1, a, edit, sheetOf } = await setup();
    await edit(a, (s) => ({ ...s, scars: 5, hope: 1 }));
    forceDice(1);
    const result = await p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() });
    expect(result.journeyEnds).toBe(true);
    expect((await sheetOf(a)).journeyEnds).toBe(true);

    await p1.mutation(api.characters.adjustResource, { characterId: a, resource: "hp", delta: -1 });
    expect((await sheetOf(a)).conditions).not.toContain("unconscious");
  });

  it("Blaze of Glory: a narrated critical success, then death taken by the Witherwild with Wither tokens", async () => {
    const { p1, a, edit, row, characterOf, gm } = await setup();
    await edit(a, (s) => ({ ...s, wither: 2 }));
    const first = await p1.mutation(api.deathMoves.choose, { characterId: a, move: "blazeOfGlory", action: "brings the tower down", idempotencyKey: key() });
    expect(first.pending).toEqual({ move: "blazeOfGlory" });
    expect((await row(first.entryId))?.roll?.outcome).toBe("critical");
    expect((await row(first.entryId))?.summary).toContain("brings the tower down");
    expect(await gm.query(api.deathMoves.state, { characterId: a })).toMatchObject({ pending: { move: "blazeOfGlory" }, awaitingMove: false });
    // A second move waits until this one is finished.
    expect(await codeOf(p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");

    const done = await p1.mutation(api.deathMoves.finishBlaze, { characterId: a, idempotencyKey: key() });
    expect(done.status).toBe("dead");
    expect((await characterOf(a)).status).toBe("dead");
    expect((await row(done.entryId))?.summary).toContain("taken by the Witherwild");
    expect(await codeOf(p1.mutation(api.deathMoves.finishBlaze, { characterId: a, idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
  });

  it("Risk It All: Hope higher waits for the player's split; Fear higher kills; matching dice clear everything", async () => {
    const { t, p1, gm, p2, a, b, sheetOf, characterOf, ids, campaignId } = await setup();
    forceDice(5, 2);
    const hope = await p1.mutation(api.deathMoves.choose, { characterId: a, move: "riskItAll", idempotencyKey: key() });
    expect(hope).toMatchObject({ hopeDie: 5, fearDie: 2, pending: { move: "riskItAll", value: 5 } });
    expect(await codeOf(p1.mutation(api.deathMoves.resolveRiskItAll, { characterId: a, hp: 1, stress: 1, idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
    const split = await p1.mutation(api.deathMoves.resolveRiskItAll, { characterId: a, hp: 3, stress: 2, idempotencyKey: key() });
    const sa = await sheetOf(a);
    expect([split.hp, split.stress, sa.hp, sa.stress]).toEqual([sa.hpMax - 3, 1, sa.hpMax - 3, 1]);

    forceDice(3, 9);
    const fear = await p2.mutation(api.deathMoves.choose, { characterId: b, move: "riskItAll", idempotencyKey: key() });
    expect(fear.status).toBe("dead");
    expect((await characterOf(b)).status).toBe("dead");

    // Reset Bryn by hand (manual revive stays) and roll matching dice.
    await gm.mutation(api.characters.setStatus, { characterId: b, status: "active" });
    forceDice(6, 6);
    const crit = await p2.mutation(api.deathMoves.choose, { characterId: b, move: "riskItAll", idempotencyKey: key() });
    expect(crit.pending).toBeNull();
    expect(await sheetOf(b)).toMatchObject({ hp: 0, stress: 0 });
    // No Fear is gained by a death move.
    const fearNow = await t.run(async (ctx) => (await ctx.db.query("campaignState").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).unique())!.fear);
    expect(fearNow).toBe(0);
    void ids;
  });

  it("Castle High less-lethal: death sends the character away until the GM returns them", async () => {
    const { p1, gm, a, characterOf, row } = await setup("castle-high");
    forceDice(2, 8);
    const result = await p1.mutation(api.deathMoves.choose, { characterId: a, move: "riskItAll", awayReason: "sentHome", idempotencyKey: key() });
    expect(result.status).toBe("away");
    expect(await characterOf(a)).toMatchObject({ status: "away", away: { reason: "sentHome" } });
    expect((await row(result.entryId))?.summary).toContain("sent home");
    // Away characters can't act.
    expect(await codeOf(p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");

    expect(await codeOf(p1.mutation(api.deathMoves.returnFromAway, { characterId: a, idempotencyKey: key() }))).toBe("FORBIDDEN");
    await gm.mutation(api.deathMoves.returnFromAway, { characterId: a, idempotencyKey: key() });
    const back = await characterOf(a);
    expect(back.status).toBe("active");
    expect(back.away).toBeUndefined();
    expect(await codeOf(gm.mutation(api.deathMoves.returnFromAway, { characterId: a, idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
  });

  it("Castle High less-lethal: Blaze of Glory ends in the infirmary by default", async () => {
    const { p1, a, characterOf } = await setup("castle-high");
    await p1.mutation(api.deathMoves.choose, { characterId: a, move: "blazeOfGlory", idempotencyKey: key() });
    const done = await p1.mutation(api.deathMoves.finishBlaze, { characterId: a, idempotencyKey: key() });
    expect(done.status).toBe("away");
    expect((await characterOf(a)).away).toEqual({ reason: "infirmary", requested: true });
  });

  it("LL1: a player's less-lethal pick is a request; the GM confirms it", async () => {
    const { p1, gm, a, characterOf, row } = await setup("castle-high");
    forceDice(2, 8);
    const result = await p1.mutation(api.deathMoves.choose, { characterId: a, move: "riskItAll", awayReason: "sentHome", idempotencyKey: key() });
    expect((await characterOf(a)).away).toEqual({ reason: "sentHome", requested: true });
    expect((await row(result.entryId))?.summary).toContain("the GM decides");
    expect((await p1.query(api.deathMoves.state, { characterId: a })).awayRequested).toBe(true);

    // The player can't settle their own request.
    expect(await codeOf(p1.mutation(api.deathMoves.settleAway, { characterId: a, reason: "infirmary", idempotencyKey: key() }))).toBe("FORBIDDEN");
    await gm.mutation(api.deathMoves.settleAway, { characterId: a, reason: "sentHome", idempotencyKey: key() });
    expect(await characterOf(a)).toMatchObject({ status: "away", away: { reason: "sentHome" } });
    expect((await characterOf(a)).away?.requested).toBeUndefined();
    expect((await gm.query(api.deathMoves.state, { characterId: a })).awayRequested).toBe(false);
    // Settled is final: nothing left to settle.
    expect(await codeOf(gm.mutation(api.deathMoves.settleAway, { characterId: a, reason: "infirmary", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
  });

  it("LL1 decision 5: back in play at full Hit Points, no death move until a Hit Point is cleared and marked again", async () => {
    const { p1, gm, a, characterOf, sheetOf } = await setup("castle-high");
    await p1.mutation(api.deathMoves.choose, { characterId: a, move: "blazeOfGlory", idempotencyKey: key() });
    await p1.mutation(api.deathMoves.finishBlaze, { characterId: a, idempotencyKey: key() });
    await gm.mutation(api.deathMoves.returnFromAway, { characterId: a, idempotencyKey: key() });
    // HP and Stress stay as they were; the prompt is not shown and the move is refused.
    const sheet = await sheetOf(a);
    expect(sheet.hp).toBe(sheet.hpMax);
    expect(sheet.stress).toBe(3);
    expect((await characterOf(a)).deathMoveSpent).toBe(true);
    expect((await p1.query(api.deathMoves.state, { characterId: a })).awaitingMove).toBe(false);
    expect(await codeOf(p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");

    // Clearing a Hit Point (saveSheet) clears the flag; marking the last one again asks for a death move.
    await p1.mutation(api.characters.adjustResource, { characterId: a, resource: "hp", delta: -1 });
    expect((await characterOf(a)).deathMoveSpent).toBeUndefined();
    expect((await p1.query(api.deathMoves.state, { characterId: a })).awaitingMove).toBe(false);
    await p1.mutation(api.characters.adjustResource, { characterId: a, resource: "hp", delta: 1 });
    expect((await p1.query(api.deathMoves.state, { characterId: a })).awaitingMove).toBe(true);
  });

  it("LL1 decision 5: undoing back below full Hit Points also clears the flag", async () => {
    const { t, p1, a, characterOf } = await setup();
    await p1.mutation(api.characters.adjustResource, { characterId: a, resource: "hp", delta: -1 });
    const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
    await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: agility, values: [8, 3], idempotencyKey: key() }); // with Hope: the sheet changes, so the row keeps a `before`
    const roll = await t.run(async (ctx) => (await ctx.db.query("actionLog").withIndex("by_character_at", (q) => q.eq("characterId", a)).collect()).at(-1)!);
    // The flag as Return to play leaves it (set directly, without touching updatedAt so the undo isn't stale).
    await t.run((ctx) => ctx.db.patch("characters", a, { deathMoveSpent: true }));
    expect(roll.before).toBeDefined();
    await p1.mutation(api.actionLog.undo, { entryId: roll._id, idempotencyKey: key() });
    expect((await characterOf(a)).deathMoveSpent).toBeUndefined();
  });

  it("LL1 decision 5: back in play below full Hit Points sets no flag", async () => {
    const { p1, gm, a, edit, characterOf } = await setup("castle-high");
    await p1.mutation(api.deathMoves.choose, { characterId: a, move: "blazeOfGlory", idempotencyKey: key() });
    await p1.mutation(api.deathMoves.finishBlaze, { characterId: a, idempotencyKey: key() });
    await edit(a, (s) => ({ ...s, hp: s.hpMax - 2 }));
    await gm.mutation(api.deathMoves.returnFromAway, { characterId: a, idempotencyKey: key() });
    expect((await characterOf(a)).deathMoveSpent).toBeUndefined();
  });

  it("LL1: the GM changes a player's request, and the GM's own death move is final at once", async () => {
    const { p1, gm, a, b, characterOf } = await setup("castle-high");
    await p1.mutation(api.deathMoves.choose, { characterId: a, move: "blazeOfGlory", idempotencyKey: key() });
    await p1.mutation(api.deathMoves.finishBlaze, { characterId: a, awayReason: "infirmary", idempotencyKey: key() });
    await gm.mutation(api.deathMoves.settleAway, { characterId: a, reason: "sentHome", idempotencyKey: key() });
    expect((await characterOf(a)).away).toEqual({ reason: "sentHome" });

    await gm.mutation(api.deathMoves.choose, { characterId: b, move: "blazeOfGlory", idempotencyKey: key() });
    await gm.mutation(api.deathMoves.finishBlaze, { characterId: b, awayReason: "sentHome", idempotencyKey: key() });
    expect((await characterOf(b)).away).toEqual({ reason: "sentHome" });
    expect((await gm.query(api.deathMoves.state, { characterId: b })).awayRequested).toBe(false);
    expect(await codeOf(gm.mutation(api.deathMoves.settleAway, { characterId: b, reason: "infirmary", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
    // An active character has no request either.
    await gm.mutation(api.deathMoves.returnFromAway, { characterId: b, idempotencyKey: key() });
    expect(await codeOf(gm.mutation(api.deathMoves.settleAway, { characterId: b, reason: "infirmary", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
  });

  it("undo restores the sheet and the status, and reopens the move's earlier step", async () => {
    const { p1, gm, a, b, p2, sheetOf, characterOf } = await setup();
    forceDice(1);
    const avoid = await p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() });
    const undone = await p1.mutation(api.deathMoves.undo, { entryId: avoid.entryId, idempotencyKey: key() });
    expect(undone).toMatchObject({ undone: [avoid.entryId], status: "active" });
    expect(await sheetOf(a)).toMatchObject({ conditions: [], scars: 0 });
    expect((await gm.query(api.deathMoves.state, { characterId: a })).awaitingMove).toBe(true);

    await p2.mutation(api.deathMoves.choose, { characterId: b, move: "blazeOfGlory", idempotencyKey: key() });
    const dead = await p2.mutation(api.deathMoves.finishBlaze, { characterId: b, idempotencyKey: key() });
    // Another player can't undo it; the GM can.
    expect(await codeOf(p1.mutation(api.deathMoves.undo, { entryId: dead.entryId, idempotencyKey: key() }))).toBe("FORBIDDEN");
    const revived = await gm.mutation(api.deathMoves.undo, { entryId: dead.entryId, idempotencyKey: key() });
    expect(revived.status).toBe("active");
    expect((await characterOf(b)).status).toBe("active");
    expect((await gm.query(api.deathMoves.state, { characterId: b })).pending).toEqual({ move: "blazeOfGlory" });
    // An older row is stale while a newer one stands.
    expect(await codeOf(gm.mutation(api.deathMoves.undo, { entryId: dead.entryId, idempotencyKey: key() }))).toBe("UNDO_STALE");
  });

  it("X6: a death-move away character comes back (return or undo) only into a free slot; the owner can't bring them back", async () => {
    const { p1, gm, a, campaignId, characterOf } = await setup("castle-high");
    await p1.mutation(api.deathMoves.choose, { characterId: a, move: "blazeOfGlory", idempotencyKey: key() });
    const gone = await p1.mutation(api.deathMoves.finishBlaze, { characterId: a, idempotencyKey: key() });
    expect(gone.status).toBe("away");
    // The owner can't bring back a death-move away character; "away" again changes nothing (no bench).
    expect(await codeOf(p1.mutation(api.characters.setStatus, { characterId: a, status: "active" }))).toBe("FORBIDDEN");
    await p1.mutation(api.characters.setStatus, { characterId: a, status: "away" });
    expect((await characterOf(a)).away).toEqual({ reason: "infirmary", requested: true });

    // The player makes a new character; Ash can't come back while it is active.
    const { characterId: fresh } = await p1.mutation(api.characters.create, { campaignId, draft: draft("Cid"), idempotencyKey: key() });
    expect(await codeOf(gm.mutation(api.deathMoves.undo, { entryId: gone.entryId, idempotencyKey: key() }))).toBe("INVALID");
    expect((await characterOf(a)).status).toBe("away");
    expect(await codeOf(gm.mutation(api.deathMoves.returnFromAway, { characterId: a, idempotencyKey: key() }))).toBe("INVALID");

    // Once the new one is benched, the undo goes through.
    await p1.mutation(api.characters.setStatus, { characterId: fresh, status: "away" });
    expect((await gm.mutation(api.deathMoves.undo, { entryId: gone.entryId, idempotencyKey: key() })).status).toBe("active");
  });

  it("anonymous, outsider, player and GM", async () => {
    const { t, p1, p2, gm, out, a, b } = await setup("castle-high");
    const choose = (who: typeof gm, characterId: Id<"characters">) =>
      codeOf(who.mutation(api.deathMoves.choose, { characterId, move: "blazeOfGlory", idempotencyKey: key() }));
    expect(await choose(t as typeof gm, a)).toBe("UNAUTHENTICATED");
    expect(await choose(out, a)).toBe("NOT_FOUND");
    expect(await choose(p2, a)).toBe("FORBIDDEN");
    expect(await choose(p1, a)).toBe("ok");
    expect(await choose(gm, b)).toBe("ok");

    const finish = (who: typeof gm, characterId: Id<"characters">) => codeOf(who.mutation(api.deathMoves.finishBlaze, { characterId, idempotencyKey: key() }));
    expect(await finish(t as typeof gm, a)).toBe("UNAUTHENTICATED");
    expect(await finish(out, a)).toBe("NOT_FOUND");
    expect(await finish(p2, a)).toBe("FORBIDDEN");
    expect(await finish(p1, a)).toBe("ok");
    expect(await finish(gm, b)).toBe("ok");

    const back = (who: typeof gm, characterId: Id<"characters">) => codeOf(who.mutation(api.deathMoves.returnFromAway, { characterId, idempotencyKey: key() }));
    expect(await back(t as typeof gm, a)).toBe("UNAUTHENTICATED");
    expect(await back(out, a)).toBe("NOT_FOUND");
    expect(await back(p1, a)).toBe("FORBIDDEN");
    expect(await back(gm, a)).toBe("ok");

    // Bryn is away by the GM's hand: final, so the GM reaches the rule.
    const settle = (who: typeof gm) => codeOf(who.mutation(api.deathMoves.settleAway, { characterId: b, reason: "infirmary", idempotencyKey: key() }));
    expect(await settle(t as typeof gm)).toBe("UNAUTHENTICATED");
    expect(await settle(out)).toBe("NOT_FOUND");
    expect(await settle(p1)).toBe("FORBIDDEN");
    expect(await settle(p2)).toBe("FORBIDDEN");
    expect(await settle(gm)).toBe("DEATH_MOVE_RULE");

    const split = (who: typeof gm) => codeOf(who.mutation(api.deathMoves.resolveRiskItAll, { characterId: a, hp: 1, stress: 0, idempotencyKey: key() }));
    expect(await split(t as typeof gm)).toBe("UNAUTHENTICATED");
    expect(await split(out)).toBe("NOT_FOUND");
    expect(await split(p2)).toBe("FORBIDDEN");
    // Nothing is waiting for a split: the owner and the GM reach the rule.
    expect(await split(p1)).toBe("DEATH_MOVE_RULE");
    expect(await split(gm)).toBe("DEATH_MOVE_RULE");

    const state = (who: typeof gm) => codeOf(who.query(api.deathMoves.state, { characterId: a }));
    expect(await state(t as typeof gm)).toBe("UNAUTHENTICATED");
    expect(await state(out)).toBe("NOT_FOUND");
    expect(await state(p2)).toBe("ok");
    expect(await state(gm)).toBe("ok");
    expect((await gm.query(api.deathMoves.state, { characterId: a })).lessLethal).toBe(true);

    // Bryn's latest death row (went away by the GM's hand).
    const entryId = (await gm.query(api.deathMoves.state, { characterId: b })).undoEntryId!;
    const undo = (who: typeof gm) => codeOf(who.mutation(api.deathMoves.undo, { entryId, idempotencyKey: key() }));
    expect(await undo(t as typeof gm)).toBe("UNAUTHENTICATED");
    expect(await undo(out)).toBe("NOT_FOUND");
    expect(await undo(p2)).toBe("FORBIDDEN");
    expect(await undo(gm)).toBe("ok");
  });
});
