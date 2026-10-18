import { describe, expect, it } from "vitest";

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

/** A campaign with a GM; p1 owns Ash, p2 owns Bryn and Cid (Cid is away, Castle High). */
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
  const c = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Cid"), idempotencyKey: key() })).characterId;
  await t.run((ctx) => ctx.db.patch("characters", c, { status: "away" }));

  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const patch = (id: Id<"characters">, change: Partial<CharacterSheet>) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...change }));
  const rows = (id: Id<"characters">) =>
    t.run((ctx) =>
      ctx.db
        .query("actionLog")
        .withIndex("by_character_at", (q) => q.eq("characterId", id))
        .collect(),
    );
  const undo = (who: typeof gm, entryId: Id<"actionLog">) => who.mutation(api.actionLog.undo, { entryId, idempotencyKey: key() });
  return { t, gm, p1, p2, campaignId, a, b, c, sheetOf, patch, rows, undo };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

const use = (characterId: Id<"characters">, featureKey: string, params: { targetId?: Id<"characters">; choice?: string; amount?: number } = {}) => ({
  characterId,
  featureKey,
  params,
  idempotencyKey: key(),
});

/** The feature keys of a Duality roll result's prompts (a manual roll returns a Duality or a damage result). */
const promptKeys = (result: object): string[] => ("prompts" in result ? (result.prompts as { featureKey: string }[]).map((p) => p.featureKey) : []);

const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false };

describe("Core Book class features through the dispatcher, dice and sessions", () => {
  useAllowlist(EMAILS);

  it("Rally reaches every active non-away PC once per session, is spent on another PC's roll, clears at session end and undoes", async () => {
    const { gm, p1, p2, campaignId, a, b, c, patch, sheetOf, rows } = await setup();
    await patch(a, { classId: "bard", level: 5 });

    const { summary } = await p1.mutation(api.classFeatures.use, use(a, "rally"));
    expect(summary).toMatch(/rallied the party: 2 Rally Dice \(d8\)/);
    expect((await sheetOf(a)).heldDice).toEqual([{ id: "rally-1", kind: "rally", sides: 8, until: "session" }]);
    expect((await sheetOf(b)).heldDice).toEqual([{ id: "rally-1", kind: "rally", sides: 8, until: "session" }]);
    expect((await sheetOf(c)).heldDice).toEqual([]);
    const [rallyRow] = await rows(a);
    expect((await rows(b))[0]?.groupId).toBe(rallyRow?.groupId);
    expect(await codeOf(p1.mutation(api.classFeatures.use, use(a, "rally")))).toBe("CLASS_FEATURE_RULE");

    // Bryn (a Warrior) spends the die on a roll: one more d8 in the roll, the die is gone.
    const { roll } = await p2.mutation(api.rolls.actionRoll, { characterId: b, ...agility, options: ["rally:rally-1"], idempotencyKey: key() });
    expect(roll.dice.filter((d) => d.role === "extra").map((d) => d.sides)).toEqual([8]);
    expect((await sheetOf(b)).heldDice).toEqual([]);

    // Ending the session clears Ash's unspent die and refreshes Rally.
    await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
    expect((await sheetOf(a)).heldDice).toEqual([]);
    expect((await sheetOf(a)).featureUses).toEqual([]);

  });

  it("undoing Rally removes the dice from every PC it reached", async () => {
    const { p1, a, b, patch, sheetOf, rows, undo } = await setup();
    await patch(a, { classId: "bard" });
    await p1.mutation(api.classFeatures.use, use(a, "rally"));
    expect((await sheetOf(b)).heldDice).toHaveLength(1);
    const [row] = await rows(a);
    expect(await codeOf(undo(p1, row!._id))).toBe("ok");
    expect((await sheetOf(a)).heldDice).toEqual([]);
    expect((await sheetOf(b)).heldDice).toEqual([]);
    expect((await sheetOf(a)).featureUses).toEqual([]);
  });

  it("Prayer Dice arrive at session start (Spellcast trait d4s), not for a trait of 0, and undo removes them", async () => {
    const { gm, campaignId, a, b, patch, sheetOf, rows, undo } = await setup();
    await patch(a, { classId: "seraph", subclassId: "divine-wielder", traits: { agility: 0, strength: 2, finesse: 1, instinct: 1, presence: 0, knowledge: -1 } });
    await patch(b, { classId: "seraph", subclassId: "divine-wielder", traits: { agility: 2, strength: 0, finesse: 1, instinct: 1, presence: 0, knowledge: -1 } });

    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    const held = (await sheetOf(a)).heldDice;
    expect(held.map((d) => [d.kind, d.sides, d.until])).toEqual([
      ["prayer", 4, "session"],
      ["prayer", 4, "session"],
    ]);
    expect(held.every((d) => d.value !== undefined && d.value >= 1 && d.value <= 4)).toBe(true);
    expect((await sheetOf(b)).heldDice).toEqual([]);

    const [row] = await rows(a);
    expect(await codeOf(undo(gm, row!._id))).toBe("ok");
    expect((await sheetOf(a)).heldDice).toEqual([]);
  });

  it("Strange Patterns prompts after a matching roll, gives one benefit, and undoes", async () => {
    const { p1, a, patch, sheetOf, rows, undo } = await setup();
    await patch(a, { classId: "wizard", stress: 3, classState: { strangeNumber: 7 } });

    const miss = await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { ...agility, options: [] }, values: [4, 5], idempotencyKey: key() });
    expect(promptKeys(miss)).toEqual([]);
    const hit = await p1.mutation(api.rolls.manualRoll, { characterId: a, roll: { ...agility, options: [] }, values: [7, 7], idempotencyKey: key() });
    expect(promptKeys(hit)).toEqual(["strangePatternsBenefit"]);

    const before = await sheetOf(a); // the critical cleared a Stress already: 2
    await p1.mutation(api.classFeatures.use, use(a, "strangePatternsBenefit", { choice: "stress" }));
    expect((await sheetOf(a)).stress).toBe(before.stress - 1);
    expect(await codeOf(p1.mutation(api.classFeatures.use, use(a, "strangePatternsBenefit", { choice: "hope" })))).toBe("CLASS_FEATURE_RULE");

    const latest = (await rows(a)).at(-1)!;
    expect(latest.kind).toBe("feature");
    expect(await codeOf(undo(p1, latest._id))).toBe("ok");
    expect((await sheetOf(a)).stress).toBe(before.stress);
  });

  it("Unstoppable is once per long rest and its die reaches the damage roll", async () => {
    const { p1, a, patch, sheetOf } = await setup();
    await patch(a, { classId: "guardian" });
    await p1.mutation(api.classFeatures.use, use(a, "unstoppable"));
    expect((await sheetOf(a)).classState.unstoppable).toEqual({ value: 1, max: 4 });
    expect(await codeOf(p1.mutation(api.classFeatures.use, use(a, "unstoppable")))).toBe("CLASS_FEATURE_RULE");
    await p1.mutation(api.classFeatures.use, use(a, "unstoppableHit"));
    const { roll } = await p1.mutation(api.rolls.manualRoll, {
      characterId: a,
      roll: { kind: "damage", source: { kind: "dice", dice: [{ count: 1, sides: 6 }] }, critical: false, modifier: 0, options: [] },
      values: [3],
      idempotencyKey: key(),
    });
    expect(roll.total).toBe(5);
  });
});
