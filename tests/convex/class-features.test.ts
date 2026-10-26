import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { logAction } from "../../convex/lib/actionLog";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { campaignFearState } from "../../convex/lib/fear";
import type { RollRecord } from "../../src/lib/domain/duality";
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

/** A campaign with a GM, two players who each own a character (Ash: p1, Bryn: p2), and an outsider. */
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
  const patch = (id: Id<"characters">, change: Partial<CharacterSheet>) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...change }));
  const fear = () => t.run(async (ctx) => (await campaignFearState(ctx, campaignId)).fear);
  const rows = (id: Id<"characters">) =>
    t.run((ctx) =>
      ctx.db
        .query("actionLog")
        .withIndex("by_character_at", (q) => q.eq("characterId", id))
        .collect(),
    );
  /** Logs a roll for the character, as the dice tracer's rolls do. */
  const logRoll = (id: Id<"characters">, roll: RollRecord) =>
    t.run(async (ctx) =>
      logAction(ctx, {
        campaignId,
        characterId: id,
        actorId: ids.p2,
        kind: "roll",
        visibility: "public",
        summary: "rolled",
        roll,
        before: readSheet((await ctx.db.get("characters", id))!.sheet),
        undoable: true,
      }),
    );
  return { t, ids, gm, p1, p2, out, campaignId, a, b, sheetOf, patch, fear, rows, logRoll };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

const use = (characterId: Id<"characters">, featureKey: string, params: { targetId?: Id<"characters">; choice?: string; dieIndexes?: number[] } = {}) => ({
  characterId,
  featureKey,
  params,
  idempotencyKey: key(),
});

