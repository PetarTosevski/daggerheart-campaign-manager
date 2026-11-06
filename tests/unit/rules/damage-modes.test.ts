import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { InstanceCard } from "@/components/adversaries/tracker/instance-card";
import type { TrackerActions, TrackerInstance } from "@/components/adversaries/tracker/use-tracker";
import { applyHitToPc, armorPreview, damageBeforeArmor, pcSeverity, type PcDefense } from "@/lib/domain/adversary-actions/severity";
import { applyResourceDelta, hitPointsToMark, markStress as markPcStress, pcVulnerableFromStress } from "@/lib/domain/characters/index";
import { applyDamageTo, applyHpTo, applyStressTo, type Combatant } from "@/lib/domain/combat-actions/damage";
import {
  applyMark,
  damageSeverity,
  damageTaken,
  defeatedAfter,
  hpForDamage,
  isDefeated,
  isMassive,
  lastHp,
  markStress,
  stressFull,
  vulnerableFromStress,
} from "@/lib/domain/encounters/damage";
import { extraSpotlight, spotlightCostsFear } from "@/lib/domain/encounters/spotlight";

// Plan rule-switches, tracer RDM: the damage rules take the campaign's modes; no modes = the Book.
// D2 CB p.99 / p.107, D4 CB p.92, D5 CB p.92 / p.178, D8 CB p.208, F3 CB p.153, Massive Damage CB p.91.

afterEach(cleanup);

const T = { major: 8, severe: 15 };
const bear = { hp: 0, stress: 0, defeated: false, stats: { hpMax: 7, stressMax: 2 } };

describe("D2 resistance (CB p.99, round up CB p.107)", () => {
  it("Book halves and rounds up; Manual takes the full damage", () => {
    expect(damageTaken(15, true)).toBe(8);
    expect(damageTaken(15, true, { resistance: "book" })).toBe(8);
    expect(damageTaken(15, true, { resistance: "manual" })).toBe(15);
    expect(damageTaken(15, false, { resistance: "manual" })).toBe(15);
    expect(hpForDamage(15, T, true)).toBe(2);
    expect(hpForDamage(15, T, true, { resistance: "manual" })).toBe(3);
    expect(damageSeverity(15, T, true, { resistance: "manual" })).toBe("severe");
  });

  it("a PC move on a resistant or immune adversary: Manual applies everything and says so", () => {
    const target: Combatant = {
      id: "a",
      side: "adversary",
      thresholds: T,
      hp: 0,
      hpMax: 7,
      stress: 0,
      stressMax: 2,
      defeated: false,
      conditions: [],
      resistance: { physical: "resistant", magic: "immune" },
    };
    const book = applyDamageTo(target, 15, "physical");
    expect(book).toMatchObject({ taken: 8, resisted: "resistant", hpMarked: 2 });
    expect(book.resistanceApplied).toBeUndefined();
    expect(applyDamageTo(target, 15, "physical", { rules: { resistance: "manual" } })).toMatchObject({ taken: 15, resistanceApplied: false, hpMarked: 3 });
    expect(applyDamageTo(target, 9, "magic")).toMatchObject({ taken: 0, hpMarked: 0 });
    expect(applyDamageTo(target, 9, "magic", { rules: { resistance: "manual" } })).toMatchObject({ taken: 9, resisted: "immune", resistanceApplied: false, hpMarked: 2 });
  });

  it("a hit on a resistant PC: Manual is not halved", () => {
    const pc: PcDefense = { id: "p", thresholds: { major: 10, severe: 20 }, hp: 0, hpMax: 6, stress: 0, stressMax: 6, armor: 0, armorMax: 3, resistance: { physical: "resistant", magic: "none" } };
    const hit = { amount: 21, type: "physical" as const, direct: false };
    expect(damageBeforeArmor(pc, hit)).toEqual({ taken: 11, resisted: "resistant", severity: "major" });
    expect(damageBeforeArmor(pc, hit, 0, { resistance: "manual" })).toEqual({ taken: 21, resisted: "resistant", resistanceApplied: false, severity: "severe" });
    expect(applyHitToPc(pc, hit, {}, { resistance: "manual" })).toMatchObject({ taken: 21, resistanceApplied: false, hpMarked: 3 });
  });
});

