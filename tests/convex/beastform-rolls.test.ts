// DA19 (plan drawer-answers, bead dcm-bxp.99.19.19 regression; docs/tasks/TASK-DA-DA19.md): a Beastform's trait bonus
// reaches every roll path, and under an Evolved form the drawer lists and the runner accepts only the uses keyed by its
// base form. Book: CB p.30 Beastform ("use the trait specified in their statistics"), CB p.32 Agile Scout ("Agility +1"),
// CB p.34 Legendary Beast ("Pick a Tier 1 Beastform option … A +1 bonus to the trait used by this form").
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { cardActor } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { pickFeature } from "../../convex/lib/featureRunner";
import { prepareDuality } from "../../convex/lib/rolls";
import { ANCESTRIES, ARMOR, COMMUNITIES, cardsForDomains, getClass, WEAPONS } from "../../src/lib/srd/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { key, setupWithCampaign, useAllowlist } from "./helpers";

function draft(name: string) {
  const cls = getClass("druid")!;
  return {
    classId: cls.id,
    subclassId: "warden-of-the-elements",
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
    experiences: ["Wilds", "Herbs"],
    domainCards: cardsForDomains(cls.domains, 1).filter((c) => c.level === 1).slice(0, 2).map((c) => c.id),
    connections: [],
  };
}

async function setup(change: Partial<CharacterSheet>) {
  const { t, gm, campaignId } = await setupWithCampaign();
  const id = (await gm.mutation(api.characters.create, { campaignId, draft: draft("Moss"), idempotencyKey: key() })).characterId;
  const sheet = () => t.run(async (ctx) => readSheet((await ctx.db.get("characters", id))!.sheet));
  const campaign = () => t.run(async (ctx) => (await ctx.db.get("campaigns", campaignId))!);
  await t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...change }));
  const transform = (choice: string) => gm.mutation(api.classFeatures.use, { characterId: id, featureKey: "beastform", params: { choice }, idempotencyKey: key() });
  const drawer = () => gm.query(api.combatFeatures.drawer, { campaignId, characterId: id });
  const agilityRoll = async () =>
    (
      await gm.mutation(api.rolls.actionRoll, {
        characterId: id,
        kind: "action",
        trait: "agility",
        modifier: 0,
        experienceIds: [],
        advantage: 0,
        disadvantage: 0,
        help: 0,
        attack: false,
        options: [],
        idempotencyKey: key(),
      })
    ).roll.modifier;
  return { t, gm, id, sheet, campaign, transform, drawer, agilityRoll };
}

const SCOPE = { hopeAndFear: false, ikonis: false };
const agilityArgs = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: true, options: [] };

describe("DA19: a Beastform's trait bonus reaches the rolls", { timeout: 60_000 }, () => {
  useAllowlist();

  it("Agile Scout: Agility +1 in the dice box, the map attack's Duality input and the drawer's actor", async () => {
    const env = await setup({ stress: 0 });
    const before = await env.sheet();
    const dice = await env.agilityRoll();
    await env.transform("agile-scout");
    const after = await env.sheet();

    // The dice box / sheet roll (rolls.actionRoll → prepareDuality).
    expect(await env.agilityRoll()).toBe(dice + 1);
    // The map attack goes through prepareDuality too (combatActions.attack).
    expect(prepareDuality(after, agilityArgs, SCOPE, null).input.trait).toBe(before.traits.agility + 1);
    // The drawer's form attack and every card / feature run read cardActor.
    expect(cardActor("pc", after, "", undefined).traits.agility).toBe(before.traits.agility + 1);
    expect(cardActor("pc", before, "", undefined).traits.agility).toBe(before.traits.agility);

    // Dropping out takes the bonus with it.
    await env.gm.mutation(api.classFeatures.endEffect, { characterId: env.id, effectId: "beastform", idempotencyKey: key() });
    expect(await env.agilityRoll()).toBe(dice);
  });

  it("an older sheet whose Beastform effect carries the mods rolls the bonus once", async () => {
    const env = await setup({});
    const base = (await env.sheet()).traits.agility;
    await env.t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", env.id))!.sheet);
      await saveSheet(ctx, env.id, { ...s, effects: [{ id: "beastform", source: "Beastform", text: "Agile Scout: +2 Evasion, +1 agility.", until: "manual", mods: { evasion: 2, trait: { id: "agility", delta: 1 } } }] });
    });
    expect(cardActor("pc", await env.sheet(), "", undefined).traits.agility).toBe(base + 1);
  });

  it("Legendary Beast on Agile Scout: Agility +2; the drawer lists and the runner accepts only the Agile Scout uses", async () => {
    const env = await setup({ level: 5, stress: 0 });
    const base = (await env.sheet()).traits.agility;
    await env.transform("legendary-beast/agile-scout");
    const sheet = await env.sheet();
    expect(cardActor("pc", sheet, "", undefined).traits.agility).toBe(base + 2);

    const features = (await env.drawer()).features;
    const attack = features.find((f) => f.featureId === "beastform:legendary-beast:attack")!;
    expect(attack.uses.map((u) => u.useId)).toEqual(["agile-scout"]);
    const evolved = features.find((f) => f.featureId === "beastform:legendary-beast:evolved")!;
    expect(evolved.uses.map((u) => u.useId)).toEqual(["agile-scout"]);
    // The base form's own line keeps its statistics, not its attack.
    const baseLine = features.find((f) => f.featureId === "beastform:agile-scout:attack")!;
    expect(baseLine.uses.map((u) => u.useId).sort()).toEqual(["advantage", "form"]);

    const campaign = await env.campaign();
    const pick = (useId: string | undefined) => pickFeature({ sheet, campaign, featureId: "beastform:legendary-beast:attack", useId, times: 1, rollUsedExperience: false, party: [] });
    expect(pick("agile-scout").featureId).toBe("beastform:legendary-beast:attack");
    expect(pick(undefined).use.id).toBe("agile-scout");
    expect(() => pick("armored-sentry")).toThrowError(expect.objectContaining({ data: expect.objectContaining({ code: "INVALID" }) }));
  });
});
