import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, storedSheet } from "../../convex/lib/characterSheet";
import { ANCESTRIES, ARMOR, CLASSES, COMMUNITIES, DOMAIN_CARDS, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

// takeCard (DD1): the Domain Deck's "Take card". Warrior domains: blade and bone.

const EMAILS = "gm@example.com,p1@example.com,p2@example.com,out@example.com";

const cardOf = (domain: string, level: number, skip = 0) => DOMAIN_CARDS.filter((c) => c.domain === domain && c.level === level && c.source === "core")[skip]!.id;
const STARTING = [cardOf("blade", 1), cardOf("bone", 1)];

function draft(name: string) {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
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
    domainCards: STARTING,
    connections: [],
  };
}

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
  const characterId = (await p1.mutation(api.characters.create, { campaignId, draft: draft("Ash"), idempotencyKey: key() })).characterId;
  /** Rewrites the stored sheet (the way a level-up or GM correction would leave it). */
  const patch = (change: (s: CharacterSheet) => Partial<CharacterSheet>) =>
    t.run(async (ctx) => {
      const c = (await ctx.db.get("characters", characterId))!;
      const s = readSheet(c.sheet);
      await ctx.db.patch("characters", characterId, { sheet: storedSheet({ ...s, ...change(s) }), updatedAt: 0 });
    });
  const cards = async (id: Id<"characters"> = characterId) => (await gm.query(api.characters.get, { characterId: id }))!.sheet.domainCards;
  return { t, gm, p1, p2, out, campaignId, characterId, patch, cards };
}

const fail = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => errorCode(e));

describe("characters.takeCard", () => {
  useAllowlist(EMAILS);

  it("a level-1 character with two cards has no picks left", async () => {
    const { p1, characterId } = await setup();
    expect(await fail(p1.mutation(api.characters.takeCard, { characterId, cardId: cardOf("blade", 1, 1) }))).toBe("INVALID");
  });

  it("takes a card into the loadout while it has room, and bumps updatedAt (patch() zeroes it)", async () => {
    const { t, p1, characterId, patch, cards } = await setup();
    await patch(() => ({ level: 3 }));
    const card = cardOf("blade", 2);
    await p1.mutation(api.characters.takeCard, { characterId, cardId: card });
    expect(await cards()).toEqual({ owned: [...STARTING, card], loadout: [...STARTING, card] });
    expect((await t.run((ctx) => ctx.db.get("characters", characterId)))!.updatedAt).toBeGreaterThan(0);
  });

  it("puts the card into the vault when the loadout holds 5", async () => {
    const { p1, characterId, patch, cards } = await setup();
    const five = [cardOf("blade", 1), cardOf("bone", 1), cardOf("blade", 2), cardOf("bone", 2), cardOf("blade", 3)];
    await patch(() => ({ level: 6, domainCards: { owned: five, loadout: five } }));
    const card = cardOf("bone", 3);
    await p1.mutation(api.characters.takeCard, { characterId, cardId: card });
    expect(await cards()).toEqual({ owned: [...five, card], loadout: five });
  });

  it("counts additional domain card advancements as picks", async () => {
    const { p1, characterId, patch, cards } = await setup();
    // Level 2 allows 3 cards; one "additional domain card" pick makes it 4.
    await patch((s) => ({
      level: 2,
      domainCards: { owned: [...s.domainCards.owned, cardOf("blade", 1, 1)], loadout: s.domainCards.loadout },
      advancements: [{ level: 2, cardId: cardOf("blade", 1, 1), picks: [{ option: "domainCard", tier: 2, slot: 0, targets: [] }, { option: "hp", tier: 2, slot: 0 }] }],
    }));
    await p1.mutation(api.characters.takeCard, { characterId, cardId: cardOf("bone", 2) });
    expect((await cards()).owned).toHaveLength(4);
    expect(await fail(p1.mutation(api.characters.takeCard, { characterId, cardId: cardOf("blade", 2) }))).toBe("INVALID");
  });

  it("refuses unknown, owned, out-of-domain and above-level cards", async () => {
    const { p1, characterId, patch, cards } = await setup();
    await patch(() => ({ level: 3 }));
    const take = (cardId: string) => fail(p1.mutation(api.characters.takeCard, { characterId, cardId }));
    expect(await take("no-such-card")).toBe("INVALID");
    expect(await take(STARTING[0]!)).toBe("INVALID");
    expect(await take(cardOf("grace", 1))).toBe("INVALID");
    expect(await take(cardOf("blade", 4))).toBe("INVALID");
    expect(await cards()).toEqual({ owned: STARTING, loadout: STARTING });
  });

  it("reaches the multiclass domain at half the level, and only from the campaign's sources", async () => {
    const { gm, p1, characterId, campaignId, patch } = await setup();
    const hf = CLASSES.find((c) => c.domains.some((d) => d === "dread"))!;
    await patch(() => ({ level: 5, multiclass: { classId: hf.id, domainId: "dread", subclassId: subclassesForClass(hf.id)[0]!.id } }));
    const dread = (level: number) => DOMAIN_CARDS.find((c) => c.domain === "dread" && c.level === level)!.id;
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: false });
    expect(await fail(p1.mutation(api.characters.takeCard, { characterId, cardId: dread(1) }))).toBe("INVALID");
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
    // ceil(5 / 2) = 3: a level-4 Dread card is out of reach, a level-3 one is not.
    expect(await fail(p1.mutation(api.characters.takeCard, { characterId, cardId: dread(4) }))).toBe("INVALID");
    await p1.mutation(api.characters.takeCard, { characterId, cardId: dread(3) });
  });

  it("the GM takes for a player; another player is FORBIDDEN, an outsider NOT_FOUND, anonymous UNAUTHENTICATED", async () => {
    const { t, gm, p2, out, characterId, patch, cards } = await setup();
    await patch(() => ({ level: 2 }));
    const cardId = cardOf("bone", 2);
    expect(await fail(t.mutation(api.characters.takeCard, { characterId, cardId }))).toBe("UNAUTHENTICATED");
    expect(await fail(out.mutation(api.characters.takeCard, { characterId, cardId }))).toBe("NOT_FOUND");
    expect(await fail(p2.mutation(api.characters.takeCard, { characterId, cardId }))).toBe("FORBIDDEN");
    await gm.mutation(api.characters.takeCard, { characterId, cardId });
    expect((await cards()).owned).toContain(cardId);
  });
});