describe("D4 Stress overflow (CB p.92)", () => {
  const full = { hp: 1, hpMax: 7, stress: 2, stressMax: 2 };
  it("Book marks 1 HP instead; Manual drops the extra Stress and says overflow", () => {
    expect(markStress(full, 1)).toEqual({ stress: 2, hp: 2, overflow: true });
    expect(markStress(full, 2, { stressOverflow: "manual" })).toEqual({ stress: 2, hp: 1, overflow: true });
    expect(markStress({ ...full, stress: 1 }, 2, { stressOverflow: "manual" })).toEqual({ stress: 2, hp: 1, overflow: true });
    expect(applyMark({ ...bear, stress: 2 }, "stress", 1)).toMatchObject({ stress: 2, hp: 1 });
    expect(applyMark({ ...bear, stress: 2 }, "stress", 1, { stressOverflow: "manual" })).toMatchObject({ stress: 2, hp: 0 });
  });

  it("PC sheets and hits: Manual marks no HP", () => {
    const pc = { stress: 6, stressMax: 6, hp: 2, hpMax: 6 };
    expect(markPcStress(pc, 1)).toEqual({ stress: 6, hp: 3, vulnerable: true });
    expect(markPcStress(pc, 1, { stressOverflow: "manual" })).toEqual({ stress: 6, hp: 2, vulnerable: true, overflow: true });
    const sheet = { ...pc, hope: 2, scars: 0 };
    expect(applyResourceDelta(sheet, "stress", 1)).toMatchObject({ stress: 6, hp: 3 });
    expect(applyResourceDelta(sheet, "stress", 1, { stressOverflow: "manual" })).toMatchObject({ stress: 6, hp: 2 });

    const target: Combatant = { id: "a", side: "adversary", thresholds: T, hp: 0, hpMax: 7, stress: 2, stressMax: 2, defeated: false, conditions: [] };
    expect(applyStressTo(target, 1)).toMatchObject({ hpMarked: 1, overflow: true });
    expect(applyStressTo(target, 1, { stressOverflow: "manual" })).toMatchObject({ hpMarked: 0, stressMarked: 0, overflow: true });

    const def: PcDefense = { id: "p", thresholds: { major: 10, severe: 20 }, hp: 0, hpMax: 6, stress: 6, stressMax: 6, armor: 0, armorMax: 3 };
    const hit = { amount: 5, type: "physical" as const, direct: false };
    expect(applyHitToPc(def, hit, { convert: "stress" })).toMatchObject({ hpMarked: 1, overflow: true });
    expect(applyHitToPc(def, hit, { convert: "stress" }, { stressOverflow: "manual" })).toMatchObject({ hpMarked: 0, overflow: true });
  });
});

describe("D5 full Stress = Vulnerable (CB p.92, p.178)", () => {
  it("Book: Vulnerable; Manual: only 'Stress full'", () => {
    const tracks = { stress: 2, stressMax: 2 };
    expect(vulnerableFromStress(tracks)).toBe(true);
    expect(vulnerableFromStress(tracks, { fullStressVulnerable: "manual" })).toBe(false);
    expect(stressFull(tracks)).toBe(true);
    expect(stressFull({ stress: 0, stressMax: 0 })).toBe(false);
    expect(pcVulnerableFromStress({ stress: 6, stressMax: 6 })).toBe(true);
    expect(pcVulnerableFromStress({ stress: 6, stressMax: 6 }, { fullStressVulnerable: "manual" })).toBe(false);
    expect(markPcStress({ stress: 5, stressMax: 6, hp: 0, hpMax: 6 }, 1, { fullStressVulnerable: "manual" })).toEqual({ stress: 6, hp: 0, vulnerable: false, full: true });
  });
});

