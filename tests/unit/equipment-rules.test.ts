import { describe, expect, it } from "vitest";

import { assertEquipment, type EquipmentSheet } from "@/lib/equipment-rules";
import { RuleError } from "@/lib/errors/app-error";
import { sheetFromImport } from "@/lib/import/sheet";

const bard: EquipmentSheet = { level: 1, classId: "bard", subclassId: "troubadour", primaryWeaponId: "rapier", armorId: "gambeson-armor" };

function codeOf(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof RuleError) return error.code;
    throw error;
  }
}

describe("assertEquipment (one source for the server and the photo import)", () => {
  it("accepts a legal loadout", () => {
    expect(codeOf(() => assertEquipment(bard, false))).toBeNull();
    expect(codeOf(() => assertEquipment({ ...bard, secondaryWeaponId: "small-dagger" }, false))).toBeNull();
  });

  it("refuses a weapon above the character's tier, and allows it once the tier is reached (CB 109)", () => {
    expect(codeOf(() => assertEquipment({ ...bard, primaryWeaponId: "improved-broadsword" }, false))).toBe("INVALID");
    expect(codeOf(() => assertEquipment({ ...bard, level: 2, primaryWeaponId: "improved-broadsword" }, false))).toBeNull();
  });

  it("refuses a secondary with a two-handed primary, and a barehanded primary with any other weapon", () => {
    expect(codeOf(() => assertEquipment({ ...bard, primaryWeaponId: "battleaxe", secondaryWeaponId: "small-dagger" }, false))).toBe("INVALID");
    const brawler = { ...bard, classId: "brawler", subclassId: "juggernaut", primaryWeaponId: "brawler-s-strike", secondaryWeaponId: "small-dagger" };
    expect(codeOf(() => assertEquipment(brawler, true))).toBe("INVALID");
  });

  it("refuses Hope & Fear items when the campaign doesn't use them, and another class's weapon", () => {
    expect(codeOf(() => assertEquipment({ ...bard, primaryWeaponId: "katana" }, false))).toBe("INVALID");
    expect(codeOf(() => assertEquipment({ ...bard, primaryWeaponId: "katana" }, true))).toBeNull();
    expect(codeOf(() => assertEquipment({ ...bard, primaryWeaponId: "brawler-s-strike" }, true))).toBe("INVALID");
  });

  it("refuses unknown or too-high armor", () => {
    expect(codeOf(() => assertEquipment({ ...bard, armorId: "nope" }, false))).toBe("INVALID");
    expect(codeOf(() => assertEquipment({ ...bard, armorId: "improved-chainmail-armor" }, false))).toBe("INVALID");
  });

  it("treats an empty primary as the two-handed Ikonis in Motherboard (CB 301)", () => {
    expect(codeOf(() => assertEquipment({ ...bard, primaryWeaponId: "" }, false, { ikonis: true }))).toBeNull();
    expect(codeOf(() => assertEquipment({ ...bard, primaryWeaponId: "", secondaryWeaponId: "small-dagger" }, false, { ikonis: true }))).toBe("INVALID");
    expect(codeOf(() => assertEquipment({ ...bard, primaryWeaponId: "" }, false))).toBe("INVALID");
  });

  it("throws the caller's code", () => {
    expect(codeOf(() => assertEquipment({ ...bard, primaryWeaponId: "battleaxe", secondaryWeaponId: "small-dagger" }, false, { code: "PHOTO_IMPORT_RULE" }))).toBe(
      "PHOTO_IMPORT_RULE",
    );
  });
});

describe("sheetFromImport uses the shared equipment rules", () => {
  const draft = {
    name: "Liriel",
    pronouns: "",
    description: "",
    level: 1,
    classId: "bard",
    subclassId: "troubadour",
    ancestry: { kind: "single" as const, id: "elf" },
    communityId: "loreborne",
    traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
    evasion: 10,
    hpMax: 5,
    hp: 0,
    stressMax: 6,
    stress: 0,
    hope: 2,
    armorMarked: 0,
    proficiency: 1,
    primaryWeaponId: "battleaxe",
    secondaryWeaponId: "small-dagger",
    armorId: "gambeson-armor",
    inventory: [],
    gold: { handfuls: 1, bags: 0, chest: false },
    experiences: [],
    domainCards: [],
  };

  it("refuses a secondary with a two-handed primary as PHOTO_IMPORT_RULE", () => {
    expect(codeOf(() => sheetFromImport(draft, false, () => "x"))).toBe("PHOTO_IMPORT_RULE");
    expect(sheetFromImport({ ...draft, secondaryWeaponId: undefined }, false, () => "x").primaryWeaponId).toBe("battleaxe");
  });
});
