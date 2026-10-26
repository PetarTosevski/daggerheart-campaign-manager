// Session features in the dice box (plan session-features F2): Slayer Dice (CB 48), Know the Tide (CB 77), the Slayer
// choice (storeSlayerDie, U2) and the pending choices query, plus the Tag Team pick by either participant (U9).
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, cardsForDomains, getClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,p2@example.com,out@example.com";
const PRIMARY = WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!;

/** A level 1 Warrior: Call of the Slayer from the Wildborne (or `communityId`). */
function draft(name: string, subclassId: string, communityId: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId,
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

/** p1 owns Bryn (a Call of the Slayer Warrior, Wildborne); p2 owns Kai (a Call of the Brave Warrior, Seaborne). */
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
  const slayer = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Bryn", "call-of-the-slayer", "wildborne"), idempotencyKey: key() })).characterId;
  const tide = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Kai", "call-of-the-brave", "seaborne"), idempotencyKey: key() })).characterId;
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (id: Id<"characters">, change: Partial<CharacterSheet>) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...change }));
  return { t, gm, p1, p2, out, campaignId, slayer, tide, sheetOf, edit };
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

const action = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
const attack = { ...action, attack: true };
const reaction = { ...action, kind: "reaction" as const };
const d6 = { source: { kind: "dice" as const, dice: [{ count: 1, sides: 6 }] }, critical: false, modifier: 0, options: [] };

/** Hope 8, Fear 3: with Hope. Hope 3, Fear 8: with Fear. 5 / 5: critical. */
const WITH_HOPE = [8, 3];
const WITH_FEAR = [3, 8];
const CRITICAL = [5, 5];

describe("rolls session features: access (anonymous, outsider, player owner, player non-owner, GM)", () => {
  useAllowlist(EMAILS);

  it("actionRoll / damageRoll / manualRoll with slayerDice and tideTokens, storeSlayerDie and pendingChoices", async () => {
    const { t, gm, p1, p2, out, slayer, tide, edit } = await setup();
    await edit(slayer, { proficiency: 6, sessionFeatures: { slayerDice: 6 } });
    await edit(tide, { level: 3, sessionFeatures: { tideTokens: 3 } });
    const slayerCalls = [
      (who: Caller) => who.mutation(api.rolls.actionRoll, { characterId: slayer, ...attack, slayerDice: 1, idempotencyKey: key() }),
      (who: Caller) => who.mutation(api.rolls.damageRoll, { characterId: slayer, ...d6, slayerDice: 1, idempotencyKey: key() }),
      (who: Caller) => who.mutation(api.rolls.manualRoll, { characterId: slayer, roll: { ...d6, kind: "damage", slayerDice: 1 }, values: [4], idempotencyKey: key() }),
      (who: Caller) => who.query(api.rolls.pendingChoices, { characterId: slayer }),
    ];
    for (const call of slayerCalls) {
      expect(await codeOf(call(t))).toBe("UNAUTHENTICATED");
      expect(await codeOf(call(out))).toBe("NOT_FOUND");
      expect(await codeOf(call(p2))).toBe("FORBIDDEN");
      expect(await codeOf(call(p1))).toBe("ok");
      expect(await codeOf(call(gm))).toBe("ok");
    }
    const tideCall = (who: Caller) => who.mutation(api.rolls.actionRoll, { characterId: tide, ...action, tideTokens: 1, idempotencyKey: key() });
    expect(await codeOf(tideCall(t))).toBe("UNAUTHENTICATED");
    expect(await codeOf(tideCall(out))).toBe("NOT_FOUND");
    expect(await codeOf(tideCall(p1))).toBe("FORBIDDEN");
    expect(await codeOf(tideCall(p2))).toBe("ok");
    expect(await codeOf(tideCall(gm))).toBe("ok");
    const manualTide = (who: Caller) => who.mutation(api.rolls.manualRoll, { characterId: tide, roll: { ...action, tideTokens: 1 }, values: WITH_HOPE, idempotencyKey: key() });
    expect(await codeOf(manualTide(out))).toBe("NOT_FOUND");
    expect(await codeOf(manualTide(p1))).toBe("FORBIDDEN");
    expect(await codeOf(manualTide(p2))).toBe("ok");

    // storeSlayerDie: a fresh roll with Hope for each caller that may store.
    await edit(slayer, { sessionFeatures: {} });
    const roll = async () => (await p1.mutation(api.rolls.manualRoll, { characterId: slayer, roll: action, values: WITH_HOPE, idempotencyKey: key() })).entryId;
    let entryId = await roll();
    const store = (who: Caller) => who.mutation(api.rolls.storeSlayerDie, { characterId: slayer, entryId, idempotencyKey: key() });
    expect(await codeOf(store(t))).toBe("UNAUTHENTICATED");
    expect(await codeOf(store(out))).toBe("NOT_FOUND");
    expect(await codeOf(store(p2))).toBe("FORBIDDEN");
    expect(await codeOf(store(p1))).toBe("ok");
    entryId = await roll();
    expect(await codeOf(store(gm))).toBe("ok");
  });
});

