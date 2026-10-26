// Hope & Fear class features through Convex (D5 T8c): Favor spend, the Brawler crit, Commune's long-rest reset. Tribute is a rest move (rest tests).
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { ARMOR, ANCESTRIES, COMMUNITIES, cardsForDomains, getClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { errorCode, key, setupWithCampaign, useAllowlist } from "./helpers";

const SUBCLASS = { brawler: "juggernaut", warlock: "pact-of-the-endless", witch: "hedge" } as const;

/** A level-1 draft: Presence +2 (warlock Spellcast), Knowledge +1 (hedge witch Spellcast). */
function draft(classId: keyof typeof SUBCLASS, name: string) {
  const cls = getClass(classId)!;
  return {
    classId,
    subclassId: SUBCLASS[classId],
    ancestry: { kind: "single", id: ANCESTRIES.find((a) => a.source === "core")!.id },
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 0, strength: 1, finesse: 0, instinct: -1, presence: 2, knowledge: 1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId:
      classId === "brawler" ? "brawler-s-strike" : WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
    connections: [],
  };
}

async function setup() {
  const { t, gm, campaignId } = await setupWithCampaign();
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const create = async (classId: keyof typeof SUBCLASS, name: string) =>
    (await gm.mutation(api.characters.create, { campaignId, draft: draft(classId, name), idempotencyKey: key() })).characterId;
  const sheetOf = (id: Id<"characters">) => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const patch = (id: Id<"characters">, change: Partial<CharacterSheet>) =>
    t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...change }));
  const use = (characterId: Id<"characters">, featureKey: string) => gm.mutation(api.classFeatures.use, { characterId, featureKey, params: {}, idempotencyKey: key() });
  return { t, gm, campaignId, create, sheetOf, patch, use };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return errorCode(e);
  }
}

const NO_DUALITY = { modifier: 0, experienceIds: [] as string[], advantage: 0, disadvantage: 0, help: 0, attack: false };

describe("Hope & Fear class features", () => {
  useAllowlist();

  it("Warlock: a Favor pays for the Patron Die, the next action roll adds it; tribute is no class action (it is a rest move)", async () => {
    const { gm, create, sheetOf, use } = await setup();
    const w = await create("warlock", "Mor");

    await use(w, "patronsPact");
    let sheet = await sheetOf(w);
    expect(sheet.classState.favor).toBe(2);
    expect(sheet.heldDice).toEqual([{ id: "patron-die", kind: "patron", sides: 6, until: "manual" }]);
    expect(await codeOf(use(w, "patronsPact"))).toBe("CLASS_FEATURE_RULE");

    const { roll } = await gm.mutation(api.rolls.actionRoll, { characterId: w, kind: "action", trait: "presence", ...NO_DUALITY, options: ["patronDie"], idempotencyKey: key() });
    expect(roll.dice.filter((d) => d.role === "extra").map((d) => d.sides)).toEqual([6]);
    expect((await sheetOf(w)).heldDice).toEqual([]);

    expect(await codeOf(use(w, "tribute"))).toBe("CLASS_FEATURE_RULE");
    sheet = await sheetOf(w);
    expect(sheet.classState.favor).toBe(2);
  });

  it("Warlock: Favor reads 3 before it is set and is spent down to none", async () => {
    const { create, patch, sheetOf, use } = await setup();
    const w = await create("warlock", "Mor");
    expect((await sheetOf(w)).classState.favor).toBeUndefined();
    await patch(w, { classState: { favor: 0 } });
    expect(await codeOf(use(w, "patronsPact"))).toBe("CLASS_FEATURE_RULE");
  });

  it("Brawler: Brawler's Strike rolls Proficiency d8 + d6, and a critical adds 14 × Proficiency to the roll", async () => {
    const { gm, create, patch } = await setup();
    const b = await create("brawler", "Knuckles");
    await patch(b, { proficiency: 2 });
    const args = { characterId: b, values: [3, 5, 2, 1] };
    const crit = await gm.mutation(api.rolls.manualRoll, {
      ...args,
      roll: { kind: "damage", source: { kind: "override", key: "brawlersStrike" }, critical: true, modifier: 0, options: [] },
      idempotencyKey: key(),
    });
    expect(crit.roll.dice.map((d) => d.sides)).toEqual([8, 8, 6, 6]);
    expect(crit.roll.total).toBe(28 + 11);
    const normal = await gm.mutation(api.rolls.manualRoll, {
      ...args,
      roll: { kind: "damage", source: { kind: "override", key: "brawlersStrike" }, critical: false, modifier: 0, options: [] },
      idempotencyKey: key(),
    });
    expect(normal.roll.total).toBe(11);

    // Combo Strike adds its chain to that damage roll, marking a Stress.
    const combo = await gm.mutation(api.classFeatures.use, { characterId: b, featureKey: "comboStrike", params: {}, idempotencyKey: key() });
    expect(combo.roll!.total).toBeGreaterThan(11);
    expect(combo.roll!.dice.filter((d) => d.role === "extra").length).toBeGreaterThanOrEqual(2);
    expect(await gm.query(api.classFeatures.lastRoll, { characterId: b })).toEqual(combo.roll);
  });

  it("Hope & Fear class features are refused while the option is off", async () => {
    const { gm, campaignId, create, use } = await setup();
    const b = await create("brawler", "Knuckles");
    await gm.mutation(api.rolls.manualRoll, {
      characterId: b,
      values: [4, 4],
      roll: { kind: "damage", source: { kind: "override", key: "brawlersStrike" }, critical: false, modifier: 0, options: [] },
      idempotencyKey: key(),
    });
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: false });
    expect(await codeOf(use(b, "comboStrike"))).toBe("CLASS_FEATURE_RULE");
  });

  it("Witch: Commune once per long rest; a short rest does not reset it, a long rest does", async () => {
    const { gm, campaignId, create, sheetOf, use } = await setup();
    const w = await create("witch", "Hazel");
    const result = await use(w, "commune");
    expect(result.roll).toEqual(expect.objectContaining({ kind: "free" }));
    expect(result.roll!.dice).toHaveLength(1); // Knowledge +1
    expect(await codeOf(use(w, "commune"))).toBe("CLASS_FEATURE_RULE");

    const rest = async (kind: "short" | "long") => {
      const { restId } = await gm.mutation(api.rests.start, { campaignId, kind, idempotencyKey: key() });
      await gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
    };
    await rest("short");
    expect(await codeOf(use(w, "commune"))).toBe("CLASS_FEATURE_RULE");
    await rest("long");
    expect((await sheetOf(w)).featureUses).toEqual([]);
    expect(await codeOf(use(w, "commune"))).toBe("ok");
  });

  it("Witch: Hex marks a Stress, and a rest clears the Hexes", async () => {
    const { gm, campaignId, create, sheetOf, use } = await setup();
    const w = await create("witch", "Hazel");
    await use(w, "hex");
    let sheet = await sheetOf(w);
    expect(sheet.classState.hexes).toEqual(["Target 1"]);
    expect(sheet.stress).toBe(1);
    expect(await codeOf(use(w, "hex"))).toBe("CLASS_FEATURE_RULE"); // Knowledge +1: one Hex at a time
    const { restId } = await gm.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: key() });
    await gm.mutation(api.rests.finish, { campaignId, restId, idempotencyKey: key() });
    sheet = await sheetOf(w);
    expect(sheet.classState.hexes).toBeUndefined();
  });
});
