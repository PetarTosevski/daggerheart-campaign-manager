import { describe, expect, it } from "vitest";

import {
  computeWeeklyPreview,
  fifoOrder,
  formatFoodTotal,
  isFreshSpoilageEligible,
  isReservedFoodKey,
  projectFoodSheetValue,
  rationsAndPortions,
  selectableBatches,
  validateBatchSelection,
  weeklyRequirementPortions,
  type PreviewBatch,
} from "@/lib/domain/food";

describe("ration/portion conversion", () => {
  it("defaults to 1 ration = 7 portions", () => {
    expect(rationsAndPortions(7)).toEqual({ rations: 1, portions: 0 });
    expect(rationsAndPortions(10)).toEqual({ rations: 1, portions: 3 });
    expect(rationsAndPortions(0)).toEqual({ rations: 0, portions: 0 });
    expect(formatFoodTotal(15)).toBe("2 rations, 1 portion");
  });
});

describe("weekly requirement", () => {
  it("derives from active characters (never hard-coded names)", () => {
    expect(weeklyRequirementPortions(0)).toBe(0);
    expect(weeklyRequirementPortions(1)).toBe(7);
    expect(weeklyRequirementPortions(5)).toBe(35);
    expect(weeklyRequirementPortions(3, 7)).toBe(21);
  });
});

describe("spoilage boundary", () => {
  it("is eligible only at or after acquired week + 2", () => {
    expect(isFreshSpoilageEligible(3, 4)).toBe(false); // W = A+1
    expect(isFreshSpoilageEligible(3, 5)).toBe(true); // W = A+2
    expect(isFreshSpoilageEligible(3, 6)).toBe(true); // W = A+3
  });
});

describe("reserved food keys", () => {
  it("projects the shared total", () => {
    expect(isReservedFoodKey("food_rations")).toBe(true);
    expect(isReservedFoodKey("food_portions")).toBe(true);
    expect(isReservedFoodKey("strength")).toBe(false);
    expect(projectFoodSheetValue("food_rations", 16)).toBe("2");
    expect(projectFoodSheetValue("food_portions", 16)).toBe("2");
  });
});

describe("fifoOrder", () => {
  it("orders by acquired week, then created_at, then id", () => {
    const batches = [
      { id: "b", acquired_week: 2, created_at: "2026-01-02" },
      { id: "a", acquired_week: 1, created_at: "2026-01-05" },
      { id: "c", acquired_week: 2, created_at: "2026-01-01" },
    ];
    expect(fifoOrder(batches).map((b) => b.id)).toEqual(["a", "c", "b"]);
  });
});

function batch(overrides: Partial<PreviewBatch> = {}): PreviewBatch {
  return {
    id: "b1",
    label: "Batch",
    food_type: "preserved",
    status: "active",
    acquired_week: 1,
    remaining_portions: 14,
    created_at: "2026-01-01",
    ...overrides,
  };
}