describe("rolls session features: Slayer Dice (CB 48, U2, U3)", () => {
  useAllowlist(EMAILS);

  it("offers the choice after an action roll with Hope and stores a die instead of the Hope, once", async () => {
    const { p1, slayer, sheetOf, edit } = await setup();
    await edit(slayer, { hope: 2, proficiency: 2 });
    const { entryId } = await p1.mutation(api.rolls.manualRoll, { characterId: slayer, roll: action, values: WITH_HOPE, idempotencyKey: key() });
    expect((await sheetOf(slayer)).hope).toBe(3);
    const choices = await p1.query(api.rolls.pendingChoices, { characterId: slayer });
    expect(choices.slayer?.entryId).toBe(entryId);
    expect(choices.slayer?.prompt.key).toBe("slayerStore");
    expect(await p1.mutation(api.rolls.storeSlayerDie, { characterId: slayer, entryId, idempotencyKey: key() })).toEqual({ slayerDice: 1, capacity: 2, hope: 2 });
    const sheet = await sheetOf(slayer);
    expect(sheet.hope).toBe(2);
    expect(sheet.sessionFeatures).toEqual({ slayerDice: 1, slayerClaim: entryId });
    expect((await p1.query(api.rolls.pendingChoices, { characterId: slayer })).slayer).toBeNull();
    // Store twice for one roll.
    expect(await codeOf(p1.mutation(api.rolls.storeSlayerDie, { characterId: slayer, entryId, idempotencyKey: key() }))).toBe("CLASS_FEATURE_RULE");
  });

  it("refuses a full pool, a roll with Fear, a reaction roll and a roll that is no longer the latest", async () => {
    const { p1, slayer, edit } = await setup();
    const roll = async (values: number[], kind: typeof action | typeof reaction = action) => (await p1.mutation(api.rolls.manualRoll, { characterId: slayer, roll: kind, values, idempotencyKey: key() })).entryId;
    const store = (entryId: Id<"actionLog">) => codeOf(p1.mutation(api.rolls.storeSlayerDie, { characterId: slayer, entryId, idempotencyKey: key() }));
    await edit(slayer, { proficiency: 1, sessionFeatures: { slayerDice: 1 } });
    const full = await roll(WITH_HOPE);
    expect((await p1.query(api.rolls.pendingChoices, { characterId: slayer })).slayer).toBeNull();
    expect(await store(full)).toBe("CLASS_FEATURE_RULE");
    await edit(slayer, { sessionFeatures: {} });
    expect(await store(await roll(WITH_FEAR))).toBe("CLASS_FEATURE_RULE");
    expect(await store(await roll(WITH_HOPE, reaction))).toBe("CLASS_FEATURE_RULE");
    const older = await roll(WITH_HOPE);
    await roll(WITH_FEAR);
    expect(await store(older)).toBe("CLASS_FEATURE_RULE");
  });

  it("takes no Hope back for a roll made at Hope max, and keeps a critical's cleared Stress", async () => {
    const { p1, slayer, sheetOf, edit } = await setup();
    await edit(slayer, { hope: 6, proficiency: 2 });
    const atMax = (await p1.mutation(api.rolls.manualRoll, { characterId: slayer, roll: action, values: WITH_HOPE, idempotencyKey: key() })).entryId;
    await p1.mutation(api.rolls.storeSlayerDie, { characterId: slayer, entryId: atMax, idempotencyKey: key() });
    expect((await sheetOf(slayer)).hope).toBe(6);

    await edit(slayer, { hope: 1, stress: 2 });
    const crit = (await p1.mutation(api.rolls.manualRoll, { characterId: slayer, roll: action, values: CRITICAL, idempotencyKey: key() })).entryId;
    expect((await sheetOf(slayer)).stress).toBe(1);
    await p1.mutation(api.rolls.storeSlayerDie, { characterId: slayer, entryId: crit, idempotencyKey: key() });
    const sheet = await sheetOf(slayer);
    expect(sheet.hope).toBe(1);
    expect(sheet.stress).toBe(1);
    expect(sheet.sessionFeatures?.slayerDice).toBe(2);
  });

  it("undoing the store row gives the Hope back and empties the die", async () => {
    const { p1, campaignId, slayer, sheetOf, edit } = await setup();
    await edit(slayer, { hope: 2, proficiency: 2 });
    const { entryId } = await p1.mutation(api.rolls.manualRoll, { characterId: slayer, roll: action, values: WITH_HOPE, idempotencyKey: key() });
    await p1.mutation(api.rolls.storeSlayerDie, { characterId: slayer, entryId, idempotencyKey: key() });
    const feed = await p1.query(api.feed.list, { campaignId, paginationOpts: { numItems: 5, cursor: null } });
    const row = feed.page.find((r) => r.summary === "Bryn stored a Slayer Die (1/2)")!;
    expect(row).toBeDefined();
    await p1.mutation(api.actionLog.undo, { entryId: row._id, idempotencyKey: key() });
    const sheet = await sheetOf(slayer);
    expect(sheet.hope).toBe(3);
    expect(sheet.sessionFeatures).toBeUndefined();
  });

  it("spends Slayer Dice on attack and damage rolls, rolled by the server, never on other rolls or above the pool", async () => {
    const { p1, slayer, tide, p2, sheetOf, edit } = await setup();
    await edit(slayer, { proficiency: 3, sessionFeatures: { slayerDice: 3 } });
    // A manual damage roll: the typed value is the d6 source; the Slayer d6 comes from the server.
    const dmg = await p1.mutation(api.rolls.manualRoll, { characterId: slayer, roll: { ...d6, kind: "damage", slayerDice: 1 }, values: [4], idempotencyKey: key() });
    expect(dmg.roll.dice).toHaveLength(2);
    expect(dmg.roll.dice[1]).toMatchObject({ sides: 6, role: "extra" });
    // The roll's modifier is Combat Training's level bonus (CB 48).
    expect(dmg.roll.total).toBe(4 + dmg.roll.dice[1]!.value + dmg.roll.modifier);
    expect((await sheetOf(slayer)).sessionFeatures?.slayerDice).toBe(2);
    // An attack roll: Hope, Fear, then the Slayer d6 (added to the total).
    const hit = await p1.mutation(api.rolls.manualRoll, { characterId: slayer, roll: { ...attack, slayerDice: 1 }, values: WITH_FEAR, idempotencyKey: key() });
    expect(hit.roll.dice).toHaveLength(3);
    expect(hit.roll.total).toBe(3 + 8 + hit.roll.dice[2]!.value + hit.roll.modifier);
    expect((await sheetOf(slayer)).sessionFeatures?.slayerDice).toBe(1);
    // A critical maxes the damage dice; a Slayer Die is a named die, not a damage die, and rolls normally (CB 48, 98; user 2026-10-21).
    const crit = await p1.mutation(api.rolls.manualRoll, { characterId: slayer, roll: { ...d6, critical: true, kind: "damage", slayerDice: 1 }, values: [2], idempotencyKey: key() });
    expect(crit.roll.modifier).toBe(dmg.roll.modifier + 6);
    expect(crit.roll.total).toBe(2 + crit.roll.dice[1]!.value + crit.roll.modifier);
    // Refusals: not an attack, a reaction roll, more than held, a character without Slayer.
    await edit(slayer, { sessionFeatures: { slayerDice: 1 } });
    expect(await codeOf(p1.mutation(api.rolls.actionRoll, { characterId: slayer, ...action, slayerDice: 1, idempotencyKey: key() }))).toBe("DICE_RULE");
    expect(await codeOf(p1.mutation(api.rolls.actionRoll, { characterId: slayer, ...reaction, attack: true, slayerDice: 1, idempotencyKey: key() }))).toBe("DICE_RULE");
    expect(await codeOf(p1.mutation(api.rolls.damageRoll, { characterId: slayer, ...d6, slayerDice: 2, idempotencyKey: key() }))).toBe("DICE_RULE");
    expect(await codeOf(p2.mutation(api.rolls.damageRoll, { characterId: tide, ...d6, slayerDice: 1, idempotencyKey: key() }))).toBe("DICE_RULE");
    expect((await sheetOf(slayer)).sessionFeatures?.slayerDice).toBe(1);
  });
});

