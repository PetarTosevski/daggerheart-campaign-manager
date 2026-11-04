import { describe, expect, it } from "vitest";

import { derivedDefense, derivedThresholds, derivedTraits, subclassBonuses } from "@/lib/domain/characters/derived";

// Chainmail Armor: base thresholds 7 / 15, Armor Score 4 (CB 126).
const guardian = { level: 5, armorId: "chainmail-armor", subclassId: "stalwart" } as const;

describe("derivedThresholds: Stalwart (CB 36)", () => {
  it("foundation, Unwavering: +1 to both thresholds", () => {
    expect(derivedThresholds({ ...guardian, subclassRank: "foundation" })).toEqual({ major: 13, severe: 21 });
  });

  it("specialization adds Unrelenting +2 (total +3)", () => {
    expect(derivedThresholds({ ...guardian, subclassRank: "specialization" })).toEqual({ major: 15, severe: 23 });
  });

  it("mastery adds Undaunted +3 (total +6)", () => {
    expect(derivedThresholds({ ...guardian, subclassRank: "mastery" })).toEqual({ major: 18, severe: 26 });
  });

  it("a missing rank counts as foundation; unarmored uses level and 2 x level", () => {
    expect(derivedThresholds({ level: 3, subclassId: "stalwart" })).toEqual({ major: 4, severe: 7 });
  });

  it("a Stalwart foundation taken through multiclass also counts", () => {
    const wizard = { level: 5, armorId: "chainmail-armor", subclassId: "school-of-war", subclassRank: "specialization" as const };
    expect(derivedThresholds(wizard)).toEqual({ major: 12, severe: 20 });
    expect(derivedThresholds({ ...wizard, multiclass: { classId: "guardian", domainId: "valor", subclassId: "stalwart" } })).toEqual({ major: 13, severe: 21 });
  });
});

describe("other always-on subclass bonuses", () => {
  it("Juggernaut Rugged: +3 Severe only (HF 10)", () => {
    expect(derivedThresholds({ level: 1, armorId: "chainmail-armor", subclassId: "juggernaut" })).toEqual({ major: 8, severe: 19 });
  });

  it("Winged Sentinel Ascendant: +4 Severe at mastery only (CB 45)", () => {
    const seraph = { level: 8, armorId: "chainmail-armor", subclassId: "winged-sentinel" };
    expect(derivedThresholds({ ...seraph, subclassRank: "specialization" })).toEqual({ major: 15, severe: 23 });
    expect(derivedThresholds({ ...seraph, subclassRank: "mastery" })).toEqual({ major: 15, severe: 27 });
  });

  it("Nightwalker Fleeting Shadow: +1 Evasion at mastery (CB 42)", () => {
    const rogue = { evasion: 12, primaryWeaponId: "dagger", subclassId: "nightwalker" };
    expect(derivedDefense({ ...rogue, subclassRank: "specialization" }).evasion).toBe(12);
    const mastered = derivedDefense({ ...rogue, subclassRank: "mastery" });
    expect(mastered.evasion).toBe(13);
    expect(mastered.subclassEvasion).toBe(1);
  });

  it("Brawler's Strike as the only weapon adds +1 Evasion (HF 10, I Am the Weapon); not with a secondary weapon", () => {
    const brawler = { evasion: 10, primaryWeaponId: "brawler-s-strike", classId: "brawler", proficiency: 1, subclassId: "juggernaut" };
    expect(derivedDefense(brawler).evasion).toBe(11);
    expect(derivedDefense({ ...brawler, secondaryWeaponId: "small-dagger" }).evasion).toBe(10);
    // Without the class (a partial sheet) no override is asked for.
    expect(derivedDefense({ evasion: 10, primaryWeaponId: "brawler-s-strike" }).evasion).toBe(10);
  });

  it("subclasses without numeric features add nothing", () => {
    expect(subclassBonuses({ subclassId: "vengeance", subclassRank: "mastery" })).toEqual({ thresholds: 0, severe: 0, evasion: 0 });
  });
});

// DA9 (B1, user 2026-10-29; dcm-bxp.99.19.19): a Beastform's trait and Evasion come from the drawer's table through
// passiveMods, not from D5's effect. CB p.30: "add their Evasion bonus to your Evasion, and use the trait specified in
// their statistics"; CB p.32 Pack Predator: "Strength +2 | Evasion +1".
describe("derived stats in Beastform (DA9, B1)", () => {
  const traits = { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 };
  const form = (mods?: { evasion: number; trait: { id: "strength"; delta: number } }) => ({
    evasion: 10,
    primaryWeaponId: "dagger",
    traits,
    level: 1,
    classId: "druid",
    subclassId: "warden-of-the-elements",
    effects: [{ id: "beastform", source: "Beastform", text: "Pack Predator: +1 Evasion, +2 strength. Can't use weapons …", until: "manual" as const, ...(mods ? { mods } : {}) }],
  });

  it("derivedDefense adds the form's Evasion and derivedTraits its trait, once", () => {
    expect(derivedDefense(form()).evasion).toBe(11);
    expect(derivedTraits(form()).strength).toBe(3);
    expect(derivedTraits(form()).agility).toBe(2);
  });

  it("an older effect that still carries the mods: derivedDefense and derivedTraits add nothing more", () => {
    const old = form({ evasion: 1, trait: { id: "strength", delta: 2 } });
    // withEffects (not called here) adds the effect's own mods; the table's stat line is skipped.
    expect(derivedDefense(old).evasion).toBe(10);
    expect(derivedTraits(old).strength).toBe(1);
  });

  it("without a Beastform nothing changes", () => {
    expect(derivedTraits({ traits, level: 1, classId: "druid", subclassId: "warden-of-the-elements", effects: [] })).toEqual(traits);
  });
});
