import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, storedSheet } from "../../convex/lib/characterSheet";
import type { RuleChange } from "../../convex/lib/validators/ruleModes";
import { addGold, cardHolders, sharedCardNote, sharedCardRefusal, type Gold } from "../../src/lib/domain/characters/index";
import { ANCESTRIES, ARMOR, COMMUNITIES, DOMAIN_CARDS, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { sharedCardsMissing } from "../../src/app/(gm)/campaigns/[campaignId]/party/new/wizard-logic";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// Plan rule-switches OSC: the sheet's optional rules. Gold coins (CB p.104, Q12 a: 10 coins = 1 handful, off by default)
// and Shared domain cards (CB p.21, user 2026-11-05: Allow / Warn / Refuse, Warn by default).

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";

const cardOf = (domain: string, level: number, skip = 0) => DOMAIN_CARDS.filter((c) => c.domain === domain && c.level === level && c.source === "core")[skip]!.id;
const STARTING = [cardOf("blade", 1), cardOf("bone", 1)];
const OTHER_STARTING = [cardOf("blade", 1, 1), cardOf("bone", 1, 1)];

function draft(name: string, domainCards = STARTING) {
  return {
    classId: getClass("warrior")!.id,
    subclassId: subclassesForClass("warrior")[0]!.id,
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
    domainCards,
    connections: [],
  };
}

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
  const mira = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Mira"), idempotencyKey: key() })).characterId;
  const setRule = (change: RuleChange) => gm.mutation(api.ruleSettings.set, { campaignId, change });
  const patch = (id: Id<"characters">, change: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", id))!.sheet);
      await ctx.db.patch("characters", id, { sheet: storedSheet({ ...s, ...change(s) }), updatedAt: 0 });
    });
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  return { t, gm, p1, p2, campaignId, mira, setRule, patch, sheetOf };
}

const fail = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => errorCode(e));

// ---------------------------------------------------------------- Gold coins

describe("addGold with coins (CB p.104)", () => {
  const g = (handfuls: number, bags: number, chest: boolean, coins?: number): Gold => ({ handfuls, bags, chest, ...(coins === undefined ? {} : { coins }) });

  it("10 coins roll into 1 handful, and on through bags to the chest", () => {
    expect(addGold(g(0, 0, false), "coins", 3)).toEqual(g(0, 0, false, 3));
    expect(addGold(g(2, 0, false, 9), "coins", 1)).toEqual(g(3, 0, false, 0));
    expect(addGold(g(9, 9, false, 9), "coins", 1)).toEqual(g(0, 0, true, 0));
    expect(addGold(g(9, 9, true, 9), "coins", 1)).toBeNull();
    expect(addGold(g(0, 0, false, 5), "coins", 27)).toEqual(g(3, 0, false, 2));
  });

  it("spending stops at 0 coins (a handful isn't broken), and handful or bag changes keep the coins", () => {
    expect(addGold(g(2, 0, false, 1), "coins", -3)).toEqual(g(2, 0, false, 0));
    expect(addGold(g(2, 0, false, 4), "handfuls", 9)).toEqual(g(1, 1, false, 4));
    expect(addGold(g(2, 1, false, 4), "bags", -1)).toEqual(g(2, 0, false, 4));
    // A sheet that never used coins stays without the field.
    expect(addGold(g(2, 0, false), "handfuls", 1)).toEqual(g(3, 0, false));
  });
});

describe("characters.adjustGold coins", () => {
  useAllowlist(EMAILS);

  it("off (the default): MECHANIC_DISABLED, and handful changes leave coins alone", async () => {
    const { p1, mira, sheetOf } = await setup();
    expect(await fail(p1.mutation(api.characters.adjustGold, { characterId: mira, coin: "coins", delta: 1 }))).toBe("MECHANIC_DISABLED");
    expect(await p1.mutation(api.characters.adjustGold, { characterId: mira, coin: "handfuls", delta: 1 })).toEqual({ handfuls: 2, bags: 0, chest: false });
    expect((await sheetOf(mira)).gold).toEqual({ handfuls: 2, bags: 0, chest: false });
  });

  it("on: coins count up and the 10th rolls into a handful; the owner or the GM", async () => {
    const { gm, p1, p2, mira, setRule } = await setup();
    await setRule({ key: "goldCoins", value: true });
    // Mira starts with 1 handful and no coins: 12 coins are 1 more handful and 2 coins.
    expect(await p1.mutation(api.characters.adjustGold, { characterId: mira, coin: "coins", delta: 12 })).toEqual({ handfuls: 2, bags: 0, chest: false, coins: 2 });
    expect(await gm.mutation(api.characters.adjustGold, { characterId: mira, coin: "handfuls", delta: -1 })).toMatchObject({ handfuls: 1 });
    expect(await fail(p2.mutation(api.characters.adjustGold, { characterId: mira, coin: "coins", delta: 1 }))).toBe("FORBIDDEN");
  });

  it("on: the coins stay on the stored sheet, and a handful change keeps them", async () => {
    const { gm, p1, mira, setRule, sheetOf } = await setup();
    await setRule({ key: "goldCoins", value: true });
    await p1.mutation(api.characters.adjustGold, { characterId: mira, coin: "coins", delta: 3 });
    expect((await sheetOf(mira)).gold).toMatchObject({ handfuls: 1, coins: 3 });
    await gm.mutation(api.characters.adjustGold, { characterId: mira, coin: "handfuls", delta: 1 });
    expect((await sheetOf(mira)).gold).toMatchObject({ handfuls: 2, coins: 3 });
  });
});

