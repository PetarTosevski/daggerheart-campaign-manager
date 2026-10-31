/**
 * User answer 2026-10-31 (tracer E6.3): "took damage" means at least 1 Hit Point was marked. Slumber (CB p.332): "Asleep
 * until they take damage"; a hit reduced to 0 HP marked does not end it, even at Minor or worse.
 */
import { describe, expect, it } from "vitest";

import { endsOnOccurrence, occurredEvents, takenSeverity } from "../../src/lib/domain/characters/expiry";

const hit = (severity: "none" | "minor" | "major" | "severe", hpMarked: number) => ({ kind: "damageTaken" as const, severity, hpMarked, lastHp: false });

describe("takeDamage needs a marked Hit Point", () => {
  it("a Minor-or-worse hit reduced to 0 HP marked is reducedToNoHp, not takeDamage", () => {
    expect(occurredEvents(hit("minor", 0)).has("takeDamage")).toBe(false);
    expect(occurredEvents(hit("major", 0)).has("reducedToNoHp")).toBe(true);
    expect(occurredEvents(hit("minor", 1)).has("takeDamage")).toBe(true);
  });

  it("Slumber's Asleep stays through a 0-HP hit and ends on a marked Hit Point", () => {
    const asleep = { endsOn: ["takeDamage" as const, "gmSpendsFear" as const] };
    expect(endsOnOccurrence(asleep, hit("severe", 0), "bearer")).toBe(false);
    expect(endsOnOccurrence(asleep, hit("minor", 1), "bearer")).toBe(true);
  });
});

/**
 * User answer 2026-10-31 (tracer E6.3): severity follows the Hit Points finally marked (Major = 2 HP, Severe = 3 HP);
 * armor that reduces the damage drops the severity with it.
 */
describe("severity follows the Hit Points marked", () => {
  it("a Severe hit armored down to 2 HP is Major, not Severe", () => {
    const events = occurredEvents(hit("severe", 2));
    expect(events.has("takeSevere")).toBe(false);
    expect(events.has("majorDamage")).toBe(true);
  });

  it("a hit armored down to 1 HP is Minor; 3 HP is Severe", () => {
    expect(occurredEvents(hit("major", 1)).has("majorDamage")).toBe(false);
    expect(occurredEvents(hit("severe", 3)).has("takeSevere")).toBe(true);
  });

  it("on the last Hit Point the hit's own severity counts when the marks were capped", () => {
    const last = { kind: "damageTaken" as const, severity: "severe" as const, hpMarked: 1, lastHp: true };
    expect(takenSeverity(last)).toBe("severe");
    expect(takenSeverity({ ...last, lastHp: false })).toBe("minor");
  });
});