describe("computeWeeklyPreview", () => {
  it("consumes FIFO across batches with exact supply", () => {
    const p = computeWeeklyPreview({
      batches: [
        batch({ id: "a", acquired_week: 1, remaining_portions: 10, created_at: "2026-01-01" }),
        batch({ id: "b", acquired_week: 2, remaining_portions: 10, created_at: "2026-01-02" }),
      ],
      targetWeek: 2,
      activeCharacterCount: 2, // 14 required
    });
    expect(p.appliedRequiredPortions).toBe(14);
    expect(p.consumedPortions).toBe(14);
    expect(p.shortagePortions).toBe(0);
    expect(p.batches.find((b) => b.id === "a")!.consumed).toBe(10);
    expect(p.batches.find((b) => b.id === "b")!.consumed).toBe(4);
    expect(p.totalAfter).toBe(6);
  });

  it("reports a shortage when supply is insufficient", () => {
    const p = computeWeeklyPreview({
      batches: [batch({ remaining_portions: 5 })],
      targetWeek: 1,
      activeCharacterCount: 2, // 14 required
    });
    expect(p.consumedPortions).toBe(5);
    expect(p.shortagePortions).toBe(9);
    expect(p.totalAfter).toBe(0);
  });

  it("leaves a partial batch on excess supply", () => {
    const p = computeWeeklyPreview({
      batches: [batch({ remaining_portions: 20 })],
      targetWeek: 1,
      activeCharacterCount: 1, // 7 required
    });
    expect(p.consumedPortions).toBe(7);
    expect(p.batches[0].after).toBe(13);
  });

  it("spoils eligible fresh food before consumption", () => {
    const p = computeWeeklyPreview({
      batches: [
        batch({ id: "old", food_type: "fresh", acquired_week: 1, remaining_portions: 7, created_at: "2026-01-01" }),
        batch({ id: "keep", food_type: "preserved", acquired_week: 3, remaining_portions: 7, created_at: "2026-01-03" }),
      ],
      targetWeek: 3, // old fresh (W>=A+2) spoils, preserved stays
      activeCharacterCount: 1, // 7 required
    });
    expect(p.spoiledPortions).toBe(7);
    expect(p.batches.find((b) => b.id === "old")!.spoiled).toBe(7);
    expect(p.consumedPortions).toBe(7);
    expect(p.batches.find((b) => b.id === "keep")!.consumed).toBe(7);
    expect(p.shortagePortions).toBe(0);
  });

  it("honors an override with skip-spoilage", () => {
    const p = computeWeeklyPreview({
      batches: [batch({ food_type: "fresh", acquired_week: 1, remaining_portions: 10 })],
      targetWeek: 5,
      activeCharacterCount: 3, // default 21
      override: { requiredPortions: 4, skipSpoilage: true },
    });
    expect(p.usedOverride).toBe(true);
    expect(p.spoiledPortions).toBe(0);
    expect(p.appliedRequiredPortions).toBe(4);
    expect(p.consumedPortions).toBe(4);
    expect(p.batches[0].after).toBe(6);
  });

  it("keeps default FIFO fields when no selection is supplied", () => {
    const p = computeWeeklyPreview({
      batches: [batch({ remaining_portions: 20 })],
      targetWeek: 1,
      activeCharacterCount: 1,
    });
    expect(p.usedCustomSelection).toBe(false);
    expect(p.effectiveSelectedBatchIds).toEqual([]);
    expect(p.consumableAvailablePortions).toBe(p.availableAfterSpoilage);
    expect(p.batches.every((b) => b.selected && b.order === null)).toBe(true);
  });
});

describe("computeWeeklyPreview with custom batch selection", () => {
  const three = [
    batch({ id: "a", acquired_week: 1, remaining_portions: 7, created_at: "2026-01-01" }),
    batch({ id: "b", acquired_week: 2, remaining_portions: 7, created_at: "2026-01-02" }),
    batch({ id: "c", acquired_week: 3, remaining_portions: 7, created_at: "2026-01-03" }),
  ];

  it("consumes only selected batches, in the submitted order", () => {
    const p = computeWeeklyPreview({
      batches: three,
      targetWeek: 3,
      activeCharacterCount: 1, // 7 required
      override: { selectedBatchIds: ["c", "b"] }, // newest first, oldest 'a' excluded
    });
    expect(p.usedCustomSelection).toBe(true);
    expect(p.effectiveSelectedBatchIds).toEqual(["c", "b"]);
    expect(p.batches.find((x) => x.id === "c")!.consumed).toBe(7);
    expect(p.batches.find((x) => x.id === "c")!.order).toBe(1);
    expect(p.batches.find((x) => x.id === "b")!.consumed).toBe(0);
    expect(p.batches.find((x) => x.id === "b")!.order).toBe(2);
    // 'a' is excluded and untouched despite being the FIFO-oldest.
    const a = p.batches.find((x) => x.id === "a")!;
    expect(a.selected).toBe(false);
    expect(a.consumed).toBe(0);
    expect(a.after).toBe(7);
  });

  it("reports a shortage from the selected supply, never falling back", () => {
    const p = computeWeeklyPreview({
      batches: three,
      targetWeek: 3,
      activeCharacterCount: 3, // 21 required
      override: { selectedBatchIds: ["b"] }, // only 7 available in the selection
    });
    expect(p.consumableAvailablePortions).toBe(7);
    expect(p.consumedPortions).toBe(7);
    expect(p.shortagePortions).toBe(14); // 21 - 7, even though a+c still hold food
    expect(p.unconsumedSelectedPortions).toBe(0);
    expect(p.batches.find((x) => x.id === "a")!.after).toBe(7);
    expect(p.batches.find((x) => x.id === "c")!.after).toBe(7);
  });

  it("reports unconsumed selected portions when the selection exceeds the requirement", () => {
    const p = computeWeeklyPreview({
      batches: three,
      targetWeek: 3,
      activeCharacterCount: 1, // 7 required
      override: { selectedBatchIds: ["a", "b", "c"] },
    });
    expect(p.consumedPortions).toBe(7);
    expect(p.unconsumedSelectedPortions).toBe(14);
  });

  it("spoils a selected fresh batch before consuming (contributes nothing)", () => {
    const p = computeWeeklyPreview({
      batches: [
        batch({ id: "fresh", food_type: "fresh", acquired_week: 1, remaining_portions: 7, created_at: "2026-01-01" }),
        batch({ id: "keep", food_type: "preserved", acquired_week: 1, remaining_portions: 7, created_at: "2026-01-02" }),
      ],
      targetWeek: 3, // fresh (W>=A+2) spoils
      activeCharacterCount: 1,
      override: { selectedBatchIds: ["fresh", "keep"] },
    });
    expect(p.spoiledPortions).toBe(7);
    expect(p.batches.find((x) => x.id === "fresh")!.consumed).toBe(0);
    expect(p.batches.find((x) => x.id === "keep")!.consumed).toBe(7);
  });

  it("combines a custom selection with skip-spoilage and a portions override", () => {
    const p = computeWeeklyPreview({
      batches: [
        batch({ id: "fresh", food_type: "fresh", acquired_week: 1, remaining_portions: 10, created_at: "2026-01-01" }),
        batch({ id: "pres", food_type: "preserved", acquired_week: 1, remaining_portions: 10, created_at: "2026-01-02" }),
      ],
      targetWeek: 9,
      activeCharacterCount: 4, // default 28
      override: { requiredPortions: 6, skipSpoilage: true, selectedBatchIds: ["fresh"] },
    });
    expect(p.spoiledPortions).toBe(0); // skip-spoilage keeps the fresh batch
    expect(p.appliedRequiredPortions).toBe(6);
    expect(p.batches.find((x) => x.id === "fresh")!.consumed).toBe(6);
    expect(p.batches.find((x) => x.id === "pres")!.consumed).toBe(0);
  });
});

