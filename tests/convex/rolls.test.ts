import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, getWeapon, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

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
  const edit = (id: Id<"characters">, change: Partial<CharacterSheet>) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...change }));
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  return { t, ids, gm, p1, p2, out, campaignId, a, b, sheetOf, edit, fear };
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
const weapon = { source: { kind: "weapon" as const, slot: "primary" as const }, critical: false, modifier: 0, options: [] };

describe("rolls: access (anonymous, outsider, player, GM)", () => {
  useAllowlist(EMAILS);

  it("actionRoll, damageRoll and manualRoll: the owner and the GM", async () => {
    const { t, gm, p1, p2, out, a } = await setup();
    const calls = [
      (who: Caller) => who.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey: key() }),
      (who: Caller) => who.mutation(api.rolls.damageRoll, { characterId: a, ...weapon, idempotencyKey: key() }),
      (who: Caller) => who.mutation(api.rolls.manualRoll, { characterId: a, roll: agility, values: [4, 5], idempotencyKey: key() }),
    ];
    for (const call of calls) {
      expect(await codeOf(call(t))).toBe("UNAUTHENTICATED");
      expect(await codeOf(call(out))).toBe("NOT_FOUND");
      expect(await codeOf(call(p2))).toBe("FORBIDDEN");
      expect(await codeOf(call(p1))).toBe("ok");
      expect(await codeOf(call(gm))).toBe("ok");
    }
  });

  it("tagTeam and tagTeamApply: the initiator's owner and the GM", async () => {
    const { t, gm, p1, p2, out, a, b, edit } = await setup();
    await edit(a, { hope: 6 });
    const side = { trait: "agility" as const, modifier: 0 };
    const start = (who: Caller) => who.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: side, partner: side, idempotencyKey: key() });
    expect(await codeOf(start(t))).toBe("UNAUTHENTICATED");
    expect(await codeOf(start(out))).toBe("NOT_FOUND");
    expect(await codeOf(start(p2))).toBe("FORBIDDEN");
    const { rolls } = await start(p1);
    const apply = (who: Caller) => who.mutation(api.rolls.tagTeamApply, { entryId: rolls[0]!.entryId, pick: a, idempotencyKey: key() });
    expect(await codeOf(apply(t))).toBe("UNAUTHENTICATED");
    expect(await codeOf(apply(out))).toBe("NOT_FOUND");
    expect(await codeOf(apply(p2))).toBe("FORBIDDEN");
    expect(await codeOf(apply(gm))).toBe("ok");
    // The GM may start one for a character too (once per session per character).
    await edit(b, { hope: 6 });
    expect(await codeOf(gm.mutation(api.rolls.tagTeam, { characterId: b, partnerId: a, initiator: side, partner: side, idempotencyKey: key() }))).toBe("ok");
    expect(await codeOf(apply(p1))).toBe("DICE_RULE"); // already settled
  });

  it("gmRoll and reveal: the GM only", async () => {
    const { t, gm, p1, out, campaignId } = await setup();
    const roll = (who: Caller) => who.mutation(api.rolls.gmRoll, { campaignId, dice: [{ count: 1, sides: 20 }], modifier: 2, idempotencyKey: key() });
    expect(await codeOf(roll(t))).toBe("UNAUTHENTICATED");
    expect(await codeOf(roll(out))).toBe("NOT_FOUND");
    expect(await codeOf(roll(p1))).toBe("FORBIDDEN");
    const { entryId } = await roll(gm);
    const reveal = (who: Caller) => who.mutation(api.rolls.reveal, { campaignId, entryId });
    expect(await codeOf(reveal(t))).toBe("UNAUTHENTICATED");
    expect(await codeOf(reveal(out))).toBe("NOT_FOUND");
    expect(await codeOf(reveal(p1))).toBe("FORBIDDEN");
    expect(await codeOf(reveal(gm))).toBe("ok");
  });
});

