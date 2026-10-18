import { describe, expect, it } from "vitest";

import { applyBudgetChange } from "@/components/adversaries/builder/budget-panel";
import {
  type BpAdjustmentId,
  battlePoints,
  BP_ADJUSTMENTS,
  BP_COSTS,
  budgetFor,
  minionGroups,
  spentFor,
  startingBudget,
  suggestedAdjustments,
  verdict,
  type BudgetEntry,
} from "@/lib/domain/encounters/budget";
import { instanceStats, nextLabels } from "@/lib/domain/encounters/instances";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import type { AdversaryDef, AdversaryType } from "@/lib/srd/types";

const one = (type: AdversaryType, extra: Partial<BudgetEntry> = {}): BudgetEntry => ({ type, tier: 1, summoned: false, ...extra });
const byName = (name: string): AdversaryDef => {
  const def = ADVERSARIES.find((a) => a.name === name);
  if (!def) throw new Error(`no adversary ${name}`);
  return def;
};

describe("starting budget (CB p.197: (3 × the number of PCs in combat) + 2)", () => {
  it("gives 11 for three PCs and 17 for five, as the book's examples", () => {
    expect(startingBudget(3)).toBe(11);
    expect(startingBudget(5)).toBe(17);
    expect(budgetFor(4, [])).toBe(14);
  });
});

describe("adjustments (CB p.197)", () => {
  it.each([
    ["easy", -1],
    ["twoSolo", -2],
    ["dmg", -2],
    ["lowTier", 1],
    ["noBig", 1],
    ["hard", 2],
  ] as const)("%s changes the budget by %i", (id, delta) => {
    expect(budgetFor(4, [id])).toBe(14 + delta);
    expect(BP_ADJUSTMENTS.find((a) => a.id === id)?.delta).toBe(delta);
  });

  it("adds several adjustments and counts each once", () => {
    expect(budgetFor(4, ["easy", "hard"])).toBe(15);
    expect(budgetFor(4, ["hard", "hard"])).toBe(16);
  });

  it("matches the book's worked example: a party of four, a little easier = 13; +2 damage = 12", () => {
    expect(budgetFor(4, ["easy"])).toBe(13);
    expect(budgetFor(4, ["dmg"])).toBe(12);
  });
});

describe("costs (CB p.197)", () => {
  it.each([
    ["Social", 1],
    ["Support", 1],
    ["Horde", 2],
    ["Ranged", 2],
    ["Skulk", 2],
    ["Standard", 2],
    ["Leader", 3],
    ["Bruiser", 4],
    ["Solo", 5],
  ] as const)("a %s costs %i", (type, cost) => {
    expect(BP_COSTS[type]).toBe(cost);
    expect(spentFor([one(type)], 4)).toBe(cost);
  });

  it("costs Minions 1 per group the size of the party, rounded up", () => {
    expect(minionGroups([one("Minion", { minionCount: 4 })], 4)).toBe(1);
    expect(spentFor([one("Minion", { minionCount: 4 })], 4)).toBe(1);
    expect(spentFor([one("Minion", { minionCount: 8 })], 4)).toBe(2);
    expect(spentFor([one("Minion", { minionCount: 5 })], 4)).toBe(2);
    expect(spentFor([one("Minion", { minionCount: 2 }), one("Minion", { minionCount: 2 })], 4)).toBe(1);
    expect(spentFor([], 4)).toBe(0);
  });

  it("does not count summoned adversaries (the book's Tip)", () => {
    expect(spentFor([one("Solo", { summoned: true }), one("Minion", { minionCount: 6, summoned: true })], 3)).toBe(0);
    expect(spentFor([one("Bruiser"), one("Bruiser", { summoned: true })], 4)).toBe(4);
  });

  it("costs an unknown type (a deleted custom adversary) nothing", () => {
    expect(spentFor([{ type: null, tier: null, summoned: false }], 4)).toBe(0);
  });

  it("matches the book's worked examples", () => {
    // Two Bruisers, two Standards and four Minions for four PCs: 8 + 4 + 1 = 13.
    expect(spentFor([one("Bruiser"), one("Bruiser"), one("Standard"), one("Standard"), one("Minion", { minionCount: 4 })], 4)).toBe(13);
    // Five Standards, a Ranged and eight Minions: 10 + 2 + 2 = 14.
    const patrol = [...Array.from({ length: 5 }, () => one("Standard")), one("Ranged"), one("Minion", { minionCount: 8 })];
    expect(spentFor(patrol, 4)).toBe(14);
    // A Leader, a Bruiser, two Hordes and a Support: 3 + 4 + 4 + 1 = 12.
    expect(spentFor([one("Leader"), one("Bruiser"), one("Horde"), one("Horde"), one("Support")], 4)).toBe(12);
  });
});

