// D5 Full Stress = Vulnerable for PCs (CB p.92): the write-side rule in saveSheet (user 2026-11-09: a PC filled Stress
// from the GM's sheet and stayed un-Vulnerable).
import { describe, expect, it } from "vitest";

import { withStressVulnerable } from "@/lib/domain/characters";

const pc = (stress: number, conditions: ("vulnerable" | "hidden")[] = [], effects: { text: string }[] = []) => ({ stress, stressMax: 6, conditions, effects });

describe("withStressVulnerable", () => {
  it("adds Vulnerable when the track fills, from any write", () => {
    expect(withStressVulnerable({ stress: 5, stressMax: 6 }, pc(6)).conditions).toEqual(["vulnerable"]);
    expect(withStressVulnerable({ stress: 0, stressMax: 6 }, pc(6, ["hidden"])).conditions).toEqual(["hidden", "vulnerable"]);
  });
  it("lifts it when a Stress clears, unless a card or feature gave it", () => {
    expect(withStressVulnerable({ stress: 6, stressMax: 6 }, pc(5, ["vulnerable"])).conditions).toEqual([]);
    expect(withStressVulnerable({ stress: 6, stressMax: 6 }, pc(5, ["vulnerable"], [{ text: "vulnerable; until your next rest" }])).conditions).toEqual(["vulnerable"]);
  });
  it("acts only when the track crosses full: the GM can remove it by hand while the track stays full", () => {
    const same = pc(6, []);
    expect(withStressVulnerable({ stress: 6, stressMax: 6 }, same)).toBe(same);
    const below = pc(3, ["vulnerable"]);
    expect(withStressVulnerable({ stress: 2, stressMax: 6 }, below)).toBe(below);
  });
});
