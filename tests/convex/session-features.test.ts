// Session features on the character sheet (plan session-features F3): sessionFeatures.bumpMoonDie and
// characters.applyDamage({ negateMinor }) (Lunar Phases, Moon Witch mastery, HF p.17; U6).
import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { derivedThresholds } from "../../src/lib/domain/characters/derived";
import { expire } from "../../src/lib/domain/characters/expiry";
import { holdsWeaponSpecialist, rerollSlayerOnes, weaponSpecialistUsed } from "../../src/lib/domain/session-features/index";
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

/** A Hope & Fear campaign: Mira (p1) is a Moon Witch at mastery, Bryn (p2) a Warrior; plus a GM and an outsider. */
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
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  await p2.mutation(api.members.joinByCode, { code });
  const mira = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Mira"), idempotencyKey: key() })).characterId;
  const bryn = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Bryn"), idempotencyKey: key() })).characterId;

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
  await patch(mira, { classId: "witch", subclassId: "moon", subclassRank: "mastery", hope: 3 });
  /** Mira with a moon die on the sheet. */
  const moon = (moonDie: number, change: Partial<CharacterSheet> = {}) => patch(mira, { sessionFeatures: { moonDie }, ...change });
  return { t, gm, p1, p2, out, campaignId, mira, bryn, sheetOf, patch, rows, moon };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

const bump = (characterId: Id<"characters">) => ({ characterId, idempotencyKey: key() });