describe("classFeatures.use", () => {
  useAllowlist(EMAILS);

  it("spends 3 Hope and refuses below 3 (CB 27)", async () => {
    const { p1, a, patch, sheetOf, rows } = await setup();
    await patch(a, { hope: 2 });
    expect(await codeOf(p1.mutation(api.classFeatures.use, use(a, "noMercy")))).toBe("NOT_ENOUGH_HOPE");
    expect(await rows(a)).toEqual([]);

    await patch(a, { hope: 4 });
    const result = await p1.mutation(api.classFeatures.use, use(a, "noMercy"));
    expect(result.summary).toMatch(/No Mercy/);
    const sheet = await sheetOf(a);
    expect(sheet.hope).toBe(1);
    expect(sheet.effects.map((e) => e.id)).toEqual(["no-mercy"]);
    expect((await rows(a)).map((r) => r.kind)).toEqual(["feature"]);
  });

  it("Life Support on another player's character writes the ally and logs both in one group, and undo restores both", async () => {
    const { p1, a, b, patch, sheetOf, rows } = await setup();
    await patch(a, { classId: "seraph", hope: 3 });
    await patch(b, { hp: 2, conditions: ["unconscious"] });

    await p1.mutation(api.classFeatures.use, use(a, "lifeSupport", { targetId: b }));

    expect((await sheetOf(a)).hope).toBe(0);
    expect((await sheetOf(b)).hp).toBe(1);
    expect((await sheetOf(b)).conditions).toEqual([]);
    const [mine] = await rows(a);
    const [theirs] = await rows(b);
    expect(mine?.groupId).toBeTypeOf("string");
    expect(theirs?.groupId).toBe(mine?.groupId);
    expect(theirs?.summary).toBe("Life Support from Ash");

    expect(await codeOf(p1.mutation(api.actionLog.undo, { entryId: mine!._id, idempotencyKey: key() }))).toBe("ok");
    expect((await sheetOf(a)).hope).toBe(3);
    expect((await sheetOf(b)).hp).toBe(2);
    expect((await sheetOf(b)).conditions).toEqual(["unconscious"]);
  });

  it("polish 29: a Rally Die clears Stress for a Hope & Fear class with the option off; its own features stay off", async () => {
    const { p2, b, patch, sheetOf } = await setup();
    await patch(b, { classId: "brawler", stress: 4, heldDice: [{ id: "rally-1", kind: "rally", sides: 6, value: 3, until: "session" }] });
    expect(await codeOf(p2.mutation(api.classFeatures.use, use(b, "comboStrike")))).toBe("CLASS_FEATURE_RULE");
    expect(await codeOf(p2.mutation(api.classFeatures.use, use(b, "rallyDieStress")))).toBe("ok");
    expect(await sheetOf(b)).toMatchObject({ stress: 1, heldDice: [] });
  });

  it("M5: a party feature over 50 characters is refused instead of skipping some", async () => {
    const { t, p1, a, patch } = await setup();
    await patch(a, { classId: "bard", subclassId: "troubadour" });
    await t.run(async (ctx) => {
      const c = (await ctx.db.get("characters", a))!;
      for (let i = 0; i < 49; i++) {
        await ctx.db.insert("characters", { campaignId: c.campaignId, ownerId: c.ownerId, createdBy: c.createdBy, status: "active", sheet: c.sheet, createdAt: 0, updatedAt: 0 });
      }
    });
    expect(await codeOf(p1.mutation(api.classFeatures.use, use(a, "rally")))).toBe("CLASS_FEATURE_RULE");
  });

  it("a player cannot use a feature for another player's character; the GM can", async () => {
    const { gm, p2, out, t, a, patch } = await setup();
    await patch(a, { hope: 6 });
    expect(await codeOf(p2.mutation(api.classFeatures.use, use(a, "noMercy")))).toBe("FORBIDDEN");
    expect(await codeOf(out.mutation(api.classFeatures.use, use(a, "noMercy")))).toBe("NOT_FOUND");
    expect(await codeOf(t.mutation(api.classFeatures.use, use(a, "noMercy")))).toBe("UNAUTHENTICATED");
    expect(await codeOf(gm.mutation(api.classFeatures.use, use(a, "noMercy")))).toBe("ok");
  });

  it("refuses an unconscious character, another class's feature and a target from another campaign", async () => {
    const { gm, p1, a, patch } = await setup();
    await patch(a, { hope: 6, conditions: ["unconscious"] });
    expect(await codeOf(p1.mutation(api.classFeatures.use, use(a, "noMercy")))).toBe("CHARACTER_UNAVAILABLE");
    await patch(a, { conditions: [] });
    expect(await codeOf(p1.mutation(api.classFeatures.use, use(a, "roguesDodge")))).toBe("CLASS_FEATURE_RULE");

    const { campaignId: other } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Other", idempotencyKey: key() });
    const stranger = (await gm.mutation(api.characters.create, { campaignId: other, draft: draft("Cid"), idempotencyKey: key() })).characterId;
    await patch(a, { classId: "seraph" });
    expect(await codeOf(p1.mutation(api.classFeatures.use, use(a, "lifeSupport", { targetId: stranger })))).toBe("NOT_FOUND");
  });

  it("Witch's Charm on an ally's roll with Hope removes that Hope and gives the GM 1 Fear, logged on both; undo takes it back", async () => {
    const { gm, p1, a, b, campaignId, patch, sheetOf, fear, rows, logRoll } = await setup();
    await patch(a, { classId: "witch", hope: 3 });
    await patch(b, { hope: 2 });
    const failed: RollRecord = {
      kind: "action",
      dice: [
        { sides: 12, value: 7, role: "hope" },
        { sides: 12, value: 2, role: "fear" },
      ],
      modifier: 1,
      total: 10,
      difficulty: 14,
      outcome: "failHope",
      manual: false,
    };
    await logRoll(b, failed);

    // A Hope & Fear class needs the campaign's option (Witherwild: off by default).
    expect(await codeOf(p1.mutation(api.classFeatures.use, use(a, "witchsCharm", { targetId: b })))).toBe("CLASS_FEATURE_RULE");
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });

    const result = await p1.mutation(api.classFeatures.use, use(a, "witchsCharm", { targetId: b }));
    expect(result.roll?.outcome).toBe("successFear");
    expect((await sheetOf(b)).hope).toBe(1);
    expect((await sheetOf(a)).hope).toBe(0);
    expect(await fear()).toBe(1);
    const charm = (await rows(b)).at(-1)!;
    expect(charm.roll?.outcome).toBe("successFear");
    const mine = (await rows(a)).at(-1)!;
    expect(mine.groupId).toBe(charm.groupId);
    expect(mine.fearDelta).toBe(1);

    // The button always works (the sheet can't know the Difficulty): on a roll already with Fear it only spends the Hope.
    await patch(a, { hope: 3 });
    await p1.mutation(api.classFeatures.use, use(a, "witchsCharm", { targetId: b }));
    expect((await sheetOf(a)).hope).toBe(0);
    expect((await sheetOf(b)).hope).toBe(1);
    expect(await fear()).toBe(1);
  });

  it("Witch's Charm works on any latest roll: a success with Hope gives that Hope to the GM as Fear", async () => {
    const { gm, p1, a, b, campaignId, patch, sheetOf, fear, logRoll } = await setup();
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
    await patch(a, { classId: "witch", hope: 3 });
    await patch(b, { hope: 2 });
    // The Difficulty may be hidden from the sheet, so even a roll that looks like a success can be charmed.
    await logRoll(b, {
      kind: "action",
      dice: [
        { sides: 12, value: 9, role: "hope" },
        { sides: 12, value: 4, role: "fear" },
      ],
      modifier: 1,
      total: 14,
      outcome: "successHope",
      manual: false,
    });
    const result = await p1.mutation(api.classFeatures.use, use(a, "witchsCharm", { targetId: b }));
    expect(result.roll?.outcome).toBe("successFear");
    expect((await sheetOf(b)).hope).toBe(1);
    expect((await sheetOf(a)).hope).toBe(0);
    expect(await fear()).toBe(1);
  });

  it("Witch's Charm on a roll with Fear changes nothing else", async () => {
    const { gm, p1, a, b, campaignId, patch, sheetOf, fear, logRoll } = await setup();
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
    await patch(a, { classId: "witch", hope: 3 });
    await patch(b, { hope: 2 });
    await logRoll(b, {
      kind: "action",
      dice: [
        { sides: 12, value: 2, role: "hope" },
        { sides: 12, value: 7, role: "fear" },
      ],
      modifier: 1,
      total: 10,
      difficulty: 14,
      outcome: "failFear",
      manual: false,
    });
    await p1.mutation(api.classFeatures.use, use(a, "witchsCharm", { targetId: b }));
    expect((await sheetOf(b)).hope).toBe(2);
    expect(await fear()).toBe(0);
  });

  it("Volatile Magic rerolls the caster's latest damage roll and logs the new roll", async () => {
    const { p1, a, patch, rows, logRoll } = await setup();
    await patch(a, { classId: "sorcerer", hope: 3 });
    await logRoll(a, {
      kind: "damage",
      dice: [
        { sides: 10, value: 1, role: "damage" },
        { sides: 10, value: 10, role: "damage" },
      ],
      modifier: 2,
      total: 13,
      outcome: "none",
      manual: false,
    });
    const result = await p1.mutation(api.classFeatures.use, use(a, "volatileMagic", { dieIndexes: [0] }));
    expect(result.roll?.dice[1]?.value).toBe(10);
    expect(result.roll?.total).toBe(12 + result.roll!.dice[0]!.value);
    expect((await rows(a)).at(-1)?.roll).toEqual(result.roll);
  });
});

