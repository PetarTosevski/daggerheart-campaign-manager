import { describe, expect, it } from "vitest";

import { companionExperienceLimit, companionStats, INITIAL_COMPANION, trainingCap, validateCompanion } from "../../src/lib/frames/extras/companion";

const sheet = (patch: Partial<typeof INITIAL_COMPANION>) => ({ ...INITIAL_COMPANION, ...patch });

describe("Ranger companion (Core pp.40-41)", () => {
  it("starts at Evasion 10, d6 Melee, 3 Stress", () => {
    expect(companionStats(INITIAL_COMPANION, 1)).toMatchObject({ evasion: 10, damageDie: 6, range: "Melee", stressMax: 3, trainingCap: 0, out: false });
  });

  it("one training option per level-up, plus Expert/Advanced Training", () => {
    expect(trainingCap(1, 0)).toBe(0);
    expect(trainingCap(4, 0)).toBe(3);
    expect(trainingCap(4, 1)).toBe(4);
    expect(() => validateCompanion(sheet({ training: { aware: 1 } }), 1)).toThrow(/0 training/);
    expect(() => validateCompanion(sheet({ training: { aware: 1 } }), 2)).not.toThrow();
  });

  it("applies Aware, Resilient and Vicious", () => {
    const s = sheet({ training: { aware: 2, resilient: 1, vicious: 2 }, vicious: ["die", "range"] });
    expect(() => validateCompanion(s, 6)).not.toThrow();
    expect(companionStats(s, 6)).toMatchObject({ evasion: 14, stressMax: 4, damageDie: 8, range: "Very Close", trainingUsed: 5 });
  });

  it("rejects options past their boxes and unexplained Vicious marks", () => {
    expect(() => validateCompanion(sheet({ training: { armored: 2 } }), 10)).toThrow(/once/);
    expect(() => validateCompanion(sheet({ training: { vicious: 1 } }), 10)).toThrow(/Vicious/);
    expect(() => validateCompanion(sheet({ training: { flying: 1 } }), 10)).toThrow(/Unknown/);
  });

  it("drops out when the last Stress is marked", () => {
    expect(companionStats(sheet({ stress: 3 }), 1).out).toBe(true);
    expect(() => validateCompanion(sheet({ stress: 4 }), 1)).toThrow(/3 Stress/);
  });

  it("gains an Experience whenever the PC does (levels 2, 5, 8)", () => {
    expect([1, 2, 5, 8].map(companionExperienceLimit)).toEqual([2, 3, 4, 5]);
    const exps = [1, 2, 3].map((n) => ({ name: `E${n}`, value: 2 }));
    expect(() => validateCompanion(sheet({ experiences: exps }), 1)).toThrow(/2 Experiences/);
    expect(() => validateCompanion(sheet({ experiences: exps }), 2)).not.toThrow();
  });
});