describe("sessionFeatures.bumpMoonDie", () => {
  useAllowlist(EMAILS);

  it("roles: anonymous, outsider and another player are refused; the owner and the GM bump", async () => {
    const { t, gm, p1, p2, out, mira, moon, sheetOf } = await setup();
    await moon(2);
    expect(await codeOf(t.mutation(api.sessionFeatures.bumpMoonDie, bump(mira)))).toBe("UNAUTHENTICATED");
    expect(await codeOf(out.mutation(api.sessionFeatures.bumpMoonDie, bump(mira)))).toBe("NOT_FOUND");
    expect(await codeOf(p2.mutation(api.sessionFeatures.bumpMoonDie, bump(mira)))).toBe("FORBIDDEN");
    expect((await sheetOf(mira)).sessionFeatures).toEqual({ moonDie: 2 });

    expect(await p1.mutation(api.sessionFeatures.bumpMoonDie, bump(mira))).toEqual({ from: 2, to: 3, hope: 2 });
    await moon(3, { featureUses: [] });
    expect(await gm.mutation(api.sessionFeatures.bumpMoonDie, bump(mira))).toEqual({ from: 3, to: 4, hope: 1 });
  });

  it("spends a Hope, raises the die, marks the use until the rest and logs one undoable public row; undo restores it", async () => {
    const { p1, mira, moon, sheetOf, rows } = await setup();
    await moon(3);
    await p1.mutation(api.sessionFeatures.bumpMoonDie, bump(mira));
    const sheet = await sheetOf(mira);
    expect(sheet.hope).toBe(2);
    expect(sheet.sessionFeatures).toEqual({ moonDie: 4 });
    expect(sheet.featureUses).toContainEqual({ key: "lunarPhasesBump", until: "rest" });
    const [row] = await rows(mira);
    expect(row).toMatchObject({ kind: "feature", visibility: "public", undoable: true, summary: "Mira spent a Hope: moon die 3 -> 4 (Full)" });

    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: row!._id, idempotencyKey: key() }))).toBe("ok");
    const back = await sheetOf(mira);
    expect(back.hope).toBe(3);
    expect(back.sessionFeatures).toEqual({ moonDie: 3 });
    expect(back.featureUses).toEqual([]);
  });

  it("a 6 becomes a 1", async () => {
    const { p1, mira, moon, sheetOf } = await setup();
    await moon(6);
    expect(await p1.mutation(api.sessionFeatures.bumpMoonDie, bump(mira))).toMatchObject({ from: 6, to: 1 });
    expect((await sheetOf(mira)).sessionFeatures?.moonDie).toBe(1);
  });

  it("refuses without a die, a second time in the same rest, at 0 Hope, and for a sheet without Lunar Phases", async () => {
    const { p1, p2, gm, campaignId, mira, bryn, moon, patch, sheetOf } = await setup();
    expect(await codeOf(p1.mutation(api.sessionFeatures.bumpMoonDie, bump(mira)))).toBe("CLASS_FEATURE_RULE");

    await moon(2);
    await p1.mutation(api.sessionFeatures.bumpMoonDie, bump(mira));
    expect(await codeOf(p1.mutation(api.sessionFeatures.bumpMoonDie, bump(mira)))).toBe("CLASS_FEATURE_RULE");
    expect((await sheetOf(mira)).sessionFeatures?.moonDie).toBe(3);

    await moon(2, { hope: 0, featureUses: [] });
    expect(await codeOf(p1.mutation(api.sessionFeatures.bumpMoonDie, bump(mira)))).toBe("NOT_ENOUGH_HOPE");

    await patch(bryn, { sessionFeatures: { moonDie: 2 }, hope: 3 });
    expect(await codeOf(p2.mutation(api.sessionFeatures.bumpMoonDie, bump(bryn)))).toBe("CLASS_FEATURE_RULE");

    // A Moon Witch below mastery, and Lunar Phases with Hope & Fear off.
    await moon(2, { hope: 3, subclassRank: "specialization" });
    expect(await codeOf(p1.mutation(api.sessionFeatures.bumpMoonDie, bump(mira)))).toBe("CLASS_FEATURE_RULE");
    await moon(2, { subclassRank: "mastery" });
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: false });
    expect(await codeOf(p1.mutation(api.sessionFeatures.bumpMoonDie, bump(mira)))).toBe("CLASS_FEATURE_RULE");
  });

  it("refuses while the Witch can't act (unconscious), as other features do", async () => {
    const { p1, mira, moon, sheetOf } = await setup();
    await moon(2, { hope: 3, conditions: ["unconscious"] });
    expect(await codeOf(p1.mutation(api.sessionFeatures.bumpMoonDie, bump(mira)))).toBe("CHARACTER_UNAVAILABLE");
    expect((await sheetOf(mira)).sessionFeatures?.moonDie).toBe(2);
  });

  it("a short rest refreshes the bump", async () => {
    const { gm, p1, campaignId, mira, moon, sheetOf } = await setup();
    await moon(2);
    await p1.mutation(api.sessionFeatures.bumpMoonDie, bump(mira));
    const { restId } = await gm.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: key() });
    await gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
    expect((await sheetOf(mira)).featureUses.some((u) => u.key === "lunarPhasesBump")).toBe(false);
    expect(await p1.mutation(api.sessionFeatures.bumpMoonDie, bump(mira))).toMatchObject({ from: 3, to: 4 });
  });
});

const damage = (characterId: Id<"characters">, amount: number, extra: { useArmorSlot?: boolean; negateMinor?: true } = {}) => ({
  characterId,
  damage: amount,
  useArmorSlot: extra.useArmorSlot ?? false,
  ...(extra.negateMinor ? { negateMinor: extra.negateMinor } : {}),
  idempotencyKey: key(),
});

