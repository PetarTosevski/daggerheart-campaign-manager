// DA9 (plan drawer-answers, beads dcm-bxp.99.19.6 and dcm-bxp.99.19.19; docs/tasks/TASK-DA-DA9.md) through Convex: the
// Party sheet's Beastform (`classFeatures.use`) still transforms, carries no mods (B1, user 2026-10-29: the drawer's table
// owns the form's trait and Evasion), the drawer holds the form's attack and statistics line, Evolved and Hybrid forms hold
// the right features, and a Hybrid marks its additional Stress. Book: CB p.30 Beastform ("add their Evasion bonus to your
// Evasion, and use the trait specified in their statistics"), CB p.32 Agile Scout ("Agility +1 | Evasion +2"), CB p.34
// Legendary Beast ("retain all traits and features from the original form … +2 bonus to Evasion"), Legendary Hybrid
// ("mark an additional Stress … two features from those options"). Role checks: tests/convex/authz/features.entries.ts.
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { pcCombatant } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { derivedTraits } from "../../src/lib/domain/characters/derived";
import { withEffects } from "../../src/lib/domain/characters/effects";
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
  await t.run(async (ctx) => saveSheet(ctx, id, { ...readSheet((await ctx.db.get("characters", id))!.sheet), ...change }));
  const transform = (choice: string) => gm.mutation(api.classFeatures.use, { characterId: id, featureKey: "beastform", params: { choice }, idempotencyKey: key() });
  const drawer = () => gm.query(api.combatFeatures.drawer, { campaignId, characterId: id });
  return { t, gm, id, sheet, transform, drawer };
}

const evasionOf = (sheet: CharacterSheet): number => pcCombatant("pc", sheet).evasion ?? 0;

describe("DA9: Beastform integration through Convex", { timeout: 60_000 }, () => {
  useAllowlist();

  it("B1: the sheet's Beastform marks a Stress and adds no mods; the table adds Evasion +2 and Agility +1 once", async () => {
    const env = await setup({ stress: 0 });
    const before = await env.sheet();
    await env.transform("agile-scout");
    const after = await env.sheet();
    expect(after.stress).toBe(1);
    const effect = after.effects.find((e) => e.id === "beastform")!;
    expect(effect.mods).toBeUndefined();
    expect(evasionOf(after)).toBe(evasionOf(before) + 2);
    expect(derivedTraits(withEffects(after)).agility).toBe(before.traits.agility + 1);
    const ids = (await env.drawer()).features.map((f) => f.featureId);
    expect(ids).toEqual(expect.arrayContaining(["beastform:agile-scout:attack", "beastform:agile-scout:agile", "beastform:agile-scout:fragile"]));

    // The Party sheet's End drops out: the bonus goes with it.
    await env.gm.mutation(api.classFeatures.endEffect, { characterId: env.id, effectId: "beastform", idempotencyKey: key() });
    expect(evasionOf(await env.sheet())).toBe(evasionOf(before));
  });

  it("an older sheet whose Beastform effect carries the mods counts them once", async () => {
    const env = await setup({});
    const base = evasionOf(await env.sheet());
    await env.t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", env.id))!.sheet);
      await saveSheet(ctx, env.id, { ...s, effects: [{ id: "beastform", source: "Beastform", text: "Agile Scout: +2 Evasion, +1 agility.", until: "manual", mods: { evasion: 2, trait: { id: "agility", delta: 1 } } }] });
    });
    expect(evasionOf(await env.sheet())).toBe(base + 2);
  });

  it("Legendary Beast upgrading Agile Scout holds the Agile Scout's features; Evasion +2 +2", async () => {
    const env = await setup({ level: 5, stress: 0 });
    const base = evasionOf(await env.sheet());
    await env.transform("legendary-beast/agile-scout");
    const after = await env.sheet();
    expect(evasionOf(after)).toBe(base + 4);
    const ids = (await env.drawer()).features.map((f) => f.featureId);
    expect(ids).toEqual(expect.arrayContaining(["beastform:legendary-beast:attack", "beastform:legendary-beast:evolved", "beastform:agile-scout:agile"]));
  });

  it("Legendary Hybrid marks 1 additional Stress and holds the chosen features", async () => {
    const env = await setup({ level: 5, stress: 0 });
    await env.transform("legendary-hybrid/agile-scout:agile+armored-sentry:cannonball");
    expect((await env.sheet()).stress).toBe(2);
    const ids = (await env.drawer()).features.filter((f) => f.source === "beastform").map((f) => f.featureId);
    expect(ids).toEqual(["beastform:legendary-hybrid:attack", "beastform:legendary-hybrid:hybrid-features", "beastform:agile-scout:agile", "beastform:armored-sentry:cannonball"]);
  });
});
