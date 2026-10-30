import { describe, expect, it } from "vitest";

import { experienceBonus, experienceValue, holdsPurposefulDesign, PURPOSEFUL_DESIGN_ID } from "@/lib/domain/dice";
import { ANCESTRY_CORE_EFFECTS } from "@/lib/srd/feature-effects/ancestry-core";
import { characterSheetSchema, experienceSchema } from "@/lib/validation/characters";

// DA11 (dcm-bxp.99.19.18). Purposeful Design, CB p.53 Clank: "At character creation, choose one of your Experiences that
// best aligns with this purpose and gain a permanent +1 bonus to it." User 2026-10-29: the sheet records the chosen
// Experience and adds +1 automatically; the stored value is never bumped.

const experiences = [
  { id: "a", name: "Sellsword", value: 2 },
  { id: "b", name: "Tinker", value: 2, purposefulDesign: true as const },
];

describe("Purposeful Design: the +1", () => {
  it("experienceValue adds +1 only to the recorded Experience", () => {
    expect(experienceValue(experiences[0]!)).toBe(2);
    expect(experienceValue(experiences[1]!)).toBe(3);
  });

  it("experienceBonus (every roll) adds it; the Hope cost is unchanged", () => {
    expect(experienceBonus(experiences, ["b"])).toEqual({ value: 3, hope: 1, names: ["Tinker"] });
    expect(experienceBonus(experiences, ["a", "b"])).toEqual({ value: 5, hope: 2, names: ["Sellsword", "Tinker"] });
    expect(experienceBonus(experiences, ["a"]).value).toBe(2);
  });

  it("the field is optional: Experiences stored before it parse unchanged, and only `true` is accepted", () => {
    expect(experienceSchema.parse({ id: "a", name: "Sellsword", value: 2 })).toEqual({ id: "a", name: "Sellsword", value: 2 });
    expect(experienceSchema.parse(experiences[1])).toEqual(experiences[1]);
    expect(experienceSchema.safeParse({ ...experiences[0], purposefulDesign: false }).success).toBe(false);
    expect(characterSheetSchema.shape.experiences.parse(experiences)).toEqual(experiences);
  });
});

describe("Purposeful Design: who holds it", () => {
  it("a Clank, and a mixed ancestry whose first feature is the Clank's (CB p.71)", () => {
    expect(holdsPurposefulDesign({ kind: "single", id: "clank" })).toBe(true);
    expect(holdsPurposefulDesign({ kind: "single", id: "dwarf" })).toBe(false);
    expect(holdsPurposefulDesign({ kind: "mixed", first: "clank", second: "elf", name: "" })).toBe(true);
    expect(holdsPurposefulDesign({ kind: "mixed", first: "elf", second: "clank", name: "" })).toBe(false);
  });

  it("a Shapeshifter whose chosen form feature is Purposeful Design, with Hope & Fear on", () => {
    const shape = { kind: "shapeshifter" as const, form: "clank", feature: "Purposeful Design" };
    expect(holdsPurposefulDesign(shape)).toBe(true);
    expect(holdsPurposefulDesign({ ...shape, feature: "Efficient" })).toBe(false);
  });

  it("the ancestry-core entry is no longer a reminder: no manual step", () => {
    const entry = ANCESTRY_CORE_EFFECTS.find((e) => e.featureId === PURPOSEFUL_DESIGN_ID)!;
    expect(entry.uses).toHaveLength(1);
    expect(entry.uses[0]!.activation).toEqual({ kind: "passive" });
    expect(entry.uses[0]!.steps ?? []).toEqual([]);
  });
});
