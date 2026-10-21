import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { gainFear } from "../../convex/lib/fear";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupWithCampaign>>;

const rows = ({ t, campaignId }: Ctx) =>
  t.run((ctx) =>
    ctx.db
      .query("history")
      .withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId))
      .collect(),
  );

const gmId = ({ t }: Ctx) =>
  t.run(async (ctx) => (await ctx.db.query("users").collect()).find((u) => u.email === "gm@example.com")!._id);

describe("history", () => {
  useAllowlist();

  it("records one row per Fear change, none for a no-op set or a replay", async () => {
    const ctx = await setupWithCampaign();
    const { gm, campaignId } = ctx;
    const k = key();
    await gm.mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: k });
    await gm.mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: k });
    await gm.mutation(api.fear.set, { campaignId, value: 5, idempotencyKey: key() });
    await gm.mutation(api.fear.set, { campaignId, value: 5, idempotencyKey: key() });
    await gm.mutation(api.fear.set, { campaignId, value: 13, idempotencyKey: key() }).catch(() => null);
    const by = await gmId(ctx);
    expect(await rows(ctx)).toEqual([
      expect.objectContaining({ kind: "fear", action: "adjust", before: 0, after: 1, by, at: expect.any(Number) }),
      expect.objectContaining({ kind: "fear", action: "set", before: 1, after: 5, by }),
    ]);
  });

  it("records Fear gained through gainFear (used by frame trackers)", async () => {
    const ctx = await setupWithCampaign();
    await ctx.t.run((c) => gainFear(c, ctx.campaignId, 2));
    await ctx.gm.mutation(api.fear.set, { campaignId: ctx.campaignId, value: 12, idempotencyKey: key() });
    // Already at the cap: nothing changes, nothing is recorded.
    await ctx.t.run((c) => gainFear(c, ctx.campaignId, 1));
    const history = await rows(ctx);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ kind: "fear", action: "gain", before: 0, after: 2, by: null });
  });

  it("records one row per countdown change, none for a refused one", async () => {
    const ctx = await setupWithCampaign();
    const { gm, campaignId } = ctx;
    const { countdownId } = await gm.mutation(api.countdowns.create, {
      campaignId,
      name: "Bridge",
      description: "",
      category: "threat",
      startingValue: 3,
      consequence: "",
      idempotencyKey: key(),
    });
    const op = (action: "advance" | "pause" | "correction", amount?: number) =>
      gm.mutation(api.countdowns.operate, { countdownId, action, amount, idempotencyKey: key() });
    await op("advance");
    await op("pause");
    await op("advance").catch(() => null);
    await op("correction", -2);
    expect(await rows(ctx)).toEqual([
      expect.objectContaining({ kind: "countdown", action: "create", countdownId, before: null, after: { currentValue: 3, status: "active" } }),
      expect.objectContaining({ action: "advance", before: { currentValue: 3, status: "active" }, after: { currentValue: 2, status: "active" } }),
      expect.objectContaining({ action: "pause", before: { currentValue: 2, status: "active" }, after: { currentValue: 2, status: "paused" } }),
      expect.objectContaining({ action: "correction", before: { currentValue: 2, status: "paused" }, after: { currentValue: 0, status: "paused" } }),
    ]);
  });

  it("records one row per campaign-time change", async () => {
    const ctx = await setupWithCampaign("witherwild");
    const { gm, campaignId } = ctx;
    await gm.mutation(api.campaignTime.advance, { campaignId, idempotencyKey: key() });
    await gm.mutation(api.campaignTime.setDay, { campaignId, cycleDay: 2, idempotencyKey: key() }).catch(() => null);
    await gm.mutation(api.campaignTime.setDay, { campaignId, cycleDay: 7, idempotencyKey: key() });
    expect(await rows(ctx)).toEqual([
      expect.objectContaining({
        kind: "campaignTime",
        action: "advance",
        before: { week: 1, cycle: "DAY", cycleDay: 1 },
        after: { week: 1, cycle: "DAY", cycleDay: 2 },
      }),
      expect.objectContaining({
        kind: "campaignTime",
        action: "setDay",
        before: { week: 1, cycle: "DAY", cycleDay: 2 },
        after: { week: 1, cycle: "DAY", cycleDay: 7 },
      }),
    ]);
  });

  it("lists the GM newest first, a page at a time", async () => {
    const { gm, campaignId } = await setupWithCampaign();
    for (const value of [1, 2, 3]) await gm.mutation(api.fear.set, { campaignId, value, idempotencyKey: key() });
    const first = await gm.query(api.history.list, { campaignId, paginationOpts: { numItems: 2, cursor: null } });
    expect(first.page.map((e) => e.after)).toEqual([3, 2]);
    expect(first.isDone).toBe(false);
    const second = await gm.query(api.history.list, {
      campaignId,
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page.map((e) => e.after)).toEqual([1]);
    expect(second.isDone).toBe(true);
  });

  it("is GM only: players, outsiders and signed-out callers can't read it", async () => {
    const { t, gm, other, campaignId } = await setupWithCampaign();
    const args = { campaignId, paginationOpts: { numItems: 10, cursor: null } };
    expect(errorCode(await other.query(api.history.list, args).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorCode(await t.query(api.history.list, args).catch((e) => e))).toBe("UNAUTHENTICATED");
    await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
    expect(errorCode(await other.query(api.history.list, args).catch((e) => e))).toBe("FORBIDDEN");
  });
});

describe("users.viewer", () => {
  useAllowlist();

  it("returns the signed-in user, or null when signed out", async () => {
    const { t, gm } = await setupWithCampaign();
    expect(await gm.query(api.users.viewer, {})).toEqual({ email: "gm@example.com", name: null });
    expect(await t.query(api.users.viewer, {})).toBeNull();
  });
});