describe("characters.applyDamage negateMinor (New moon)", () => {
  useAllowlist(EMAILS);

  it("roles: anonymous, outsider and another player are refused; the owner and the GM negate", async () => {
    const { t, gm, p1, p2, out, mira, moon, sheetOf } = await setup();
    await moon(1);
    expect(await codeOf(t.mutation(api.characters.applyDamage, damage(mira, 1, { negateMinor: true })))).toBe("UNAUTHENTICATED");
    expect(await codeOf(out.mutation(api.characters.applyDamage, damage(mira, 1, { negateMinor: true })))).toBe("NOT_FOUND");
    expect(await codeOf(p2.mutation(api.characters.applyDamage, damage(mira, 1, { negateMinor: true })))).toBe("FORBIDDEN");
    expect((await sheetOf(mira)).hope).toBe(3);

    expect(await p1.mutation(api.characters.applyDamage, damage(mira, 1, { negateMinor: true }))).toEqual({ severity: "minor", marks: 0, hp: 0, armorMarked: 0 });
    expect(await gm.mutation(api.characters.applyDamage, damage(mira, 1, { negateMinor: true }))).toMatchObject({ severity: "minor", marks: 0 });
    const sheet = await sheetOf(mira);
    expect(sheet.hope).toBe(1);
    expect(sheet.hp).toBe(0);
  });

  it("spends a Hope, marks no Hit Point but still the chosen Armor Slot, logs one undoable row; undo restores it", async () => {
    const { p1, mira, moon, sheetOf, rows } = await setup();
    await moon(1);
    const major = derivedThresholds(await sheetOf(mira)).major;
    // Major damage made Minor by the Armor Slot: the New moon negates what is left.
    const result = await p1.mutation(api.characters.applyDamage, damage(mira, major, { useArmorSlot: true, negateMinor: true }));
    expect(result).toEqual({ severity: "minor", marks: 0, hp: 0, armorMarked: 1 });
    const sheet = await sheetOf(mira);
    expect(sheet).toMatchObject({ hope: 2, hp: 0, armorMarked: 1 });
    const [row] = await rows(mira);
    expect(row).toMatchObject({ kind: "feature", visibility: "public", undoable: true, summary: "Mira spent a Hope: the New Moon negates Minor damage" });

    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: row!._id, idempotencyKey: key() }))).toBe("ok");
    expect(await sheetOf(mira)).toMatchObject({ hope: 3, hp: 0, armorMarked: 0 });
  });

  it("refuses under Waxing, on Major damage, at 0 Hope and without a die; plain damage is unchanged and unlogged (E4)", async () => {
    const { p1, mira, moon, sheetOf, rows } = await setup();
    await moon(2);
    expect(await codeOf(p1.mutation(api.characters.applyDamage, damage(mira, 1, { negateMinor: true })))).toBe("CLASS_FEATURE_RULE");
    await moon(1);
    const major = derivedThresholds(await sheetOf(mira)).major;
    expect(await codeOf(p1.mutation(api.characters.applyDamage, damage(mira, major, { negateMinor: true })))).toBe("CLASS_FEATURE_RULE");
    await moon(1, { hope: 0 });
    expect(await codeOf(p1.mutation(api.characters.applyDamage, damage(mira, 1, { negateMinor: true })))).toBe("CLASS_FEATURE_RULE");
    await moon(1, { hope: 3, sessionFeatures: undefined });
    expect(await codeOf(p1.mutation(api.characters.applyDamage, damage(mira, 1, { negateMinor: true })))).toBe("CLASS_FEATURE_RULE");
    expect((await sheetOf(mira)).hp).toBe(0);

    await moon(1);
    expect(await p1.mutation(api.characters.applyDamage, damage(mira, 1))).toEqual({ severity: "minor", marks: 1, hp: 1, armorMarked: 0 });
    expect((await sheetOf(mira)).hope).toBe(3);
    expect(await rows(mira)).toEqual([]);
  });

  it("seedForE2e (the browser specs' internal seeding) is refused outside the local e2e backend", async () => {
    const { t, mira, sheetOf } = await setup();
    await expect(t.mutation(internal.sessionFeatures.seedForE2e, { characterId: mira, moonDie: 1 })).rejects.toThrow(/local e2e backend/);
    expect((await sheetOf(mira)).sessionFeatures).toBeUndefined();
  });

  it("a Full moon's +3 counts in the server's thresholds", async () => {
    const { p1, mira, moon, sheetOf } = await setup();
    const { major } = derivedThresholds(await sheetOf(mira));
    expect(await p1.mutation(api.characters.applyDamage, damage(mira, major))).toMatchObject({ severity: "major" });
    await moon(4, { hp: 0 });
    expect(await p1.mutation(api.characters.applyDamage, damage(mira, major))).toMatchObject({ severity: "minor", marks: 1 });
  });
});

