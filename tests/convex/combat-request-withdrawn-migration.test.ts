import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { setupWithCampaign } from "./helpers";

/**
 * dcm-bxp.99.32.17: `migrations/combatRequestWithdrawn` moves HD3's withdrawals (a sanction `declined` by its own
 * creator) to `withdrawn` and leaves GM declines, other kinds and open rows alone (TE5; a second run changes nothing).
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type T = Awaited<ReturnType<typeof setupWithCampaign>>["t"];

async function run(t: T, dryRun = false) {
  await t.mutation(internal.migrations.run.run, { fn: "migrations/combatRequestWithdrawn:markWithdrawn", ...(dryRun ? { dryRun: true } : {}) });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("migrations/combatRequestWithdrawn:markWithdrawn", () => {
  it("marks self-declined sanctions withdrawn, nothing else; a dry run and a second run change nothing", async () => {
    const { t, campaignId } = await setupWithCampaign();
    const ids = await t.run(async (ctx) => {
      const campaign = (await ctx.db.get("campaigns", campaignId))!;
      const gm = campaign.ownerId;
      const player = await ctx.db.insert("users", { email: "p@example.com", emailVerificationTime: 1 });
      const characterId = await ctx.db.insert("characters", { campaignId, ownerId: player, createdBy: player, status: "active", sheet: { name: "Ash" }, createdAt: 0, updatedAt: 0 });
      const sanction = { schemaVersion: 1 as const, kind: "sanction" as const, characterId, action: { kind: "attack" as const, slot: "primary" as const, targetTokenIds: [], roll: {} }, outOfRange: [] };
      const base = { campaignId, kind: "sanction" as const, createdBy: player, createdAt: 0, responses: [], payload: sanction };
      const targetCount = { schemaVersion: 1 as const, kind: "targetCount" as const, characterId, featureId: "f", useId: "main", count: 2 };
      return {
        withdrawn: await ctx.db.insert("combatRequests", { ...base, status: "declined", resolvedAt: 1, resolvedBy: player }),
        gmDeclined: await ctx.db.insert("combatRequests", { ...base, status: "declined", resolvedAt: 1, resolvedBy: gm }),
        open: await ctx.db.insert("combatRequests", { ...base, status: "open" }),
        otherKind: await ctx.db.insert("combatRequests", { ...base, kind: "targetCount", payload: targetCount, status: "declined", resolvedAt: 1, resolvedBy: player }),
      };
    });
    const status = (id: Id<"combatRequests">) => t.run(async (ctx) => (await ctx.db.get("combatRequests", id))!.status);

    await run(t, true);
    expect(await status(ids.withdrawn)).toBe("declined");

    await run(t);
    expect(await status(ids.withdrawn)).toBe("withdrawn");
    expect(await status(ids.gmDeclined)).toBe("declined");
    expect(await status(ids.open)).toBe("open");
    expect(await status(ids.otherKind)).toBe("declined");

    await run(t);
    expect(await status(ids.withdrawn)).toBe("withdrawn");
  });
});
