// SD-R: the rest-time heritage features in the rest flow (convex/rests.ts, src/lib/domain/rest/feature-moves.ts).
// Book texts (printed pages):
// - Hardy (Frostborne, HF p.29): "When you take a rest, you clear a Hit Point."
// - Efficient (Clank, CB p.53): "When you take a short rest, you can choose a long rest move instead of a short rest move."
// - Celestial Trance (Elf, CB p.56): "During a rest, you can drop into a trance to choose an additional downtime move."
// - Oasis (Duneborne, HF p.27): "During a short rest, you or an ally can reroll a die used for a downtime move and take
//   the higher result."
// - CB p.105: "If a short rest is interrupted (such as by an adversary's attack), characters don't gain its benefits. If a
//   long rest is interrupted, the characters instead gain the benefits of a short rest".
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { featureKey } from "../../src/lib/domain/feature-effects/ids";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";

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
 * Server dice: each die takes the next face from `faces`, then `rest` (the rest's Fear d4 included). `rollDie` maps a
 * buffer value v to v % sides + 1.
 */
function dice(faces: number[], rest = 1) {
  const queue = [...faces];
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => array.fill((queue.shift() ?? rest) - 1)) as typeof crypto.getRandomValues);
}

/**
 * A campaign with Hope & Fear content, a GM and two players with a character each (Ash: p1, Bryn: p2). Both start as
 * the first Core ancestry (Clank, so they hold Efficient) of a Core community.
 */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2] = [as(ids.gm), as(ids.p1), as(ids.p2)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;

  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (id: Id<"characters">, change: Partial<CharacterSheet>) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...change }));
  const start = (kind: "short" | "long") => gm.mutation(api.rests.start, { campaignId, kind, idempotencyKey: key() });
  const finish = (restId: Id<"rests">) => gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
  const interrupt = (restId: Id<"rests">) => gm.mutation(api.rests.interrupt, { campaignId, restId, idempotencyKey: key() });
  const undo = (restId: Id<"rests">) => gm.mutation(api.rests.undo, { campaignId, restId, idempotencyKey: key() });
  type Move = { move: "tendToWounds" | "clearStress" | "prepare" | "tendToAllWounds" | "clearAllStress" | "repairAllArmor" | "workOnProject"; targetId?: Id<"characters"> };
  const choose = (player: typeof p1, restId: Id<"rests">, characterId: Id<"characters">, moves: Move[], efficient?: boolean) =>
    player.mutation(api.rests.choose, { restId, characterId, moves, efficient, idempotencyKey: key() });
  /** The rest's public log row of one character (its summary lists the moves and features). */
  const rowOf = (characterId: Id<"characters">) =>
    t.run(async (ctx) => {
      const rows = await ctx.db
        .query("actionLog")
        .withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId))
        .order("desc")
        .take(20);
      return rows.find((r) => r.kind === "rest" && r.characterId === characterId && r.undoneAt === undefined)?.summary ?? "";
    });
  const current = () => gm.query(api.restsReads.current, { campaignId });
  return { t, gm, p1, p2, campaignId, a, b, sheetOf, edit, start, finish, interrupt, undo, choose, rowOf, current };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("rest-time heritage features (SD-R)", () => {
  useAllowlist(EMAILS);
  afterEach(() => vi.restoreAllMocks());

  it("Hardy clears a Hit Point at the end of a short and a long rest, in the rest's log row, and undo takes it back (HF p.29)", async () => {
    const { a, b, edit, sheetOf, start, finish, interrupt, undo, choose, p1, p2, rowOf } = await setup();
    await edit(a, { communityId: "frostborne", hp: 3 });
    await edit(b, { hp: 3 });
    dice([]);
    const short = await start("short");
    await choose(p1, short.restId, a, [{ move: "prepare" }, { move: "prepare" }]);
    await choose(p2, short.restId, b, [{ move: "prepare" }, { move: "prepare" }]);
    await finish(short.restId);
    expect((await sheetOf(a)).hp).toBe(2);
    expect((await sheetOf(b)).hp).toBe(3);
    expect(await rowOf(a)).toContain("Hardy: clears 1 HP");
    expect(await rowOf(b)).not.toContain("Hardy");

    await undo(short.restId);
    expect((await sheetOf(a)).hp).toBe(3);

    await interrupt(short.restId);
    const long = await start("long");
    await choose(p1, long.restId, a, [{ move: "prepare" }, { move: "prepare" }]);
    await finish(long.restId);
    expect((await sheetOf(a)).hp).toBe(2);
  });

  it("Hardy needs the Hope & Fear option (a Hope & Fear community)", async () => {
    const { a, edit, sheetOf, start, finish, gm, campaignId } = await setup();
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: false });
    await edit(a, { communityId: "frostborne", hp: 3 });
    await finish((await start("short")).restId);
    expect((await sheetOf(a)).hp).toBe(3);
  });

  it("Efficient: a Clank's short rest offers the long rest moves and, used, takes one of them (CB p.53)", async () => {
    const { a, b, edit, sheetOf, start, finish, choose, p1, p2, current } = await setup();
    await edit(a, { hp: 5, stress: 4 });
    await edit(b, { ancestry: { kind: "single", id: "human" } });
    const { restId } = await start("short");
    const moves = (await current()).open!.moves;
    expect(moves.find((m) => m.characterId === a)!.efficient).toEqual(["tendToAllWounds", "clearAllStress", "repairAllArmor", "workOnProject"]);
    expect(moves.find((m) => m.characterId === a)!.moves).not.toContain("tendToAllWounds");
    expect(moves.find((m) => m.characterId === b)!.efficient).toEqual([]);

    // Not used: a short rest's moves only. Used: one long rest move, not two. Not held: refused.
    expect(await codeOf(choose(p1, restId, a, [{ move: "tendToAllWounds" }, { move: "prepare" }]))).toBe("REST_RULE");
    expect(await codeOf(choose(p1, restId, a, [{ move: "tendToAllWounds" }, { move: "clearAllStress" }], true))).toBe("REST_RULE");
    expect(await codeOf(choose(p2, restId, b, [{ move: "tendToAllWounds" }, { move: "prepare" }], true))).toBe("REST_RULE");
    await choose(p1, restId, a, [{ move: "tendToAllWounds" }, { move: "prepare" }], true);
    await finish(restId);
    expect((await sheetOf(a)).hp).toBe(0);
    expect((await sheetOf(a)).stress).toBe(4);

    // A long rest has nothing to add.
    await start("long");
    expect((await current()).open!.moves.find((m) => m.characterId === a)!.efficient).toEqual([]);
  });

  it("Celestial Trance: an Elf picks a third downtime move on any rest; everyone else two (CB p.56)", async () => {
    const { a, b, edit, sheetOf, start, finish, choose, p1, p2, current } = await setup();
    await edit(a, { ancestry: { kind: "single", id: "elf" }, hope: 0 });
    for (const kind of ["short", "long"] as const) {
      const { restId } = await start(kind);
      const moves = (await current()).open!.moves;
      expect(moves.find((m) => m.characterId === a)!.slots).toBe(3);
      expect(moves.find((m) => m.characterId === b)!.slots).toBe(2);
      expect(await codeOf(choose(p2, restId, b, [{ move: "prepare" }, { move: "prepare" }, { move: "prepare" }]))).toBe("REST_RULE");
      await choose(p1, restId, a, [{ move: "prepare" }, { move: "prepare" }, { move: "prepare" }]);
      await finish(restId);
    }
    expect((await sheetOf(a)).hope).toBe(6);
  });

  // ---------------------------------------------------------------- Oasis (DA5: the player picks the die)

  it("Oasis: after a short rest the holder picks a die (an ally's), the server rerolls it, keeps the higher and clears the difference (HF p.27)", async () => {
    const { a, b, edit, sheetOf, start, finish, undo, choose, p1, p2, rowOf, current } = await setup();
    await edit(a, { communityId: "duneborne" });
    await edit(b, { stress: 6 });
    const { restId } = await start("short");
    expect((await current()).open!.moves.find((m) => m.characterId === a)!.oasis).toBe(true);
    expect((await current()).open!.moves.find((m) => m.characterId === b)!.oasis).toBe(false);
    await choose(p1, restId, a, [{ move: "prepare" }, { move: "prepare" }]);
    await choose(p2, restId, b, [{ move: "clearStress" }, { move: "clearStress" }]);
    // No automatic reroll any more: the ally's dice 1 and 2 (tier 1) clear 2 + 3 of 6 Stress.
    dice([1, 2]);
    await finish(restId);
    expect((await sheetOf(b)).stress).toBe(1);
    expect(await rowOf(a)).not.toContain("Oasis");
    const last = (await current()).last!;
    expect(last.oasisHolders).toEqual([a]);
    expect(last.dice.map((d) => ({ characterId: d.characterId, move: d.move, rolled: d.rolled, value: d.value, bonus: d.bonus }))).toEqual([
      { characterId: b, move: "clearStress", rolled: 1, value: 1, bonus: 1 },
      { characterId: b, move: "clearStress", rolled: 2, value: 2, bonus: 1 },
    ]);

    // Only a holder rerolls; the ally's own player can't use Oasis for Bryn.
    expect(await codeOf(p2.mutation(api.rests.oasisReroll, { restId, characterId: b, die: 0, idempotencyKey: key() }))).toBe("REST_RULE");
    expect(await codeOf(p1.mutation(api.rests.oasisReroll, { restId, characterId: a, die: 5, idempotencyKey: key() }))).toBe("REST_RULE");

    // Ash rerolls Bryn's 1: a 4, kept. The move would have cleared 3 more; Bryn had 1 Stress left.
    dice([4]);
    expect(await p1.mutation(api.rests.oasisReroll, { restId, characterId: a, die: 0, idempotencyKey: key() })).toEqual({ rolled: 4, kept: 4, cleared: 1 });
    expect((await sheetOf(b)).stress).toBe(0);
    expect(await rowOf(b)).toContain("Oasis (Ash): rerolled Bryn's Clear Stress d4 (1, then 4), kept 4: clears 1 more Stress");
    const after = (await current()).last!;
    expect(after.dice[0]).toMatchObject({ rolled: 1, value: 4, rerolls: [{ holderId: a, rolled: 4, kept: 4 }] });

    // One holder, one reroll in the pool: it is spent (DA15). Bryn held no Oasis: no panel to close.
    expect((await current()).last!.oasisLeft).toBe(0);
    expect(await codeOf(p2.mutation(api.rests.closeOasis, { restId, characterId: b, idempotencyKey: key() }))).toBe("REST_RULE");
    expect(await codeOf(p1.mutation(api.rests.oasisReroll, { restId, characterId: a, die: 1, idempotencyKey: key() }))).toBe("REST_RULE");

    // The rest's undo takes the reroll back with the rest, and the stored dice go with it.
    await undo(restId);
    expect((await sheetOf(b)).stress).toBe(6);
    expect((await current()).open?._id).toBe(restId);
    expect((await current()).last).toBeNull();
  });

  // ---------------------------------------------------------------- Oasis as a party pool (DA15, user 2026-10-30)

  it("Oasis pool: one reroll per Duneborne, spent by any holder on any die, the same die again while rerolls remain (DA15)", async () => {
    const { a, b, edit, sheetOf, start, finish, undo, choose, p1, p2, current } = await setup();
    await edit(a, { communityId: "duneborne" });
    await edit(b, { communityId: "duneborne", stress: 6 });
    const { restId } = await start("short");
    await choose(p1, restId, a, [{ move: "prepare" }, { move: "prepare" }]);
    await choose(p2, restId, b, [{ move: "clearStress" }, { move: "clearStress" }]);
    // Bryn's dice 1 and 1 (tier 1) clear 2 + 2 of 6 Stress.
    dice([1, 1]);
    await finish(restId);
    expect((await sheetOf(b)).stress).toBe(2);
    expect((await current()).last).toMatchObject({ oasisHolders: [a, b], oasisClosed: [], oasisLeft: 2, resultsOpen: true });

    // Ash spends both rerolls on Bryn's first die: 2 (kept, 1 more Stress), then 1 (lower, 2 kept).
    dice([2]);
    expect(await p1.mutation(api.rests.oasisReroll, { restId, characterId: a, die: 0, idempotencyKey: key() })).toEqual({ rolled: 2, kept: 2, cleared: 1 });
    expect((await current()).last!.oasisLeft).toBe(1);
    dice([1]);
    expect(await p1.mutation(api.rests.oasisReroll, { restId, characterId: a, die: 0, idempotencyKey: key() })).toEqual({ rolled: 1, kept: 2, cleared: 0 });
    const last = (await current()).last!;
    expect(last.oasisLeft).toBe(0);
    // The first reroll spent Ash's own, the second Bryn's.
    expect(last.dice[0]).toMatchObject({
      rolled: 1,
      value: 2,
      rerolls: [
        { holderId: a, rolled: 2, kept: 2, spentFrom: a },
        { holderId: a, rolled: 1, kept: 2, spentFrom: b },
      ],
    });
    // The pool is empty: nobody rerolls, Bryn included. The window stays open until each holder closes.
    dice([4]);
    expect(await codeOf(p2.mutation(api.rests.oasisReroll, { restId, characterId: b, die: 1, idempotencyKey: key() }))).toBe("REST_RULE");
    expect(await codeOf(p1.mutation(api.rests.oasisReroll, { restId, characterId: a, die: 1, idempotencyKey: key() }))).toBe("REST_RULE");
    expect((await sheetOf(b)).stress).toBe(1);
    expect((await current()).last!.resultsOpen).toBe(true);

    // The rest's undo reverts both rerolls with the rest.
    await undo(restId);
    expect((await sheetOf(b)).stress).toBe(6);
  });

  it("Oasis: each holder closes their own panel, withdrawing their unused reroll; the window ends once all have (DA15)", async () => {
    const { a, b, edit, sheetOf, start, finish, undo, choose, gm, p1, p2, current } = await setup();
    await edit(a, { communityId: "duneborne" });
    await edit(b, { communityId: "duneborne", stress: 6 });
    const close = (who: typeof p1, restId: Id<"rests">, characterId: Id<"characters">) =>
      who.mutation(api.rests.closeOasis, { restId, characterId, idempotencyKey: key() });
    const { restId } = await start("short");
    await choose(p2, restId, b, [{ move: "clearStress" }, { move: "clearStress" }]);
    // Not before the rest ends.
    expect(await codeOf(close(p1, restId, a))).toBe("REST_RULE");
    dice([1, 1]);
    await finish(restId);

    // Ash closes without rerolling: Ash's reroll leaves the pool; closing twice is harmless; Ash can no longer reroll.
    await close(p1, restId, a);
    await close(p1, restId, a);
    expect((await current()).last).toMatchObject({ oasisClosed: [a], oasisLeft: 1, resultsOpen: true });
    dice([4]);
    expect(await codeOf(p1.mutation(api.rests.oasisReroll, { restId, characterId: a, die: 0, idempotencyKey: key() }))).toBe("REST_RULE");
    // Bryn still has one: spent on Bryn's own die; then the pool is empty.
    dice([4]);
    expect(await p2.mutation(api.rests.oasisReroll, { restId, characterId: b, die: 0, idempotencyKey: key() })).toMatchObject({ kept: 4 });
    expect((await current()).last!.oasisLeft).toBe(0);
    expect((await sheetOf(b)).stress).toBe(0);
    // The GM closes Bryn's panel for Bryn's player: every holder closed, the window is over.
    await close(gm, restId, b);
    expect((await current()).last).toMatchObject({ oasisClosed: [a, b], oasisLeft: 0, resultsOpen: false });

    // Undo clears the closed panels with the dice; finishing again opens a fresh pool.
    await undo(restId);
    dice([1, 1]);
    await finish(restId);
    expect((await current()).last).toMatchObject({ oasisClosed: [], oasisLeft: 2, resultsOpen: true });
  });

  it("Oasis: a closing holder withdraws only their own unused reroll; one another holder spent stays spent (DA15)", async () => {
    const { a, b, edit, start, finish, choose, p1, p2, current } = await setup();
    await edit(a, { communityId: "duneborne" });
    await edit(b, { communityId: "duneborne", stress: 6 });
    const { restId } = await start("short");
    await choose(p2, restId, b, [{ move: "clearStress" }, { move: "clearStress" }]);
    dice([1, 1]);
    await finish(restId);
    // Bryn rerolls twice: Bryn's own, then Ash's. Ash closing withdraws nothing more; the pool was already empty.
    dice([2, 3]);
    await p2.mutation(api.rests.oasisReroll, { restId, characterId: b, die: 0, idempotencyKey: key() });
    await p2.mutation(api.rests.oasisReroll, { restId, characterId: b, die: 1, idempotencyKey: key() });
    expect((await current()).last!.dice.map((d) => d.rerolls.map((r) => r.spentFrom))).toEqual([[b], [a]]);
    await p1.mutation(api.rests.closeOasis, { restId, characterId: a, idempotencyKey: key() });
    expect((await current()).last).toMatchObject({ oasisLeft: 0, resultsOpen: true });
    // Another player can't close a holder's panel.
    expect(await codeOf(p1.mutation(api.rests.closeOasis, { restId, characterId: b, idempotencyKey: key() }))).toBe("FORBIDDEN");
  });

  it("Oasis keeps the first result when the reroll is lower; the GM can reroll for the holder; nothing on a long rest", async () => {
    const { a, b, edit, sheetOf, start, finish, choose, gm, p1, p2, rowOf, current } = await setup();
    await edit(a, { communityId: "duneborne", stress: 6 });
    const short = await start("short");
    await choose(p1, short.restId, a, [{ move: "clearStress" }, { move: "prepare" }]);
    dice([3]);
    await finish(short.restId);
    expect((await sheetOf(a)).stress).toBe(2);
    dice([1]);
    expect(await gm.mutation(api.rests.oasisReroll, { restId: short.restId, characterId: a, die: 0, idempotencyKey: key() })).toEqual({ rolled: 1, kept: 3, cleared: 0 });
    expect((await sheetOf(a)).stress).toBe(2);
    expect(await rowOf(a)).toContain("Oasis (Ash): rerolled Ash's Clear Stress d4 (3, then 1), kept 3");

    const long = await start("long");
    expect((await current()).open!.moves.find((m) => m.characterId === a)!.oasis).toBe(false);
    // While the next rest is open, the last rest's dice are no longer rerollable.
    expect(await codeOf(p1.mutation(api.rests.oasisReroll, { restId: short.restId, characterId: a, die: 0, idempotencyKey: key() }))).toBe("REST_RULE");
    await choose(p1, long.restId, a, [{ move: "clearAllStress" }, { move: "prepare" }]);
    await choose(p2, long.restId, b, [{ move: "prepare" }, { move: "prepare" }]);
    await finish(long.restId);
    expect((await current()).last).toMatchObject({ dice: [], oasisHolders: [] });
    expect(await codeOf(p1.mutation(api.rests.oasisReroll, { restId: long.restId, characterId: a, die: 0, idempotencyKey: key() }))).toBe("REST_RULE");
  });

  it("an interrupted long rest runs them as a short rest (CB p.105): Hardy, the trance's move, Oasis; an interrupted short rest gives none", async () => {
    const { a, b, edit, sheetOf, start, finish, interrupt, choose, p1, p2, rowOf, current } = await setup();
    await edit(a, { communityId: "frostborne", ancestry: { kind: "single", id: "elf" }, hp: 6, stress: 6 });
    await edit(b, { communityId: "duneborne" });

    const short = await start("short");
    await choose(p1, short.restId, a, [{ move: "prepare" }, { move: "prepare" }]);
    await interrupt(short.restId);
    expect((await sheetOf(a)).hp).toBe(6);
    expect(await rowOf(a)).not.toContain("Hardy");
    expect((await current()).last).toMatchObject({ dice: [], oasisHolders: [] });

    const long = await start("long");
    // The trance's third move counts too; each long rest move becomes its short rest move.
    await choose(p1, long.restId, a, [{ move: "tendToAllWounds" }, { move: "clearAllStress" }, { move: "prepare" }]);
    await choose(p2, long.restId, b, [{ move: "prepare" }, { move: "prepare" }]);
    // Tend to Wounds 1 (+1 tier), Clear Stress 2 (+1), then Hardy 1 more HP.
    dice([1, 2]);
    await interrupt(long.restId);
    expect(await sheetOf(a)).toMatchObject({ hp: 3, stress: 3 });
    expect(await rowOf(a)).toContain("Hardy: clears 1 HP");
    expect((await current()).last!.oasisHolders).toEqual([b]);
    // Bryn's Oasis on Ash's Tend to Wounds die: 1, then 4, kept 4; 3 more HP.
    dice([4]);
    await p2.mutation(api.rests.oasisReroll, { restId: long.restId, characterId: b, die: 0, idempotencyKey: key() });
    expect((await sheetOf(a)).hp).toBe(0);
    expect(await codeOf(finish(long.restId))).toBe("REST_RULE");
  });

  it("dcm-bxp.99.19.58 (user 2026-10-30, overrides .45 (4)): Efficient on an interrupted long rest keeps ONE long rest pick, the other converts", async () => {
    // The default party are Clanks (Efficient, CB p.53); an interrupted long rest gives "the benefits of a short rest".
    const { a, edit, sheetOf, start, interrupt, choose, p1, current } = await setup();
    await edit(a, { hp: 6, stress: 6 });
    const long = await start("long");
    expect((await current()).open!.moves.find((m) => m.characterId === a)!.efficient).toEqual([]);
    await choose(p1, long.restId, a, [{ move: "tendToAllWounds" }, { move: "clearAllStress" }]);
    dice([2]);
    await interrupt(long.restId);
    // Tend to All Wounds kept at full strength (all 6 HP); Clear All Stress became Clear Stress: 2 + tier 1.
    expect(await sheetOf(a)).toMatchObject({ hp: 0, stress: 3 });
  });

  it("pins (dcm-bxp.99.19.47 (4)): Toxic Concoctions and Feed tokens are kept on an interrupted long rest, cleared on a finished one", async () => {
    const { a, b, edit, sheetOf, start, finish, interrupt } = await setup();
    const TOXIC = featureKey("subclass:poisoners-guild:toxic-concoctions");
    const FEED = featureKey("transformation:vampire:feed");
    const tokens = async (id: Id<"characters">, k: string) => (await sheetOf(id)).cardTokens?.find((c) => c.cardId === k)?.count ?? 0;
    await edit(a, { classId: "assassin", subclassId: "poisoners-guild", cardTokens: [{ cardId: TOXIC, count: 4 }] });
    await edit(b, { transformationId: "vampire", cardTokens: [{ cardId: FEED, count: 3 }] });
    await interrupt((await start("long")).restId);
    expect(await tokens(a, TOXIC)).toBe(4);
    expect(await tokens(b, FEED)).toBe(3);
    await finish((await start("long")).restId);
    expect(await tokens(a, TOXIC)).toBe(0);
    expect(await tokens(b, FEED)).toBe(2);
  });
});
