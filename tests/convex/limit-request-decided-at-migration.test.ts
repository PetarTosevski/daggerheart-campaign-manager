import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { setupWithCampaign } from "./helpers";

/**
 * dcm-bxp.82.14: `migrations/limitRequestDecidedAt` gives a decided limit request without `decidedAt` its `createdAt`
 * (so `adminRetention.expireLimitRequests`, which reads `by_status_decidedAt`, still reaches it) and leaves pending and
 * already-dated rows alone (TE5: old shape in, new shape out, a second run changes nothing).
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type T = Awaited<ReturnType<typeof setupWithCampaign>>["t"];

async function run(t: T, dryRun = false) {
  await t.mutation(internal.migrations.run.run, { fn: "migrations/limitRequestDecidedAt:backfillDecidedAt", ...(dryRun ? { dryRun: true } : {}) });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("migrations/limitRequestDecidedAt:backfillDecidedAt", () => {
  it("backfills decided rows only; a dry run and a second run change nothing", async () => {
    const { t, campaignId } = await setupWithCampaign();
    const made = await t.run(async (ctx) => {
      const campaign = (await ctx.db.get("campaigns", campaignId))!;
      const base = { campaignId, requestedBy: campaign.ownerId, wants: { dailyQuestions: 60 }, reason: "r", createdAt: 5 };
      return {
        legacy: await ctx.db.insert("lorekeeperLimitRequests", { ...base, status: "declined" }),
        pending: await ctx.db.insert("lorekeeperLimitRequests", { ...base, status: "pending" }),
        decided: await ctx.db.insert("lorekeeperLimitRequests", { ...base, status: "approved", decidedAt: 9 }),
      };
    });
    const get = (id: Id<"lorekeeperLimitRequests">) => t.run((ctx) => ctx.db.get("lorekeeperLimitRequests", id));

    await run(t, true);
    expect((await get(made.legacy))!.decidedAt).toBeUndefined();

    await run(t);
    expect((await get(made.legacy))!.decidedAt).toBe(5);
    expect((await get(made.pending))!.decidedAt).toBeUndefined();
    expect((await get(made.decided))!.decidedAt).toBe(9);

    await run(t);
    expect((await get(made.legacy))!.decidedAt).toBe(5);
  });
});
