import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key } from "./helpers";
import { makeTest } from "./setup";

// HD4 (plan combat-hud, answer 15b): a player's death move waits for the GM's confirm; dice and outcome at confirm.

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

/** The next dice the server rolls (`rollDie` reads one Uint32 per die), and how many it rolled. */
function forceDice(...faces: number[]) {
  const real = crypto.getRandomValues.bind(crypto);
  const rolled = { count: 0 };
  vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array && array.length === 1) {
      rolled.count += 1;
      if (faces.length > 0) {
        array[0] = faces.shift()! - 1;
        return array;
      }
    }
    return real(array as never) as T;
  });
  return rolled;
}

/** A GM, two players each owning a level-1 warrior at their last Hit Point, and an outsider. */
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
  await edit(a, (s) => ({ ...s, hp: s.hpMax, stress: 3 }));
  await edit(b, (s) => ({ ...s, hp: s.hpMax, stress: 3 }));
  const row = (id: Id<"actionLog">) => t.run((ctx) => ctx.db.get("actionLog", id));
  const feed = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const state = (id: Id<"characters"> = a) => gm.query(api.deathMoves.state, { characterId: id });
  return { t, gm, p1, p2, out, campaignId, a, b, sheetOf, characterOf, edit, row, feed, state };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("HD4: a player's death move waits for the GM's confirm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("choose by a player stores the move as waiting: nothing rolled or applied, one undoable feed row", async () => {
    const { p1, a, sheetOf, characterOf, row, state, p2 } = await setup();
    const before = await sheetOf(a);
    const dice = forceDice();
    const r = await p1.mutation(api.deathMoves.choose, { characterId: a, move: "blazeOfGlory", action: "  holds the gate  ", idempotencyKey: key() });
    expect(r).toMatchObject({ awaitingGm: true, status: "active", pending: null, hopeDie: null, fearDie: null });
    expect(dice.count).toBe(0);
    expect(await sheetOf(a)).toEqual(before);
    expect((await characterOf(a)).deathRequest).toMatchObject({ move: "blazeOfGlory", action: "holds the gate", entryId: r.entryId });
    const logged = (await row(r.entryId))!;
    expect(logged).toMatchObject({ kind: "death", visibility: "public", undoable: true });
    expect(logged.roll).toBeUndefined();
    expect(logged.before).toBeUndefined();
    expect(logged.summary).toBe("Ash chooses Blaze of Glory: holds the gate. Waiting for the GM to confirm.");
    // Everyone who sees the character reads the wait; the Undo is for its player (nothing rolled) and the GM only.
    const seen = await p2.query(api.deathMoves.state, { characterId: a });
    expect(seen).toMatchObject({ awaitingMove: false, pending: null, request: { move: "blazeOfGlory", action: "holds the gate", entryId: r.entryId }, undoEntryId: null });
    expect(await state()).toEqual({ ...seen, undoEntryId: r.entryId });
    expect(await p1.query(api.deathMoves.state, { characterId: a })).toEqual({ ...seen, undoEntryId: r.entryId });
  });

  it("nothing else is chosen while a move waits, by the player or the GM", async () => {
    const { p1, gm, a } = await setup();
    await p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() });
    expect(await codeOf(p1.mutation(api.deathMoves.choose, { characterId: a, move: "riskItAll", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
    expect(await codeOf(gm.mutation(api.deathMoves.choose, { characterId: a, move: "riskItAll", idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
  });

  it("the GM's own choose (any character) is made at once", async () => {
    const { gm, a, sheetOf } = await setup();
    forceDice(12);
    const r = await gm.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() });
    expect(r).toMatchObject({ awaitingGm: false, hopeDie: 12, scarred: false });
    expect((await sheetOf(a)).conditions).toContain("unconscious");
  });

  it("confirm rolls and applies the move; the GM's undo takes back both rows and the move is due again", async () => {
    const { p1, gm, a, sheetOf, state, row } = await setup();
    const asked = await p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() });
    const dice = forceDice(1);
    const done = await gm.mutation(api.deathMoves.confirm, { characterId: a, idempotencyKey: key() });
    expect(dice.count).toBe(1);
    expect(done).toMatchObject({ awaitingGm: false, hopeDie: 1, scarred: true, pending: null, status: "active" });
    expect(await sheetOf(a)).toMatchObject({ scars: 1 });
    expect((await sheetOf(a)).conditions).toContain("unconscious");
    expect(await state()).toMatchObject({ request: null, awaitingMove: false, undoEntryId: done.entryId });
    expect((await row(done.entryId))?.actorId).not.toBe((await row(asked.entryId))?.actorId);

    // The player can't undo the GM's confirmed move (the dice rolled: no Undo shown); the GM can, which also takes the
    // request back.
    expect((await p1.query(api.deathMoves.state, { characterId: a })).undoEntryId).toBeNull();
    expect(await codeOf(p1.mutation(api.deathMoves.undo, { entryId: done.entryId, idempotencyKey: key() }))).toBe("FORBIDDEN");
    const undone = await gm.mutation(api.deathMoves.undo, { entryId: done.entryId, idempotencyKey: key() });
    expect(new Set(undone.undone)).toEqual(new Set([done.entryId, asked.entryId]));
    expect(await sheetOf(a)).toMatchObject({ scars: 0, conditions: [] });
    expect(await state()).toMatchObject({ request: null, awaitingMove: true, undoEntryId: null });
  });

  it("confirm keeps Blaze of Glory's and Risk It All's second steps, taken by the player", async () => {
    const { p1, p2, gm, a, b, characterOf, sheetOf, state } = await setup();
    await p1.mutation(api.deathMoves.choose, { characterId: a, move: "blazeOfGlory", idempotencyKey: key() });
    const blaze = await gm.mutation(api.deathMoves.confirm, { characterId: a, idempotencyKey: key() });
    expect(blaze.pending).toEqual({ move: "blazeOfGlory" });
    const finished = await p1.mutation(api.deathMoves.finishBlaze, { characterId: a, idempotencyKey: key() });
    expect((await characterOf(a)).status).toBe("dead");

    await p2.mutation(api.deathMoves.choose, { characterId: b, move: "riskItAll", idempotencyKey: key() });
    forceDice(5, 2);
    const risk = await gm.mutation(api.deathMoves.confirm, { characterId: b, idempotencyKey: key() });
    expect(risk).toMatchObject({ hopeDie: 5, fearDie: 2, pending: { move: "riskItAll", value: 5 } });
    expect((await state(b)).pending).toEqual({ move: "riskItAll", value: 5 });
    const split = await p2.mutation(api.deathMoves.resolveRiskItAll, { characterId: b, hp: 3, stress: 2, idempotencyKey: key() });
    expect(await sheetOf(b)).toMatchObject({ stress: 1 });

    // User 2026-11-03: players can't undo death moves, rolled or not. Blaze's finish and Risk It All's split rolled
    // nothing and are the player's own rows, yet only the GM undoes them; no Undo is offered to the player.
    expect((await p1.query(api.deathMoves.state, { characterId: a })).undoEntryId).toBeNull();
    expect((await p2.query(api.deathMoves.state, { characterId: b })).undoEntryId).toBeNull();
    expect((await state(a)).undoEntryId).toBe(finished.entryId);
    expect((await state(b)).undoEntryId).toBe(split.entryId);
    expect(await codeOf(p1.mutation(api.deathMoves.undo, { entryId: finished.entryId, idempotencyKey: key() }))).toBe("UNDO_EXPIRED");
    expect(await codeOf(p2.mutation(api.actionLog.undo, { entryId: split.entryId, idempotencyKey: key() }))).toBe("UNDO_EXPIRED");
    const campaignId = (await characterOf(a)).campaignId;
    const playerFeed = await p2.query(api.feed.list, { campaignId, paginationOpts: { numItems: 50, cursor: null } });
    expect(playerFeed.page.find((r) => r._id === split.entryId)?.canUndo).toBe(false);
    const gmFeed = await gm.query(api.feed.list, { campaignId, paginationOpts: { numItems: 50, cursor: null } });
    expect(gmFeed.page.find((r) => r._id === split.entryId)?.canUndo).toBe(true);
    expect((await gm.mutation(api.deathMoves.undo, { entryId: split.entryId, idempotencyKey: key() })).undone).toEqual([split.entryId]);
    expect((await gm.mutation(api.deathMoves.undo, { entryId: finished.entryId, idempotencyKey: key() })).status).toBe("active");
  });

  it("Castle High: the player's away pick stays a request unless the GM's confirm sets the place", async () => {
    const { p1, p2, gm, a, b, characterOf } = await setup("castle-high");
    await p1.mutation(api.deathMoves.choose, { characterId: a, move: "riskItAll", awayReason: "sentHome", idempotencyKey: key() });
    forceDice(2, 8);
    expect((await gm.mutation(api.deathMoves.confirm, { characterId: a, idempotencyKey: key() })).status).toBe("away");
    expect((await characterOf(a)).away).toEqual({ reason: "sentHome", requested: true });

    vi.restoreAllMocks();
    await p2.mutation(api.deathMoves.choose, { characterId: b, move: "riskItAll", awayReason: "sentHome", idempotencyKey: key() });
    forceDice(2, 8);
    await gm.mutation(api.deathMoves.confirm, { characterId: b, awayReason: "infirmary", idempotencyKey: key() });
    expect((await characterOf(b)).away).toEqual({ reason: "infirmary" });
  });

  it("decline sends the move back: nothing applied, the request row undone, a feed line, the move due again", async () => {
    const { p1, gm, a, sheetOf, state, row, feed } = await setup();
    const before = await sheetOf(a);
    const asked = await p1.mutation(api.deathMoves.choose, { characterId: a, move: "riskItAll", idempotencyKey: key() });
    const dice = forceDice();
    expect(await gm.mutation(api.deathMoves.decline, { characterId: a, idempotencyKey: key() })).toBeNull();
    expect(dice.count).toBe(0);
    expect(await sheetOf(a)).toEqual(before);
    expect((await row(asked.entryId))?.undoneAt).toBeDefined();
    const line = (await feed()).at(-1)!;
    expect(line).toMatchObject({ kind: "death", visibility: "public", undoable: false, summary: "The GM sends back Ash's Risk It All: choose again." });
    expect(line.characterId).toBeUndefined();
    expect(await state()).toMatchObject({ request: null, awaitingMove: true, undoEntryId: null });
    expect(await codeOf(gm.mutation(api.deathMoves.decline, { characterId: a, idempotencyKey: key() }))).toBe("DEATH_MOVE_NOT_WAITING");
    expect(await codeOf(gm.mutation(api.deathMoves.confirm, { characterId: a, idempotencyKey: key() }))).toBe("DEATH_MOVE_NOT_WAITING");
    // The player chooses again.
    expect((await p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() })).awaitingGm).toBe(true);
  });

  it("the player takes the request back by undoing its row (here or from the feed)", async () => {
    const { p1, gm, a, characterOf, state } = await setup();
    const first = await p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() });
    await p1.mutation(api.deathMoves.undo, { entryId: first.entryId, idempotencyKey: key() });
    expect((await characterOf(a)).deathRequest).toBeUndefined();
    expect(await state()).toMatchObject({ request: null, awaitingMove: true });
    expect(await codeOf(gm.mutation(api.deathMoves.confirm, { characterId: a, idempotencyKey: key() }))).toBe("DEATH_MOVE_NOT_WAITING");

    const second = await p1.mutation(api.deathMoves.choose, { characterId: a, move: "riskItAll", idempotencyKey: key() });
    await p1.mutation(api.actionLog.undo, { entryId: second.entryId, idempotencyKey: key() });
    expect(await state()).toMatchObject({ request: null, awaitingMove: true });
    expect(await codeOf(gm.mutation(api.deathMoves.decline, { characterId: a, idempotencyKey: key() }))).toBe("DEATH_MOVE_NOT_WAITING");
  });

  it("confirm is refused once the move is no longer due; the GM sends it back instead", async () => {
    const { p1, gm, a } = await setup();
    await p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() });
    await gm.mutation(api.characters.adjustResource, { characterId: a, resource: "hp", delta: -1 });
    expect(await codeOf(gm.mutation(api.deathMoves.confirm, { characterId: a, idempotencyKey: key() }))).toBe("DEATH_MOVE_RULE");
    expect(await gm.mutation(api.deathMoves.decline, { characterId: a, idempotencyKey: key() })).toBeNull();
  });

  it("confirm is idempotent: a retry with the same key returns the same roll", async () => {
    const { p1, gm, a } = await setup();
    await p1.mutation(api.deathMoves.choose, { characterId: a, move: "riskItAll", idempotencyKey: key() });
    forceDice(6, 6);
    const k = key();
    const once = await gm.mutation(api.deathMoves.confirm, { characterId: a, idempotencyKey: k });
    const again = await gm.mutation(api.deathMoves.confirm, { characterId: a, idempotencyKey: k });
    expect(again).toEqual(once);
  });

  it("anonymous, outsider, player and GM", async () => {
    const { t, p1, p2, gm, out, a } = await setup();
    await p1.mutation(api.deathMoves.choose, { characterId: a, move: "avoidDeath", idempotencyKey: key() });
    for (const fn of [api.deathMoves.confirm, api.deathMoves.decline]) {
      const call = (who: typeof gm) => codeOf(who.mutation(fn, { characterId: a, idempotencyKey: key() }));
      expect(await call(t as typeof gm)).toBe("UNAUTHENTICATED");
      expect(await call(out)).toBe("NOT_FOUND");
      expect(await call(p2)).toBe("FORBIDDEN");
      // The character's own player can't confirm or send back their own move.
      expect(await call(p1)).toBe("FORBIDDEN");
    }
    expect(await codeOf(gm.mutation(api.deathMoves.decline, { characterId: a, idempotencyKey: key() }))).toBe("ok");
  });
});
