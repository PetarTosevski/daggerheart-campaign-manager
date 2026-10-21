import { describe, expect, it } from "vitest";

import {
  adversaryAttack,
  adversaryDamage,
  applyHitToPc,
  armorOptions,
  armorPreview,
  criticalBonus,
  formatDamage,
  groupAttackDamage,
  parseAttackModifier,
  pcSeverity,
  standardAttackDamage,
  stepDown,
  type PcDefense,
} from "@/lib/domain/adversary-actions";
import { parseDamage } from "@/lib/domain/adversaries";
import { queueRng } from "@/lib/domain/dice";

// Plan combat-actions, tracer AA1: attack rolls (AR1, AR2, AR7), damage (AR9, AR10) and damage to PCs (AR3-AR5).
// Expected values come from the book where it has examples (CB p.148: a 2d8+2 critical rolling 5 and 7 is 30; CB p.114:
// Rune's Major hit with an Armor Slot becomes Minor) and otherwise from the rule text by hand.

describe("adversaryAttack (AR1, AR2, AR7; CB p.160, p.148, p.161)", () => {
  const targets = [
    { id: "mira", evasion: 12 },
    { id: "bram", evasion: 18 },
  ];

  it("rolls one d20 + ATK for every target; hit when the total meets or beats Evasion", () => {
    const r = adversaryAttack(2, {}, 0, targets, queueRng([10]));
    expect(r.total).toBe(12);
    expect(r.critical).toBe(false);
    expect(r.hits).toEqual([
      { id: "mira", hit: true },
      { id: "bram", hit: false },
    ]);
    expect(r.record).toMatchObject({ kind: "action", modifier: 2, total: 12 });
  });

  it("with advantage keeps the higher of two d20s, with disadvantage the lower", () => {
    expect(adversaryAttack(0, { advantage: 1 }, 0, targets, queueRng([5, 14])).natural).toBe(14);
    expect(adversaryAttack(0, { disadvantage: 1 }, 0, targets, queueRng([14, 5])).natural).toBe(5);
    // One advantage and one disadvantage cancel: a single die.
    expect(adversaryAttack(0, { advantage: 1, disadvantage: 1 }, 0, targets, queueRng([9])).record.dice).toHaveLength(1);
  });

  it("a natural 20 always succeeds and is critical (CB p.148)", () => {
    const r = adversaryAttack(-5, {}, 0, [{ id: "tank", evasion: 30 }], queueRng([20]));
    expect(r.critical).toBe(true);
    expect(r.hits).toEqual([{ id: "tank", hit: true }]);
  });

  it("adds an Experience bought with a Fear (CB p.160) and modifier dice such as +2d4", () => {
    expect(adversaryAttack(1, {}, 3, targets, queueRng([8])).total).toBe(12);
    const dice = adversaryAttack("+2d4", {}, 0, targets, queueRng([10, 3, 4]));
    expect(dice.total).toBe(17);
    expect(dice.record.dice.map((d) => d.value)).toEqual([10, 3, 4]);
  });

  it("parses printed modifiers", () => {
    expect(parseAttackModifier(3)).toEqual({ flat: 3, dice: null });
    expect(parseAttackModifier("−1")).toEqual({ flat: -1, dice: null });
    expect(parseAttackModifier("+2d4")).toEqual({ flat: 0, dice: { count: 2, sides: 4 } });
    expect(parseAttackModifier("odd")).toEqual({ flat: 0, dice: null });
  });
});

