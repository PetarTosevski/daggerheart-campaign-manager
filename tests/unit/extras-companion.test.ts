import { describe, expect, it } from "vitest";

import { applyResourceDelta, hopeMax } from "../../src/lib/domain/characters/index";
import { avoidDeath } from "../../src/lib/domain/death/index";
import { characterSheetSchema } from "../../src/lib/validation/characters";
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

describe("Light in the Dark (CB 40, dcm-bxp.14)", () => {
  const tracks = { level: 3, hp: 6, hpMax: 6, stress: 0, stressMax: 6, hope: 1, scars: 6, hopeSlotBonus: 1, conditions: [] };

  it("a seventh Hope slot: Hope max 7, and the sheet holds 7 Hope and 7 scars", () => {
    expect(hopeMax(0, 1)).toBe(7);
    expect(applyResourceDelta({ ...tracks, scars: 0, hope: 6 }, "hope", 1).hope).toBe(7);
    const fields = characterSheetSchema.pick({ hope: true, scars: true, hopeSlotBonus: true });
    expect(fields.safeParse({ hope: 7, scars: 0, hopeSlotBonus: 1 }).success).toBe(true);
    expect(fields.safeParse({ hope: 0, scars: 7, hopeSlotBonus: 1 }).success).toBe(true);
    expect(fields.safeParse({ hope: 0, scars: 8, hopeSlotBonus: 1 }).success).toBe(false);
  });

  it("with six scars one slot is left; scarring it ends the journey (CB 106)", () => {
    expect(hopeMax(6, 1)).toBe(1);
    const scarred = avoidDeath(tracks, 1);
    expect(scarred).toMatchObject({ scarred: true, journeyEnds: true });
    expect(avoidDeath({ ...tracks, scars: 5 }, 1).journeyEnds).toBe(false);
  });
});
