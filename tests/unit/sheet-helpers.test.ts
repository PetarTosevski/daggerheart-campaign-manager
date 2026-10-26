import { describe, expect, it } from "vitest";

import {
  ancestryArtId,
  ancestryLabel,
  heritageCards,
  pipDelta,
  planDamage,
  recallBlock,
  signed,
  thresholdRanges,
  vaultCardIds,
  weaponDamage,
} from "@/app/(gm)/campaigns/[campaignId]/party/[characterId]/sheet-helpers";
import { ANCESTRIES } from "@/lib/srd";

describe("weaponDamage", () => {
  it("uses Proficiency as the number of damage dice", () => {
    expect(weaponDamage("d8+1 phy", 1)).toBe("1d8+1 phy");
    expect(weaponDamage("d10+3 mag", 3)).toBe("3d10+3 mag");
    expect(weaponDamage("d6 phy", 2)).toBe("2d6 phy");
  });
  it("multiplies only the first die", () => {
    expect(weaponDamage("d8+d6 phy", 2)).toBe("2d8+d6 phy");
  });
});

describe("pipDelta", () => {
  it("marks up to the tapped slot", () => {
    expect(pipDelta(3, 0)).toBe(3);
    expect(pipDelta(5, 2)).toBe(3);
  });
  it("clears back to a lower slot", () => {
    expect(pipDelta(2, 4)).toBe(-2);
  });
  it("tapping the last marked slot clears it", () => {
    expect(pipDelta(4, 4)).toBe(-1);
    expect(pipDelta(1, 1)).toBe(-1);
  });
});

describe("thresholdRanges", () => {
  it("formats the three bands", () => {
    expect(thresholdRanges({ major: 5, severe: 10 })).toEqual({ minor: "1 – 4", major: "5 – 9", severe: "10+" });
  });
  it("handles a Major threshold of 1", () => {
    expect(thresholdRanges({ major: 1, severe: 2 }).minor).toBe("—");
  });
});

describe("planDamage", () => {
  const t = { major: 8, severe: 16 };
  it("maps damage to Hit Points", () => {
    expect(planDamage(0, t, false, 3)).toEqual({ severity: "none", marks: 0, armorUsed: false });
    expect(planDamage(5, t, false, 3)).toEqual({ severity: "minor", marks: 1, armorUsed: false });
    expect(planDamage(8, t, false, 3)).toEqual({ severity: "major", marks: 2, armorUsed: false });
    expect(planDamage(20, t, false, 3)).toEqual({ severity: "severe", marks: 3, armorUsed: false });
  });
  it("an Armor Slot drops severity by one threshold", () => {
    expect(planDamage(20, t, true, 1)).toEqual({ severity: "major", marks: 2, armorUsed: true });
    expect(planDamage(3, t, true, 1)).toEqual({ severity: "none", marks: 0, armorUsed: true });
  });
  it("no free slot or no damage means no slot is used", () => {
    expect(planDamage(20, t, true, 0)).toEqual({ severity: "severe", marks: 3, armorUsed: false });
    expect(planDamage(0, t, true, 2)).toEqual({ severity: "none", marks: 0, armorUsed: false });
  });
});

describe("domain cards", () => {
  it("the vault is owned minus loadout", () => {
    expect(vaultCardIds({ domainCards: { owned: ["a", "b", "c"], loadout: ["b"] } })).toEqual(["a", "c"]);
  });
  it("blocks cards above level and a full loadout", () => {
    expect(recallBlock({ level: 3 }, 2, 1)).toMatch(/above your level/);
    expect(recallBlock({ level: 1 }, 2, 5)).toMatch(/full/);
    expect(recallBlock({ level: 1 }, 2, 4)).toBeNull();
  });
});

describe("heritageCards", () => {
  const [a, b] = ANCESTRIES;
  it("single ancestry plus community", () => {
    const cards = heritageCards({ ancestry: { kind: "single", id: a.id }, communityId: "loreborne" });
    expect(cards.map((c) => c.kind)).toEqual(["Ancestry", "Community"]);
    expect(cards[0].features).toEqual(a.features);
  });
  it("mixed ancestry takes the first feature of one and the second of the other", () => {
    const cards = heritageCards({ ancestry: { kind: "mixed", first: a.id, second: b.id, name: "" }, communityId: "loreborne" });
    expect(cards[0].features).toEqual([a.features[0], b.features[1]]);
    expect(cards[0].name).toBe(`${a.name} / ${b.name}`);
  });
  it("shapeshifter keeps only the chosen feature and adds the transformation", () => {
    const feature = a.features[1].name;
    const cards = heritageCards({ ancestry: { kind: "shapeshifter", form: a.id, feature }, communityId: "loreborne" });
    expect(cards[0].features.map((f) => f.name)).toEqual([feature]);
    expect(cards.at(-1)?.name).toBe("Shapeshifter");
  });
});

describe("signed", () => {
  it("formats modifiers", () => {
    expect(signed(2)).toBe("+2");
    expect(signed(0)).toBe("0");
    expect(signed(-1)).toBe("−1");
  });
});

describe("ancestryLabel", () => {
  const [a, b] = ANCESTRIES;
  it("names single, mixed and shapeshifter ancestries", () => {
    expect(ancestryLabel({ kind: "single", id: a.id })).toBe(a.name);
    expect(ancestryLabel({ kind: "mixed", first: a.id, second: b.id, name: "" })).toBe(`${a.name} / ${b.name}`);
    expect(ancestryLabel({ kind: "mixed", first: a.id, second: b.id, name: "Half-thing" })).toBe("Half-thing");
    expect(ancestryLabel({ kind: "shapeshifter", form: a.id, feature: "x" })).toBe(`Shapeshifter (${a.name} form)`);
    expect(ancestryArtId({ kind: "shapeshifter", form: a.id, feature: "x" })).toBe(a.id);
  });
});

describe("equipment modifiers", () => {
  it("adds permanent Evasion and Armor Score modifiers and ignores conditional ones", async () => {
    const { equipmentModifiers } = await import("@/lib/domain/characters");
    expect(equipmentModifiers(["−1 to Evasion", "+2 to Armor Score; -1 to Evasion", undefined])).toEqual({ evasion: -2, armorScore: 2 });
    expect(equipmentModifiers(["+1 to Evasion while it’s active."])).toEqual({ evasion: 0, armorScore: 0 });
  });
});