describe("adversary damage (AR2, AR9, AR10)", () => {
  it("CB p.148: a 2d8+2 critical rolling 5 and 7 deals 16 + 12 + 2 = 30", () => {
    expect(adversaryDamage("2d8+2 phy", true, queueRng([5, 7]))!.record.total).toBe(30);
    expect(adversaryDamage("2d8+2 phy", false, queueRng([5, 7]))!.record.total).toBe(14);
    expect(criticalBonus("2d8+2 phy")).toBe(16);
  });

  it("flat and direct damage are not rolled; a critical adds nothing to flat damage; types map", () => {
    expect(adversaryDamage("40 direct phy", true, queueRng([]))).toMatchObject({ record: { total: 40 }, direct: true, type: "physical" });
    expect(adversaryDamage("1d6 mag", false, queueRng([4]))!.type).toBe("magic");
    expect(adversaryDamage("1d6 phy/mag", false, queueRng([4]))!.type).toBe("both");
    expect(adversaryDamage("nonsense", false, queueRng([]))).toBeNull();
  });

  it("Horde (X) replaces the standard attack's damage once half or more of the HP is marked (CB p.199)", () => {
    expect(standardAttackDamage("1d10+2 phy", { hp: 2, hpMax: 6 }, "1d4+1")).toBe("1d10+2 phy");
    expect(standardAttackDamage("1d10+2 phy", { hp: 3, hpMax: 6 }, "1d4+1")).toBe("1d4+1 phy");
    expect(standardAttackDamage("1d10+2 phy", { hp: 3, hpMax: 5 }, "1d4+1")).toBe("1d4+1 phy");
    expect(standardAttackDamage("1d10+2 phy", { hp: 0, hpMax: 5 }, null, { add: 2, direct: true })).toBe("1d10+4 direct phy");
    expect(standardAttackDamage("1d8 phy", { hp: 0, hpMax: 5 }, null, { type: "magic" })).toBe("1d8 mag");
  });

  it("formats damage back to text", () => {
    expect(formatDamage(parseDamage("2 phy")!)).toBe("2 phy");
    expect(formatDamage(parseDamage("1d8-1 mag")!)).toBe("1d8-1 mag");
  });

  it("Minion Group Attack combines X per Minion (CB p.201)", () => {
    expect(groupAttackDamage(2, 4)).toBe(8);
    expect(groupAttackDamage(3, 0)).toBe(0);
  });
});

