import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
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

/** A campaign with a GM, two players who each own a character, and an outsider. */
async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
    p2: await ctx.db.insert("users", { email: "p2@example.com" }),
    out: await ctx.db.insert("users", { email: "out@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const [gm, p1, p2, out] = [as(ids.gm), as(ids.p1), as(ids.p2), as(ids.out)];
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const a = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  const b = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;

  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (id: Id<"characters">, change: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, change(readSheet((await ctx.db.get("characters", id))!.sheet))));
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const start = (kind: "short" | "long", override?: boolean) => gm.mutation(api.rests.start, { campaignId, kind, override, idempotencyKey: key() });
  const finish = (restId: Id<"rests">) => gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
  const rest = (restId: Id<"rests">) => t.run((ctx) => ctx.db.get("rests", restId));
  return { t, ids, gm, p1, p2, out, campaignId, a, b, sheetOf, edit, fear, start, finish, rest };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

describe("rests", () => {
  useAllowlist(EMAILS);

  it("a short rest: players pick, the GM finishes, moves, Fear and the log apply", async () => {
    const { p1, a, b, sheetOf, edit, fear, start, finish, rest, t, campaignId } = await setup();
    await edit(a, (s) => ({ ...s, stress: 6, effects: [{ id: "e1", source: "Test", text: "", until: "rest" }] }));
    await edit(b, (s) => ({ ...s, hp: 4 }));
    const { restId } = await start("short");
    await p1.mutation(api.rests.choose, { restId, characterId: a, moves: [{ move: "clearStress" }, { move: "tendToWounds", targetId: b }], idempotencyKey: key() });

    const { fearRoll, fearGained } = await finish(restId);

    expect(fearRoll).toBeGreaterThanOrEqual(1);
    expect(fearRoll).toBeLessThanOrEqual(4);
    expect(fearGained).toBe(fearRoll);
    expect(await fear()).toBe(fearGained);
    const ash = await sheetOf(a);
    expect(ash.stress).toBeLessThanOrEqual(6 - 2);
    expect(ash.effects).toEqual([]);
    expect((await sheetOf(b)).hp).toBeLessThanOrEqual(4 - 2);
    expect((await rest(restId))?.status).toBe("finished");

    const rows = await t.run((ctx) => ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect());
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.groupId)).size).toBe(1);
    expect(rows.find((r) => r.characterId === undefined)?.fearDelta).toBe(fearGained);
  });

  it("refuses a fourth short rest in a row, even with the old override flag (CB 105, HF 176)", async () => {
    const { start, finish, gm, t, campaignId } = await setup();
    for (let i = 0; i < 3; i++) await finish((await start("short")).restId);
    expect(await codeOf(start("short"))).toBe("REST_RULE");
    // The deprecated `override` arg is ignored: no GM override any more (RF2).
    expect(await codeOf(start("short", true))).toBe("REST_RULE");
    expect((await gm.query(api.rests.current, { campaignId })).open).toBeNull();
    const rows = await t.run((ctx) => ctx.db.query("rests").withIndex("by_campaign_started", (q) => q.eq("campaignId", campaignId)).collect());
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.gmOverride !== undefined)).toBe(false);
    // A long rest resets the count.
    await finish((await start("long")).restId);
    expect((await gm.query(api.rests.current, { campaignId })).shortRestsSinceLong).toBe(0);
    expect(await codeOf(start("short"))).toBe("ok");
  });

  it("M5: a rest over 49 resting PCs is refused (start and finish), never a partial undo group", async () => {
    const { t, a, start, finish } = await setup();
    const copies = (n: number) =>
      t.run(async (ctx) => {
        const c = (await ctx.db.get("characters", a))!;
        for (let i = 0; i < n; i++) {
          await ctx.db.insert("characters", { campaignId: c.campaignId, ownerId: c.ownerId, createdBy: c.createdBy, status: "active", sheet: c.sheet, createdAt: 0, updatedAt: 0 });
        }
      });
    await copies(47);
    const { restId } = await start("short");
    await copies(1);
    expect(await codeOf(finish(restId))).toBe("REST_RULE");
    await t.run((ctx) => ctx.db.delete("rests", restId));
    expect(await codeOf(start("short"))).toBe("REST_RULE");
  });

  it("refuses a second open rest", async () => {
    const { start } = await setup();
    await start("short");
    expect(await codeOf(start("long"))).toBe("REST_RULE");
  });

  it("long rest Fear is 1d4 + active PCs; away PCs are left out (HF 127)", async () => {
    const { t, b, start, finish, sheetOf, edit, a } = await setup();
    await t.run((ctx) => ctx.db.patch("characters", b, { status: "away", away: { reason: "infirmary" } }));
    await edit(a, (s) => ({ ...s, conditions: ["unconscious"] }));
    await edit(b, (s) => ({ ...s, stress: 3 }));
    const { restId } = await start("long");
    const { fearRoll, fearGained } = await finish(restId);
    expect(fearGained).toBe(fearRoll! + 1);
    // The unconscious PC wakes on a long rest (CB 106); the away PC is untouched.
    expect((await sheetOf(a)).conditions).not.toContain("unconscious");
    expect((await sheetOf(b)).stress).toBe(3);
  });

  it("short rest Fear is 1d4 regardless of the party", async () => {
    const { start, finish } = await setup();
    const { fearRoll, fearGained } = await finish((await start("short")).restId);
    expect(fearGained).toBe(fearRoll);
  });

  it("choose: a player can't choose for another player's character; away, dead and unconscious characters can't choose", async () => {
    const { p1, p2, a, b, t, edit, start } = await setup();
    const { restId } = await start("short");
    const moves = [{ move: "clearStress" as const }, { move: "prepare" as const }];
    expect(await codeOf(p1.mutation(api.rests.choose, { restId, characterId: b, moves, idempotencyKey: key() }))).toBe("FORBIDDEN");
    await edit(a, (s) => ({ ...s, conditions: ["unconscious"] }));
    expect(await codeOf(p1.mutation(api.rests.choose, { restId, characterId: a, moves, idempotencyKey: key() }))).toBe("CHARACTER_UNAVAILABLE");
    await t.run((ctx) => ctx.db.patch("characters", b, { status: "dead" }));
    expect(await codeOf(p2.mutation(api.rests.choose, { restId, characterId: b, moves, idempotencyKey: key() }))).toBe("CHARACTER_UNAVAILABLE");
    await t.run((ctx) => ctx.db.patch("characters", b, { status: "away", away: { reason: "sentHome" } }));
    expect(await codeOf(p2.mutation(api.rests.choose, { restId, characterId: b, moves, idempotencyKey: key() }))).toBe("CHARACTER_UNAVAILABLE");
  });

  it("choose: rule checks on moves, targets and projects", async () => {
    const { p1, a, b, t, start } = await setup();
    const { restId } = await start("short");
    const choose = (moves: { move: "clearStress" | "tendToWounds" | "clearAllStress" | "prepare"; targetId?: Id<"characters"> }[]) =>
      codeOf(p1.mutation(api.rests.choose, { restId, characterId: a, moves, idempotencyKey: key() }));
    expect(await choose([{ move: "clearStress" }])).toBe("REST_RULE");
    expect(await choose([{ move: "clearAllStress" }, { move: "prepare" }])).toBe("REST_RULE");
    expect(await choose([{ move: "clearStress", targetId: b }, { move: "prepare" }])).toBe("REST_RULE");
    await t.run((ctx) => ctx.db.patch("characters", b, { status: "away", away: { reason: "infirmary" } }));
    expect(await choose([{ move: "tendToWounds", targetId: b }, { move: "prepare" }])).toBe("REST_RULE");
    expect(await choose([{ move: "clearStress" }, { move: "clearStress" }])).toBe("ok");
    // A second pick replaces the first.
    expect(await choose([{ move: "prepare" }, { move: "prepare" }])).toBe("ok");
    const rows = await t.run((ctx) => ctx.db.query("restChoices").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].moves.map((m) => m.move)).toEqual(["prepare", "prepare"]);
  });

  it("Work on a Project ticks the character's countdown; undo does not revert it (plan note 11)", async () => {
    const { p1, p2, a, b, gm, campaignId, start, finish } = await setup();
    const { countdownId } = await p1.mutation(api.rests.createProject, { characterId: a, name: "Decipher the tome", startingValue: 3, idempotencyKey: key() });
    const other = (await p2.mutation(api.rests.createProject, { characterId: b, name: "Forge", startingValue: 3, idempotencyKey: key() })).countdownId;
    const { restId } = await start("long");
    expect(
      await codeOf(p1.mutation(api.rests.choose, { restId, characterId: a, moves: [{ move: "workOnProject", countdownId: other }, { move: "prepare" }], idempotencyKey: key() })),
    ).toBe("REST_RULE");
    await p1.mutation(api.rests.choose, { restId, characterId: a, moves: [{ move: "workOnProject", countdownId }, { move: "workOnProject" }], idempotencyKey: key() });
    await finish(restId);
    const projects = await p1.query(api.rests.projects, { characterId: a });
    expect(projects.map((p) => p.currentValue)).toEqual([2]);
    // Projects stay off the dashboard list.
    expect((await gm.query(api.countdowns.listByCampaign, { campaignId })).map((c) => c._id)).not.toContain(countdownId);
    await gm.mutation(api.rests.undo, { campaignId, restId, idempotencyKey: key() });
    expect((await p1.query(api.rests.projects, { characterId: a })).map((p) => p.currentValue)).toEqual([2]);
  });

  it("undo restores every sheet and the Fear, and reopens the rest", async () => {
    const { p1, a, b, gm, campaignId, sheetOf, edit, fear, start, finish, rest } = await setup();
    await edit(a, (s) => ({ ...s, stress: 6 }));
    await edit(b, (s) => ({ ...s, hp: 4 }));
    const beforeA = await sheetOf(a);
    const beforeB = await sheetOf(b);
    const { restId } = await start("short");
    await p1.mutation(api.rests.choose, { restId, characterId: a, moves: [{ move: "clearStress" }, { move: "tendToWounds", targetId: b }], idempotencyKey: key() });
    const { fearGained } = await finish(restId);
    expect(await fear()).toBe(fearGained);

    const { fearReverted } = await gm.mutation(api.rests.undo, { campaignId, restId, idempotencyKey: key() });

    expect(fearReverted).toBe(fearGained);
    expect(await fear()).toBe(0);
    expect(await sheetOf(a)).toEqual(beforeA);
    expect(await sheetOf(b)).toEqual(beforeB);
    expect((await rest(restId))?.status).toBe("open");
    // A second undo has nothing left; the reopened rest can be finished again.
    expect(await codeOf(gm.mutation(api.rests.undo, { campaignId, restId, idempotencyKey: key() }))).toBe("REST_RULE");
    expect(await codeOf(finish(restId))).toBe("ok");
  });

  it("undo is refused once a PC has acted since the rest", async () => {
    const { a, gm, campaignId, t, start, finish, ids } = await setup();
    const { restId } = await start("short");
    await finish(restId);
    await t.run(async (ctx) => {
      await ctx.db.insert("actionLog", { campaignId, characterId: a, actorId: ids.p1, kind: "roll", visibility: "public", summary: "rolled", undoable: true, at: Date.now() + 1000 });
    });
    expect(await codeOf(gm.mutation(api.rests.undo, { campaignId, restId, idempotencyKey: key() }))).toBe("UNDO_STALE");
  });

  it("interrupt: a short rest gives nothing; a long rest gives short-rest benefits (CB 105)", async () => {
    const { p1, a, gm, campaignId, sheetOf, edit, fear, start, rest } = await setup();
    await edit(a, (s) => ({ ...s, stress: 6 }));
    const short = await start("short");
    await p1.mutation(api.rests.choose, { restId: short.restId, characterId: a, moves: [{ move: "clearStress" }, { move: "clearStress" }], idempotencyKey: key() });
    expect(await gm.mutation(api.rests.interrupt, { campaignId, restId: short.restId, idempotencyKey: key() })).toEqual({ fearRoll: null, fearGained: 0 });
    expect((await sheetOf(a)).stress).toBe(6);
    expect(await fear()).toBe(0);
    expect((await rest(short.restId))?.status).toBe("interrupted");

    const long = await start("long");
    await p1.mutation(api.rests.choose, { restId: long.restId, characterId: a, moves: [{ move: "clearAllStress" }, { move: "prepare" }], idempotencyKey: key() });
    const { fearRoll, fearGained } = await gm.mutation(api.rests.interrupt, { campaignId, restId: long.restId, idempotencyKey: key() });
    const stress = (await sheetOf(a)).stress;
    // Clear All Stress became Clear Stress: 1d4 + tier 1 cleared, not all 6.
    expect(stress).toBeGreaterThanOrEqual(6 - 5);
    expect(stress).toBeLessThanOrEqual(6 - 2);
    expect(fearGained).toBe(fearRoll);
  });

  it("an interrupted long rest after three short rests still gives short-rest benefits (CB 105)", async () => {
    const { p1, a, gm, campaignId, sheetOf, edit, start, finish } = await setup();
    for (let i = 0; i < 3; i++) await finish((await start("short")).restId);
    await edit(a, (s) => ({ ...s, stress: 6 }));
    const long = await start("long");
    await p1.mutation(api.rests.choose, { restId: long.restId, characterId: a, moves: [{ move: "clearAllStress" }, { move: "prepare" }], idempotencyKey: key() });
    await gm.mutation(api.rests.interrupt, { campaignId, restId: long.restId, idempotencyKey: key() });
    expect((await sheetOf(a)).stress).toBeLessThanOrEqual(6 - 2);
    // An interrupted long rest is not a long rest: the next rest must still be a long rest.
    expect(await codeOf(start("short"))).toBe("REST_RULE");
  });

  describe("access: anonymous, outsider, player and GM", () => {
    it("current and projects", async () => {
      const { t, gm, p1, out, campaignId, a } = await setup();
      expect(await codeOf(t.query(api.rests.current, { campaignId }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(out.query(api.rests.current, { campaignId }))).toBe("NOT_FOUND");
      expect(await codeOf(p1.query(api.rests.current, { campaignId }))).toBe("ok");
      expect(await codeOf(gm.query(api.rests.current, { campaignId }))).toBe("ok");
      expect(await codeOf(t.query(api.rests.projects, { characterId: a }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(out.query(api.rests.projects, { characterId: a }))).toBe("NOT_FOUND");
      expect(await codeOf(p1.query(api.rests.projects, { characterId: a }))).toBe("ok");
      expect(await codeOf(gm.query(api.rests.projects, { characterId: a }))).toBe("ok");
    });

    it("start, finish, interrupt and undo are the GM's", async () => {
      const { t, gm, p1, out, campaignId } = await setup();
      for (const caller of [t, out, p1]) {
        const expected = caller === t ? "UNAUTHENTICATED" : caller === out ? "NOT_FOUND" : "FORBIDDEN";
        expect(await codeOf(caller.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: key() }))).toBe(expected);
      }
      const { restId } = await gm.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: key() });
      for (const fn of [api.rests.finish, api.rests.interrupt, api.rests.undo]) {
        expect(await codeOf(t.mutation(fn, { campaignId, restId, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
        expect(await codeOf(out.mutation(fn, { campaignId, restId, idempotencyKey: key() }))).toBe("NOT_FOUND");
        expect(await codeOf(p1.mutation(fn, { campaignId, restId, idempotencyKey: key() }))).toBe("FORBIDDEN");
      }
      expect(await codeOf(gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() }))).toBe("ok");
      expect(await codeOf(gm.mutation(api.rests.undo, { campaignId, restId, idempotencyKey: key() }))).toBe("ok");
      expect(await codeOf(gm.mutation(api.rests.interrupt, { campaignId, restId, idempotencyKey: key() }))).toBe("ok");
    });

    it("choose and createProject: the character's owner and the GM", async () => {
      const { t, gm, p1, p2, out, a, start } = await setup();
      const { restId } = await start("short");
      const moves = [{ move: "prepare" as const }, { move: "prepare" as const }];
      expect(await codeOf(t.mutation(api.rests.choose, { restId, characterId: a, moves, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(out.mutation(api.rests.choose, { restId, characterId: a, moves, idempotencyKey: key() }))).toBe("NOT_FOUND");
      expect(await codeOf(p2.mutation(api.rests.choose, { restId, characterId: a, moves, idempotencyKey: key() }))).toBe("FORBIDDEN");
      expect(await codeOf(p1.mutation(api.rests.choose, { restId, characterId: a, moves, idempotencyKey: key() }))).toBe("ok");
      expect(await codeOf(gm.mutation(api.rests.choose, { restId, characterId: a, moves, idempotencyKey: key() }))).toBe("ok");
      const project = { characterId: a, name: "Tome", startingValue: 4 };
      expect(await codeOf(t.mutation(api.rests.createProject, { ...project, idempotencyKey: key() }))).toBe("UNAUTHENTICATED");
      expect(await codeOf(out.mutation(api.rests.createProject, { ...project, idempotencyKey: key() }))).toBe("NOT_FOUND");
      expect(await codeOf(p2.mutation(api.rests.createProject, { ...project, idempotencyKey: key() }))).toBe("FORBIDDEN");
      expect(await codeOf(p1.mutation(api.rests.createProject, { ...project, idempotencyKey: key() }))).toBe("ok");
      expect(await codeOf(gm.mutation(api.rests.createProject, { ...project, idempotencyKey: key() }))).toBe("ok");
      expect(await codeOf(p1.mutation(api.rests.createProject, { ...project, startingValue: 0, idempotencyKey: key() }))).toBe("INVALID");
    });
  });
});