describe("rolls: rules", () => {
  useAllowlist(EMAILS);

  it("a player's roll with Fear raises GM Fear; with Hope it gains Hope", async () => {
    const { p1, a, sheetOf, fear } = await setup();
    const hope = (await sheetOf(a)).hope;
    const withFear = await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: agility, values: [3, 8], idempotencyKey: key() });
    expect(withFear.roll.manual).toBe(true);
    expect("fearGained" in withFear && withFear.fearGained).toBe(1);
    expect(await fear()).toBe(1);
    expect((await sheetOf(a)).hope).toBe(hope);
    await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: agility, values: [8, 3], idempotencyKey: key() });
    expect((await sheetOf(a)).hope).toBe(hope + 1);
    expect(await fear()).toBe(1);
  });

  it("a server roll applies its own outcome", async () => {
    const { p1, a, sheetOf, fear } = await setup();
    const hope = (await sheetOf(a)).hope;
    const { roll, fearGained } = await p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, difficulty: 10, idempotencyKey: key() });
    expect(roll.manual).toBe(false);
    const [h, f] = roll.dice;
    expect(roll.total).toBe(h!.value + f!.value + 2);
    const withFear = h!.value < f!.value;
    expect(fearGained).toBe(withFear ? 1 : 0);
    expect(await fear()).toBe(withFear ? 1 : 0);
    expect((await sheetOf(a)).hope).toBe(withFear ? hope : hope + 1);
  });

  it("a reaction roll gives no Fear or Hope, and allows no help", async () => {
    const { p1, a, sheetOf, fear } = await setup();
    const hope = (await sheetOf(a)).hope;
    await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { ...agility, kind: "reaction" }, values: [3, 8], idempotencyKey: key() });
    await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { ...agility, kind: "reaction" }, values: [8, 3], idempotencyKey: key() });
    expect(await fear()).toBe(0);
    expect((await sheetOf(a)).hope).toBe(hope);
    expect(await codeOf(p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, kind: "reaction", help: 1, idempotencyKey: key() }))).toBe("DICE_RULE");
  });

  it("an Experience costs a Hope and adds its value, also on reaction rolls", async () => {
    const { p1, a, sheetOf, edit } = await setup();
    const sheet = await sheetOf(a);
    await edit(a, { hope: 1 });
    const exp = sheet.experiences[0]!;
    const { roll } = await p1.mutation(api.rolls.manualRoll, {
      characterId: a,
      roll: { ...agility, kind: "reaction", experienceIds: [exp.id] },
      values: [3, 8],
      idempotencyKey: key(),
    });
    expect(roll.total).toBe(3 + 8 + 2 + exp.value);
    expect((await sheetOf(a)).hope).toBe(0);
    expect(await codeOf(p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, experienceIds: [exp.id], idempotencyKey: key() }))).toBe("NOT_ENOUGH_HOPE");
  });

  it("undo reverts Hope, Stress and Fear", async () => {
    const { p1, gm, a, sheetOf, edit, fear } = await setup();
    await edit(a, { hope: 2, stress: 3 });
    const crit = await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: agility, values: [5, 5], idempotencyKey: key() });
    expect(await sheetOf(a)).toMatchObject({ hope: 3, stress: 2 });
    await p1.mutation(api.actionLog.undo, { entryId: crit.entryId, idempotencyKey: key() });
    expect(await sheetOf(a)).toMatchObject({ hope: 2, stress: 3 });

    const exp = (await sheetOf(a)).experiences[0]!;
    const withFear = await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { ...agility, experienceIds: [exp.id] }, values: [2, 9], idempotencyKey: key() });
    expect(await fear()).toBe(1);
    expect((await sheetOf(a)).hope).toBe(1);
    await gm.mutation(api.actionLog.undo, { entryId: withFear.entryId, idempotencyKey: key() });
    expect(await fear()).toBe(0);
    expect((await sheetOf(a)).hope).toBe(2);
  });

  it("dead, away and unconscious characters can't roll", async () => {
    const { t, p1, a, edit } = await setup();
    await edit(a, { conditions: ["unconscious"] });
    expect(await codeOf(p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey: key() }))).toBe("CHARACTER_UNAVAILABLE");
    expect(await codeOf(p1.mutation(api.rolls.damageRoll, { characterId: a, ...weapon, idempotencyKey: key() }))).toBe("CHARACTER_UNAVAILABLE");
    await edit(a, { conditions: [] });
    await t.run((ctx) => ctx.db.patch("characters", a, { status: "dead" }));
    expect(await codeOf(p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey: key() }))).toBe("CHARACTER_UNAVAILABLE");
  });

  it("weapon damage rolls Proficiency-many dice; a critical adds their maximum", async () => {
    const { p1, a, edit } = await setup();
    await edit(a, { proficiency: 2 });
    const sides = Number(/^d(\d+)/.exec(getWeapon(PRIMARY.id)!.damage)![1]);
    const flat = Number(/\+(\d+)/.exec(PRIMARY.damage)?.[1] ?? 0);
    const { roll } = await p1.mutation(api.rolls.damageRoll, { characterId: a, ...weapon, idempotencyKey: key() });
    expect(roll.dice.map((d) => d.sides)).toEqual([sides, sides]);
    const manual = await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { kind: "damage", ...weapon, critical: true }, values: [1, 2], idempotencyKey: key() });
    // + level 1 from the Warrior's Combat Training (CB 48).
    expect(manual.roll.total).toBe(2 * sides + 1 + 2 + flat + 1);
    expect(await codeOf(p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { kind: "damage", ...weapon }, values: [1], idempotencyKey: key() }))).toBe("DICE_RULE");
    expect(await codeOf(p1.mutation(api.rolls.damageRoll, { characterId: a, ...weapon, source: { kind: "weapon", slot: "secondary" }, idempotencyKey: key() }))).toBe("DICE_RULE");
  });

  it("a tag team costs 3 Hope once per session and applies one result to both", async () => {
    const { p1, a, b, sheetOf, edit, fear } = await setup();
    await edit(a, { hope: 4 });
    await edit(b, { hope: 1 });
    const side = { trait: "agility" as const, modifier: 1 };
    const { rolls, groupId } = await p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: side, partner: side, idempotencyKey: key() });
    expect(groupId).toBeTypeOf("string");
    expect(rolls).toHaveLength(2);
    expect((await sheetOf(a)).hope).toBe(1);
    expect((await sheetOf(a)).featureUses).toContainEqual({ key: "tagTeam", until: "session" });
    await edit(a, { hope: 4 });
    expect(await codeOf(p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: side, partner: side, idempotencyKey: key() }))).toBe("DICE_RULE");
    await edit(a, { hope: 1 });

    const picked = rolls[1]!;
    const { outcome, fearGained } = await p1.mutation(api.rolls.tagTeamApply, { entryId: picked.entryId, pick: b, idempotencyKey: key() });
    expect(outcome).toBe(picked.roll.outcome);
    const withFear = outcome === "successFear" || outcome === "failFear";
    expect(fearGained).toBe(withFear ? 2 : 0);
    expect(await fear()).toBe(withFear ? 2 : 0);
    expect((await sheetOf(a)).hope).toBe(withFear ? 1 : 2);
    expect((await sheetOf(b)).hope).toBe(withFear ? 1 : 2);

    // Undo takes back the whole tag team: the 3 Hope, both results and the Fear.
    await p1.mutation(api.actionLog.undo, { entryId: picked.entryId, idempotencyKey: key() });
    expect((await sheetOf(a)).hope).toBe(4);
    expect((await sheetOf(a)).featureUses).toEqual([]);
    expect((await sheetOf(b)).hope).toBe(1);
    expect(await fear()).toBe(0);
  });

  it("refuses a tag team with yourself, without Hope, or with an unavailable partner", async () => {
    const { p1, a, b, edit } = await setup();
    const side = { trait: "agility" as const, modifier: 0 };
    const start = (partnerId: Id<"characters">) => p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId, initiator: side, partner: side, idempotencyKey: key() });
    await edit(a, { hope: 2 });
    expect(await codeOf(start(b))).toBe("NOT_ENOUGH_HOPE");
    await edit(a, { hope: 6 });
    expect(await codeOf(start(a))).toBe("DICE_RULE");
    await edit(b, { conditions: ["unconscious"] });
    expect(await codeOf(start(b))).toBe("CHARACTER_UNAVAILABLE");
  });

  it("replays a keyed roll instead of rolling twice", async () => {
    const { p1, a } = await setup();
    const idempotencyKey = key();
    const first = await p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey });
    expect(await p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, idempotencyKey })).toEqual(first);
  });
});