// ---------------------------------------------------------------- Shared domain cards

describe("shared domain cards: pure helpers", () => {
  const holders = cardHolders(
    [
      { id: "a", name: "Mira", cards: ["rune-ward", "rune-ward", "deft"] },
      { id: "b", name: "Brin", cards: ["rune-ward"] },
      { id: "me", name: "Me", cards: ["deft", "mine"] },
    ],
    "me",
  );

  it("names every other holder; the chooser's own cards don't count", () => {
    expect(holders.get("rune-ward")).toEqual(["Mira", "Brin"]);
    expect(holders.get("deft")).toEqual(["Mira"]);
    expect(holders.has("mine")).toBe(false);
  });

  it("Warn and Refuse note the card; Allow says nothing", () => {
    expect(sharedCardNote("warn", holders, "deft")).toBe("Mira already has this card");
    expect(sharedCardNote("refuse", holders, "rune-ward")).toBe("Mira and Brin already have this card");
    expect(sharedCardNote("allow", holders, "deft")).toBeNull();
    expect(sharedCardNote("warn", holders, "mine")).toBeNull();
  });

  it("only Refuse refuses, and the wizard's step 8 waits for another card", () => {
    expect(sharedCardRefusal("warn", holders, ["deft"])).toBeNull();
    expect(sharedCardRefusal("allow", holders, ["deft"])).toBeNull();
    expect(sharedCardRefusal("refuse", holders, ["mine", "deft"], () => "Deft")).toBe("Mira already has Deft, and this campaign doesn't share domain cards.");
    expect(sharedCardsMissing(["deft", "mine"], "refuse", holders, () => "Deft")).toEqual(["a card Mira doesn't hold instead of Deft"]);
    expect(sharedCardsMissing(["deft"], "warn", holders, () => "Deft")).toEqual([]);
  });
});

describe("shared domain cards: the server", () => {
  useAllowlist(EMAILS);

  it("Warn (the default) and Allow never refuse a card another character holds", async () => {
    const { p2, campaignId, setRule, sheetOf } = await setup();
    const brin = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Brin"), idempotencyKey: key() })).characterId;
    expect((await sheetOf(brin)).domainCards.owned).toEqual(STARTING);
    await setRule({ key: "sharedDomainCards", value: "allow" });
    await p2.mutation(api.characters.setStatus, { characterId: brin, status: "retired" });
    expect(await p2.mutation(api.characters.create, { campaignId, draft: draft("Cael"), idempotencyKey: key() })).toHaveProperty("characterId");
  });

  it("Refuse: creation is INVALID with a card another character holds; other cards are fine", async () => {
    const { p2, campaignId, setRule } = await setup();
    await setRule({ key: "sharedDomainCards", value: "refuse" });
    expect(await fail(p2.mutation(api.characters.create, { campaignId, draft: draft("Brin"), idempotencyKey: key() }))).toBe("INVALID");
    expect(await p2.mutation(api.characters.create, { campaignId, draft: draft("Brin", OTHER_STARTING), idempotencyKey: key() })).toHaveProperty("characterId");
  });

  it("Refuse: the Domain Deck's takeCard is INVALID for another character's card", async () => {
    const { p2, campaignId, mira, setRule, patch } = await setup();
    const brin = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Brin", OTHER_STARTING), idempotencyKey: key() })).characterId;
    const shared = cardOf("blade", 2);
    await patch(mira, (s) => ({ level: 3, domainCards: { owned: [...s.domainCards.owned, shared], loadout: s.domainCards.loadout } }));
    await patch(brin, () => ({ level: 3 }));
    await setRule({ key: "sharedDomainCards", value: "refuse" });
    expect(await fail(p2.mutation(api.characters.takeCard, { characterId: brin, cardId: shared }))).toBe("INVALID");
    await p2.mutation(api.characters.takeCard, { characterId: brin, cardId: cardOf("blade", 2, 1) });
    await setRule({ key: "sharedDomainCards", value: "warn" });
    await p2.mutation(api.characters.takeCard, { characterId: brin, cardId: shared });
  });

  it("Refuse: a level-up gaining another character's card is LEVEL_UP_RULE", async () => {
    const { gm, p2, campaignId, mira, setRule, patch } = await setup();
    const brin = (await p2.mutation(api.characters.create, { campaignId, draft: draft("Brin", OTHER_STARTING), idempotencyKey: key() })).characterId;
    const shared = cardOf("blade", 2);
    await patch(mira, (s) => ({ domainCards: { owned: [...s.domainCards.owned, shared], loadout: s.domainCards.loadout } }));
    await setRule({ key: "sharedDomainCards", value: "refuse" });
    const choice = { picks: [{ option: "hp" as const, tier: 2 }, { option: "stress" as const, tier: 2 }], experienceName: "Bare Knuckles", cardId: shared };
    expect(await fail(gm.mutation(api.levelUp.apply, { characterId: brin, choice, idempotencyKey: key() }))).toBe("LEVEL_UP_RULE");
    expect(await gm.mutation(api.levelUp.apply, { characterId: brin, choice: { ...choice, cardId: cardOf("blade", 2, 1) }, idempotencyKey: key() })).toEqual({ level: 2 });
  });
});