describe("suggested adjustments (hints, never applied)", () => {
  it("suggests twoSolo with 2 or more Solos", () => {
    expect(suggestedAdjustments([one("Solo")], 1)).not.toContain("twoSolo");
    expect(suggestedAdjustments([one("Solo"), one("Solo")], 1)).toContain("twoSolo");
    expect(suggestedAdjustments([one("Solo"), one("Solo", { summoned: true })], 1)).not.toContain("twoSolo");
  });

  it("suggests lowTier when an adversary is from a lower tier than the party's", () => {
    expect(suggestedAdjustments([one("Bruiser", { tier: 2 }), one("Standard", { tier: 2 })], 2)).not.toContain("lowTier");
    expect(suggestedAdjustments([one("Bruiser", { tier: 2 }), one("Standard", { tier: 1 })], 2)).toContain("lowTier");
    expect(suggestedAdjustments([one("Bruiser", { tier: 1, summoned: true })], 2)).not.toContain("lowTier");
    expect(suggestedAdjustments([{ type: null, tier: null, summoned: false }], 2)).not.toContain("lowTier");
  });

  it("suggests noBig when no Bruiser, Horde, Leader or Solo is in the fight", () => {
    expect(suggestedAdjustments([], 1)).not.toContain("noBig");
    expect(suggestedAdjustments([one("Standard"), one("Minion", { minionCount: 4 })], 1)).toContain("noBig");
    for (const big of ["Bruiser", "Horde", "Leader", "Solo"] as const) {
      expect(suggestedAdjustments([one("Standard"), one(big)], 1)).not.toContain("noBig");
    }
  });
});

describe("verdict and panel", () => {
  it("words the verdict like the Sessions board", () => {
    expect(verdict(5)).toBe("5 BP left");
    expect(verdict(0)).toBe("Right on budget");
    expect(verdict(-2)).toBe("Over by 2 BP");
  });

  it("puts it together: 2 Bears and a Lackey group of 4 for 4 PCs spend 9 of 14; Harder or longer makes it 16", () => {
    const entries = [one("Bruiser"), one("Bruiser"), one("Minion", { minionCount: 4 })];
    expect(battlePoints({ pcs: 4, adjustments: [], entries, partyTier: 1 })).toMatchObject({
      budget: 14,
      spent: 9,
      left: 5,
      state: "under",
      verdict: "5 BP left",
      percent: 64,
      minionGroups: 1,
      hints: [],
    });
    expect(battlePoints({ pcs: 4, adjustments: ["hard"], entries, partyTier: 1 }).budget).toBe(16);
    expect(battlePoints({ pcs: 1, adjustments: [], entries, partyTier: 1 }).state).toBe("over");
    expect(battlePoints({ pcs: 1, adjustments: [], entries, partyTier: 1 }).percent).toBe(100);
    expect(battlePoints({ pcs: 2, adjustments: [], entries: [one("Bruiser"), one("Bruiser")], partyTier: 1 }).state).toBe("exact");
    expect(battlePoints({ pcs: 4, adjustments: [], entries, partyTier: 2 }).hints).toEqual(["lowTier"]);
  });
});

describe("optimistic Battle Points update (CL4)", () => {
  it("stacks two quick clicks on + to +2, clamps to 1..12 and toggles adjustments like the server", () => {
    const start = { pcs: 4, adjustments: [] as BpAdjustmentId[] };
    const twice = applyBudgetChange(applyBudgetChange(start, { kind: "pcs", delta: 1 }), { kind: "pcs", delta: 1 });
    expect(twice.pcs).toBe(6);
    expect(applyBudgetChange({ ...start, pcs: 12 }, { kind: "pcs", delta: 1 }).pcs).toBe(12);
    expect(applyBudgetChange({ ...start, pcs: 1 }, { kind: "pcs", delta: -1 }).pcs).toBe(1);
    const hard = applyBudgetChange(start, { kind: "adjustment", adjustment: "hard", on: true });
    expect(hard.adjustments).toEqual(["hard"]);
    expect(applyBudgetChange(hard, { kind: "adjustment", adjustment: "hard", on: true }).adjustments).toEqual(["hard"]);
    expect(applyBudgetChange(hard, { kind: "adjustment", adjustment: "hard", on: false }).adjustments).toEqual([]);
  });
});

describe("instances", () => {
  it("numbers labels after the highest one in the encounter", () => {
    expect(nextLabels("Bear", [], 2)).toEqual(["Bear", "Bear 2"]);
    expect(nextLabels("Bear", ["Bear", "Bear 2"], 1)).toEqual(["Bear 3"]);
    expect(nextLabels("Bear", ["Bear 4", "Bearded Devil", "Bear x"], 1)).toEqual(["Bear 5"]);
    expect(nextLabels("Bear", ["Brown Bear"], 1)).toEqual(["Bear"]);
  });

  it("cuts long names so the label stays within 60 characters", () => {
    const [label] = nextLabels("x".repeat(80), [], 1);
    expect(label!.length).toBeLessThanOrEqual(57);
    expect(nextLabels("x".repeat(80), [label!], 1)[0]!.length).toBeLessThanOrEqual(60);
  });

  it("snapshots the stat block's numbers", () => {
    expect(instanceStats(byName("Bear"))).toEqual({ difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 });
  });

  it("gives a Minion group one Hit Point per Minion and no thresholds", () => {
    expect(instanceStats(byName("Jagged Knife Lackey"), 4)).toEqual({ difficulty: 9, major: null, severe: null, hpMax: 4, stressMax: 1 });
  });

  it("reads Stress None as an empty Stress track", () => {
    const armor = byName("Spellbound Armor");
    expect(armor.stress).toBeNull();
    expect(instanceStats(armor).stressMax).toBe(0);
  });
});
