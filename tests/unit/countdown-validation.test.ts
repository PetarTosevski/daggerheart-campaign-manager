import { describe, expect, it } from "vitest";

import { COUNTDOWN_DICE_SIDES, COUNTDOWN_MODES } from "@/lib/domain/countdowns/advanced";
import {
  COUNTDOWN_REASON_MAX_LENGTH,
  countdownDetailsSchema,
  createCountdownSchema,
  operateCountdownSchema,
  restTickSchema,
} from "@/lib/validation/countdowns";

const campaignId = "11111111-1111-4111-8111-111111111111";
const countdownId = "22222222-2222-4222-8222-222222222222";
const idempotencyKey = "33333333-3333-4333-8333-333333333333";

describe("countdown validation", () => {
  it("accepts a valid constrained countdown", () => {
    expect(
      createCountdownSchema.parse({
        campaignId,
        name: "  Encroaching blight  ",
        description: "A threat approaches.",
        category: "threat",
        startingValue: "6",
        consequence: "The refuge is overrun.",
        idempotencyKey,
      }),
    ).toMatchObject({
      campaignId,
      name: "Encroaching blight",
      category: "threat",
      startingValue: 6,
    });
  });

  it("rejects unsupported categories and invalid starting values", () => {
    const base = {
      campaignId,
      name: "Project",
      description: "",
      consequence: "",
      idempotencyKey,
    };

    expect(
      createCountdownSchema.safeParse({
        ...base,
        category: "custom",
        startingValue: 6,
      }).success,
    ).toBe(false);
    expect(
      createCountdownSchema.safeParse({
        ...base,
        category: "project",
        startingValue: 0,
      }).success,
    ).toBe(false);
  });

  describe("rest ticks (rest-ticks RT1)", () => {
    const details = { name: "Storm", description: "", category: "threat" as const, consequence: "", startingValue: 6 };

    it("accepts every amount kind on every mode", () => {
      const settings = [
        { amount: { kind: "fixed", n: 1 }, mode: "auto" },
        { amount: { kind: "fixed", n: 20 }, mode: "remind" },
        { amount: { kind: "pcs" }, mode: "auto" },
        ...COUNTDOWN_DICE_SIDES.map((sides) => ({ amount: { kind: "die", sides }, mode: "remind" })),
        ...COUNTDOWN_DICE_SIDES.map((sides) => ({ amount: { kind: "diePlusPcs", sides }, mode: "auto" })),
      ];
      for (const setting of settings) expect(restTickSchema.safeParse(setting).success).toBe(true);
      for (const mode of COUNTDOWN_MODES) {
        const parsed = countdownDetailsSchema.safeParse({ ...details, mode, onLongRest: settings[0], onShortRest: settings[3] });
        expect(parsed.success).toBe(true);
      }
    });

    it("rejects a fixed amount outside 1..20, other dice, unknown kinds and modes", () => {
      for (const bad of [
        { amount: { kind: "fixed", n: 0 }, mode: "auto" },
        { amount: { kind: "fixed", n: 21 }, mode: "auto" },
        { amount: { kind: "fixed", n: 1.5 }, mode: "auto" },
        { amount: { kind: "die", sides: 3 }, mode: "auto" },
        { amount: { kind: "diePlusPcs", sides: 100 }, mode: "auto" },
        { amount: { kind: "half" }, mode: "auto" },
        { amount: { kind: "pcs" }, mode: "sometimes" },
      ]) {
        expect(restTickSchema.safeParse(bad).success).toBe(false);
        expect(countdownDetailsSchema.safeParse({ ...details, onShortRest: bad }).success).toBe(false);
      }
    });
  });

  it("validates operation intent, mode, reason, and request key", () => {
    expect(
      operateCountdownSchema.safeParse({
        countdownId,
        intent: "advance",
        eventMode: "correction",
        reason: "Fix the previous step.",
        idempotencyKey,
      }).success,
    ).toBe(true);

    expect(
      operateCountdownSchema.safeParse({
        countdownId,
        intent: "complete",
        eventMode: "operation",
        reason: "x".repeat(COUNTDOWN_REASON_MAX_LENGTH + 1),
        idempotencyKey: "invalid",
      }).success,
    ).toBe(false);
  });
});
