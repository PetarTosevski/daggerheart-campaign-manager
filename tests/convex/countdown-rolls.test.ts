import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

/**
 * countdowns-advanced K1: rolls tick countdowns. Armed countdowns tick on every counted PC action roll (Q1 (c), D2),
 * by the R4 table for progress / consequence, a Tag Team once (R10), never a reaction roll (R11); the GM's feed button
 * (countdownRolls.preview / applyRoll / countedRows) applies a roll to any countdown, once per pair (D5); undo takes
 * the ticks back (D11, Q5).
 */

const EMAILS = "gm@example.com,p1@example.com,p2@example.com,out@example.com";
const PRIMARY = WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!;

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
    primaryWeaponId: PRIMARY.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

type Caller = Pick<ReturnType<typeof makeTest>, "mutation" | "query">;

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

/** Manual Duality dice [Hope, Fear] and a Difficulty for each outcome (agility +2). */
const OUTCOMES = {
  critical: { values: [5, 5] },
  successHope: { values: [8, 3], difficulty: 10 },
  successFear: { values: [3, 8], difficulty: 10 },
  failHope: { values: [8, 3], difficulty: 30 },
  failFear: { values: [3, 8], difficulty: 30 },
} as const;
type Outcome = keyof typeof OUTCOMES;

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
  const edit = (id: Id<"characters">, change: Partial<CharacterSheet>) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...change }));

  const create = async (extra: Record<string, unknown>) =>
    (
      await gm.mutation(api.countdowns.create, {
        campaignId,
        name: "Doom",
        description: "",
        category: "threat",
        consequence: "The dam breaks",
        idempotencyKey: key(),
        ...extra,
      } as never)
    ).countdownId as Id<"countdowns">;
  const row = (id: Id<"countdowns">) => t.run(async (ctx) => (await ctx.db.get("countdowns", id))!);
  const value = async (id: Id<"countdowns">) => (await row(id)).currentValue;
  /** A manual action roll of `who`'s character with the given outcome. */
  const roll = async (outcome: Outcome, who: Caller = p1, characterId: Id<"characters"> = a, kind: "action" | "reaction" = "action") => {
    const { values, ...rest } = OUTCOMES[outcome] as { values: readonly number[]; difficulty?: number };
    const result = (await who.mutation(api.rolls.manualRoll, { characterId, values: [...values], roll: { ...agility, kind, ...rest }, idempotencyKey: key() })) as {
      entryId: Id<"actionLog">;
      roll: { outcome: string };
    };
    return result;
  };
  const preview = (who: Caller, entryId: Id<"actionLog">) => who.query(api.countdownRolls.preview, { campaignId, entryId });
  const apply = (who: Caller, entryId: Id<"actionLog">, countdownIds: Id<"countdowns">[]) =>
    who.mutation(api.countdownRolls.applyRoll, { campaignId, entryId, countdownIds, idempotencyKey: key() });
  const undo = (who: Caller, entryId: Id<"actionLog">) => who.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  const notices = () =>
    t.run(async (ctx) =>
      (await ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect()).filter((r) => r.kind === "countdown"),
    );
  /** A frame-owned countdown (an objective): never ticked by rolls (D4). */
  const frameOwned = () =>
    t.run((ctx) =>
      ctx.db.insert("countdowns", {
        campaignId,
        name: "Objective",
        description: "",
        category: "project",
        startingValue: 5,
        currentValue: 5,
        status: "active",
        consequence: "",
        createdAt: Date.now(),
        ownerKey: "objective:x",
        armed: true,
      }),
    );
  /** A chase pair (D9), inserted directly until K3's createChase lands: the PCs' progress row and the rivals' consequence row. */
  const chase = (party: number, rivals: number, start = 6) =>
    t.run(async (ctx) => {
      const base = { campaignId, description: "", category: "threat" as const, startingValue: start, status: "active" as const, consequence: "", createdAt: Date.now(), armed: true };
      const p = await ctx.db.insert("countdowns", { ...base, name: "The party", currentValue: party, mode: "progress" });
      const r = await ctx.db.insert("countdowns", { ...base, name: "The thief", currentValue: rivals, mode: "consequence" });
      await ctx.db.patch("countdowns", p, { chase: { partnerId: r, side: "party", party: "pursuing" } });
      await ctx.db.patch("countdowns", r, { chase: { partnerId: p, side: "rivals", party: "pursuing" } });
      return { p, r };
    });
  return { t, ids, gm, p1, p2, out, campaignId, a, b, edit, create, row, value, roll, preview, apply, undo, notices, frameOwned, chase };
}