describe("tracker card: D5, D8 and F3 badges", () => {
  const instance = {
    _id: "i1",
    _creationTime: 0,
    campaignId: "c1",
    encounterId: "e1",
    source: { kind: "srd", adversaryId: "bear" },
    label: "Bear",
    order: 1,
    summoned: false,
    stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
    hp: 7,
    stress: 2,
    defeated: false,
    conditions: [],
    tags: [],
    spotlights: 0,
    spotlightTurn: 1,
    updatedAt: 0,
    name: "Bear",
    type: "Bruiser",
    tier: 1,
  } as unknown as TrackerInstance;
  const card = (props: Partial<Parameters<typeof InstanceCard>[0]>) =>
    render(createElement(InstanceCard, { instance, rules: null, gmTurn: 1, selected: false, onSelect: () => {}, actions: {} as TrackerActions, ...props }));

  it("Book: Vulnerable · Stress full, no Last HP badge, Spotlight · 1 Fear", () => {
    card({ spotlightCostsFear: true });
    expect(screen.getByText("Vulnerable · Stress full")).toBeTruthy();
    expect(screen.queryByText("Last HP")).toBeNull();
    expect(screen.getByRole("button", { name: "Spotlight Bear (spends 1 Fear)" })).toBeTruthy();
  });

  it("Manual: 'Stress full' without Vulnerable, 'Last HP', and an extra spotlight that spends no Fear", () => {
    card({ modes: { fullStressVulnerable: "manual", adversaryDefeated: "manual" }, extraSpotlight: true });
    expect(screen.getByText("Stress full")).toBeTruthy();
    expect(screen.queryByText("Vulnerable · Stress full")).toBeNull();
    expect(screen.getByText("Last HP")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Spotlight Bear (extra spotlight, no Fear spent)" }).textContent).toBe("Spotlight · extra");
  });
});

describe("D8 adversary defeated at its last HP (CB p.208)", () => {
  it("Book defeats; Manual leaves it up and says lastHp", () => {
    expect(isDefeated({ hp: 7, hpMax: 7 })).toBe(true);
    expect(isDefeated({ hp: 7, hpMax: 7 }, { adversaryDefeated: "manual" })).toBe(false);
    expect(lastHp({ hp: 7, hpMax: 7 })).toBe(true);
    expect(applyMark(bear, "hp", 7)).toMatchObject({ hp: 7, defeated: true });
    expect(applyMark(bear, "hp", 7, { adversaryDefeated: "manual" })).toMatchObject({ hp: 7, defeated: false });
    // A flag the GM set stays while every HP is marked, and clears with an HP.
    expect(defeatedAfter(true, { hp: 7, hpMax: 7 }, { adversaryDefeated: "manual" })).toBe(true);
    expect(defeatedAfter(true, { hp: 6, hpMax: 7 }, { adversaryDefeated: "manual" })).toBe(false);
  });

  it("PC moves on an adversary: Manual, not defeated, lastHp; a PC target keeps the Book", () => {
    const target: Combatant = { id: "a", side: "adversary", thresholds: T, hp: 5, hpMax: 7, stress: 0, stressMax: 2, defeated: false, conditions: [] };
    const book = applyDamageTo(target, 20, "physical");
    expect(book).toMatchObject({ defeated: true, hpMarked: 2 });
    expect(book.lastHp).toBeUndefined();
    expect(applyDamageTo(target, 20, "physical", { rules: { adversaryDefeated: "manual" } })).toMatchObject({ defeated: false, lastHp: true, hpMarked: 2 });
    expect(applyHpTo(target, 2, { adversaryDefeated: "manual" })).toMatchObject({ defeated: false });
    expect(applyHpTo({ ...target, side: "pc" }, 2, { adversaryDefeated: "manual" })).toMatchObject({ defeated: true });
  });
});

describe("F3 extra adversary spotlight costs Fear (CB p.153)", () => {
  it("Book: every spotlight after the first costs 1 Fear; Manual: none, but it is still an extra one", () => {
    expect(spotlightCostsFear(0)).toBe(false);
    expect(spotlightCostsFear(1)).toBe(true);
    expect(spotlightCostsFear(1, "book")).toBe(true);
    expect(spotlightCostsFear(1, "manual")).toBe(false);
    expect(extraSpotlight(1)).toBe(true);
    expect(extraSpotlight(0)).toBe(false);
  });
});

describe("Massive Damage (optional, CB p.91; PCs and adversaries)", () => {
  it("off = today; on: at or above twice the Severe threshold marks 4 HP", () => {
    expect(hpForDamage(30, T, false)).toBe(3);
    expect(hpForDamage(30, T, false, { massiveDamage: false })).toBe(3);
    expect(hpForDamage(30, T, false, { massiveDamage: true })).toBe(4);
    expect(hpForDamage(29, T, false, { massiveDamage: true })).toBe(3);
    // After resistance: 59 halved rounds up to 30, Massive; 58 halves to 29.
    expect(hpForDamage(59, T, true, { massiveDamage: true })).toBe(4);
    expect(hpForDamage(58, T, true, { massiveDamage: true })).toBe(3);
    // No Severe threshold: never Massive; no thresholds at all (Minions) stays "all".
    expect(isMassive(99, { severe: null }, { massiveDamage: true })).toBe(false);
    expect(hpForDamage(99, { major: null, severe: null }, false, { massiveDamage: true })).toBe("all");
  });

  it("adversaries hit by a PC move", () => {
    const target: Combatant = { id: "a", side: "adversary", thresholds: T, hp: 0, hpMax: 7, stress: 0, stressMax: 2, defeated: false, conditions: [] };
    const book = applyDamageTo(target, 30, "physical");
    expect(book.hpMarked).toBe(3);
    expect(book.massive).toBeUndefined();
    expect(applyDamageTo(target, 30, "physical", { rules: { massiveDamage: true } })).toMatchObject({ hpMarked: 4, severity: "severe", massive: true });
  });

  it("PCs: 4 HP, and an Armor Slot reduces Massive to Severe", () => {
    const t = { major: 10, severe: 20 };
    expect(hitPointsToMark(40, t)).toEqual({ severity: "severe", marks: 3 });
    expect(hitPointsToMark(40, t, false, { massiveDamage: true })).toEqual({ severity: "severe", marks: 4, massive: true });
    expect(hitPointsToMark(40, t, true, { massiveDamage: true })).toEqual({ severity: "severe", marks: 3, massive: true });
    expect(pcSeverity(40, t)).toEqual({ severity: "severe", hp: 3 });
    expect(pcSeverity(40, t, { massiveDamage: true })).toEqual({ severity: "severe", hp: 4, massive: true });

    const pc: PcDefense = { id: "p", thresholds: t, hp: 0, hpMax: 6, stress: 0, stressMax: 6, armor: 0, armorMax: 3 };
    const hit = { amount: 40, type: "physical" as const, direct: false };
    expect(applyHitToPc(pc, hit)).toMatchObject({ severity: "severe", hpMarked: 3 });
    expect(applyHitToPc(pc, hit, {}, { massiveDamage: true })).toMatchObject({ severity: "severe", massiveBefore: true, massive: true, hpMarked: 4 });
    const armored = applyHitToPc(pc, hit, { armorSlots: 1 }, { massiveDamage: true });
    expect(armored).toMatchObject({ severity: "severe", armorSlots: 1, hpMarked: 3 });
    expect(armored.massive).toBeUndefined();
    expect(armorPreview(pc, hit, 0, { massiveDamage: true })).toEqual([
      { slots: 0, severity: "severe", hp: 4, massive: true },
      { slots: 1, severity: "severe", hp: 3 },
    ]);
    expect(armorPreview(pc, hit)).toEqual([
      { slots: 0, severity: "severe", hp: 3 },
      { slots: 1, severity: "major", hp: 2 },
    ]);
  });
});
