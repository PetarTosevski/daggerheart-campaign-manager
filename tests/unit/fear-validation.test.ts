import { describe, expect, it } from "vitest";

import { fearAdjustmentSchema } from "@/lib/validation/fear";

const validInput = {
  campaignId: "11111111-1111-4111-8111-111111111111",
  direction: "increase",
  eventType: "adjustment",
  idempotencyKey: "22222222-2222-4222-8222-222222222222",
};

describe("fearAdjustmentSchema", () => {
  it("accepts a valid adjustment", () => {
    expect(fearAdjustmentSchema.parse(validInput)).toEqual(validInput);
  });

  it("accepts a compensating correction event", () => {
    expect(
      fearAdjustmentSchema.parse({ ...validInput, eventType: "correction" })
        .eventType,
    ).toBe("correction");
  });

  it("rejects invalid directions, event types, campaigns, and request keys", () => {
    expect(
      fearAdjustmentSchema.safeParse({ ...validInput, direction: "set" }).success,
    ).toBe(false);
    expect(
      fearAdjustmentSchema.safeParse({ ...validInput, eventType: "automatic" })
        .success,
    ).toBe(false);
    expect(
      fearAdjustmentSchema.safeParse({ ...validInput, campaignId: "not-a-uuid" })
        .success,
    ).toBe(false);
    expect(
      fearAdjustmentSchema.safeParse({
        ...validInput,
        idempotencyKey: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});