// ---------------------------------------------------------------- D5 TI-a integration

/** A GM-owned character of any class in a fresh campaign of `frameId` (Hope & Fear content on unless `hopeAndFear` is false). */
async function classSetup(frameId: "witherwild" | "motherboard", hopeAndFear = true) {
  const t = makeTest();
  const gmId = await t.run((ctx) => ctx.db.insert("users", { email: "gm@example.com" }));
  const gm = t.withIdentity({ subject: `${gmId}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Party", idempotencyKey: key() });
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: hopeAndFear });
  const create = async (classId: string, change: Record<string, unknown> = {}, ikonis?: { name: string; description: string; trait: "strength"; range: "Melee"; damageType: "physical" }) => {
    const cls = getClass(classId)!;
    const d = {
      ...draft(classId),
      classId,
      subclassId: subclassesForClass(classId)[0].id,
      domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
      ...change,
    };
    return (await gm.mutation(api.characters.create, { campaignId, draft: d, ...(ikonis ? { ikonis } : {}), idempotencyKey: key() })).characterId;
  };
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const edit = (id: Id<"characters">, change: Partial<CharacterSheet>) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...change }));
  return { t, gm, campaignId, create, sheetOf, edit };
}

const RALLY = { id: "rally-1", kind: "rally" as const, sides: 6, until: "session" as const };
const strike = { source: { kind: "override" as const, key: "brawlersStrike" }, critical: false, modifier: 0, options: [] as string[] };

describe("rolls: class-feature integration (D5 TI-a)", () => {
  useAllowlist(EMAILS);

  it("with Hope & Fear off, a Brawler's override is refused but a held Rally Die still spends; on, both work", async () => {
    const { gm, campaignId, create, edit } = await classSetup("witherwild");
    const brawler = await create("brawler", { primaryWeaponId: "brawler-s-strike" });
    await edit(brawler, { heldDice: [RALLY] });
    expect(await codeOf(gm.mutation(api.rolls.damageRoll, { characterId: brawler, ...strike, idempotencyKey: key() }))).toBe("ok");
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: false });
    expect(await codeOf(gm.mutation(api.rolls.damageRoll, { characterId: brawler, ...strike, idempotencyKey: key() }))).toBe("DICE_RULE");
    const { roll } = await gm.mutation(api.rolls.actionRoll, { characterId: brawler, ...agility, options: ["rally:rally-1"], idempotencyKey: key() });
    expect(roll.dice.filter((d) => d.role === "extra").map((d) => d.sides)).toEqual([6]);
  });

  it("Brawler's Strike as the primary weapon rolls as the override: both dice scale with Proficiency (HF 10)", async () => {
    const { gm, create, edit } = await classSetup("witherwild");
    const brawler = await create("brawler", { primaryWeaponId: "brawler-s-strike" });
    await edit(brawler, { proficiency: 2 });
    const { roll } = await gm.mutation(api.rolls.damageRoll, { characterId: brawler, ...weapon, idempotencyKey: key() });
    expect(roll.dice.map((d) => d.sides)).toEqual([8, 8, 6, 6]);
  });

  it("a Brawler crit with a Rally Die: 14 × Proficiency plus the Rally Die's maximum, plus the roll (CB 98)", async () => {
    const { gm, create, edit } = await classSetup("witherwild");
    const brawler = await create("brawler", { primaryWeaponId: "brawler-s-strike" });
    await edit(brawler, { heldDice: [RALLY] });
    const { roll } = await gm.mutation(api.rolls.manualRoll, {
      characterId: brawler,
      roll: { kind: "damage", ...strike, critical: true, options: ["rally:rally-1"] },
      values: [1, 1, 1],
      idempotencyKey: key(),
    });
    expect(roll.total).toBe(14 + 6 + 3);
  });

  it("Get In & Get Out's advantage is spent once: taking it ends the effect", async () => {
    const { gm, create, sheetOf } = await classSetup("witherwild");
    const assassin = await create("assassin");
    await gm.mutation(api.classFeatures.use, { characterId: assassin, featureKey: "getInGetOut", params: {}, idempotencyKey: key() });
    const { roll } = await gm.mutation(api.rolls.manualRoll, { characterId: assassin, roll: { ...agility, options: ["getInGetOut"] }, values: [4, 5, 6], idempotencyKey: key() });
    expect(roll.dice.map((d) => d.role)).toEqual(["hope", "fear", "advantage"]);
    expect((await sheetOf(assassin)).effects).toEqual([]);
    expect(await codeOf(gm.mutation(api.rolls.actionRoll, { characterId: assassin, ...agility, options: ["getInGetOut"], idempotencyKey: key() }))).toBe("DICE_RULE");
  });

  it("Strange Patterns prompts after a reaction roll too (CB 50)", async () => {
    const { gm, create, edit } = await classSetup("witherwild");
    const wizard = await create("wizard");
    await edit(wizard, { classState: { strangeNumber: 3 } });
    const out = await gm.mutation(api.rolls.manualRoll, { characterId: wizard, roll: { ...agility, kind: "reaction" }, values: [3, 8], idempotencyKey: key() });
    const prompts = "prompts" in out ? (out.prompts as { featureKey: string }[]) : [];
    expect(prompts.map((p) => p.featureKey)).toEqual(["strangePatternsBenefit"]);
    await gm.mutation(api.classFeatures.use, { characterId: wizard, featureKey: "strangePatternsBenefit", params: { choice: "hope" }, idempotencyKey: key() });
  });

  it("Motherboard: the Ikonis is the attack and damage source with Bonded and augments; no Combat Training (CB 295, 301)", async () => {
    const { t, gm, create, sheetOf } = await classSetup("motherboard");
    const ikonis = { name: "Spark rod", description: "", trait: "strength" as const, range: "Melee" as const, damageType: "physical" as const };
    const warrior = await create("warrior", { primaryWeaponId: "" }, ikonis);
    const ikonisDamage = { source: { kind: "ikonis" as const }, critical: false, modifier: 0, options: [] as string[] };
    // d12+1 at Proficiency 1, Bonded +1 (level 1), Force +1 (Ikonis Training); Combat Training would add another +1.
    const dmg = await gm.mutation(api.rolls.manualRoll, { characterId: warrior, roll: { kind: "damage", ...ikonisDamage }, values: [5], idempotencyKey: key() });
    expect(dmg.roll.total).toBe(5 + 1 + 1 + 1);
    expect(await codeOf(gm.mutation(api.rolls.damageRoll, { characterId: warrior, ...weapon, idempotencyKey: key() }))).toBe("DICE_RULE");

    // Converge +1 and Override (advantage) installed: the attack uses the Ikonis's trait (Strength +1).
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("characterExtras")
        .withIndex("by_character_extra", (q) => q.eq("characterId", warrior).eq("extra", "motherboard"))
        .unique();
      await ctx.db.patch("characterExtras", row!._id, { data: { ...row!.data, installed: ["force", "converge", "override"] } } as never);
    });
    const attack = await gm.mutation(api.rolls.manualRoll, { characterId: warrior, roll: { ...agility, ikonis: true }, values: [6, 5, 4], idempotencyKey: key() });
    expect(attack.roll.dice.map((d) => d.role)).toEqual(["hope", "fear", "advantage"]);
    expect(attack.roll.total).toBe(6 + 5 + 4 + 1 + 1);
    expect((await sheetOf(warrior)).primaryWeaponId).toBe("");

    // Outside Motherboard there is no Ikonis.
    const other = await classSetup("witherwild");
    const plain = await other.create("warrior");
    expect(await codeOf(other.gm.mutation(api.rolls.damageRoll, { characterId: plain, ...ikonisDamage, idempotencyKey: key() }))).toBe("DICE_RULE");
  });

  it("Motherboard: an Ikonis still in the old frameTrackers row rolls (characterExtras.motherboardState fallback)", async () => {
    const { t, gm, campaignId, create } = await classSetup("motherboard");
    const ikonis = { name: "Spark rod", description: "", trait: "strength" as const, range: "Melee" as const, damageType: "physical" as const };
    const warrior = await create("warrior", { primaryWeaponId: "" }, ikonis);
    await t.run(async (ctx) => {
      const row = (await ctx.db
        .query("characterExtras")
        .withIndex("by_character_extra", (q) => q.eq("characterId", warrior).eq("extra", "motherboard"))
        .unique())!;
      await ctx.db.delete("characterExtras", row._id);
      await ctx.db.insert("frameTrackers", { campaignId, key: `character:${warrior}:motherboard`, data: row.data, updatedAt: 7 });
    });
    const dmg = await gm.mutation(api.rolls.manualRoll, {
      characterId: warrior,
      roll: { kind: "damage", source: { kind: "ikonis" }, critical: false, modifier: 0, options: [] },
      values: [5],
      idempotencyKey: key(),
    });
    expect(dmg.roll.total).toBe(5 + 1 + 1 + 1);
  });
});

// ---------------------------------------------------------------- D5 review fixes (R1)

describe("rolls: trust (review H2, M1)", () => {
  useAllowlist(EMAILS);
  const summaryOf = (t: ReturnType<typeof makeTest>, id: Id<"actionLog">) => t.run(async (ctx) => (await ctx.db.get("actionLog", id))!.summary);

  it("tagTeamApply refuses when either character rolled after the tag team; the tag team still undoes", async () => {
    const { p1, p2, a, b, edit, sheetOf } = await setup();
    await edit(a, { hope: 6 });
    const side = { trait: "agility" as const, modifier: 0 };
    const { rolls } = await p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: side, partner: side, idempotencyKey: key() });
    const between = await p2.mutation(api.rolls.actionRoll, { characterId: b, ...agility, idempotencyKey: key() });

    expect(await codeOf(p1.mutation(api.rolls.tagTeamApply, { entryId: rolls[0]!.entryId, pick: a, idempotencyKey: key() }))).toBe("DICE_RULE");

    // With the roll in between undone, the tag team applies again.
    await p2.mutation(api.actionLog.undo, { entryId: between.entryId, idempotencyKey: key() });
    expect(await codeOf(p1.mutation(api.rolls.tagTeamApply, { entryId: rolls[0]!.entryId, pick: a, idempotencyKey: key() }))).toBe("ok");
    await p1.mutation(api.actionLog.undo, { entryId: rolls[0]!.entryId, idempotencyKey: key() });
    expect((await sheetOf(a)).hope).toBe(6);
  });

  it("caps the typed modifier at ±10 on action, damage and tag team rolls", async () => {
    const { p1, a, b, edit } = await setup();
    await edit(a, { hope: 6 });
    expect(await codeOf(p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, modifier: 11, idempotencyKey: key() }))).toBe("DICE_RULE");
    expect(await codeOf(p1.mutation(api.rolls.damageRoll, { characterId: a, ...weapon, modifier: -11, idempotencyKey: key() }))).toBe("DICE_RULE");
    expect(await codeOf(p1.mutation(api.rolls.manualRoll, { characterId: a, values: [5, 3], roll: { ...agility, modifier: 11 }, idempotencyKey: key() }))).toBe("DICE_RULE");
    const big = { trait: "agility" as const, modifier: 11 };
    const ok = { trait: "agility" as const, modifier: 10 };
    expect(await codeOf(p1.mutation(api.rolls.tagTeam, { characterId: a, partnerId: b, initiator: ok, partner: big, idempotencyKey: key() }))).toBe("DICE_RULE");
    expect(await codeOf(p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, modifier: 10, idempotencyKey: key() }))).toBe("ok");
    expect(await codeOf(p1.mutation(api.rolls.actionRoll, { characterId: a, ...agility, modifier: -10, idempotencyKey: key() }))).toBe("ok");
  });

  it("feed lines show the typed modifier and who set the Difficulty", async () => {
    const { t, gm, p1, a } = await setup();
    const byPlayer = await p1.mutation(api.rolls.manualRoll, { characterId: a, values: [5, 3], roll: { ...agility, modifier: 3, difficulty: 12 }, idempotencyKey: key() });
    const player = await summaryOf(t, byPlayer.entryId);
    expect(player).toContain("+3 typed");
    expect(player).toContain("vs DC 12 (player)");

    const byGm = await gm.mutation(api.rolls.manualRoll, { characterId: a, values: [5, 3], roll: { ...agility, modifier: -2, difficulty: 12 }, idempotencyKey: key() });
    const fromGm = await summaryOf(t, byGm.entryId);
    expect(fromGm).toContain("-2 typed");
    expect(fromGm).toContain("vs 12");
    expect(fromGm).not.toContain("(player)");

    const plain = await p1.mutation(api.rolls.manualRoll, { characterId: a, values: [5, 3], roll: agility, idempotencyKey: key() });
    expect(await summaryOf(t, plain.entryId)).not.toContain("typed");
  });

  it("a damage critical is declared unless the character's latest action roll was a critical success", async () => {
    const { t, p1, a } = await setup();
    const crit = { ...weapon, critical: true };
    const declared = await p1.mutation(api.rolls.damageRoll, { characterId: a, ...crit, idempotencyKey: key() });
    expect(await summaryOf(t, declared.entryId)).toContain("critical (declared) damage");

    await p1.mutation(api.rolls.manualRoll, { characterId: a, values: [7, 7], roll: agility, idempotencyKey: key() });
    const rolled = await p1.mutation(api.rolls.damageRoll, { characterId: a, ...crit, modifier: 2, idempotencyKey: key() });
    const line = await summaryOf(t, rolled.entryId);
    expect(line).toContain("Ash: critical damage");
    expect(line).toContain("+2 typed");

    // A later non-critical action roll unlinks it again.
    await p1.mutation(api.rolls.manualRoll, { characterId: a, values: [8, 3], roll: agility, idempotencyKey: key() });
    const again = await p1.mutation(api.rolls.damageRoll, { characterId: a, ...crit, idempotencyKey: key() });
    expect(await summaryOf(t, again.entryId)).toContain("critical (declared)");
  });
});