describe("rolls session features: Know the Tide (CB 77, U4, U5, Q1)", () => {
  useAllowlist(EMAILS);

  it("places a token on an action roll with Fear up to the level, never on a reaction roll, a critical or a roll with Hope", async () => {
    const { p2, tide, sheetOf, edit } = await setup();
    const roll = (values: number[], kind: typeof action | typeof reaction = action) => p2.mutation(api.rolls.manualRoll, { characterId: tide, roll: kind, values, idempotencyKey: key() });
    const tokens = async () => (await sheetOf(tide)).sessionFeatures?.tideTokens ?? 0;
    await roll(WITH_FEAR, reaction);
    expect(await tokens()).toBe(0);
    await roll(CRITICAL);
    expect(await tokens()).toBe(0);
    await roll(WITH_HOPE);
    expect(await tokens()).toBe(0);
    await roll(WITH_FEAR);
    expect(await tokens()).toBe(1);
    // Level 1: the cap is reached.
    await roll(WITH_FEAR);
    expect(await tokens()).toBe(1);
    await edit(tide, { level: 2 });
    await roll(WITH_FEAR);
    expect(await tokens()).toBe(2);
  });

  it("a character without Know the Tide places nothing", async () => {
    const { p1, slayer, sheetOf } = await setup();
    await p1.mutation(api.rolls.manualRoll, { characterId: slayer, roll: action, values: WITH_FEAR, idempotencyKey: key() });
    expect((await sheetOf(slayer)).sessionFeatures).toBeUndefined();
  });

  it("undoing the roll takes its token back", async () => {
    const { p2, tide, sheetOf } = await setup();
    const { entryId } = await p2.mutation(api.rolls.manualRoll, { characterId: tide, roll: action, values: WITH_FEAR, idempotencyKey: key() });
    expect((await sheetOf(tide)).sessionFeatures?.tideTokens).toBe(1);
    await p2.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
    expect((await sheetOf(tide)).sessionFeatures).toBeUndefined();
  });

  it("spends tokens for +1 each on action rolls only; refuses others and counts above the held tokens", async () => {
    const { p1, p2, slayer, tide, sheetOf, edit } = await setup();
    await edit(tide, { level: 3, sessionFeatures: { tideTokens: 2 } });
    const plain = await p2.mutation(api.rolls.manualRoll, { characterId: tide, roll: action, values: WITH_HOPE, idempotencyKey: key() });
    const boosted = await p2.mutation(api.rolls.manualRoll, { characterId: tide, roll: { ...action, tideTokens: 2 }, values: WITH_HOPE, idempotencyKey: key() });
    expect(boosted.roll.modifier).toBe(plain.roll.modifier + 2);
    expect(boosted.roll.total).toBe(plain.roll.total + 2);
    expect((await sheetOf(tide)).sessionFeatures).toBeUndefined();
    await edit(tide, { sessionFeatures: { tideTokens: 1 } });
    expect(await codeOf(p2.mutation(api.rolls.actionRoll, { characterId: tide, ...action, tideTokens: 2, idempotencyKey: key() }))).toBe("DICE_RULE");
    expect(await codeOf(p2.mutation(api.rolls.actionRoll, { characterId: tide, ...reaction, tideTokens: 1, idempotencyKey: key() }))).toBe("DICE_RULE");
    expect(await codeOf(p1.mutation(api.rolls.actionRoll, { characterId: slayer, ...action, tideTokens: 1, idempotencyKey: key() }))).toBe("CLASS_FEATURE_RULE");
    expect((await sheetOf(tide)).sessionFeatures?.tideTokens).toBe(1);
  });
});

