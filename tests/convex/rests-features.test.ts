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
  const current = () => gm.query(api.rests.current, { campaignId });
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

  it("Oasis: on a short rest the holder rerolls a downtime die (theirs or an ally's) and keeps the higher result (HF p.27)", async () => {
    const { a, b, edit, sheetOf, start, finish, choose, p1, p2, rowOf, current } = await setup();
    await edit(a, { communityId: "duneborne" });
    await edit(b, { stress: 6 });
    const { restId } = await start("short");
    expect((await current()).open!.moves.find((m) => m.characterId === a)!.oasis).toBe(true);
    expect((await current()).open!.moves.find((m) => m.characterId === b)!.oasis).toBe(false);
    await choose(p1, restId, a, [{ move: "prepare" }, { move: "prepare" }]);
    await choose(p2, restId, b, [{ move: "clearStress" }, { move: "clearStress" }]);
    // The ally's dice: 1 and 2. Oasis rerolls the 1 to a 3 and keeps the 3. Tier 1: 3 + 1 and 2 + 1 clear all 6 Stress.
    dice([1, 2, 3]);
    await finish(restId);
    expect(await rowOf(a)).toContain("Oasis: rerolled a d4 (1, then 3), kept 3");
    expect(await rowOf(b)).toContain("Clear Stress: clears 4 Stress (1d4 3 + tier 1)");
    expect((await sheetOf(b)).stress).toBe(0);
  });

  it("Oasis keeps the first result when the reroll is lower, and does nothing on a long rest", async () => {
    const { a, b, edit, start, finish, choose, p1, p2, rowOf, current } = await setup();
    await edit(a, { communityId: "duneborne", stress: 6 });
    const short = await start("short");
    await choose(p1, short.restId, a, [{ move: "clearStress" }, { move: "prepare" }]);
    dice([3, 1]);
    await finish(short.restId);
    expect(await rowOf(a)).toContain("Clear Stress: clears 4 Stress (1d4 3 + tier 1)");
    expect(await rowOf(a)).toContain("Oasis: rerolled a d4 (3, then 1), kept 3");

    const long = await start("long");
    expect((await current()).open!.moves.find((m) => m.characterId === a)!.oasis).toBe(false);
    await choose(p1, long.restId, a, [{ move: "clearAllStress" }, { move: "prepare" }]);
    await choose(p2, long.restId, b, [{ move: "prepare" }, { move: "prepare" }]);
    await finish(long.restId);
    expect(await rowOf(a)).not.toContain("Oasis");
  });

  it("an interrupted long rest runs them as a short rest (CB p.105); an interrupted short rest gives none", async () => {
    const { a, b, edit, sheetOf, start, finish, interrupt, choose, p1, p2, rowOf } = await setup();
    await edit(a, { communityId: "frostborne", ancestry: { kind: "single", id: "elf" }, hp: 6, stress: 6 });
    await edit(b, { communityId: "duneborne" });

    const short = await start("short");
    await choose(p1, short.restId, a, [{ move: "prepare" }, { move: "prepare" }]);
    await interrupt(short.restId);
    expect((await sheetOf(a)).hp).toBe(6);

    const long = await start("long");
    // The trance's third move counts too; each long rest move becomes its short rest move.
    await choose(p1, long.restId, a, [{ move: "tendToAllWounds" }, { move: "clearAllStress" }, { move: "prepare" }]);
    await choose(p2, long.restId, b, [{ move: "prepare" }, { move: "prepare" }]);
    // Tend to Wounds 1 (+1 tier), Clear Stress 2 (+1); Oasis rerolls the 1 to a 4 (kept): 5 HP, then Hardy 1 more.
    dice([1, 2, 4]);
    await interrupt(long.restId);
    const ash = await sheetOf(a);
    expect(ash.hp).toBe(0);
    expect(ash.stress).toBe(3);
    expect(await rowOf(a)).toContain("Hardy: clears 1 HP");
    expect(await rowOf(b)).toContain("Oasis: rerolled a d4 (1, then 4), kept 4");
    expect(await codeOf(finish(long.restId))).toBe("REST_RULE");
  });
});
