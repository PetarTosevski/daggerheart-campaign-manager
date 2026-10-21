import { describe, expect, it } from "vitest";

import { ADVERSARIES } from "../../src/lib/srd/adversaries";
import {
  ADVERSARY_RESISTANCE,
  RESISTANCE_EXCLUSIONS,
  alwaysOnResistance,
  conditionalResistance,
  mentionsResistance,
} from "../../src/lib/srd/adversary-resistance";

const byId = new Map(ADVERSARIES.map((a) => [a.id, a]));

function featureText(adversaryId: string, feature: string): string | undefined {
  return byId.get(adversaryId)?.features.find((f) => f.name === feature)?.text;
}

const mentions = ADVERSARIES.flatMap((a) =>
  a.features.filter((f) => mentionsResistance(f.text)).map((f) => ({ adversaryId: a.id, feature: f.name, text: f.text })),
);

describe("adversary resistance table (CB p.99)", () => {
  it("classifies every SRD feature that mentions resistance or immunity", () => {
    const unclassified = mentions.filter(
      (m) =>
        ADVERSARY_RESISTANCE[m.adversaryId]?.feature !== m.feature &&
        !RESISTANCE_EXCLUSIONS.some((e) => e.adversaryId === m.adversaryId && e.feature === m.feature),
    );
    expect(unclassified).toEqual([]);
  });

  it("scans the whole catalogue, core and Hope & Fear", () => {
    expect(mentions).toHaveLength(34);
    expect(new Set(mentions.map((m) => byId.get(m.adversaryId)?.source))).toEqual(new Set(["core", "hope-and-fear"]));
  });

  it("has no stale entry: every entry and exclusion names a real feature that mentions resistance or immunity", () => {
    for (const [id, entry] of Object.entries(ADVERSARY_RESISTANCE)) {
      const text = featureText(id, entry.feature);
      expect(text, `${id} / ${entry.feature}`).toBeDefined();
      expect(mentionsResistance(text ?? "")).toBe(true);
    }
    for (const e of RESISTANCE_EXCLUSIONS) {
      const text = featureText(e.adversaryId, e.feature);
      expect(text, `${e.adversaryId} / ${e.feature}`).toBeDefined();
      expect(mentionsResistance(text ?? "")).toBe(true);
      expect(ADVERSARY_RESISTANCE[e.adversaryId]).toBeUndefined();
    }
  });

  it("gives every entry at least one resistance, matching the words of its text", () => {
    for (const [id, entry] of Object.entries(ADVERSARY_RESISTANCE)) {
      const text = (featureText(id, entry.feature) ?? "").toLowerCase();
      const levels = [entry.physical, entry.magic];
      expect(levels.some((l) => l !== "none"), id).toBe(true);
      if (levels.includes("immune")) expect(text, id).toMatch(/immun/);
      if (levels.includes("resistant")) expect(text, id).toMatch(/resistan/);
      // "All damage" or unspecified damage applies to both types (CB p.99).
      if (/all damage|immune to damage/.test(text)) expect(entry.physical).toBe(entry.magic);
      if (entry.physical !== "none" && entry.magic === "none") expect(text, id).toMatch(/physical/);
      if (entry.magic !== "none" && entry.physical === "none") expect(text, id).toMatch(/magic/);
    }
  });

  it("flags texts with 'while' or 'in this form' as conditional, and only those", () => {
    for (const [id, entry] of Object.entries(ADVERSARY_RESISTANCE)) {
      const text = featureText(id, entry.feature) ?? "";
      const looksConditional = /\bwhile\b|in this form|the egg/i.test(text);
      expect(entry.conditional !== undefined, id).toBe(looksConditional);
    }
  });

  it("keeps 'takes double damage' texts manual on the entry", () => {
    for (const [id, entry] of Object.entries(ADVERSARY_RESISTANCE)) {
      const text = featureText(id, entry.feature) ?? "";
      expect(entry.manual !== undefined, id).toBe(/takes double/i.test(text));
    }
    expect(ADVERSARY_RESISTANCE.scarecrow?.manual).toMatch(/fire/);
  });

  it("excludes the odd texts named by the plan", () => {
    const excluded = RESISTANCE_EXCLUSIONS.map((e) => e.adversaryId).sort();
    expect(excluded).toEqual(["cult-adept", "vault-guardian-gaoler", "yufo"]);
  });

  it("counts: 24 always on, 7 conditional, 3 excluded", () => {
    const entries = Object.values(ADVERSARY_RESISTANCE);
    expect(entries.filter((e) => e.conditional === undefined)).toHaveLength(24);
    expect(entries.filter((e) => e.conditional !== undefined)).toHaveLength(7);
    expect(RESISTANCE_EXCLUSIONS).toHaveLength(3);
  });
});

describe("alwaysOnResistance", () => {
  it("returns the CB p.99 example's physical resistance for the Skeleton Warrior", () => {
    expect(alwaysOnResistance("skeleton-warrior")).toEqual({ physical: "resistant", magic: "none" });
  });

  it("returns magic resistance and physical immunity together", () => {
    expect(alwaysOnResistance("cephilith-titan")).toEqual({ physical: "immune", magic: "resistant" });
  });

  it("returns none for conditional entries, unknown ids and adversaries without resistance", () => {
    expect(alwaysOnResistance("landshark")).toEqual({ physical: "none", magic: "none" });
    expect(alwaysOnResistance("nope")).toEqual({ physical: "none", magic: "none" });
    expect(alwaysOnResistance("acid-burrower")).toEqual({ physical: "none", magic: "none" });
    expect(alwaysOnResistance("yufo")).toEqual({ physical: "none", magic: "none" });
  });
});

describe("conditionalResistance", () => {
  it("returns the in-state resistance and its condition", () => {
    expect(conditionalResistance("landshark-behemoth")).toMatchObject({
      physical: "immune",
      magic: "immune",
      conditional: expect.stringMatching(/underground/i),
    });
    expect(conditionalResistance("oak-treant")).toMatchObject({ physical: "resistant", magic: "none" });
  });

  it("returns undefined for always-on and unknown ids", () => {
    expect(conditionalResistance("skeleton-warrior")).toBeUndefined();
    expect(conditionalResistance("nope")).toBeUndefined();
  });
});

describe("mentionsResistance", () => {
  it("matches resistance, resistant and immune, case-insensitively", () => {
    expect(mentionsResistance("The Warrior is resistant to physical damage.")).toBe(true);
    expect(mentionsResistance("has Resistance to all damage")).toBe(true);
    expect(mentionsResistance("They have immunity to physical damage")).toBe(true);
    expect(mentionsResistance("Targets who succeed take half damage.")).toBe(false);
  });
});
