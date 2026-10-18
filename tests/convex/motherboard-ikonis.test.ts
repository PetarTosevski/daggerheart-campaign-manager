import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { INITIAL_COMPANION } from "../../src/lib/frames/extras/companion";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getArmor, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const ARMOR_ID = ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id;
const IKONIS = { name: "Spark rod", description: "", trait: "strength" as const, range: "Melee" as const, damageType: "physical" as const };
const PRIMARY = WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id;

function draft(classId: string, overrides: Record<string, unknown> = {}) {
  const cls = getClass(classId)!;
  const sub = classId === "ranger" ? "beastbound" : subclassesForClass(classId)[0].id;
  const cards = cardsForDomains(cls.domains, 1)
    .filter((c) => c.level === 1)
    .slice(0, 2)
    .map((c) => c.id);
  return {
    classId,
    subclassId: sub,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name: "Vex",
    pronouns: "",
    description: "",
    primaryWeaponId: "",
    armorId: ARMOR_ID,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Scavenger", "Tinker"],
    domainCards: cards,
    connections: [],
    ...overrides,
  };
}

async function setup(frameId: "motherboard" | "witherwild") {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    p1: await ctx.db.insert("users", { email: "p1@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|s` });
  const gm = as(ids.gm);
  const p1 = as(ids.p1);
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Party", idempotencyKey: key() });
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await p1.mutation(api.members.joinByCode, { code });
  const sheetOf = async (id: Id<"characters">) => (await p1.query(api.characters.get, { characterId: id }))!.sheet;
  const edit = (id: Id<"characters">, change: (s: CharacterSheet) => CharacterSheet) =>
    t.run(async (ctx) => saveSheet(ctx, id, change(readSheet((await ctx.db.get("characters", id))!.sheet))));
  return { t, gm, p1, campaignId, sheetOf, edit };
}

const fail = async (p: Promise<unknown>) => errorCode(await p.then(() => null, (e: unknown) => e));

describe("Motherboard Ikonis (CB 295, 301-303)", () => {
  useAllowlist("gm@example.com,p1@example.com");

  it("a Motherboard Warrior is created with an Ikonis and a Force augment instead of weapons", async () => {
    const { p1, campaignId, sheetOf } = await setup("motherboard");
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft("warrior"), ikonis: IKONIS, idempotencyKey: key() });
    const sheet = await sheetOf(characterId);
    expect(sheet.primaryWeaponId).toBe("");
    expect(sheet.secondaryWeaponId).toBeUndefined();
    const extras = await p1.query(api.characterExtras.get, { characterId });
    expect(extras.motherboard).toMatchObject({ ikonis: IKONIS, built: [{ id: "force", relics: [] }], installed: ["force"], quantum: 5 });
  });

  it("other classes start with no augments installed", async () => {
    const { p1, campaignId } = await setup("motherboard");
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft("bard"), ikonis: IKONIS, idempotencyKey: key() });
    expect((await p1.query(api.characterExtras.get, { characterId })).motherboard).toMatchObject({ built: [], installed: [] });
  });

  it("a Motherboard draft needs a complete Ikonis and no weapons", async () => {
    const { p1, campaignId } = await setup("motherboard");
    const create = (d: Record<string, unknown>, ikonis?: typeof IKONIS) =>
      fail(p1.mutation(api.characters.create, { campaignId, draft: draft("warrior", d), ...(ikonis ? { ikonis } : {}), idempotencyKey: key() }));
    expect(await create({})).toBe("INVALID");
    expect(await create({}, { ...IKONIS, range: null } as unknown as typeof IKONIS)).toBe("INVALID");
    expect(await create({ primaryWeaponId: PRIMARY }, IKONIS)).toBe("INVALID");
  });

  it("other frames still require a primary weapon and take no Ikonis", async () => {
    const { p1, campaignId } = await setup("witherwild");
    expect(await fail(p1.mutation(api.characters.create, { campaignId, draft: draft("warrior"), idempotencyKey: key() }))).toBe("INVALID");
    expect(
      await fail(p1.mutation(api.characters.create, { campaignId, draft: draft("warrior", { primaryWeaponId: PRIMARY }), ikonis: IKONIS, idempotencyKey: key() })),
    ).toBe("INVALID");
    await p1.mutation(api.characters.create, { campaignId, draft: draft("warrior", { primaryWeaponId: PRIMARY }), idempotencyKey: key() });
  });

  it("the sheet takes no new weapons in Motherboard; armor still changes", async () => {
    const { p1, campaignId, sheetOf } = await setup("motherboard");
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft("warrior"), ikonis: IKONIS, idempotencyKey: key() });
    expect(await fail(p1.mutation(api.characters.updateSheet, { characterId, patch: { primaryWeaponId: PRIMARY } }))).toBe("INVALID");
    const other = ARMOR.find((a) => a.source === "core" && a.tier === 1 && a.id !== ARMOR_ID)!.id;
    await p1.mutation(api.characters.updateSheet, { characterId, patch: { armorId: other } });
    expect((await sheetOf(characterId)).armorId).toBe(other);
  });

  it("installed Guard raises the Armor Score the server uses", async () => {
    const { gm, p1, campaignId, sheetOf } = await setup("motherboard");
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft("warrior"), ikonis: IKONIS, idempotencyKey: key() });
    const base = getArmor(ARMOR_ID)!.baseScore;
    const scrap = { Wire: 3, Silver: 2, Platinum: 2, Fuse: 3 };
    await p1.mutation(api.characterExtras.correctWallet, { characterId, correction: { scrap }, idempotencyKey: key() });
    await p1.mutation(api.characterExtras.craftAugment, { characterId, augmentId: "guard", idempotencyKey: key() });
    // CB 301: augments are swapped during downtime (an open rest).
    await gm.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: key() });
    await p1.mutation(api.characterExtras.installAugments, { characterId, augmentIds: ["force", "guard"], idempotencyKey: key() });
    const r = await p1.mutation(api.characters.adjustResource, { characterId, resource: "armor", delta: 12 });
    expect(r.armorMarked).toBe(base + 1);
    expect((await sheetOf(characterId)).armorMarked).toBe(base + 1);
  });
});

