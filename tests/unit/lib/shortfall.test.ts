import { describe, expect, it } from "vitest";

import { shortfalls, unaffordable, type PayerState } from "../../../src/lib/domain/card-effects/availability";
import { appError } from "../../../src/lib/errors/app-error";

/**
 * dcm-bxp.99.32.2: cost refusals carry a structured `shortfall` { resource, need, have } (board CmpBlocked: "Wall Walk
 * costs 1 Hope. You have 0."). `shortfalls` gives the numbers behind `unaffordable`, in the same order.
 */

const state = (over: Partial<PayerState> = {}): PayerState => ({
  hope: 0,
  stress: 5,
  stressMax: 6,
  hp: 0,
  hpMax: 6,
  armor: 0,
  armorMax: 3,
  cardTokens: 0,
  ...over,
});

describe("shortfalls", () => {
  it("names each short resource with what the use needs and what the payer has", () => {
    const costs = [
      { resource: "hope" as const, amount: 1 },
      { resource: "stress" as const, amount: 2 },
      { resource: "armor" as const, amount: 1 },
    ];
    expect(shortfalls(costs, state())).toEqual([
      { resource: "hope", need: 1, have: 0 },
      // Stress is marked: `have` is the room left on the track (6 - 5).
      { resource: "stress", need: 2, have: 1 },
    ]);
    expect(shortfalls(costs, state()).map((s) => s.resource)).toEqual(unaffordable(costs, state()));
  });

  it("is empty when the cost is affordable; a Hope cost under cannotSpendHope has 0", () => {
    expect(shortfalls([{ resource: "hope", amount: 2 }], state({ hope: 3 }))).toEqual([]);
    expect(shortfalls([{ resource: "hope", amount: 2 }], state({ hope: 3, flags: ["cannotSpendHope"] }))).toEqual([{ resource: "hope", need: 2, have: 0 }]);
  });

  it("reads Favor and Focus by name, held dice as tokens, and the GM's Fear", () => {
    expect(shortfalls([{ resource: "tokens", amount: 2, pool: "favor" }], state({ favor: 1 }))).toEqual([{ resource: "favor", need: 2, have: 1 }]);
    expect(shortfalls([{ resource: "tokens", amount: 1, pool: "focus" }], state({ focus: 0 }))).toEqual([{ resource: "focus", need: 1, have: 0 }]);
    expect(shortfalls([{ resource: "tokens", amount: 1, pool: "rally" }], state())).toEqual([{ resource: "tokens", need: 1, have: 0 }]);
    expect(shortfalls([{ resource: "fear", amount: 2 }], state({ fear: 1 }))).toEqual([{ resource: "fear", need: 2, have: 1 }]);
  });
});

describe("appError with a shortfall", () => {
  it("puts it on the payload next to the code and message, and leaves it off otherwise", () => {
    expect(appError("CARD_COST_UNPAID", "Short of: hope.", { resource: "hope", need: 1, have: 0 }).data).toEqual({
      code: "CARD_COST_UNPAID",
      message: "Short of: hope.",
      shortfall: { resource: "hope", need: 1, have: 0 },
    });
    expect(appError("NOT_ENOUGH_FEAR", undefined, { resource: "fear", need: 1, have: 0 }).data).toEqual({ code: "NOT_ENOUGH_FEAR", shortfall: { resource: "fear", need: 1, have: 0 } });
    expect(appError("CARD_COST_UNPAID", "x").data).toEqual({ code: "CARD_COST_UNPAID", message: "x" });
  });
});
