import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { setupWithCampaign } from "./helpers";

/**
 * Plan lanes-2, E2.3 (dcm-bxp.99.19.60): `migrations/targetCountExpiresAt` clears the retired `expiresAt` from
 * `targetCount` rows and leaves every other row alone (TE5: old shape in, new shape out, a second run changes nothing).
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type T = Awaited<ReturnType<typeof setupWithCampaign>>["t"];
const fn = "migrations/targetCountExpiresAt:clearExpiresAt";

async function run(t: T, dryRun = false) {
  await t.mutation(internal.migrations.run.run, { fn, ...(dryRun ? { dryRun: true } : {}) });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function rows(t: T, campaignId: Id<"campaigns">) {
  return t.run(async (ctx) => {
    const campaign = (await ctx.db.get("campaigns", campaignId))!;
    const characterId = await ctx.db.insert("characters", { campaignId, ownerId: campaign.ownerId, createdBy: campaign.ownerId, status: "active", sheet: { name: "Warden" }, createdAt: 0, updatedAt: 0 });
    const base = { campaignId, status: "open" as const, createdBy: campaign.ownerId, createdAt: 0, responses: [] };
    const payload = { schemaVersion: 1 as const, kind: "targetCount" as const, characterId, featureId: "class:druid:wardens-protection", useId: "main", count: 3 };
    const old = await ctx.db.insert("combatRequests", { ...base, kind: "targetCount", payload: { ...payload, expiresAt: Number.MAX_SAFE_INTEGER } });
    const fresh = await ctx.db.insert("combatRequests", { ...base, kind: "targetCount", payload });
    return { old, fresh };
  });
}

describe("migrations/targetCountExpiresAt:clearExpiresAt", () => {
  it("clears expiresAt from targetCount rows only; a dry run and a second run change nothing", async () => {
    const { t, campaignId } = await setupWithCampaign();
    const { old, fresh } = await rows(t, campaignId);
    const get = (id: Id<"combatRequests">) => t.run((ctx) => ctx.db.get("combatRequests", id));

    await run(t, true);
    expect((await get(old))!.payload).toMatchObject({ expiresAt: Number.MAX_SAFE_INTEGER });

    await run(t);
    const after = (await get(old))!.payload;
    expect(after).not.toHaveProperty("expiresAt");
    expect(after).toMatchObject({ kind: "targetCount", count: 3, useId: "main" });
    const untouched = (await get(fresh))!;

    await run(t);
    expect((await get(fresh))!).toEqual(untouched);
    expect((await get(old))!.payload).not.toHaveProperty("expiresAt");
  });
});
