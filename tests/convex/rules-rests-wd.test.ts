// Plan rule-switches wave 3, tracer WD: T1 Two moves per rest, T3 What each move does, C4 Unconscious (sheet side) and
// W3 Doom Track Tier 1 on the long rest's Fear (docs/tasks/TASK-RULES-WD.md). Book behaviour is covered by
// tests/convex/rests.test.ts and rules-rests.test.ts, unchanged.
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import type { RuleChange } from "../../convex/lib/validators/ruleModes";
import type { PublishedFrameId } from "../../src/lib/frames/index";
import { ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";

function draft(name: string, pronouns = "") {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    // A human: no Celestial Trance, so the book's count is exactly two.
    ancestry: { kind: "single", id: "human" },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns,
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

async function setup(frameId: PublishedFrameId = "witherwild") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2] = [as(ids.gm), as(ids.p1), as(ids.p2)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash", "she/her"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;

  const setRule = (change: RuleChange) => gm.mutation(api.ruleSettings.set, { campaignId, change });
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (id: Id<"characters">, change: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, change(readSheet((await ctx.db.get("characters", id))!.sheet))));
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const start = (kind: "short" | "long") => gm.mutation(api.rests.start, { campaignId, kind, idempotencyKey: key() });
  const finish = (restId: Id<"rests">) => gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
  const choose = (who: typeof p1, restId: Id<"rests">, characterId: Id<"characters">, moves: { move: string; targetId?: Id<"characters"> }[]) =>
    who.mutation(api.rests.choose, { restId, characterId, moves: moves as never, idempotencyKey: key() });
  const rest = (restId: Id<"rests">) => t.run((ctx) => ctx.db.get("rests", restId));
  const log = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const notes = async () => (await log()).filter((r) => r.kind === "rule");
  const knockOut = (id: Id<"characters">) => edit(id, (s) => ({ ...s, hp: s.hpMax, conditions: [...s.conditions, "unconscious"] }));
  return { t, gm, p1, p2, campaignId, a, b, setRule, sheetOf, edit, fear, start, finish, choose, rest, log, notes, knockOut };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("rule switches wave 3: rests & unconscious (WD)", () => {
  useAllowlist(EMAILS);

  describe("T1 Two moves per rest", () => {
    it("Book: exactly two moves; no note", async () => {
      const { p1, a, start, finish, choose, notes } = await setup();
      const { restId } = await start("short");
      expect(await codeOf(choose(p1, restId, a, [{ move: "prepare" }]))).toBe("REST_RULE");
      expect(await codeOf(choose(p1, restId, a, [{ move: "prepare" }, { move: "prepare" }, { move: "prepare" }]))).toBe("REST_RULE");
      expect(await codeOf(choose(p1, restId, a, []))).toBe("REST_RULE");
      expect(await codeOf(choose(p1, restId, a, [{ move: "prepare" }, { move: "clearStress" }]))).toBe("ok");
      await finish(restId);
      expect(await notes()).toHaveLength(0);
    });

    it("Manual: 0 to 4 moves; the GM hears of a count other than two; undo takes the note back", async () => {
      const { gm, p1, p2, a, b, campaignId, setRule, start, finish, choose, rest, log, notes } = await setup();
      await setRule({ key: "twoDowntimeMoves", value: "manual" });
      const { restId } = await start("short");
      const mine = (await gm.query(api.restsReads.current, { campaignId })).open!.moves.find((m) => m.characterId === a)!;
      expect(mine).toMatchObject({ minSlots: 0, slots: 4 });
      expect(await codeOf(choose(p1, restId, a, Array.from({ length: 5 }, () => ({ move: "prepare" }))))).toBe("REST_RULE");
      expect(await codeOf(choose(p1, restId, a, []))).toBe("ok");
      expect(await codeOf(choose(p1, restId, a, [{ move: "prepare" }, { move: "prepare" }, { move: "clearStress" }]))).toBe("ok");
      expect(await codeOf(choose(p2, restId, b, [{ move: "prepare" }, { move: "clearStress" }]))).toBe("ok");
      await finish(restId);
      const ruleNotes = (await notes()).filter((n) => n.ruleId === "twoDowntimeMoves");
      expect(ruleNotes.map((n) => n.summary)).toEqual(["Ash picked 3 moves"]);
      expect(ruleNotes[0]).toMatchObject({ visibility: "gm", characterId: a, groupId: (await rest(restId))!.groupId, undoable: true });

      await gm.mutation(api.rests.undo, { campaignId, restId, idempotencyKey: key() });
      expect((await log()).find((r) => r._id === ruleNotes[0]!._id)?.undoneAt).toBeDefined();
    });
  });

  describe("T3 What each move does", () => {
    it("Manual: the core moves are listed, nothing rolled or applied; Fear and the short-rest count still apply", async () => {
      const { gm, p1, p2, a, b, campaignId, setRule, edit, sheetOf, start, finish, choose, rest, log, notes, fear } = await setup();
      await setRule({ key: "downtimeMoveEffects", value: "manual" });
      await edit(b, (s) => ({ ...s, hp: 3, stress: 2 }));
      await edit(a, (s) => ({ ...s, hope: 1 }));
      const { restId } = await start("short");
      await choose(p1, restId, a, [{ move: "tendToWounds", targetId: b }, { move: "prepare" }]);
      await choose(p2, restId, b, [{ move: "clearStress" }, { move: "repairArmor" }]);
      const result = await finish(restId);

      expect((await sheetOf(b))).toMatchObject({ hp: 3, stress: 2 });
      expect((await sheetOf(a)).hope).toBe(1);
      const stored = (await rest(restId))!;
      expect(stored.dice).toBeUndefined();
      expect(stored.oasisHolders).toBeUndefined();
      // F2 still applies (Book: 1d4 on a short rest), and T2 counts the rest.
      expect(result.fearGained).toBeGreaterThan(0);
      expect(await fear()).toBe(result.fearGained);
      expect((await gm.query(api.restsReads.current, { campaignId })).shortRestsSinceLong).toBe(1);

      const ashRow = (await log()).find((r) => r.kind === "rest" && r.characterId === a)!;
      expect(ashRow.summary).toBe("Short rest: moves by hand: Tend to Wounds on Bryn, Prepare");
      const listed = (await notes()).filter((n) => n.ruleId === "downtimeMoveEffects").map((n) => n.summary);
      expect(listed).toEqual(["Short rest: Ash: Tend to Wounds on Bryn, Prepare", "Short rest: Bryn: Clear Stress, Repair Armor"]);
    });

    it("Book: the moves are rolled and applied as before", async () => {
      const { p1, a, b, edit, sheetOf, start, finish, choose, notes } = await setup();
      await edit(b, (s) => ({ ...s, hp: 3 }));
      const { restId } = await start("short");
      await choose(p1, restId, a, [{ move: "tendToWounds", targetId: b }, { move: "prepare" }]);
      await finish(restId);
      expect((await sheetOf(b)).hp).toBeLessThan(3);
      expect(await notes()).toHaveLength(0);
    });
  });

  describe("C4 Unconscious", () => {
    it("Book: an unconscious PC can't pick moves; a long rest wakes them; clearing a Hit Point wakes them", async () => {
      const { p1, a, knockOut, sheetOf, start, finish, choose, notes } = await setup();
      await knockOut(a);
      const { restId } = await start("long");
      expect(await codeOf(choose(p1, restId, a, [{ move: "prepare" }, { move: "prepare" }]))).toBe("CHARACTER_UNAVAILABLE");
      await finish(restId);
      expect((await sheetOf(a)).conditions).not.toContain("unconscious");

      await knockOut(a);
      await p1.mutation(api.characters.adjustResource, { characterId: a, resource: "hp", delta: -1 });
      expect((await sheetOf(a)).conditions).not.toContain("unconscious");
      expect(await notes()).toHaveLength(0);
    });

    it("Manual: an unconscious PC picks moves, stays down after a long rest, and the GM is asked", async () => {
      const { p1, a, knockOut, setRule, sheetOf, start, finish, choose, rest, notes } = await setup();
      await setRule({ key: "unconscious", value: "manual" });
      await knockOut(a);
      const { restId } = await start("long");
      expect(await codeOf(choose(p1, restId, a, [{ move: "prepare" }, { move: "clearAllStress" }]))).toBe("ok");
      await finish(restId);
      const after = await sheetOf(a);
      expect(after.conditions).toContain("unconscious");
      // Their moves ran: Prepare gave Hope.
      expect(after.hope).toBeGreaterThan(2);
      const wake = (await notes()).filter((n) => n.ruleId === "unconscious");
      expect(wake.map((n) => n.summary)).toEqual(["Long rest: wake Ash?"]);
      expect(wake[0]).toMatchObject({ visibility: "gm", characterId: a, groupId: (await rest(restId))!.groupId });
    });

    it("Manual: Tend to All Wounds on an unconscious ally clears their HP but leaves them down", async () => {
      const { p2, a, b, knockOut, setRule, sheetOf, start, finish, choose, notes } = await setup();
      await setRule({ key: "unconscious", value: "manual" });
      await knockOut(a);
      const { restId } = await start("long");
      await choose(p2, restId, b, [{ move: "tendToAllWounds", targetId: a }, { move: "prepare" }]);
      await finish(restId);
      const after = await sheetOf(a);
      expect(after.hp).toBe(0);
      expect(after.conditions).toContain("unconscious");
      // One question per PC: the long rest's.
      expect((await notes()).filter((n) => n.ruleId === "unconscious").map((n) => n.summary)).toEqual(["Long rest: wake Ash?"]);
    });

    it("Manual: clearing a Hit Point keeps the PC down, with a GM note", async () => {
      const { p1, a, knockOut, setRule, sheetOf, notes } = await setup();
      await setRule({ key: "unconscious", value: "manual" });
      await knockOut(a);
      const before = await sheetOf(a);
      await p1.mutation(api.characters.adjustResource, { characterId: a, resource: "hp", delta: -1 });
      const after = await sheetOf(a);
      expect(after.hp).toBe(before.hp - 1);
      expect(after.conditions).toContain("unconscious");
      const [note] = await notes();
      expect(note).toMatchObject({ ruleId: "unconscious", visibility: "gm", summary: "Ash had a Hit Point cleared: wake her?" });

      // The GM wakes her by hand: the condition goes and stays gone.
      await p1.mutation(api.characters.toggleCondition, { characterId: a, condition: "unconscious" });
      expect((await sheetOf(a)).conditions).not.toContain("unconscious");
    });

    it("Manual: an unconscious PC passes the acting check (a feature refuses for its own reasons, not CHARACTER_UNAVAILABLE)", async () => {
      const { p1, a, knockOut, setRule } = await setup();
      await knockOut(a);
      const use = () => p1.mutation(api.sessionFeatures.bumpMoonDie, { characterId: a, idempotencyKey: key() });
      const book = await codeOf(use());
      expect(book).toBe("CHARACTER_UNAVAILABLE");
      await setRule({ key: "unconscious", value: "manual" });
      expect(await codeOf(use())).not.toBe("CHARACTER_UNAVAILABLE");
    });
  });

  describe("W3 Doom Track Tier 1 (Journey to Horizon)", () => {
    async function horizon(boxes: string[]) {
      const env = await setup("journey-to-horizon");
      for (const boxId of boxes) await env.gm.mutation(api.trackers.horizon.markBox, { campaignId: env.campaignId, boxId, idempotencyKey: key() });
      return env;
    }
    const TIER_ONE = ["1a", "1b", "1c", "1d", "1a1"];

    it("Book, 5 Tier 1 boxes: the long rest's Fear d4 is rolled twice and the higher kept", async () => {
      const { start, finish, log } = await horizon(TIER_ONE);
      const { fearRoll, fearGained } = await finish((await start("long")).restId);
      const row = (await log()).find((r) => r.kind === "rest" && r.characterId === undefined)!;
      const m = /Doom Track Tier 1: rolled (\d) and (\d), kept the higher/.exec(row.summary);
      expect(m).not.toBeNull();
      expect(fearRoll).toBe(Math.max(Number(m![1]), Number(m![2])));
      expect(fearGained).toBe(fearRoll! + 2);
    });

    it("A short rest, 4 boxes, or the Doom Track on Manual: one roll", async () => {
      const five = await horizon(TIER_ONE);
      await five.finish((await five.start("short")).restId);
      expect((await five.log()).some((r) => r.summary.includes("Doom Track Tier 1"))).toBe(false);

      const four = await horizon(TIER_ONE.slice(0, 4));
      await four.finish((await four.start("long")).restId);
      expect((await four.log()).some((r) => r.summary.includes("Doom Track Tier 1"))).toBe(false);

      const manual = await horizon(TIER_ONE);
      await manual.setRule({ key: "doomTrack", value: "manual" });
      await manual.finish((await manual.start("long")).restId);
      expect((await manual.log()).some((r) => r.summary.includes("Doom Track Tier 1"))).toBe(false);
    });
  });
});