describe("countdown rolls: access (anonymous, outsider, player, GM)", () => {
  useAllowlist(EMAILS);

  it("preview, applyRoll and countedRows: GM only", async () => {
    const { t, gm, p1, out, campaignId, create, roll, preview, apply } = await setup();
    const id = await create({ startingValue: 4 });
    const { entryId } = await roll("successHope");
    for (const who of [t, out, p1] as Caller[]) {
      const expected = who === t ? "UNAUTHENTICATED" : who === out ? "NOT_FOUND" : "FORBIDDEN";
      expect(await codeOf(preview(who, entryId))).toBe(expected);
      expect(await codeOf(apply(who, entryId, [id]))).toBe(expected);
      expect(await codeOf(who.query(api.countdownRolls.countedRows, { campaignId, entryIds: [entryId] }))).toBe(expected);
    }
    expect(await codeOf(preview(gm, entryId))).toBe("ok");
    expect(await codeOf(gm.query(api.countdownRolls.countedRows, { campaignId, entryIds: [entryId] }))).toBe("ok");
    expect(await codeOf(apply(gm, entryId, [id]))).toBe("ok");
  });
});

describe("countdown rolls: automatic ticks (Q1, D2-D4, D6)", () => {
  useAllowlist(EMAILS);

  it("an armed standard countdown ticks 1 on every outcome (R2), with one history row and one tick row per roll", async () => {
    const { t, create, roll, value } = await setup();
    const id = await create({ startingValue: 10, armed: true });
    for (const outcome of Object.keys(OUTCOMES) as Outcome[]) {
      const before = await value(id);
      const r = await roll(outcome);
      expect(r.roll.outcome).toBe(outcome);
      expect(await value(id)).toBe(before - 1);
    }
    const ticks = await t.run((ctx) => ctx.db.query("countdownTicks").withIndex("by_campaign_at").collect());
    expect(ticks).toHaveLength(5);
    expect(ticks.every((k) => k.source === "roll")).toBe(true);
    const history = await t.run(async (ctx) => (await ctx.db.query("history").collect()).filter((h) => h.kind === "countdown" && h.countdownId === id));
    expect(history.map((h) => h.action)).toEqual(["create", "roll", "roll", "roll", "roll", "roll"]);
  });

  it("progress and consequence tick by the R4 table, outcome by outcome", async () => {
    const R4: Record<Outcome, [number, number]> = { failFear: [0, 3], failHope: [0, 2], successFear: [1, 1], successHope: [2, 0], critical: [3, 0] };
    for (const [outcome, [progress, consequence]] of Object.entries(R4) as [Outcome, [number, number]][]) {
      const { create, roll, value } = await setup();
      const p = await create({ startingValue: 10, mode: "progress", armed: true });
      const c = await create({ startingValue: 10, mode: "consequence", armed: true });
      await roll(outcome);
      expect([10 - (await value(p)), 10 - (await value(c))], outcome).toEqual([progress, consequence]);
    }
  });

  it("a roll without a Difficulty counts as a success (D3)", async () => {
    const { p1, a, create, value } = await setup();
    const p = await create({ startingValue: 10, mode: "progress", armed: true });
    // Hope 3, Fear 8 and no Difficulty: recorded as a success with Fear (actionOutcome), so progress ticks 1.
    const r = await p1.mutation(api.rolls.manualRoll, { characterId: a, values: [3, 8], roll: agility, idempotencyKey: key() });
    expect(r.roll).toMatchObject({ outcome: "successFear" });
    expect(r.roll.difficulty).toBeUndefined();
    expect(await value(p)).toBe(9);
  });

  it("a server-rolled action roll without a Difficulty ticks a progress countdown as a success", async () => {
    const { p1, a, create, value } = await setup();
    const p = await create({ startingValue: 10, mode: "progress", armed: true });
    const r = await p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey: key() });
    const expected = { critical: 3, successHope: 2, successFear: 1 }[r.roll.outcome as "critical" | "successHope" | "successFear"];
    expect(expected).toBeDefined();
    expect(await value(p)).toBe(10 - expected);
  });

  it("reaction, damage and GM rolls tick nothing (R11, D2)", async () => {
    const { gm, p1, a, campaignId, create, roll, value } = await setup();
    const id = await create({ startingValue: 4, armed: true });
    await roll("failFear", p1, a, "reaction");
    await p1.mutation(api.rolls.damageRoll, { characterId: a, source: { kind: "weapon", slot: "primary" }, critical: false, modifier: 0, options: [], idempotencyKey: key() });
    await gm.mutation(api.rolls.gmRoll, { campaignId, dice: [{ count: 1, sides: 20 }], modifier: 0, idempotencyKey: key() });
    expect(await value(id)).toBe(4);
  });

  it("paused, completed, unarmed, long-term and frame-owned countdowns are not auto-ticked (D4)", async () => {
    const { gm, create, roll, value, frameOwned } = await setup();
    const paused = await create({ startingValue: 4, armed: true });
    await gm.mutation(api.countdowns.operate, { countdownId: paused, action: "pause", idempotencyKey: key() });
    const done = await create({ startingValue: 1, armed: true });
    await gm.mutation(api.countdowns.operate, { countdownId: done, action: "advance", idempotencyKey: key() });
    const unarmed = await create({ startingValue: 4 });
    const longTerm = await create({ startingValue: 8, mode: "longTerm", armed: true });
    const owned = await frameOwned();
    await roll("successHope");
    expect([await value(paused), await value(done), await value(unarmed), await value(longTerm), await value(owned)]).toEqual([4, 0, 4, 8, 5]);
  });

  it("a tick larger than the value left stops at 0 and triggers (D6)", async () => {
    const { create, roll, row, notices } = await setup();
    const id = await create({ startingValue: 2, mode: "consequence", armed: true });
    await roll("failFear");
    expect(await row(id)).toMatchObject({ currentValue: 0, status: "completed", triggerCount: 1 });
    const n = await notices();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ visibility: "gm", undoable: false, summary: "Doom triggered: The dam breaks" });
  });

  it("a loop resets on a roll and keeps counting (R6, Q2)", async () => {
    const { create, roll, row, notices } = await setup();
    const id = await create({ startingValue: 2, repeat: "loop", armed: true });
    await roll("successHope");
    await roll("successFear");
    expect(await row(id)).toMatchObject({ currentValue: 2, startingValue: 2, status: "active", triggerCount: 1 });
    await roll("failHope");
    expect((await row(id)).currentValue).toBe(1);
    expect(await notices()).toHaveLength(1);
  });

  it("a Tag Team counts once for the pair, keyed on the group's first result row; its pending rolls tick nothing (R10, D5)", async () => {
    const { t, p1, a, b, edit, create, value } = await setup();
    const id = await create({ startingValue: 5, armed: true });
    await edit(a, { hope: 6 });
    const side = { trait: "agility" as const, modifier: 0 };
    const { rolls, groupId } = await p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: side, partner: side, idempotencyKey: key() });
    expect(rolls).toHaveLength(2);
    expect(await value(id)).toBe(5);
    await p1.mutation(api.rolls.tagTeamApply, { entryId: rolls[0]!.entryId, pick: b, idempotencyKey: key() });
    expect(await value(id)).toBe(4);
    const group = await t.run(async (ctx) =>
      (await ctx.db.query("actionLog").withIndex("by_campaign_at").collect()).filter((r) => r.groupId === groupId).sort((x, y) => x.at - y.at || x._creationTime - y._creationTime),
    );
    expect(group).toHaveLength(4);
    const ticks = await t.run((ctx) => ctx.db.query("countdownTicks").withIndex("by_campaign_at").collect());
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.entryId).toBe(group[2]!._id);
  });

  it("a chase pair moves both rows by R4 and stops once one side reaches 0 (R8, D9)", async () => {
    const { roll, value, row, chase } = await setup();
    // The book's example: the PCs' d6 at 6, the thief at 3.
    const { p, r } = await chase(6, 3);
    await roll("successHope");
    expect([await value(p), await value(r)]).toEqual([4, 3]);
    await roll("successFear");
    expect([await value(p), await value(r)]).toEqual([3, 2]);
    await roll("failFear");
    expect([await value(p), await value(r)]).toEqual([3, 0]);
    expect((await row(r)).status).toBe("completed");
    await roll("critical");
    expect([await value(p), await value(r)]).toEqual([3, 0]);
  });

  it("undoing a roll takes back the ticks it caused, a trigger included (D11, Q5)", async () => {
    const { p1, create, roll, row, undo, notices } = await setup();
    const id = await create({ startingValue: 1, repeat: "loop", armed: true });
    const other = await create({ startingValue: 5, armed: true });
    const { entryId } = await roll("successHope");
    expect(await row(id)).toMatchObject({ currentValue: 1, triggerCount: 1 });
    expect((await row(other)).currentValue).toBe(4);
    await undo(p1, entryId);
    expect(await row(id)).toMatchObject({ currentValue: 1, status: "active" });
    expect((await row(id)).triggerCount).toBeUndefined();
    expect((await row(other)).currentValue).toBe(5);
    expect((await notices())[0]!.undoneAt).toBeDefined();
  });
});