describe("rolls session features: Tag Team (Q1, U9)", () => {
  useAllowlist(EMAILS);

  it("either participant picks; the chosen roll places tokens and offers the Slayer choice for both", async () => {
    const { gm, p1, p2, slayer, tide, sheetOf, edit } = await setup();
    await edit(slayer, { hope: 6, proficiency: 2 });
    await edit(tide, { level: 2 });
    const side = { trait: "agility" as const, modifier: 0 };
    const { rolls } = await p1.mutation(api.rolls.tagTeam, { characterId: slayer, partnerId: tide, initiator: side, partner: side, idempotencyKey: key() });
    // The pick is offered in both boxes (the GM edits both), never the Slayer choice while it waits.
    for (const [who, id] of [
      [p1, slayer],
      [p2, tide],
      [gm, tide],
    ] as const) {
      const choices = await who.query(api.rolls.pendingChoices, { characterId: id });
      expect(choices.tagTeam?.entryId).toBe(rolls[0]!.entryId);
      expect(choices.tagTeam?.rolls.map((r) => r.name)).toEqual(["Bryn", "Kai"]);
      expect(choices.slayer).toBeNull();
    }
    const picked = rolls[1]!;
    const { outcome } = await p2.mutation(api.rolls.tagTeamApply, { entryId: rolls[0]!.entryId, pick: tide, idempotencyKey: key() });
    expect(outcome).toBe(picked.roll.outcome);
    expect((await p2.query(api.rolls.pendingChoices, { characterId: tide })).tagTeam).toBeNull();
    const withFear = outcome === "successFear" || outcome === "failFear";
    const withHope = outcome === "critical" || outcome === "successHope" || outcome === "failHope";
    expect((await sheetOf(tide)).sessionFeatures?.tideTokens ?? 0).toBe(withFear ? 1 : 0);
    const offer = (await p1.query(api.rolls.pendingChoices, { characterId: slayer })).slayer;
    expect(offer !== null).toBe(withHope);
    if (offer !== null) {
      const before = (await sheetOf(slayer)).hope;
      await p1.mutation(api.rolls.storeSlayerDie, { characterId: slayer, entryId: offer.entryId, idempotencyKey: key() });
      const sheet = await sheetOf(slayer);
      expect(sheet.sessionFeatures?.slayerDice).toBe(1);
      // The Tag Team cost 3 Hope (6 -> 3) and the result gave one back (4): storing takes that one.
      expect(sheet.hope).toBe(before - 1);
    }
  });
});
