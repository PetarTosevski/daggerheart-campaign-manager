import { describe, expect, it } from "vitest";

import {
  adversariesFor,
  featureFearCost,
  hordeDamage,
  maxDamage,
  minionValue,
  parseDamage,
  relentlessValue,
} from "@/lib/domain/adversaries";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import type { AdversaryDef } from "@/lib/srd/types";

const byName = (name: string): AdversaryDef => {
  const def = ADVERSARIES.find((a) => a.name === name);
  if (!def) throw new Error(`no adversary ${name}`);
  return def;
};

describe("minionValue (CB p.201)", () => {
  it("reads X from Minion (X)", () => {
    expect(minionValue(byName("Jagged Knife Lackey"))).toBe(3);
    expect(minionValue(byName("Giant Rat"))).toBe(3);
    expect(minionValue(byName("Severed Shadow"))).toBe(12);
  });

  it("is null for an adversary that is not a Minion", () => {
    expect(minionValue(byName("Bear"))).toBeNull();
  });
});

describe("hordeDamage (CB p.199)", () => {
  it("reads X from Horde (X)", () => {
    expect(hordeDamage(byName("Giant Mosquitoes"))).toBe("1d4+1");
    expect(hordeDamage(byName("Night Children"))).toBe("2d6+2");
  });

  it("writes a typographic minus as ASCII", () => {
    expect(hordeDamage(byName("Will-o’-the-Wisps"))).toBe("1d4-1");
  });

  it("is null for an adversary that is not a Horde", () => {
    expect(hordeDamage(byName("Bear"))).toBeNull();
  });
});

describe("relentlessValue (CB p.195)", () => {
  it("reads X from Relentless (X)", () => {
    expect(relentlessValue(byName("Acid Burrower"))).toBe(3);
    expect(relentlessValue(byName("Construct"))).toBe(2);
    expect(relentlessValue(byName("Forlorne Lykona (Dragon Form)"))).toBe(4);
  });

  it("is 'X' when the block makes it variable", () => {
    expect(relentlessValue(byName("Hydra"))).toBe("X");
    expect(relentlessValue(byName("Xero the Castle Killer"))).toBe("X");
  });

  it("is null without the feature", () => {
    expect(relentlessValue(byName("Bear"))).toBeNull();
  });
});

describe("featureFearCost (CB p.194)", () => {
  it("reads 'Spend a Fear' as 1 and 'spend N Fear' as N", () => {
    expect(featureFearCost("Spend a Fear to choose a target and spotlight all Ruffians.")).toBe(1);
    expect(featureFearCost("Once per scene, spend 2 Fear to summon up to two Darkweave adversaries.")).toBe(2);
    expect(featureFearCost("you can spend a Fear to make an attack roll against them")).toBe(1);
  });

  it("is null for the spotlight reminder and for amounts the GM chooses", () => {
    expect(featureFearCost("Spend Fear as usual to spotlight them.")).toBeNull();
    expect(featureFearCost("Up to three times per scene, spend any number of Fear to clear an equal number of HP.")).toBeNull();
    expect(featureFearCost("Mark a Stress to make an attack.")).toBeNull();
  });

  it("matches the stored cost of real features", () => {
    const denMother = byName("Darkweave Queen").features.find((f) => f.name === "Den Mother")!;
    expect(featureFearCost(denMother.text)).toBe(2);
    expect(denMother.fearCost).toBe(2);
  });
});

describe("parseDamage", () => {
  it("splits dice, modifier and type", () => {
    expect(parseDamage("2d10+4 phy")).toEqual({ dice: { count: 2, sides: 10 }, modifier: 4, type: "phy", direct: false });
    expect(parseDamage("1d20 phy")).toEqual({ dice: { count: 1, sides: 20 }, modifier: 0, type: "phy", direct: false });
    expect(parseDamage("1d8+4 phy/mag")).toEqual({ dice: { count: 1, sides: 8 }, modifier: 4, type: "phy/mag", direct: false });
  });

  it("reads flat damage, direct damage and Horde values without a type", () => {
    expect(parseDamage("2 phy")).toEqual({ dice: null, modifier: 2, type: "phy", direct: false });
    expect(parseDamage("40 direct phy")).toEqual({ dice: null, modifier: 40, type: "phy", direct: true });
    expect(parseDamage("1d4-1")).toEqual({ dice: { count: 1, sides: 4 }, modifier: -1, type: null, direct: false });
    expect(parseDamage("1d4−1")).toEqual({ dice: { count: 1, sides: 4 }, modifier: -1, type: null, direct: false });
  });

  it("is null for text that is not damage", () => {
    expect(parseDamage("")).toBeNull();
    expect(parseDamage("lots")).toBeNull();
  });

  it("parses every standard attack in the catalogue", () => {
    for (const a of ADVERSARIES) expect(parseDamage(a.attack.damage), a.name).not.toBeNull();
  });
});

describe("maxDamage (CB p.148)", () => {
  it("is the highest value the dice can roll", () => {
    expect(maxDamage({ count: 2, sides: 8 })).toBe(16);
    expect(maxDamage(parseDamage("4d12+10 phy")!.dice)).toBe(48);
  });

  it("is 0 for flat damage", () => {
    expect(maxDamage(null)).toBe(0);
  });
});

describe("adversariesFor", () => {
  it("lists only Core blocks with the Hope & Fear switch off", () => {
    const list = adversariesFor(ADVERSARIES, { hopeAndFear: false, frameId: "witherwild" });
    expect(list).toHaveLength(129);
    expect(list.every((a) => a.source === "core")).toBe(true);
  });

  it("adds the 135 Hope & Fear blocks with the switch on, but not the Weredragon ones", () => {
    const list = adversariesFor(ADVERSARIES, { hopeAndFear: true, frameId: "castle-high" });
    expect(list).toHaveLength(264);
    expect(list.some((a) => a.frameId)).toBe(false);
  });

  it("adds the Weredragon blocks only in Reign of the Weredragon, whatever the switch says", () => {
    const off = adversariesFor(ADVERSARIES, { hopeAndFear: false, frameId: "reign-of-the-weredragon" });
    expect(off).toHaveLength(132);
    expect(off.filter((a) => a.frameId).map((a) => a.name)).toEqual([
      "Weredrake",
      "Forlorne Lykona (Dragon Form)",
      "Forlorne Lykona (Faun Form)",
    ]);
    expect(adversariesFor(ADVERSARIES, { hopeAndFear: true, frameId: "reign-of-the-weredragon" })).toHaveLength(267);
  });

  it("works for a custom campaign without a published frame", () => {
    expect(adversariesFor(ADVERSARIES, { hopeAndFear: true, frameId: null })).toHaveLength(264);
  });
});
