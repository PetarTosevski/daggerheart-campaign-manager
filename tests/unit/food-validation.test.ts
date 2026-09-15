import { describe, expect, it } from "vitest";

import {
  acquireFoodBatchSchema,
  correctFoodBatchSchema,
  processWeeklyFoodSchema,
} from "@/lib/validation/food";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("acquireFoodBatchSchema", () => {
  const base = { campaignId: uuid, idempotencyKey: uuid, label: "Rations", foodType: "preserved", initialPortions: "7", sourceNote: "" };
  it("accepts valid input and coerces portions", () => {
    const r = acquireFoodBatchSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.initialPortions).toBe(7);
  });
  it("rejects non-positive portions, bad type, blank label, bad uuid", () => {
    expect(acquireFoodBatchSchema.safeParse({ ...base, initialPortions: "0" }).success).toBe(false);
    expect(acquireFoodBatchSchema.safeParse({ ...base, initialPortions: "-3" }).success).toBe(false);
    expect(acquireFoodBatchSchema.safeParse({ ...base, foodType: "spicy" }).success).toBe(false);
    expect(acquireFoodBatchSchema.safeParse({ ...base, label: "  " }).success).toBe(false);
    expect(acquireFoodBatchSchema.safeParse({ ...base, campaignId: "x" }).success).toBe(false);
  });
});

describe("processWeeklyFoodSchema", () => {
  const uuid2 = "22222222-2222-4222-8222-222222222222";
  const base = { campaignId: uuid, idempotencyKey: uuid, targetWeek: "3", overrideRequiredPortions: "", skipSpoilage: false, overrideBatchSelection: false, selectedBatchIds: [] as string[], reason: "" };
  it("accepts an ordinary process without a reason", () => {
    expect(processWeeklyFoodSchema.safeParse(base).success).toBe(true);
  });
  it("requires a reason when overriding required portions", () => {
    expect(processWeeklyFoodSchema.safeParse({ ...base, overrideRequiredPortions: "10" }).success).toBe(false);
    expect(processWeeklyFoodSchema.safeParse({ ...base, overrideRequiredPortions: "10", reason: "party split" }).success).toBe(true);
  });
  it("requires a reason when skipping spoilage", () => {
    expect(processWeeklyFoodSchema.safeParse({ ...base, skipSpoilage: true }).success).toBe(false);
    expect(processWeeklyFoodSchema.safeParse({ ...base, skipSpoilage: true, reason: "kept cold" }).success).toBe(true);
  });
  it("rejects a negative override and week < 1", () => {
    expect(processWeeklyFoodSchema.safeParse({ ...base, overrideRequiredPortions: "-1", reason: "x" }).success).toBe(false);
    expect(processWeeklyFoodSchema.safeParse({ ...base, targetWeek: "0" }).success).toBe(false);
  });

  it("requires a reason and a non-empty list when overriding batch selection", () => {
    expect(processWeeklyFoodSchema.safeParse({ ...base, overrideBatchSelection: true, selectedBatchIds: [uuid], reason: "" }).success).toBe(false);
    expect(processWeeklyFoodSchema.safeParse({ ...base, overrideBatchSelection: true, selectedBatchIds: [], reason: "custom" }).success).toBe(false);
    expect(processWeeklyFoodSchema.safeParse({ ...base, overrideBatchSelection: true, selectedBatchIds: [uuid], reason: "custom" }).success).toBe(true);
  });
  it("rejects duplicate selected batches", () => {
    expect(processWeeklyFoodSchema.safeParse({ ...base, overrideBatchSelection: true, selectedBatchIds: [uuid, uuid], reason: "custom" }).success).toBe(false);
  });
  it("rejects submitted batches when the batch override is off", () => {
    expect(processWeeklyFoodSchema.safeParse({ ...base, overrideBatchSelection: false, selectedBatchIds: [uuid] }).success).toBe(false);
  });
  it("rejects non-uuid batch ids", () => {
    expect(processWeeklyFoodSchema.safeParse({ ...base, overrideBatchSelection: true, selectedBatchIds: ["nope"], reason: "custom" }).success).toBe(false);
  });
  it("accepts an ordered multi-batch selection", () => {
    expect(processWeeklyFoodSchema.safeParse({ ...base, overrideBatchSelection: true, selectedBatchIds: [uuid2, uuid], reason: "custom order" }).success).toBe(true);
  });
});

describe("correctFoodBatchSchema", () => {
  const base = { campaignId: uuid, idempotencyKey: uuid, batchId: uuid, newRemainingPortions: "3", reason: "miscount" };
  it("accepts valid corrections", () => {
    expect(correctFoodBatchSchema.safeParse(base).success).toBe(true);
    expect(correctFoodBatchSchema.safeParse({ ...base, newRemainingPortions: "0" }).success).toBe(true);
  });
  it("requires a reason and rejects negatives / bad ids", () => {
    expect(correctFoodBatchSchema.safeParse({ ...base, reason: "  " }).success).toBe(false);
    expect(correctFoodBatchSchema.safeParse({ ...base, newRemainingPortions: "-1" }).success).toBe(false);
    expect(correctFoodBatchSchema.safeParse({ ...base, batchId: "x" }).success).toBe(false);
  });
});
