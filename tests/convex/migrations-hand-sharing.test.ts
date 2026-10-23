import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { setupWithCampaign, useAllowlist } from "./helpers";

/**
 * F8-I1 (dcm-bxp.99.27): `migrations/handSharing` moves F7-H4's hand sharing into typed fields (TE5: old shape in,
 * new shape out, a second run changes nothing).
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type T = Awaited<ReturnType<typeof setupWithCampaign>>["t"];

async function run(t: T, fn: string, dryRun = false) {
  await t.mutation(internal.migrations.run.run, { fn, ...(dryRun ? { dryRun: true } : {}) });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function character(t: T, campaignId: Id<"campaigns">, name: string): Promise<Id<"characters">> {
  return t.run(async (ctx) => {
    const campaign = (await ctx.db.get("campaigns", campaignId))!;
    return ctx.db.insert("characters", { campaignId, ownerId: campaign.ownerId, createdBy: campaign.ownerId, status: "active", sheet: { name }, createdAt: 0, updatedAt: 0 });
  });
}

describe("migrations/handSharing:moveSwitch", () => {
  useAllowlist();
  const fn = "migrations/handSharing:moveSwitch";

  it("moves the options key to the field, keeps the other options, and unsets an emptied options record", async () => {
    const { t, gm, campaignId } = await setupWithCampaign();
    const { campaignId: second } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Second", idempotencyKey: "k-second" });
    const { campaignId: third } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Third", idempotencyKey: "k-third" });
    await t.run(async (ctx) => {
      await ctx.db.patch("campaigns", campaignId, { options: { playersSeeHands: false, someRule: true } });
      await ctx.db.patch("campaigns", second, { options: { playersSeeHands: true } });
      // The GM flipped the new switch after the deploy: the field wins over the stale key.
      await ctx.db.patch("campaigns", third, { options: { playersSeeHands: false }, playersSeeHands: true });
    });

    await run(t, fn, true);
    expect((await t.run((ctx) => ctx.db.get("campaigns", campaignId)))!.options).toEqual({ playersSeeHands: false, someRule: true });

    await run(t, fn);
    const [a, b, c] = await t.run((ctx) => Promise.all([campaignId, second, third].map((id) => ctx.db.get("campaigns", id))));
    expect(a).toMatchObject({ options: { someRule: true }, playersSeeHands: false });
    expect(b!.options).toBeUndefined();
    expect(b!.playersSeeHands).toBe(true);
    expect(c!.options).toBeUndefined();
    expect(c!.playersSeeHands).toBe(true);
    // Read through the server: the switch is off in the first campaign.
    expect((await gm.query(api.combatCards.handSharing, { campaignId })).playersSeeHands).toBe(false);

    await run(t, fn);
    expect(await t.run((ctx) => ctx.db.get("campaigns", campaignId))).toEqual(a);
  });
});

describe("migrations/handSharing:moveHidden", () => {
  useAllowlist();
  const fn = "migrations/handSharing:moveHidden";

  it("marks each listed character of the row's campaign hidden, drops other ids, deletes the row and keeps other trackers", async () => {
    const { t, gm, campaignId } = await setupWithCampaign();
    const { campaignId: elsewhere } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Elsewhere", idempotencyKey: "k-elsewhere" });
    const ash = await character(t, campaignId, "Ash");
    const bryn = await character(t, campaignId, "Bryn");
    const stranger = await character(t, elsewhere, "Stranger");
    await t.run(async (ctx) => {
      await ctx.db.insert("frameTrackers", { campaignId, key: "handPrivacy", data: { schemaVersion: 1, hidden: [ash, stranger, "not-an-id"] }, updatedAt: 0 });
      await ctx.db.insert("frameTrackers", { campaignId, key: "someTracker", data: { schemaVersion: 1 }, updatedAt: 0 });
    });

    await run(t, fn);
    const [a, b, s] = await t.run((ctx) => Promise.all([ash, bryn, stranger].map((id) => ctx.db.get("characters", id))));
    expect(a!.handHidden).toBe(true);
    expect(b!.handHidden).toBeUndefined();
    expect(s!.handHidden).toBeUndefined();
    const keys = await t.run(async (ctx) => (await ctx.db.query("frameTrackers").collect()).map((r) => r.key));
    expect(keys).toEqual(["someTracker"]);
    expect((await gm.query(api.combatCards.handSharing, { campaignId })).hidden).toEqual([ash]);

    await run(t, fn);
    expect((await t.run((ctx) => ctx.db.get("characters", ash)))!.handHidden).toBe(true);
  });

  it("leaves a blob that fails its schema for a manual repair", async () => {
    const { t, campaignId } = await setupWithCampaign();
    await t.run((ctx) => ctx.db.insert("frameTrackers", { campaignId, key: "handPrivacy", data: { schemaVersion: 1, hidden: "nope" }, updatedAt: 0 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run(t, fn);
    warn.mockRestore();
    expect(await t.run(async (ctx) => (await ctx.db.query("frameTrackers").collect()).length)).toBe(1);
  });
});