describe("classFeatures.gotHit and endEffect", () => {
  useAllowlist(EMAILS);

  it("Got hit ends Rogue's Dodge; End ends an effect; both log rows and refuse when nothing ends", async () => {
    const { p1, p2, a, patch, sheetOf, rows } = await setup();
    await patch(a, { classId: "rogue", hope: 6 });
    await p1.mutation(api.classFeatures.use, use(a, "roguesDodge"));
    expect((await sheetOf(a)).effects.map((e) => e.id)).toEqual(["rogues-dodge"]);

    expect(await codeOf(p2.mutation(api.classFeatures.gotHit, { characterId: a, idempotencyKey: key() }))).toBe("FORBIDDEN");
    await p1.mutation(api.classFeatures.gotHit, { characterId: a, idempotencyKey: key() });
    expect((await sheetOf(a)).effects).toEqual([]);
    expect(await codeOf(p1.mutation(api.classFeatures.gotHit, { characterId: a, idempotencyKey: key() }))).toBe("CLASS_FEATURE_RULE");

    await p1.mutation(api.classFeatures.use, use(a, "roguesDodge"));
    await p1.mutation(api.classFeatures.endEffect, { characterId: a, effectId: "rogues-dodge", idempotencyKey: key() });
    expect((await sheetOf(a)).effects).toEqual([]);
    expect(await codeOf(p1.mutation(api.classFeatures.endEffect, { characterId: a, effectId: "rogues-dodge", idempotencyKey: key() }))).toBe(
      "CLASS_FEATURE_RULE",
    );
    expect((await rows(a)).map((r) => r.summary)).toEqual([
      "used Rogue’s Dodge: +2 Evasion",
      "was hit: Rogue’s Dodge ended",
      "used Rogue’s Dodge: +2 Evasion",
      "ended Rogue’s Dodge",
    ]);
  });
});

describe("classFeatures.lastRoll", () => {
  useAllowlist(EMAILS);

  it("returns the latest live roll to campaign members only", async () => {
    const { p2, out, a, logRoll } = await setup();
    expect(await p2.query(api.classFeatures.lastRoll, { characterId: a })).toBeNull();
    const roll: RollRecord = { kind: "damage", dice: [{ sides: 6, value: 3, role: "damage" }], modifier: 0, total: 3, outcome: "none", manual: true };
    await logRoll(a, roll);
    expect(await p2.query(api.classFeatures.lastRoll, { characterId: a })).toEqual(roll);
    expect(await codeOf(out.query(api.classFeatures.lastRoll, { characterId: a }))).toBe("NOT_FOUND");
  });
});