describe("damage to a PC (AR3-AR5; CB p.91, p.114, p.99, p.92)", () => {
  // Rune (CB p.114): Armor Score 3, 1 slot already marked.
  const rune: PcDefense = { id: "rune", thresholds: { major: 10, severe: 20 }, hp: 0, hpMax: 6, stress: 0, stressMax: 6, armor: 1, armorMax: 3, hope: 2 };

  it("severity: Severe 3, Major 2, Minor 1, 0 or less none (CB p.91)", () => {
    expect(pcSeverity(20, rune.thresholds)).toEqual({ severity: "severe", hp: 3 });
    expect(pcSeverity(14, rune.thresholds)).toEqual({ severity: "major", hp: 2 });
    expect(pcSeverity(9, rune.thresholds)).toEqual({ severity: "minor", hp: 1 });
    expect(pcSeverity(0, rune.thresholds)).toEqual({ severity: "none", hp: 0 });
    expect(stepDown("severe", 2)).toBe("minor");
    expect(stepDown("minor", 5)).toBe("none");
  });

  it("CB p.114: Rune hit for Major marks an Armor Slot to make it Minor; he has 1 slot left", () => {
    const r = applyHitToPc(rune, { amount: 14, type: "physical", direct: false }, { armorSlots: 1 });
    expect(r).toMatchObject({ severityBefore: "major", severity: "minor", armorSlots: 1, hpMarked: 1, deathMove: false });
    expect(r.after).toEqual({ hp: 1, stress: 0, armor: 2, hope: 2 });
    expect(armorOptions({ ...rune, armor: 2 }, { amount: 14, type: "physical", direct: false }).free).toBe(1);
  });

  it("only one Armor Slot per hit unless a card allows more (I Am Your Shield: any number, CB p.341)", () => {
    const hit = { amount: 25, type: "physical" as const, direct: false };
    expect(applyHitToPc(rune, hit, { armorSlots: 2 })).toMatchObject({ armorSlots: 1, severity: "major" });
    expect(applyHitToPc(rune, hit, { armorSlots: 2, extraSlots: "any" })).toMatchObject({ armorSlots: 2, severity: "minor", hpMarked: 1 });
    expect(applyHitToPc(rune, hit, { armorSlots: 3, extraSlots: "any" })).toMatchObject({ armorSlots: 2 }); // only 2 free
    expect(armorPreview(rune, hit, "any").map((p) => p.severity)).toEqual(["severe", "major", "minor"]);
  });

  it("direct damage can't be reduced by Armor Slots (CB p.99)", () => {
    const r = applyHitToPc(rune, { amount: 14, type: "physical", direct: true }, { armorSlots: 1 });
    expect(r).toMatchObject({ armorSlots: 0, severity: "major", hpMarked: 2 });
    expect(armorOptions(rune, { amount: 14, type: "physical", direct: true }).canUseArmor).toBe(false);
  });

  it("a forced slot is marked without benefit first (CB p.195); a free slot may still reduce", () => {
    const hit = { amount: 14, type: "physical" as const, direct: false, forcedArmor: 1 };
    const r = applyHitToPc(rune, hit, { armorSlots: 1 });
    expect(r).toMatchObject({ forcedArmor: 1, armorSlots: 1, severity: "minor" });
    expect(r.after.armor).toBe(3);
    expect(applyHitToPc({ ...rune, armor: 2 }, hit, { armorSlots: 1 })).toMatchObject({ forcedArmor: 1, armorSlots: 0, severity: "major" });
  });

  it("marking the last HP flags a death move (CB p.91)", () => {
    const r = applyHitToPc({ ...rune, hp: 4 }, { amount: 25, type: "magic", direct: false });
    expect(r).toMatchObject({ hpMarked: 2, deathMove: true });
    expect(r.after.hp).toBe(6);
  });

  it("resistance halves before the thresholds; immunity takes none (CB p.99)", () => {
    const resistant = { ...rune, resistance: { physical: "resistant" as const, magic: "none" as const } };
    expect(applyHitToPc(resistant, { amount: 21, type: "physical", direct: false })).toMatchObject({ taken: 10, severity: "major" });
    expect(applyHitToPc({ ...rune, resistance: { physical: "immune", magic: "none" } }, { amount: 21, type: "physical", direct: false })).toMatchObject({ taken: 0, hpMarked: 0 });
  });

  it("Stress instead of HP overflows into 1 HP on a full track (CB p.92); Hope instead spends what there is", () => {
    const r = applyHitToPc({ ...rune, stress: 5 }, { amount: 14, type: "physical", direct: false }, { convert: "stress" });
    expect(r).toMatchObject({ stressMarked: 1, overflow: true, hpMarked: 1 });
    const h = applyHitToPc(rune, { amount: 25, type: "physical", direct: false }, { convert: "hope" });
    expect(h).toMatchObject({ hopeSpent: 2, hpMarked: 1 });
  });

  it("reductions, severity steps, negation, On the Brink and Chains of Affliction", () => {
    const hit = { amount: 14, type: "physical" as const, direct: false };
    expect(applyHitToPc(rune, hit, { reduceDamage: 5 })).toMatchObject({ severity: "minor" });
    expect(applyHitToPc(rune, hit, { reduceSeverity: 1 })).toMatchObject({ severity: "minor" });
    expect(applyHitToPc(rune, hit, { negate: true })).toMatchObject({ severity: "none", hpMarked: 0 });
    expect(applyHitToPc({ ...rune, noMinorDamage: true }, { ...hit, amount: 5 })).toMatchObject({ severity: "none" });
    expect(applyHitToPc(rune, { ...hit, hpMarkedDelta: -1 })).toMatchObject({ severity: "major", hpMarked: 1 });
    expect(applyHitToPc({ ...rune, noArmorSlots: true }, hit, { armorSlots: 1 })).toMatchObject({ armorSlots: 0 });
  });
});
