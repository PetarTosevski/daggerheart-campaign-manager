import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { campaignTimeActionSchema } from "@/lib/validation/campaign-time";

const common = {
  campaignId: randomUUID(),
  idempotencyKey: randomUUID(),
  note: "  The party completed a journey.  ",
};

describe("campaignTimeActionSchema", () => {
  it("accepts an advance and trims its optional note", () => {
    const result = campaignTimeActionSchema.parse({
      ...common,
      intent: "advance",
      targetWeek: "",
      targetCycle: "",
      targetCycleDay: "",
      correctsEventId: "",
    });

    expect(result).toMatchObject({
      intent: "advance",
      note: "The party completed a journey.",
    });
  });

  it("coerces and validates a correction target", () => {
    const correctedEventId = randomUUID();
    const result = campaignTimeActionSchema.parse({
      ...common,
      intent: "correction",
      targetWeek: "3",
      targetCycle: "NIGHT",
      targetCycleDay: "7",
      correctsEventId: correctedEventId,
    });

    expect(result).toMatchObject({
      intent: "correction",
      targetWeek: 3,
      targetCycle: "NIGHT",
      targetCycleDay: 7,
      correctsEventId: correctedEventId,
    });
  });

  it("rejects invalid identifiers, target bounds, cycle, and long notes", () => {
    const result = campaignTimeActionSchema.safeParse({
      campaignId: "not-a-uuid",
      idempotencyKey: "not-a-uuid",
      intent: "correction",
      targetWeek: "0",
      targetCycle: "TWILIGHT",
      targetCycleDay: "8",
      note: "x".repeat(201),
      correctsEventId: "not-a-uuid",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields.campaignId).toBeDefined();
      expect(fields.idempotencyKey).toBeDefined();
      expect(fields.targetWeek).toBeDefined();
      expect(fields.targetCycle).toBeDefined();
      expect(fields.targetCycleDay).toBeDefined();
      expect(fields.note).toBeDefined();
      expect(fields.correctsEventId).toBeDefined();
    }
  });
});
