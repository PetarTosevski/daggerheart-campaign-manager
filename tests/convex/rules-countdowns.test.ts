import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { manualTickNote, rollsTickCountdowns } from "../../src/lib/domain/countdowns/advanced";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

/**
 * Plan rule-switches RK: rule switch K1 `countdownTicks` (CB p.162: a standard countdown "ticks down every time a player
 * makes an action roll, regardless of the result"; CB p.97: a Tag Team counts once). Book: armed countdowns tick as
 * today. Manual (user answer Q3 a, 2026-11-05): nothing ticks; after each counted PC action roll the GM gets one note
 * naming the armed countdowns; none armed, no note; reaction rolls never.
 */

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";
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

const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
/** Manual Duality dice [Hope, Fear] and a Difficulty (agility +2). */
const OUTCOMES = {
  successHope: { values: [8, 3], difficulty: 10 },
  failFear: { values: [3, 8], difficulty: 30 },
} as const;
type Outcome = keyof typeof OUTCOMES;
const page = { paginationOpts: { numItems: 50, cursor: null } };

async function setup(mode: "book" | "manual") {
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
  if (mode === "manual") await gm.mutation(api.ruleSettings.set, { campaignId, change: { key: "countdownTicks", value: "manual" } });
  const edit = (id: Id<"characters">, change: Partial<CharacterSheet>) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...change }));
  const create = async (name: string, extra: Record<string, unknown>) =>
    (
      await gm.mutation(api.countdowns.create, { campaignId, name, description: "", category: "threat", consequence: "", idempotencyKey: key(), ...extra } as never)
    ).countdownId as Id<"countdowns">;
  const value = async (id: Id<"countdowns">) => (await t.run((ctx) => ctx.db.get("countdowns", id)))!.currentValue;
  const roll = async (outcome: Outcome, kind: "action" | "reaction" = "action") => {
    const { values, ...rest } = OUTCOMES[outcome];
    return (await p1.mutation(api.rolls.manualRoll, { characterId: a, values: [...values], roll: { ...agility, kind, ...rest }, idempotencyKey: key() })) as {
      entryId: Id<"actionLog">;
    };
  };
  const notes = () =>
    t.run(async (ctx) =>
      (await ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId)).collect()).filter((r) => r.kind === "rule"),
    );
  const ticks = () => t.run((ctx) => ctx.db.query("countdownTicks").withIndex("by_campaign_at").collect());
  return { t, gm, p1, campaignId, a, b, edit, create, value, roll, notes, ticks };
}

describe("K1 pure helpers", () => {
  it("rollsTickCountdowns: Book (the default) ticks, Manual doesn't", () => {
    expect(rollsTickCountdowns()).toBe(true);
    expect(rollsTickCountdowns("book")).toBe(true);
    expect(rollsTickCountdowns("manual")).toBe(false);
  });

  it("manualTickNote names each countdown with its value, the amount when above 1, and skips amount 0", () => {
    expect(manualTickNote([])).toBeNull();
    expect(manualTickNote([{ name: "Rivals", currentValue: 4, amount: 0 }])).toBeNull();
    expect(
      manualTickNote([
        { name: "Ambush", currentValue: 3, amount: 1 },
        { name: "Rivals", currentValue: 4, amount: 0 },
        { name: "Collapse", currentValue: 5, amount: 2 },
      ]),
    ).toBe("Action roll: tick Ambush (3), Collapse (5) by 2?");
  });
});

describe("K1 countdownTicks: Book", () => {
  useAllowlist(EMAILS);

  it("armed countdowns tick on an action roll and no note is posted", async () => {
    const { create, value, roll, notes } = await setup("book");
    const id = await create("Ambush", { startingValue: 3, armed: true });
    await roll("successHope");
    expect(await value(id)).toBe(2);
    expect(await notes()).toEqual([]);
  });
});

