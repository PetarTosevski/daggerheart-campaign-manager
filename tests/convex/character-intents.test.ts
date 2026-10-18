import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, subclassesForClass, WEAPONS } from "../../src/lib/srd/index";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const EMAILS = "gm@example.com,p1@example.com,p2@example.com";

function draft() {
  const cls = getClass("warrior")!;
  return {
    classId: cls.id,
    subclassId: subclassesForClass("warrior")[0].id,
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name: "Ash",
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

/** A campaign with a GM and two players; p1 owns a fresh character. */
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
  const { characterId } = await p1.mutation(api.characters.create, { campaignId, draft: draft(), idempotencyKey: key() });
  const sheet = async () => (await gm.query(api.characters.get, { characterId }))!.sheet;
  return { t, gm, p1, p2, characterId, sheet };
}

describe("character intents", () => {
  useAllowlist(EMAILS);

  it("two intents built from the same stale snapshot both apply", async () => {
    const { gm, p1, characterId, sheet } = await setup();
    // Both the owner and the GM act on the sheet as they last saw it.
    const stale = await sheet();
    const [torch] = stale.inventory;
    const [first, second] = stale.experiences;

    // Stepper double click: two +1s from the same value give +2.
    await p1.mutation(api.characters.adjustGold, { characterId, coin: "handfuls", delta: 1 });
    await p1.mutation(api.characters.adjustGold, { characterId, coin: "handfuls", delta: 1 });
    // The owner and the GM edit different parts of the same lists.
    await p1.mutation(api.characters.addInventory, { characterId, name: "Lantern" });
    await gm.mutation(api.characters.removeInventory, { characterId, itemId: torch.id });
    await p1.mutation(api.characters.setExperience, { characterId, experienceId: first.id, value: 3 });
    await gm.mutation(api.characters.setExperience, { characterId, experienceId: second.id, name: "Locksmith" });
    // Traits are the GM's to correct (players change them through level-up).
    await gm.mutation(api.characters.setTrait, { characterId, trait: "agility", value: 3 });
    await gm.mutation(api.characters.setTrait, { characterId, trait: "knowledge", value: 0 });

    const now = await sheet();
    expect(now.gold.handfuls).toBe(stale.gold.handfuls + 2);
    const names = now.inventory.map((i) => i.name);
    expect(names).toContain("Lantern");
    expect(names).not.toContain("Torch");
    expect(now.inventory).toHaveLength(stale.inventory.length);
    expect(now.experiences).toEqual([
      { ...first, value: 3 },
      { ...second, name: "Locksmith" },
    ]);
    expect(now.traits).toMatchObject({ agility: 3, knowledge: 0, strength: 1 });
  });

  it("list items keep their ids across edits; removing a removed item is a no-op", async () => {
    const { p1, characterId, sheet } = await setup();
    const { itemId } = await p1.mutation(api.characters.addInventory, { characterId, name: "Rope" });
    const { experienceId } = await p1.mutation(api.characters.addExperience, { characterId, name: "Sailor" });
    const before = await sheet();
    expect(before.inventory.at(-1)).toEqual({ id: itemId, name: "Rope" });
    expect(before.experiences.at(-1)).toEqual({ id: experienceId, name: "Sailor", value: 2 });

    await p1.mutation(api.characters.removeInventory, { characterId, itemId });
    await p1.mutation(api.characters.removeInventory, { characterId, itemId });
    await p1.mutation(api.characters.removeExperience, { characterId, experienceId });
    await p1.mutation(api.characters.removeExperience, { characterId, experienceId });
    const after = await sheet();
    expect(after.inventory).toEqual(before.inventory.slice(0, -1));
    expect(after.experiences).toEqual(before.experiences.slice(0, -1));
    expect(errorCode(await p1.mutation(api.characters.setExperience, { characterId, experienceId, value: 1 }).catch((e) => e))).toBe("NOT_FOUND");
  });

  it("gold follows CB 104: 9 handfuls and 9 bags, a 10th rolls over, one chest at most", async () => {
    const { p1, characterId, sheet } = await setup();
    expect(await p1.mutation(api.characters.adjustGold, { characterId, coin: "bags", delta: -5 })).toEqual({ handfuls: 1, bags: 0, chest: false });
    // 1 + 8 = 9 handfuls; one more is a bag and clears the handfuls.
    expect(await p1.mutation(api.characters.adjustGold, { characterId, coin: "handfuls", delta: 8 })).toEqual({ handfuls: 9, bags: 0, chest: false });
    expect(await p1.mutation(api.characters.adjustGold, { characterId, coin: "handfuls", delta: 1 })).toEqual({ handfuls: 0, bags: 1, chest: false });
    // 1 + 9 bags = the chest.
    expect(await p1.mutation(api.characters.adjustGold, { characterId, coin: "bags", delta: 9 })).toEqual({ handfuls: 0, bags: 0, chest: true });
    expect(await p1.mutation(api.characters.adjustGold, { characterId, coin: "bags", delta: 9 })).toEqual({ handfuls: 0, bags: 9, chest: true });
    // A second chest isn't allowed: store gold first.
    expect(errorCode(await p1.mutation(api.characters.adjustGold, { characterId, coin: "bags", delta: 1 }).catch((e) => e))).toBe("INVALID");
    // A whole-sheet write is capped at 9 too.
    await p1.mutation(api.characters.updateSheet, { characterId, patch: { gold: { handfuls: 27, bags: 40, chest: true } } });
    expect((await sheet()).gold).toEqual({ handfuls: 9, bags: 9, chest: true });
    await p1.mutation(api.characters.setGoldChest, { characterId, chest: false });
    expect((await sheet()).gold).toEqual({ handfuls: 9, bags: 9, chest: false });
    expect(errorCode(await p1.mutation(api.characters.adjustGold, { characterId, coin: "bags", delta: 0.5 }).catch((e) => e))).toBe("INVALID");
  });

  it("intents validate their values", async () => {
    const { gm, p1, characterId } = await setup();
    const fails = async (run: () => Promise<unknown>) => errorCode(await run().then(() => null, (e) => e));
    expect(await fails(() => gm.mutation(api.characters.setTrait, { characterId, trait: "agility", value: 11 }))).toBe("INVALID");
    // A player can't set traits, directly or through updateSheet.
    expect(await fails(() => p1.mutation(api.characters.setTrait, { characterId, trait: "agility", value: 3 }))).toBe("FORBIDDEN");
    const traits = { agility: 3, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 };
    expect(await fails(() => p1.mutation(api.characters.updateSheet, { characterId, patch: { traits } }))).toBe("FORBIDDEN");
    expect(await fails(() => p1.mutation(api.characters.addInventory, { characterId, name: "  " }))).toBe("INVALID");
    expect(await fails(() => p1.mutation(api.characters.addExperience, { characterId, name: "x".repeat(81) }))).toBe("INVALID");
  });

  it("only the owner and the GM send intents; strangers get NOT_FOUND", async () => {
    const { t, p2, characterId } = await setup();
    expect(errorCode(await p2.mutation(api.characters.addInventory, { characterId, name: "Rope" }).catch((e) => e))).toBe("FORBIDDEN");
    expect(errorCode(await p2.mutation(api.characters.adjustGold, { characterId, coin: "bags", delta: 1 }).catch((e) => e))).toBe("FORBIDDEN");
    const strangerId = await t.run((ctx) => ctx.db.insert("users", { email: "x@example.com" }));
    process.env.ALLOWED_EMAILS = `${EMAILS},x@example.com`;
    const stranger = t.withIdentity({ subject: `${strangerId}|s` });
    expect(errorCode(await stranger.mutation(api.characters.setTrait, { characterId, trait: "agility", value: 1 }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorCode(await t.mutation(api.characters.setGoldChest, { characterId, chest: true }).catch((e) => e))).toBe("UNAUTHENTICATED");
  });

  it("intents on an unmigrated version 1 sheet address the ids its reads showed", async () => {
    const { t, p1, characterId, sheet } = await setup();
    await t.run(async (ctx) => {
      const c = (await ctx.db.get(characterId))!;
      const { schemaVersion: _version, ...rest } = c.sheet;
      void _version;
      await ctx.db.patch(characterId, { sheet: { ...rest, inventory: ["Torch", "Rope"], experiences: [{ name: "Sellsword", value: 2 }] } });
    });
    await p1.mutation(api.characters.removeInventory, { characterId, itemId: "inv-0" });
    await p1.mutation(api.characters.setExperience, { characterId, experienceId: "exp-0", value: 4 });
    const now = await sheet();
    expect(now.inventory).toEqual([{ id: "inv-1", name: "Rope" }]);
    expect(now.experiences).toEqual([{ id: "exp-0", name: "Sellsword", value: 4 }]);
    expect(await t.run(async (ctx) => (await ctx.db.get(characterId))!.sheet.schemaVersion)).toBe(2);
  });
});
