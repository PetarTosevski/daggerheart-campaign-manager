// Plan rule-switches RR: the rest rule switches F2 Fear from rests, T2 Short-rest limit and T4 Interrupted rest
// (docs/tasks/TASK-RULES-RR.md). Book behaviour is covered by tests/convex/rests.test.ts, unchanged.
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import type { RuleChange } from "../../convex/lib/validators/ruleModes";
import { ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    ancestry: { kind: "single", id: "elf" },
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

/** A campaign (no frame rest hooks) with a GM and two players who each own a character. */
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
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;

  const setRule = (change: RuleChange) => gm.mutation(api.ruleSettings.set, { campaignId, change });
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (id: Id<"characters">, change: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, change(readSheet((await ctx.db.get("characters", id))!.sheet))));
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const start = (kind: "short" | "long", extended?: boolean) => gm.mutation(api.rests.start, { campaignId, kind, extended, idempotencyKey: key() });
  const finish = (restId: Id<"rests">) => gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
  const interrupt = (restId: Id<"rests">) => gm.mutation(api.rests.interrupt, { campaignId, restId, idempotencyKey: key() });
  const rest = (restId: Id<"rests">) => t.run((ctx) => ctx.db.get("rests", restId));
  const log = () => t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
  const notes = async () => (await log()).filter((r) => r.kind === "rule");
  return { t, gm, p1, p2, campaignId, a, b, setRule, sheetOf, edit, fear, start, finish, interrupt, rest, log, notes };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("rule switches: rests (RR)", () => {
  useAllowlist(EMAILS);

  describe("F2 Fear from rests", () => {
    it("Book: no extended choice; the launcher reads the modes", async () => {
      const { gm, campaignId, start } = await setup();
      expect(await codeOf(start("long", true))).toBe("REST_RULE");
      const state = await gm.query(api.restsReads.current, { campaignId });
      expect(state.rules).toEqual({ fearFromRests: "book", shortRestLimit: "book", interruptedRest: "book" });
    });

    it("Extended downtime: a long rest started as several days gains 1d6 per PC (CB 181); other rests follow the book", async () => {
      const { gm, campaignId, setRule, start, finish, rest, fear, log } = await setup();
      await setRule({ key: "fearFromRests", value: "extendedDowntime" });
      // Only a long rest can be extended.
      expect(await codeOf(start("short", true))).toBe("REST_RULE");

      const { restId } = await start("long", true);
      expect((await gm.query(api.restsReads.current, { campaignId })).open?.extended).toBe(true);
      const { fearRoll, fearGained } = await finish(restId);
      expect(fearRoll).toBeGreaterThanOrEqual(2);
      expect(fearRoll).toBeLessThanOrEqual(12);
      expect(fearGained).toBe(fearRoll);
      expect(await fear()).toBe(fearGained);
      expect((await rest(restId))?.extended).toBe(true);
      const row = (await log()).find((r) => r.kind === "rest" && r.characterId === undefined)!;
      expect(row.summary).toContain("Extended downtime: 2d6");
      expect(row.fearDelta).toBe(fearGained);

      // An ordinary long rest in the same mode: 1d4 + PCs.
      const plain = await finish((await start("long")).restId);
      expect(plain.fearGained).toBe(plain.fearRoll! + 2);
    });

    it("Extended downtime interrupted runs as a short rest: book Fear (1d4)", async () => {
      const { setRule, start, interrupt } = await setup();
      await setRule({ key: "fearFromRests", value: "extendedDowntime" });
      const { fearRoll, fearGained } = await interrupt((await start("long", true)).restId);
      expect(fearRoll).toBeLessThanOrEqual(4);
      expect(fearGained).toBe(fearRoll);
    });

    it("Manual: no Fear gained; the summary and a GM note say 'Gain 1d4 + N Fear'; undo takes the note back", async () => {
      const { gm, campaignId, setRule, start, finish, rest, fear, log, notes } = await setup();
      await setRule({ key: "fearFromRests", value: "manual" });
      // The extended choice is only offered in its own mode.
      expect(await codeOf(start("long", true))).toBe("REST_RULE");

      const { restId } = await start("long");
      const result = await finish(restId);
      expect(result).toMatchObject({ fearRoll: null, fearGained: 0, fearPrompt: "Gain 1d4 + 2 Fear" });
      expect(await fear()).toBe(0);
      const stored = (await rest(restId))!;
      expect(stored.fearRoll).toBeUndefined();
      expect(stored.fearGained).toBeUndefined();
      expect(stored.fearPrompt).toBe("Gain 1d4 + 2 Fear");
      const row = (await log()).find((r) => r.kind === "rest" && r.characterId === undefined)!;
      expect(row.summary).toBe("Long rest: Gain 1d4 + 2 Fear");
      expect(row.fearDelta).toBeUndefined();
      const [note] = await notes();
      expect(note).toMatchObject({ ruleId: "fearFromRests", visibility: "gm", summary: "Long rest: Gain 1d4 + 2 Fear", groupId: stored.groupId, undoable: true });
      expect((await gm.query(api.restsReads.current, { campaignId })).last?.fearPrompt).toBe("Gain 1d4 + 2 Fear");

      await gm.mutation(api.rests.undo, { campaignId, restId, idempotencyKey: key() });
      expect((await rest(restId))?.status).toBe("open");
      expect((await rest(restId))?.fearPrompt).toBeUndefined();
      expect((await log()).find((r) => r._id === note!._id)?.undoneAt).toBeDefined();
      await finish(restId);

      const short = await finish((await start("short")).restId);
      expect(short.fearPrompt).toBe("Gain 1d4 Fear");
    });
  });

  describe("T2 Short-rest limit", () => {
    it("Book: the fourth short rest is refused, no note", async () => {
      const { start, finish, notes } = await setup();
      for (let i = 0; i < 3; i++) await finish((await start("short")).restId);
      expect(await codeOf(start("short"))).toBe("REST_RULE");
      expect(await notes()).toHaveLength(0);
    });

    it("Manual: the fourth short rest starts and the GM gets a note", async () => {
      const { setRule, start, finish, rest, notes } = await setup();
      await setRule({ key: "shortRestLimit", value: "manual" });
      for (let i = 0; i < 3; i++) await finish((await start("short")).restId);
      expect(await notes()).toHaveLength(0);
      const { restId } = await start("short");
      expect((await rest(restId))?.status).toBe("open");
      const [note] = await notes();
      expect(note).toMatchObject({ ruleId: "shortRestLimit", visibility: "gm", summary: "Fourth short rest in a row: the book says long rest" });
      await finish(restId);
    });
  });

  describe("T4 Interrupted rest", () => {
    it("Book: an interrupted long rest still gives short-rest benefits, no note", async () => {
      const { p1, a, edit, sheetOf, start, interrupt, notes } = await setup();
      await edit(a, (s) => ({ ...s, stress: 6 }));
      const { restId } = await start("long");
      await p1.mutation(api.rests.choose, { restId, characterId: a, moves: [{ move: "clearAllStress" }, { move: "prepare" }], idempotencyKey: key() });
      const { fearGained } = await interrupt(restId);
      expect(fearGained).toBeGreaterThan(0);
      expect((await sheetOf(a)).stress).toBeLessThanOrEqual(4);
      expect(await notes()).toHaveLength(0);
    });

    it("Manual: Interrupt closes the rest with no moves, no Fear, and a GM note", async () => {
      const { p1, a, edit, sheetOf, setRule, start, interrupt, rest, fear, log, notes } = await setup();
      await setRule({ key: "interruptedRest", value: "manual" });
      await edit(a, (s) => ({ ...s, stress: 6 }));
      const { restId } = await start("long");
      await p1.mutation(api.rests.choose, { restId, characterId: a, moves: [{ move: "clearAllStress" }, { move: "prepare" }], idempotencyKey: key() });
      expect(await interrupt(restId)).toEqual({ fearRoll: null, fearGained: 0 });
      expect((await sheetOf(a)).stress).toBe(6);
      expect(await fear()).toBe(0);
      expect((await rest(restId))?.status).toBe("interrupted");
      expect((await log()).filter((r) => r.kind === "rest")).toHaveLength(0);
      const [note] = await notes();
      expect(note).toMatchObject({ ruleId: "interruptedRest", visibility: "gm", summary: "Rest interrupted: decide what anyone keeps" });

      // A short rest too.
      await interrupt((await start("short")).restId);
      expect(await notes()).toHaveLength(2);
    });
  });
});
