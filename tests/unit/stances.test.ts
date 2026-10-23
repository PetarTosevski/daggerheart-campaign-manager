// Martial stances rule data (SD-ST; HF p.11-12).
import { describe, expect, it } from "vitest";

import {
  FOCUS_MAX,
  REFOCUS,
  SHIFT_FOCUS_COST,
  STANCE_DROP_TRIGGERS,
  STANCES,
  STARTING_STANCES,
  stanceById,
  stancesUpToTier
} from "@/lib/srd/stances";
import { SUBCLASSES } from "@/lib/srd/subclasses";

describe("martial stances (HF p.12)", () => {
  it("lists 16 stances, 4 per tier", () => {
    expect(STANCES).toHaveLength(16);
    for (const tier of [1, 2, 3, 4]) {
      expect(STANCES.filter((s) => s.tier === tier)).toHaveLength(4);
    }
  });

  it("has unique ids and names", () => {
    expect(new Set(STANCES.map((s) => s.id)).size).toBe(16);
    expect(new Set(STANCES.map((s) => s.name)).size).toBe(16);
  });

  it("every entry has the {id, name, tier, text} shape", () => {
    for (const s of STANCES) {
      expect(Object.keys(s).sort()).toEqual(["id", "name", "text", "tier"]);
      expect(s.id).toMatch(/^[a-z]+$/);
      expect(s.id).toBe(s.name.toLowerCase());
      expect([1, 2, 3, 4]).toContain(s.tier);
      expect(s.text.length).toBeGreaterThan(20);
      expect(s.text.trim()).toBe(s.text);
      expect(s.text).toMatch(/\.$/);
    }
  });

  it("puts each stance in its book tier", () => {
    const byTier = (t: number) => STANCES.filter((s) => s.tier === t).map((s) => s.name);
    expect(byTier(1)).toEqual(["Favored", "Invigorating", "Quick", "Reliable"]);
    expect(byTier(2)).toEqual(["Aggressive", "Anchored", "Defensive", "Otherworldly"]);
    expect(byTier(3)).toEqual(["Grappling", "Scary", "Stable", "Vigilant"]);
    expect(byTier(4)).toEqual(["Crushing", "Exacting", "Honed", "Isolating"]);
  });

  it("looks stances up by id and by tier", () => {
    expect(stanceById("honed")?.tier).toBe(4);
    expect(stanceById("nope")).toBeUndefined();
    expect(stancesUpToTier(1)).toHaveLength(4);
    expect(stancesUpToTier(3)).toHaveLength(12);
    expect(stancesUpToTier(4)).toHaveLength(16);
  });

  it("holds the Focus rules as constants", () => {
    expect(FOCUS_MAX).toBe(6);
    expect(SHIFT_FOCUS_COST).toBe(1);
    expect(STARTING_STANCES).toBe(2);
    expect(REFOCUS).toEqual({ per: "rest", trait: "instinct", die: 6, keep: "highest", clearsTrack: true });
    expect(STANCE_DROP_TRIGGERS).toEqual(["shift", "severe-damage", "last-hit-point", "scene-end"]);
  });

  it("the Martial Artist foundation still names the Martial Stances sheet", () => {
    const ma = SUBCLASSES.find((s) => s.id === "martial-artist");
    expect(ma?.foundation[0]?.name).toBe("Stance Fighter");
    expect(ma?.foundation[0]?.text).toContain("Martial Stances sheet");
    expect(ma?.foundation[0]?.text).toContain("choose two martial stances from Tier 1");
  });
});