describe("Light in the Dark (CB 40, dcm-bxp.14)", () => {
  useAllowlist("gm@example.com,p1@example.com");

  it("sets hopeSlotBonus, so Hope reaches 7 and a seventh scar fits", async () => {
    const { p1, campaignId, sheetOf, edit } = await setup("witherwild");
    const { characterId } = await p1.mutation(api.characters.create, {
      campaignId,
      draft: draft("ranger", { primaryWeaponId: PRIMARY }),
      idempotencyKey: key(),
    });
    await edit(characterId, (s) => ({ ...s, level: 2 }));
    const companion = { ...INITIAL_COMPANION, training: { lightInTheDark: 1 } };
    await p1.mutation(api.characterExtras.saveCompanion, { characterId, state: companion, idempotencyKey: key() });
    expect((await sheetOf(characterId)).hopeSlotBonus).toBe(1);
    const hope = await p1.mutation(api.characters.adjustResource, { characterId, resource: "hope", delta: 12 });
    expect(hope.hope).toBe(7);
    const scars = await p1.mutation(api.characters.adjustResource, { characterId, resource: "scars", delta: 12 });
    expect(scars).toMatchObject({ scars: 7, hope: 0 });

    await p1.mutation(api.characters.adjustResource, { characterId, resource: "scars", delta: -12 });
    await p1.mutation(api.characters.adjustResource, { characterId, resource: "hope", delta: 12 });
    // Untaking it removes the slot and the Hope on it.
    await p1.mutation(api.characterExtras.saveCompanion, { characterId, state: INITIAL_COMPANION, idempotencyKey: key() });
    expect(await sheetOf(characterId)).toMatchObject({ hopeSlotBonus: 0, hope: 6 });
  });
});

describe("free card swaps need an open rest (CB 101, 105)", () => {
  useAllowlist("gm@example.com,p1@example.com");

  it("duringRest without an open rest pays the Recall Cost; with one it is free", async () => {
    const { gm, p1, campaignId, sheetOf } = await setup("witherwild");
    const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft("warrior", { primaryWeaponId: PRIMARY }), idempotencyKey: key() });
    const card = "get-back-up"; // Recall Cost 1
    expect((await sheetOf(characterId)).domainCards.loadout).toContain(card);
    await p1.mutation(api.characters.moveCard, { characterId, cardId: card, to: "vault" });
    await p1.mutation(api.characters.moveCard, { characterId, cardId: card, to: "loadout", duringRest: true });
    expect((await sheetOf(characterId)).stress).toBe(1);

    await gm.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: key() });
    await p1.mutation(api.characters.moveCard, { characterId, cardId: card, to: "vault" });
    await p1.mutation(api.characters.moveCard, { characterId, cardId: card, to: "loadout", duringRest: true });
    expect((await sheetOf(characterId)).stress).toBe(1);
  });
});
