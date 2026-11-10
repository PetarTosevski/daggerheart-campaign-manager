// Plan rule-switches wave 3, tracer WS: the pure helpers (docs/tasks/TASK-RULES-WS.md).
import { describe, expect, it } from "vitest";

import { avoidDeath, scarNote } from "@/lib/domain/death";
import { aboveLevelNote, cardsWithin, cardTakeProblem, isAboveLevel } from "@/lib/domain/level-up";
import { doomReminderDue, doomTierRulesApply, tierFourFearNote } from "@/lib/frames/trackers/horizon";
import { cardsForDomains } from "@/lib/srd";

const tracks = { level: 2, hp: 6, hpMax: 6, stress: 0, stressMax: 6, hope: 2, scars: 0, conditions: [] as const };

describe("X3 scars", () => {
  it("Book scars on a low Hope Die; Manual reports the scar but leaves the sheet", () => {
    expect(avoidDeath(tracks, 1).sheet.scars).toBe(1);
    const manual = avoidDeath(tracks, 1, "manual");
    expect(manual).toMatchObject({ scarred: true, journeyEnds: false });
    expect(manual.sheet.scars).toBe(0);
    expect(manual.sheet.conditions).toContain("unconscious");
    expect(scarNote("Mira")).toBe("Mira gains a scar: cross out a Hope slot?");
  });
});

describe("W3 doom track", () => {
  it("reminds every session in Book, every N-th in Every N sessions, never in Manual", () => {
    expect([1, 2, 3].map((n) => doomReminderDue("book", 3, n))).toEqual([true, true, true]);
    expect([1, 2, 3, 4, 5, 6].map((n) => doomReminderDue("everyNSessions", 2, n))).toEqual([false, true, false, true, false, true]);
    expect(doomReminderDue("everyNSessions", 1, undefined)).toBe(true);
    expect(doomReminderDue("everyNSessions", 2, undefined)).toBe(false);
    expect(doomReminderDue("manual", 1, 1)).toBe(false);
    expect([doomTierRulesApply("book"), doomTierRulesApply("everyNSessions"), doomTierRulesApply("manual")]).toEqual([true, true, false]);
    expect(tierFourFearNote(3)).toBe("Doom Track Tier 4: gain 3 Fear?");
  });
});

describe("L3 domain card levels", () => {
  const warrior = { classId: "warrior", domainCards: { owned: [], loadout: [] }, level: 2 };
  const blade4 = cardsForDomains(["blade"], 4).find((c) => c.level === 4)!;
  const arcana1 = cardsForDomains(["arcana"], 1).find((c) => c.level === 1)!;

  it("Manual widens the reach to every level of the character's domains, never to another domain", () => {
    expect(cardTakeProblem(warrior, blade4.id, ["core"])?.reason).toBe("locked");
    expect(cardTakeProblem(warrior, blade4.id, ["core"], "manual")).toBeNull();
    expect(cardTakeProblem(warrior, arcana1.id, ["core"], "manual")?.reason).toBe("locked");
    expect(cardsWithin(warrior, 2, 10, ["core"]).some((c) => c.id === blade4.id)).toBe(false);
    expect(cardsWithin(warrior, 2, 10, ["core"], "manual").some((c) => c.id === blade4.id)).toBe(true);
  });

  it("marks cards above the Book reach and words the GM's note", () => {
    expect(isAboveLevel(warrior, blade4, 2)).toBe(true);
    expect(isAboveLevel(warrior, blade4, 4)).toBe(false);
    expect(isAboveLevel(warrior, arcana1, 2)).toBe(false);
    expect(aboveLevelNote("Mira", { name: "Blade Dance", level: 4 }, 2)).toBe("Mira took Blade Dance (level 4) at level 2");
  });
});
