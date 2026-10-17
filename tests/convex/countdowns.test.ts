import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorCode, errorData, key, setupWithCampaign, useAllowlist } from "./helpers";

const DETAILS = {
  name: "  The bridge collapses ",
  description: "",
  category: "threat" as const,
  startingValue: 3,
  consequence: "The road east is cut off.",
};

async function withCountdown(startingValue = 3) {
  const ctx = await setupWithCampaign();
  const { countdownId } = await ctx.gm.mutation(api.countdowns.create, {
    campaignId: ctx.campaignId,
    ...DETAILS,
    startingValue,
    idempotencyKey: key(),
  });
  const op = (action: "advance" | "reverse" | "pause" | "resume" | "cancel" | "correction", amount?: number) =>
    ctx.gm.mutation(api.countdowns.operate, { countdownId, action, amount, idempotencyKey: key() });
  const current = async () =>
    (await ctx.gm.query(api.countdowns.listByCampaign, { campaignId: ctx.campaignId })).find(
      (c) => c._id === countdownId,
    );
  return { ...ctx, countdownId: countdownId as Id<"countdowns">, op, current };
}

describe("countdowns", () => {
  useAllowlist();

  it("creates an active countdown at its starting value with trimmed text", async () => {
    const { current } = await withCountdown();
    expect(await current()).toMatchObject({
      name: "The bridge collapses",
      currentValue: 3,
      startingValue: 3,
      status: "active",
      category: "threat",
      completedAt: null,
    });
  });

  it("validates the details", async () => {
    const { gm, campaignId } = await setupWithCampaign();
    for (const bad of [{ name: " " }, { startingValue: 0 }, { startingValue: 21 }, { startingValue: 2.5 }]) {
      const error = await gm
        .mutation(api.countdowns.create, { campaignId, ...DETAILS, ...bad, idempotencyKey: key() })
        .catch((e) => e);
      expect(errorCode(error)).toBe("INVALID");
    }
  });

  it("ticks down to completion once, records the time, and reopens by reversing", async () => {
    const { op, current } = await withCountdown(2);
    await op("advance");
    expect(await op("advance")).toEqual({ previousValue: 1, newValue: 0, status: "completed" });
    const done = await current();
    expect(done?.completedAt).toEqual(expect.any(Number));
    expect(errorCode(await op("advance").catch((e) => e))).toBe("COUNTDOWN_RULE");
    await op("reverse");
    expect(await current()).toMatchObject({ currentValue: 1, status: "active", completedAt: null });
  });

  it("blocks ticking while paused but allows a correction", async () => {
    const { op, current } = await withCountdown(5);
    await op("pause");
    expect(errorCode(await op("advance").catch((e) => e))).toBe("COUNTDOWN_RULE");
    await op("correction", -2);
    expect(await current()).toMatchObject({ currentValue: 3, status: "paused" });
    await op("resume");
    expect((await current())?.status).toBe("active");
  });

  it("keeps the value within 0 and the starting value", async () => {
    const { op } = await withCountdown(3);
    expect(errorCode(await op("reverse").catch((e) => e))).toBe("COUNTDOWN_RULE");
    expect(errorCode(await op("correction", -4).catch((e) => e))).toBe("COUNTDOWN_RULE");
  });

  it("hides a cancelled countdown and refuses further changes", async () => {
    const { op, current } = await withCountdown();
    await op("cancel");
    expect(await current()).toBeUndefined();
    expect(errorCode(await op("resume").catch((e) => e))).toBe("COUNTDOWN_RULE");
  });

  it("requires an amount exactly for corrections", async () => {
    const { op } = await withCountdown();
    expect(errorCode(await op("correction").catch((e) => e))).toBe("INVALID");
    expect(errorCode(await op("advance", 1).catch((e) => e))).toBe("INVALID");
  });

  it("replays a retried operation", async () => {
    const { gm, countdownId, current } = await withCountdown(5);
    const k = key();
    await gm.mutation(api.countdowns.operate, { countdownId, action: "advance", idempotencyKey: k });
    await gm.mutation(api.countdowns.operate, { countdownId, action: "advance", idempotencyKey: k });
    expect((await current())?.currentValue).toBe(4);
    const mismatch = await gm
      .mutation(api.countdowns.operate, { countdownId, action: "reverse", idempotencyKey: k })
      .catch((e) => e);
    expect(errorData(mismatch)).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("hides another owner's countdowns", async () => {
    const { other, campaignId, countdownId } = await withCountdown();
    expect(errorData(await other.query(api.countdowns.listByCampaign, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    const error = await other
      .mutation(api.countdowns.operate, { countdownId, action: "advance", idempotencyKey: key() })
      .catch((e) => e);
    expect(errorData(error)).toBe("NOT_FOUND");
  });
});
