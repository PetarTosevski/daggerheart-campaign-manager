import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import { ARMOR, cardsForDomains, COMMUNITIES, getClass, WEAPONS } from "../../src/lib/srd/index";
import type { Id } from "../../convex/_generated/dataModel";
import type { CharacterDraft } from "../../src/lib/validation/characters";
import { key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

function draft(classId: string, subclassId: string, ancestry: CharacterDraft["ancestry"]) {
  const cls = getClass(classId)!;
  const cards = cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id);
  const primary = WEAPONS.find((w) => w.slot === "primary" && w.tier === 1 && w.source === "core" && w.category === "physical" && !w.classId)!;
  return {
    classId,
    subclassId,
    ancestry,
    communityId: COMMUNITIES.find((c) => c.source === "core")!.id,
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name: "Ash",
    pronouns: "",
    description: "",
    primaryWeaponId: primary.id,
    armorId: ARMOR.find((a) => a.source === "core" && a.tier === 1)!.id,
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cards,
    connections: [],
  };
}

async function setup() {
  const t = makeTest();
  const gmId = await t.run((ctx) => ctx.db.insert("users", { email: "gm@example.com" }));
  const gm = t.withIdentity({ subject: `${gmId}|s` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Party", idempotencyKey: key() });
  const create = async (d: ReturnType<typeof draft>) => (await gm.mutation(api.characters.create, { campaignId, draft: d, idempotencyKey: key() })).characterId;
  const stored = (id: Id<"characters">) => t.run(async (ctx) => (await ctx.db.get(id))!.sheet);
  return { t, gm, gmId, campaignId, create, stored };
}

describe("feature slots (SS1)", () => {
  useAllowlist("gm@example.com");
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("characters.create adds the subclass and ancestry slots, mixed ancestry included", async () => {
    const { gm, create, stored } = await setup();
    const wizard = getClass("wizard")!;
    const war = await create(draft("wizard", "school-of-war", { kind: "single", id: "giant" }));
    expect((await gm.query(api.characters.get, { characterId: war }))!.sheet).toMatchObject({ hpMax: wizard.startingHp + 2, stressMax: 6 });
    expect(await stored(war)).toMatchObject({ slotBonuses: ["subclass:school-of-war", "ancestry:giant:0"] });

    const guardian = getClass("guardian")!;
    const vengeance = await create(draft("guardian", "vengeance", { kind: "mixed", first: "human", second: "giant", name: "" }));
    // Human's first feature (High Stamina) only; Giant's second feature is Reach.
    expect((await gm.query(api.characters.get, { characterId: vengeance }))!.sheet).toMatchObject({ hpMax: guardian.startingHp, stressMax: 8 });

    const plain = await create(draft("wizard", "school-of-knowledge", { kind: "single", id: "elf" }));
    expect((await gm.query(api.characters.get, { characterId: plain }))!.sheet).toMatchObject({ hpMax: wizard.startingHp, stressMax: 6 });
    expect(await stored(plain)).not.toHaveProperty("slotBonuses");
  });

  it("migrations/slotBonuses:applySlotBonuses adds missing bonuses once; imported characters only record them", async () => {
    const { t, gmId, campaignId, create, stored } = await setup();
    const wizard = getClass("wizard")!;
    const created = await create(draft("wizard", "school-of-war", { kind: "single", id: "human" }));
    const imported = await create(draft("wizard", "school-of-war", { kind: "single", id: "giant" }));
    // Rewrite both as sheets stored before SS1: no slotBonuses, starting maximums.
    await t.run(async (ctx) => {
      for (const id of [created, imported]) {
        const { slotBonuses: _bonuses, ...sheet } = (await ctx.db.get(id))!.sheet;
        void _bonuses;
        await ctx.db.patch(id, { sheet: { ...sheet, hpMax: wizard.startingHp, stressMax: 6 } });
      }
      await ctx.db.insert("actionLog", { campaignId, characterId: imported, actorId: gmId, kind: "import", visibility: "public", summary: "Imported", undoable: false, at: 1 });
    });

    await t.mutation(internal.migrations.slotBonuses.applySlotBonuses, { batchSize: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const once = await stored(created);
    expect(once).toMatchObject({ hpMax: wizard.startingHp + 1, stressMax: 7, slotBonuses: ["subclass:school-of-war", "ancestry:human:0"] });
    expect(await stored(imported)).toMatchObject({ hpMax: wizard.startingHp, stressMax: 6, slotBonuses: ["subclass:school-of-war", "ancestry:giant:0"] });

    await t.mutation(internal.migrations.slotBonuses.applySlotBonuses, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await stored(created)).toEqual(once);
  });
});