describe("countdown rolls: the feed button (Q1 (c), D5)", () => {
  useAllowlist(EMAILS);

  it("preview lists active non-long-term countdowns with the amount and whether this roll ticked them", async () => {
    const { gm, create, roll, preview } = await setup();
    const armed = await create({ startingValue: 6, armed: true });
    const progress = await create({ startingValue: 6, mode: "progress" });
    const consequence = await create({ startingValue: 6, mode: "consequence" });
    await create({ startingValue: 8, mode: "longTerm" });
    const paused = await create({ startingValue: 4 });
    await gm.mutation(api.countdowns.operate, { countdownId: paused, action: "pause", idempotencyKey: key() });
    const { entryId } = await roll("failFear");
    const view = await preview(gm, entryId);
    expect(view.outcome).toBe("failFear");
    expect(view.countdowns.map((c) => [c.countdownId, c.amount, c.ticked])).toEqual([
      [armed, 1, true],
      [progress, 0, false],
      [consequence, 3, false],
    ]);
  });

  it("applyRoll ticks the chosen unarmed countdowns with source feed; a second apply of the pair is refused", async () => {
    const { t, gm, create, roll, value, apply, preview } = await setup();
    const id = await create({ startingValue: 4 });
    const c = await create({ startingValue: 6, mode: "consequence" });
    const { entryId } = await roll("failHope");
    expect(await value(id)).toBe(4);
    expect(await apply(gm, entryId, [id, c])).toEqual([
      { countdownId: id, currentValue: 3, triggered: false },
      { countdownId: c, currentValue: 4, triggered: false },
    ]);
    const ticks = await t.run((ctx) => ctx.db.query("countdownTicks").withIndex("by_entry_countdown", (q) => q.eq("entryId", entryId)).collect());
    expect(ticks.map((k) => k.source)).toEqual(["feed", "feed"]);
    expect((await preview(gm, entryId)).countdowns.every((x) => x.ticked)).toBe(true);
    expect(await codeOf(apply(gm, entryId, [id]))).toBe("COUNTDOWN_RULE");
    expect(await value(id)).toBe(3);
  });

  it("the feed apply after an automatic tick is refused (D5)", async () => {
    const { gm, create, roll, value, apply } = await setup();
    const id = await create({ startingValue: 4, armed: true });
    const { entryId } = await roll("successHope");
    expect(await value(id)).toBe(3);
    expect(await codeOf(apply(gm, entryId, [id]))).toBe("COUNTDOWN_RULE");
    expect(await value(id)).toBe(3);
  });

  it("refusals: undone, reaction and pending Tag Team rows INVALID; other campaign's rows and countdowns, frame-owned NOT_FOUND; paused and long-term COUNTDOWN_RULE", async () => {
    const { t, gm, p1, a, b, edit, create, row, roll, apply, preview, undo, frameOwned } = await setup();
    const id = await create({ startingValue: 4 });
    const reaction = await roll("successHope", p1, a, "reaction");
    expect(await codeOf(preview(gm, reaction.entryId))).toBe("INVALID");
    expect(await codeOf(apply(gm, reaction.entryId, [id]))).toBe("INVALID");

    const undone = await roll("successHope");
    await undo(p1, undone.entryId);
    expect(await codeOf(preview(gm, undone.entryId))).toBe("INVALID");
    expect(await codeOf(apply(gm, undone.entryId, [id]))).toBe("INVALID");

    await edit(b, { hope: 6 });
    const side = { trait: "agility" as const, modifier: 0 };
    const { rolls } = await gm.mutation(api.rolls.tagTeam, { characterId: b, partnerId: a, initiator: side, partner: side, idempotencyKey: key() });
    expect(await codeOf(apply(gm, rolls[0]!.entryId, [id]))).toBe("INVALID");
    await gm.mutation(api.rolls.tagTeamApply, { entryId: rolls[0]!.entryId, pick: a, idempotencyKey: key() });

    const { entryId } = await roll("successHope");
    expect(await codeOf(apply(gm, entryId, [await frameOwned()]))).toBe("NOT_FOUND");
    const paused = await create({ startingValue: 4 });
    await gm.mutation(api.countdowns.operate, { countdownId: paused, action: "pause", idempotencyKey: key() });
    expect(await codeOf(apply(gm, entryId, [paused]))).toBe("COUNTDOWN_RULE");
    expect(await codeOf(apply(gm, entryId, [await create({ startingValue: 8, mode: "longTerm" })]))).toBe("COUNTDOWN_RULE");
    expect(await codeOf(apply(gm, entryId, []))).toBe("INVALID");

    // Another campaign of the same GM: its countdown, and a row passed with the wrong campaign.
    const { campaignId: secondId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Second", idempotencyKey: key() });
    const { countdownId: foreign } = await gm.mutation(api.countdowns.create, {
      campaignId: secondId,
      name: "Elsewhere",
      description: "",
      category: "threat",
      consequence: "",
      startingValue: 4,
      idempotencyKey: key(),
    });
    expect(await codeOf(apply(gm, entryId, [id, foreign]))).toBe("NOT_FOUND");
    // A counted roll row of the second campaign, asked about through the first.
    const foreignRow = await t.run(async (ctx) => {
      const { _id, _creationTime, ...copy } = (await ctx.db.get("actionLog", entryId))!;
      void _id;
      void _creationTime;
      return ctx.db.insert("actionLog", { ...copy, campaignId: secondId, characterId: undefined, before: undefined });
    });
    expect(await codeOf(gm.query(api.countdownRolls.preview, { campaignId: secondId, entryId: foreignRow }))).toBe("ok");
    expect(await codeOf(preview(gm, foreignRow))).toBe("NOT_FOUND");
    expect(await codeOf(apply(gm, foreignRow, [id]))).toBe("NOT_FOUND");
    // Nothing moved: refusals are all or nothing.
    expect([(await row(foreign)).currentValue, (await row(id)).currentValue]).toEqual([4, 4]);
  });

  it("undoing a roll takes back its feed ticks", async () => {
    const { gm, p1, create, roll, value, apply, undo } = await setup();
    const id = await create({ startingValue: 4 });
    const { entryId } = await roll("successHope");
    await apply(gm, entryId, [id]);
    expect(await value(id)).toBe(3);
    await undo(p1, entryId);
    expect(await value(id)).toBe(4);
  });

  it("countedRows names plain action rolls and a Tag Team's first result row only", async () => {
    const { gm, p1, a, b, edit, campaignId, roll } = await setup();
    const action = await roll("successHope");
    const reaction = await roll("successHope", p1, a, "reaction");
    const damage = await p1.mutation(api.rolls.damageRoll, { characterId: a, source: { kind: "weapon", slot: "primary" }, critical: false, modifier: 0, options: [], idempotencyKey: key() });
    await edit(a, { hope: 6 });
    const side = { trait: "agility" as const, modifier: 0 };
    const { rolls } = await p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: side, partner: side, idempotencyKey: key() });
    const pendingIds = rolls.map((r) => r.entryId);
    expect(await gm.query(api.countdownRolls.countedRows, { campaignId, entryIds: pendingIds })).toEqual([]);
    await p1.mutation(api.rolls.tagTeamApply, { entryId: rolls[0]!.entryId, pick: a, idempotencyKey: key() });
    const results = await gm.query(api.feed.list, { campaignId, paginationOpts: { numItems: 20, cursor: null } });
    const resultRows = results.page.filter((r) => r.summary.includes("Tag Team result")).map((r) => r._id);
    expect(resultRows).toHaveLength(2);
    const ids = [action.entryId, reaction.entryId, damage.entryId, ...pendingIds, ...resultRows];
    const counted = await gm.query(api.countdownRolls.countedRows, { campaignId, entryIds: ids });
    // The feed is newest first: the second result row is listed before the first.
    expect(new Set(counted)).toEqual(new Set([action.entryId, resultRows[1]!]));
  });
});