describe("K1 countdownTicks: Manual (Q3 a)", () => {
  useAllowlist(EMAILS);

  it("nothing ticks; one GM-only note per roll names the armed countdowns; players never receive it", async () => {
    const { gm, p1, campaignId, create, value, roll, notes, ticks } = await setup("manual");
    const ambush = await create("Ambush", { startingValue: 3, armed: true });
    const collapse = await create("Collapse", { startingValue: 5, armed: true });
    const idle = await create("Idle", { startingValue: 4 });
    await roll("failFear");
    await roll("successHope");
    expect([await value(ambush), await value(collapse), await value(idle)]).toEqual([3, 5, 4]);
    expect(await ticks()).toEqual([]);
    const n = await notes();
    expect(n).toHaveLength(2);
    for (const row of n) {
      expect(row).toMatchObject({ visibility: "gm", ruleId: "countdownTicks", summary: "Action roll: tick Ambush (3), Collapse (5)?", undoable: false });
      expect(row.groupId).toBeUndefined();
      expect(row.characterId).toBeUndefined();
    }
    const gmFeed = (await gm.query(api.feed.list, { campaignId, ...page })).page;
    expect(gmFeed.filter((r) => r.kind === "rule")).toHaveLength(2);
    const playerFeed = (await p1.query(api.feed.list, { campaignId, ...page })).page;
    expect(playerFeed.some((r) => r.kind === "rule")).toBe(false);
  });

  it("dynamic countdowns show the amount; a countdown the roll would not move is left out", async () => {
    const { create, roll, notes } = await setup("manual");
    await create("Escape", { startingValue: 8, mode: "progress", armed: true });
    await create("Guards", { startingValue: 6, mode: "consequence", armed: true });
    await roll("successHope");
    expect((await notes()).map((r) => r.summary)).toEqual(["Action roll: tick Escape (8) by 2?"]);
  });

  it("no note when nothing is armed, nor on a reaction roll", async () => {
    const { create, roll, notes } = await setup("manual");
    const unarmed = await create("Idle", { startingValue: 4 });
    await roll("successHope");
    expect(await notes()).toEqual([]);
    expect(unarmed).toBeDefined();
    await create("Ambush", { startingValue: 3, armed: true });
    await roll("successHope", "reaction");
    expect(await notes()).toEqual([]);
  });

  it("the GM's feed button still ticks the countdown by hand", async () => {
    const { gm, campaignId, create, value, roll } = await setup("manual");
    const id = await create("Ambush", { startingValue: 3, armed: true });
    const { entryId } = await roll("successHope");
    await gm.mutation(api.countdownRolls.applyRoll, { campaignId, entryId, countdownIds: [id], idempotencyKey: key() });
    expect(await value(id)).toBe(2);
  });

  it("a Tag Team gives one note, in its group; the result row still carries the feed button and undo takes the note back", async () => {
    const { t, gm, p1, campaignId, a, b, edit, create, value, notes } = await setup("manual");
    const id = await create("Ambush", { startingValue: 5, armed: true });
    await edit(a, { hope: 6 });
    const side = { trait: "agility" as const, modifier: 0 };
    const { rolls, groupId } = await p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: side, partner: side, idempotencyKey: key() });
    await p1.mutation(api.rolls.tagTeamApply, { entryId: rolls[0]!.entryId, pick: b, idempotencyKey: key() });
    expect(await value(id)).toBe(5);
    const n = await notes();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ groupId, undoable: true, summary: "Action roll: tick Ambush (5)?" });
    const group = await t.run(async (ctx) =>
      (await ctx.db.query("actionLog").withIndex("by_campaign_group", (q) => q.eq("campaignId", campaignId).eq("groupId", groupId)).collect())
        .filter((r) => r.kind === "roll")
        .sort((x, y) => x.at - y.at || x._creationTime - y._creationTime),
    );
    const firstResult = group[2]!._id;
    expect(await gm.query(api.countdownRolls.countedRows, { campaignId, entryIds: [firstResult] })).toEqual([firstResult]);
    const preview = await gm.query(api.countdownRolls.preview, { campaignId, entryId: firstResult });
    expect(preview.countdowns.map((c) => [c.name, c.amount, c.ticked])).toEqual([["Ambush", 1, false]]);
    await gm.mutation(api.actionLog.undo, { entryId: firstResult, idempotencyKey: key() });
    expect((await notes())[0]!.undoneAt).toBeDefined();
  });
});
