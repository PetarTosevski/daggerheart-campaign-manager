import { describe, expect, it } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import { multiclassSpellcastOption, spellcastTraitOf } from "@/lib/domain/characters/spellcast";
import { prayerDiceCount } from "@/lib/domain/class-features/classes/seraph";
import { warlockSpellcast } from "@/lib/domain/class-features/classes/warlock";
import { witchSpellcast } from "@/lib/domain/class-features/classes/witch";
import { assertEquipment, type EquipmentSheet } from "@/lib/equipment-rules";
import { RuleError } from "@/lib/errors/app-error";
import type { CharacterSheet } from "@/lib/validation/characters";

// SS2 (CB 111): the effective Spellcast trait with a multiclass, and every reader of it.

function sheetOf(classId: string, subclassId: string, multiclass?: CharacterSheet["multiclass"]): CharacterSheet {
  const sheet = readSheet({
    schemaVersion: 2,
    name: "Vex",
    pronouns: "",
    description: "",
    level: 5,
    classId,
    subclassId,
    ancestry: { kind: "single", id: "elf" },
    communityId: "wildborne",
    traits: { agility: 0, strength: 1, finesse: 3, instinct: 2, presence: 1, knowledge: 4 },
    traitMarks: {},
    evasion: 10,
    hpMax: 6,
    hp: 0,
    stressMax: 6,
    stress: 0,
    hope: 2,
    scars: 0,
    armorMarked: 0,
    proficiency: 1,
    primaryWeaponId: "dagger",
    inventory: [],
    gold: { handfuls: 1, bags: 0, chest: false },
    experiences: [],
    domainCards: { owned: [], loadout: [] },
    background: [],
    connections: [],
    notes: "",
  });
  return multiclass ? { ...sheet, multiclass } : sheet;
}

const codeOf = (run: () => void): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof RuleError) return error.code;
    throw error;
  }
};

describe("multiclassSpellcastOption", () => {
  it("is a choice when both subclasses have different traits, forced without an original, none otherwise", () => {
    expect(multiclassSpellcastOption("nightwalker", "school-of-knowledge")).toEqual({ kind: "choose", original: "finesse", added: "knowledge" });
    expect(multiclassSpellcastOption("call-of-the-brave", "school-of-knowledge")).toEqual({ kind: "forced", trait: "knowledge" });
    expect(multiclassSpellcastOption("nightwalker", "call-of-the-brave")).toEqual({ kind: "none", trait: "finesse" });
    expect(multiclassSpellcastOption("warden-of-renewal", "elemental-origin")).toEqual({ kind: "none", trait: "instinct" });
  });
});

describe("spellcastTraitOf", () => {
  const wizard = { classId: "wizard", domainId: "codex", subclassId: "school-of-knowledge" };

  it("is the own subclass's without a multiclass, null without one", () => {
    expect(spellcastTraitOf(sheetOf("rogue", "nightwalker"))).toBe("finesse");
    expect(spellcastTraitOf(sheetOf("warrior", "call-of-the-brave"))).toBeNull();
  });

  it("follows the multiclass choice", () => {
    expect(spellcastTraitOf(sheetOf("rogue", "nightwalker", { ...wizard, spellcastTrait: "knowledge" }))).toBe("knowledge");
    expect(spellcastTraitOf(sheetOf("rogue", "nightwalker", { ...wizard, spellcastTrait: "finesse" }))).toBe("finesse");
  });

  it("older multiclass data without a choice keeps the original; no original gives the new one", () => {
    expect(spellcastTraitOf(sheetOf("rogue", "nightwalker", wizard))).toBe("finesse");
    expect(spellcastTraitOf(sheetOf("warrior", "call-of-the-brave", wizard))).toBe("knowledge");
  });

  it("ignores a stored trait that is neither subclass's", () => {
    expect(spellcastTraitOf(sheetOf("rogue", "nightwalker", { ...wizard, spellcastTrait: "agility" }))).toBe("finesse");
  });
});

describe("readers of the effective trait", () => {
  it("magic weapons: a Warrior who multiclassed into a Spellcast subclass may wield them", () => {
    const warrior: EquipmentSheet = { level: 5, classId: "warrior", subclassId: "call-of-the-brave", primaryWeaponId: "arcane-gauntlets" };
    expect(codeOf(() => assertEquipment(warrior, false))).toBe("INVALID");
    expect(codeOf(() => assertEquipment({ ...warrior, multiclass: { classId: "wizard", domainId: "codex", subclassId: "school-of-knowledge" } }, false))).toBeNull();
  });

  it("warlock and witch read the chosen trait", () => {
    // Warlock (Presence 1) multiclassed into Hedge (Knowledge 4).
    const hedge = { classId: "witch", domainId: "dread", subclassId: "hedge" };
    expect(warlockSpellcast(sheetOf("warlock", "pact-of-the-endless", { ...hedge, spellcastTrait: "presence" }))).toBe(1);
    expect(warlockSpellcast(sheetOf("warlock", "pact-of-the-endless", { ...hedge, spellcastTrait: "knowledge" }))).toBe(4);
    expect(witchSpellcast(sheetOf("warlock", "pact-of-the-endless", { ...hedge, spellcastTrait: "knowledge" }))).toBe(4);
    expect(witchSpellcast(sheetOf("warlock", "pact-of-the-endless", { ...hedge, spellcastTrait: "presence" }))).toBe(1);
  });

  it("seraph Prayer Dice follow the chosen trait, and only for a Seraph", () => {
    // Seraph (Strength 1) multiclassed into Nightwalker (Finesse 3).
    const rogue = { classId: "rogue", domainId: "midnight", subclassId: "nightwalker" };
    expect(prayerDiceCount(sheetOf("seraph", "divine-wielder"))).toBe(1);
    expect(prayerDiceCount(sheetOf("seraph", "divine-wielder", { ...rogue, spellcastTrait: "finesse" }))).toBe(3);
    expect(prayerDiceCount(sheetOf("seraph", "divine-wielder", { ...rogue, spellcastTrait: "strength" }))).toBe(1);
    expect(prayerDiceCount(sheetOf("rogue", "nightwalker"))).toBe(0);
  });
});