describe("selectableBatches", () => {
  it("orders FIFO and flags batches that will spoil this week", () => {
    const s = selectableBatches({
      batches: [
        batch({ id: "fresh", food_type: "fresh", acquired_week: 1, remaining_portions: 7, created_at: "2026-01-01" }),
        batch({ id: "pres", food_type: "preserved", acquired_week: 1, remaining_portions: 7, created_at: "2026-01-02" }),
      ],
      targetWeek: 3,
    });
    expect(s.map((b) => b.id)).toEqual(["fresh", "pres"]);
    expect(s.find((b) => b.id === "fresh")!.willSpoil).toBe(true);
    expect(s.find((b) => b.id === "pres")!.willSpoil).toBe(false);
  });

  it("does not flag spoilage when it is skipped", () => {
    const s = selectableBatches({
      batches: [batch({ id: "fresh", food_type: "fresh", acquired_week: 1, remaining_portions: 7 })],
      targetWeek: 9,
      skipSpoilage: true,
    });
    expect(s[0].willSpoil).toBe(false);
  });
});

describe("validateBatchSelection", () => {
  const batches = [
    batch({ id: "a", acquired_week: 1, remaining_portions: 7, created_at: "2026-01-01" }),
    batch({ id: "fresh", food_type: "fresh", acquired_week: 1, remaining_portions: 7, created_at: "2026-01-02" }),
  ];

  it("accepts a valid, ordered, unique selection", () => {
    expect(validateBatchSelection({ selectedBatchIds: ["a"], batches, targetWeek: 1 })).toEqual({ ok: true, ids: ["a"] });
  });
  it("rejects an empty selection", () => {
    expect(validateBatchSelection({ selectedBatchIds: [], batches, targetWeek: 1 })).toMatchObject({ ok: false, issue: "empty" });
  });
  it("rejects duplicates", () => {
    expect(validateBatchSelection({ selectedBatchIds: ["a", "a"], batches, targetWeek: 1 })).toMatchObject({ ok: false, issue: "duplicate" });
  });
  it("rejects unknown ids", () => {
    expect(validateBatchSelection({ selectedBatchIds: ["zzz"], batches, targetWeek: 1 })).toMatchObject({ ok: false, issue: "unknown" });
  });
  it("rejects a batch that will spoil this week", () => {
    expect(validateBatchSelection({ selectedBatchIds: ["fresh"], batches, targetWeek: 3 })).toMatchObject({ ok: false, issue: "will-spoil" });
  });
  it("accepts a fresh batch when spoilage is skipped", () => {
    expect(validateBatchSelection({ selectedBatchIds: ["fresh"], batches, targetWeek: 3, skipSpoilage: true })).toMatchObject({ ok: true });
  });
});
