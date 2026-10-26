import { describe, expect, it } from "vitest";

import { applySlotBonuses, FEATURE_SLOTS, gainSlotBonus, loseSlotBonus, slotBonusKeys } from "@/lib/domain/characters/slots";
import { getAncestry, getSubclass } from "@/lib/srd/index";
import type { CharacterSheet } from "@/lib/validation/characters";

type Sheet = Pick<CharacterSheet, "ancestry" | "subclassId" | "multiclass" | "hp" | "hpMax" | "stress" | "stressMax" | "slotBonuses">;

const sheet = (over: Partial<Sheet> = {}): Sheet => ({
  ancestry: { kind: "single", id: "dwarf" },
  subclassId: "call-of-the-brave",
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  ...over,
});

describe("FEATURE_SLOTS", () => {
  it("maps the four slot features to their slot, and each key names the feature that says so", () => {
    expect(FEATURE_SLOTS).toEqual({
      "subclass:vengeance": { stress: 1 },
      "subclass:school-of-war": { hp: 1 },
      "ancestry:giant:0": { hp: 1 },
      "ancestry:human:0": { stress: 1 },
    });
    expect(getSubclass("vengeance")?.foundation?.some((f) => f.name === "At Ease")).toBe(true);
    expect(getSubclass("school-of-war")?.foundation?.some((f) => f.name === "Battlemage")).toBe(true);
    expect(getAncestry("giant")?.features[0]?.text).toMatch(/additional Hit Point slot/);
    expect(getAncestry("human")?.features[0]?.text).toMatch(/additional Stress slot/);
  });
});

describe("slotBonusKeys", () => {
  it("finds the subclass, the multiclass foundation and the ancestry features", () => {
    expect(slotBonusKeys(sheet())).toEqual([]);
    expect(slotBonusKeys(sheet({ subclassId: "vengeance", ancestry: { kind: "single", id: "giant" } }))).toEqual(["subclass:vengeance", "ancestry:giant:0"]);
    expect(slotBonusKeys(sheet({ multiclass: { classId: "wizard", domainId: "codex", subclassId: "school-of-war" } }))).toEqual(["subclass:school-of-war"]);
  });

  it("a mixed ancestry has only the first feature of its first ancestry", () => {
    expect(slotBonusKeys(sheet({ ancestry: { kind: "mixed", first: "human", second: "elf", name: "" } }))).toEqual(["ancestry:human:0"]);
    expect(slotBonusKeys(sheet({ ancestry: { kind: "mixed", first: "elf", second: "giant", name: "" } }))).toEqual([]);
  });

  it("leaves a Shapeshifter's form feature out", () => {
    expect(slotBonusKeys(sheet({ ancestry: { kind: "shapeshifter", form: "giant", feature: "Endurance" } }))).toEqual([]);
  });
});

describe("gain, lose and apply", () => {
  it("gains a slot once and records it", () => {
    const once = gainSlotBonus(sheet(), "subclass:school-of-war");
    expect(once).toMatchObject({ hpMax: 7, stressMax: 6, slotBonuses: ["subclass:school-of-war"] });
    expect(gainSlotBonus(once, "subclass:school-of-war")).toBe(once);
    expect(gainSlotBonus(sheet(), "subclass:stalwart")).toEqual(sheet());
  });

  it("loses only an applied slot, keeping marks within the new maximum", () => {
    const gained = { ...gainSlotBonus(sheet(), "subclass:vengeance"), stress: 7 };
    expect(loseSlotBonus(gained, "subclass:vengeance")).toMatchObject({ stressMax: 6, stress: 6, slotBonuses: [] });
    expect(loseSlotBonus(sheet(), "subclass:vengeance")).toEqual(sheet());
  });

  it("applies every missing bonus and is idempotent", () => {
    const human = sheet({ subclassId: "vengeance", ancestry: { kind: "single", id: "human" } });
    const applied = applySlotBonuses(human);
    expect(applied).toMatchObject({ hpMax: 6, stressMax: 8, slotBonuses: ["subclass:vengeance", "ancestry:human:0"] });
    expect(applySlotBonuses(applied)).toEqual(applied);
  });
});
