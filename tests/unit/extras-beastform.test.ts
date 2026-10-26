import { describe, expect, it } from "vitest";

import { resolveBeastform, validateBeastform } from "../../src/lib/frames/extras/beastform";
import { extrasFor, parseDamage, stepDie } from "../../src/lib/frames/extras/common";

describe("extras applicability", () => {
  it("class extras follow the class/subclass, frame extras the frame", () => {
    expect(extrasFor("witherwild", { classId: "druid", subclassId: "warden-of-renewal" })).toMatchObject({ beastform: true, companion: false, motherboard: false });
    expect(extrasFor("motherboard", { classId: "ranger", subclassId: "beastbound" })).toMatchObject({ beastform: false, companion: true, motherboard: true });
    expect(extrasFor("beast-feast", { classId: "bard", subclassId: "x" })).toMatchObject({ beastFeast: true, castleHigh: false });
    expect(extrasFor("castle-high", { classId: "bard", subclassId: "x" }).castleHigh).toBe(true);
  });
});

describe("damage helpers", () => {
  it("parses and steps dice", () => {
    expect(parseDamage("d10+8 phy")).toEqual({ count: 1, sides: 10, bonus: 8, type: "phy" });
    expect(stepDie(6)).toBe(8);
    expect(stepDie(12)).toBe(12);
  });
});

describe("Beastform (Core pp.31-35)", () => {
  it("allows forms of your tier or lower only", () => {
    expect(() => validateBeastform({ formId: "agile-scout" }, 1)).not.toThrow();
    expect(() => validateBeastform({ formId: "armored-sentry" }, 1)).toThrow(/Tier 2/);
    expect(() => validateBeastform({ formId: "armored-sentry" }, 2)).not.toThrow();
    expect(() => validateBeastform({ formId: "nope" }, 4)).toThrow(/Unknown/);
    expect(() => validateBeastform({ formId: null }, 1)).not.toThrow();
  });

  it("resolves a plain form with the Evolution trait", () => {
    const r = resolveBeastform({ formId: "agile-scout", evolutionTrait: "finesse" })!;
    expect(r).toMatchObject({ name: "Agile Scout", evasionBonus: 2, traitBonus: { trait: "agility", bonus: 1 }, evolutionTrait: "finesse" });
    expect(r.attack?.damage).toBe("d4 phy");
    expect(resolveBeastform({ formId: null })).toBeNull();
  });

  it("Legendary Beast upgrades a Tier 1 form: +6 damage, +1 trait, +2 Evasion", () => {
    expect(() => validateBeastform({ formId: "legendary-beast" }, 3)).toThrow(/choose which/);
    expect(() => validateBeastform({ formId: "legendary-beast", baseFormId: "armored-sentry" }, 3)).toThrow();
    const state = { formId: "legendary-beast", baseFormId: "agile-scout" };
    expect(() => validateBeastform(state, 3)).not.toThrow();
    const r = resolveBeastform(state)!;
    expect(r).toMatchObject({ evasionBonus: 4, traitBonus: { trait: "agility", bonus: 2 } });
    expect(r.attack?.damage).toBe("d4+6 phy");
  });

  it("Mythic Beast also steps the damage die", () => {
    const r = resolveBeastform({ formId: "mythic-beast", baseFormId: "agile-scout" })!;
    expect(r.attack?.damage).toBe("d6+9 phy");
    expect(r.evasionBonus).toBe(5);
  });

  it("Legendary Hybrid takes two Tier 1-2 forms, four advantages and two features", () => {
    const hybrid = (h: { sources?: string[]; advantages?: string[]; features?: string[] }) => ({
      formId: "legendary-hybrid",
      hybrid: {
        sources: ["agile-scout", "armored-sentry"],
        advantages: ["deceive", "sneak", "dig", "protect"],
        features: ["Agile", "Fragile"],
        ...h,
      },
    });
    expect(() => validateBeastform(hybrid({}), 3)).not.toThrow();
    expect(() => validateBeastform({ formId: "legendary-hybrid" }, 3)).toThrow(/choose them/);
    expect(() => validateBeastform(hybrid({ sources: ["agile-scout", "great-predator"] }), 3)).toThrow(/Tiers 1/);
    expect(() => validateBeastform(hybrid({ advantages: ["deceive", "sneak", "dig", "swim"] }), 3)).toThrow(/4 advantages/);
    expect(() => validateBeastform(hybrid({ advantages: ["deceive", "sneak", "dig"] }), 3)).toThrow(/4 advantages/);
    expect(() => validateBeastform(hybrid({ features: ["Agile"] }), 3)).toThrow(/2 features/);
    const r = resolveBeastform(hybrid({}))!;
    expect(r.name).toBe("Legendary Hybrid (Agile Scout + Armored Sentry)");
    expect(r.advantages).toEqual(["deceive", "sneak", "dig", "protect"]);
    expect(r.features.map((f) => f.name)).toEqual(["Hybrid Features", "Agile", "Fragile"]);
  });
});