describe("rolls.storeSlayerDie after a roll that paid an Experience at Hope max (dcm-bxp.65, K2, CB p.48)", () => {
  useAllowlist(EMAILS);

  const action = { kind: "action" as const, trait: "agility" as const, modifier: 0, advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
  /** Hope 8, Fear 3: a success with Hope. */
  const WITH_HOPE = [8, 3];

  // dcm-bxp.65: at Hope 6 the Experience's Hope (6 -> 5) and the roll's Hope (5 -> 6) leave the sheet unchanged, so
  // the row's `before` cannot tell a gained Hope; the roll row's `hopeGained` (set from the sheet after costs) does.
  it("takes back the Hope the roll gave: Hope 6, pay 1 for an Experience (5), roll with Hope (6), store -> 5", async () => {
    const { p2, bryn, patch, sheetOf } = await setup();
    await patch(bryn, { subclassId: "call-of-the-slayer", hope: 6, proficiency: 2 });
    const exp = (await sheetOf(bryn)).experiences[0]!;
    const { entryId } = await p2.mutation(api.rolls.manualRoll, { characterId: bryn, roll: { ...action, experienceIds: [exp.id] }, values: WITH_HOPE, idempotencyKey: key() });
    expect((await sheetOf(bryn)).hope).toBe(6);
    expect(await p2.mutation(api.rolls.storeSlayerDie, { characterId: bryn, entryId, idempotencyKey: key() })).toEqual({ slayerDice: 1, capacity: 2, hope: 5 });
    expect((await sheetOf(bryn)).hope).toBe(5);
  });
});

describe("Weapon Specialist rules (Call of the Slayer specialization, CB 48; dcm-bxp.62)", () => {
  const base = { subclassId: "call-of-the-slayer", subclassRank: "specialization" as const, featureUses: [] as CharacterSheet["featureUses"] };
  const queue = (...values: number[]) => () => values.shift()!;

  it("is held at specialization and mastery, never at foundation or through a multiclass", () => {
    expect(holdsWeaponSpecialist(base)).toBe(true);
    expect(holdsWeaponSpecialist({ ...base, subclassRank: "mastery" })).toBe(true);
    expect(holdsWeaponSpecialist({ ...base, subclassRank: "foundation" })).toBe(false);
    expect(holdsWeaponSpecialist({ subclassId: "call-of-the-brave", subclassRank: "mastery", multiclass: { classId: "warrior", domainId: "blade", subclassId: "call-of-the-slayer" } })).toBe(false);
  });

  it("rerolls each 1 once and marks the use until the long rest, which expires it", () => {
    const sheet = base as unknown as CharacterSheet;
    const out = rerollSlayerOnes(sheet, [{ sides: 6, value: 1 }, { sides: 6, value: 4 }, { sides: 6, value: 1 }], queue(6, 1));
    expect(out.dice.map((d) => d.value)).toEqual([6, 4, 1]);
    expect(out.label).toBe("Weapon Specialist: 1 -> 6, 1 -> 1");
    expect(weaponSpecialistUsed(out.sheet)).toBe(true);
    // Spent: later 1s stand.
    expect(rerollSlayerOnes(out.sheet, [{ sides: 6, value: 1 }], queue(5)).dice[0]!.value).toBe(1);
    expect(weaponSpecialistUsed(expire(out.sheet, "shortRest"))).toBe(true);
    expect(weaponSpecialistUsed(expire(out.sheet, "longRest"))).toBe(false);
  });

  it("without a 1 or without the feature, nothing changes", () => {
    const sheet = base as unknown as CharacterSheet;
    expect(rerollSlayerOnes(sheet, [{ sides: 6, value: 3 }], queue(6))).toEqual({ sheet, dice: [{ sides: 6, value: 3 }] });
    const foundation = { ...base, subclassRank: "foundation" } as unknown as CharacterSheet;
    expect(rerollSlayerOnes(foundation, [{ sides: 6, value: 1 }], queue(6)).dice[0]!.value).toBe(1);
  });
});
