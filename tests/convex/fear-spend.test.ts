import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { spendFear } from "../../convex/lib/fear";
import { errorCode, key, setupWithCampaign, useAllowlist } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupWithCampaign>>;

const fearOf = async ({ gm, campaignId }: Ctx) => (await gm.query(api.campaigns.get, { campaignId }))?.fear;

const history = ({ t, campaignId }: Ctx) =>
  t.run((ctx) =>
    ctx.db
      .query("history")
      .withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId))
      .collect(),
  );

const gmId = ({ t }: Ctx) =>
  t.run(async (ctx) => (await ctx.db.query("users").collect()).find((u) => u.email === "gm@example.com")!._id);

/** spendFear (convex/lib/fear.ts, D8): the GM spends Fear for a move, a Fear Feature, an Experience or an interrupt (CB p.154). */
describe("spendFear", () => {
  useAllowlist();

  it("lowers GM Fear by the amount and records one history row with action spend, by the caller", async () => {
    const ctx = await setupWithCampaign();
    await ctx.gm.mutation(api.fear.set, { campaignId: ctx.campaignId, value: 3, idempotencyKey: key() });

    expect(await ctx.gm.run((c) => spendFear(c, ctx.campaignId, 1, "move"))).toEqual({ previousValue: 3, newValue: 2, reason: "move" });
    expect(await ctx.gm.run((c) => spendFear(c, ctx.campaignId, 2, "feature"))).toEqual({ previousValue: 2, newValue: 0, reason: "feature" });

    expect(await fearOf(ctx)).toBe(0);
    const by = await gmId(ctx);
    const spends = (await history(ctx)).filter((row) => row.action === "spend");
    expect(spends).toEqual([
      expect.objectContaining({ kind: "fear", action: "spend", before: 3, after: 2, by }),
      expect.objectContaining({ kind: "fear", action: "spend", before: 2, after: 0, by }),
    ]);
  });

  it("refuses with FEAR_EMPTY at 0 Fear, or with less Fear than the amount, and changes and records nothing", async () => {
    const ctx = await setupWithCampaign();
    // A new Witherwild campaign starts at 0 Fear.
    expect(await fearOf(ctx)).toBe(0);
    expect(errorCode(await ctx.gm.run((c) => spendFear(c, ctx.campaignId, 1, "interrupt")).catch((e: unknown) => e))).toBe("FEAR_EMPTY");

    await ctx.gm.mutation(api.fear.set, { campaignId: ctx.campaignId, value: 1, idempotencyKey: key() });
    expect(errorCode(await ctx.gm.run((c) => spendFear(c, ctx.campaignId, 2, "experience")).catch((e: unknown) => e))).toBe("FEAR_EMPTY");

    expect(await fearOf(ctx)).toBe(1);
    expect((await history(ctx)).filter((row) => row.action === "spend")).toEqual([]);
  });

  it("refuses an amount that is not a whole number from 1 to 12 with FEAR_RANGE", async () => {
    const ctx = await setupWithCampaign();
    await ctx.gm.mutation(api.fear.set, { campaignId: ctx.campaignId, value: 12, idempotencyKey: key() });
    for (const amount of [0, -1, 1.5, 13]) {
      expect(errorCode(await ctx.gm.run((c) => spendFear(c, ctx.campaignId, amount, "move")).catch((e: unknown) => e))).toBe("FEAR_RANGE");
    }
    expect(await fearOf(ctx)).toBe(12);
  });
});
