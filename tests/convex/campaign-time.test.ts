import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, key, setupWithCampaign, useAllowlist } from "./helpers";

describe("campaign time", () => {
  useAllowlist();

  it("starts a Witherwild campaign at week 1, Day cycle, day 1", async () => {
    const { gm, campaignId } = await setupWithCampaign("witherwild");
    expect(await gm.query(api.campaignTime.get, { campaignId })).toEqual({ week: 1, cycle: "DAY", cycleDay: 1 });
  });

  it("is disabled for frames without campaign time, on the server", async () => {
    const { t, gm, campaignId } = await setupWithCampaign("beast-feast");
    expect(await t.run((ctx) => ctx.db.query("campaignTime").collect())).toEqual([]);
    for (const call of [
      () => gm.query(api.campaignTime.get, { campaignId }),
      () => gm.mutation(api.campaignTime.advance, { campaignId, idempotencyKey: key() }),
      () => gm.mutation(api.campaignTime.setDay, { campaignId, cycleDay: 3, idempotencyKey: key() }),
    ]) {
      expect(errorCode(await call().catch((e) => e))).toBe("MECHANIC_DISABLED");
    }
  });

  it("advances a day and rolls into the next week's Night cycle after day 7", async () => {
    const { gm, campaignId } = await setupWithCampaign();
    expect(await gm.mutation(api.campaignTime.advance, { campaignId, idempotencyKey: key() })).toEqual({
      week: 1,
      cycle: "DAY",
      cycleDay: 2,
    });
    await gm.mutation(api.campaignTime.setDay, { campaignId, cycleDay: 7, idempotencyKey: key() });
    expect(await gm.mutation(api.campaignTime.advance, { campaignId, idempotencyKey: key() })).toEqual({
      week: 2,
      cycle: "NIGHT",
      cycleDay: 1,
    });
  });

  it("sets a day within the week, which must change", async () => {
    const { gm, campaignId } = await setupWithCampaign();
    await gm.mutation(api.campaignTime.setDay, { campaignId, cycleDay: 5, idempotencyKey: key() });
    expect((await gm.query(api.campaignTime.get, { campaignId })).cycleDay).toBe(5);
    for (const cycleDay of [5, 0, 8]) {
      const error = await gm
        .mutation(api.campaignTime.setDay, { campaignId, cycleDay, idempotencyKey: key() })
        .catch((e) => e);
      expect(errorCode(error)).toBe("TIME_RULE");
    }
  });

  it("replays a retried advance", async () => {
    const { gm, campaignId } = await setupWithCampaign();
    const k = key();
    await gm.mutation(api.campaignTime.advance, { campaignId, idempotencyKey: k });
    await gm.mutation(api.campaignTime.advance, { campaignId, idempotencyKey: k });
    expect((await gm.query(api.campaignTime.get, { campaignId })).cycleDay).toBe(2);
  });

  it("treats a Witherwild campaign without a time row as the initial time and creates it on change", async () => {
    const { t, gm, campaignId } = await setupWithCampaign();
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("campaignTime").collect()) await ctx.db.delete(row._id);
    });
    expect(await gm.query(api.campaignTime.get, { campaignId })).toEqual({ week: 1, cycle: "DAY", cycleDay: 1 });
    await gm.mutation(api.campaignTime.setDay, { campaignId, cycleDay: 4, idempotencyKey: key() });
    expect(await gm.query(api.campaignTime.get, { campaignId })).toEqual({ week: 1, cycle: "DAY", cycleDay: 4 });
    expect(await t.run((ctx) => ctx.db.query("campaignTime").collect())).toHaveLength(1);
  });

  it("hides another owner's campaign time", async () => {
    const { other, campaignId } = await setupWithCampaign();
    expect(errorCode(await other.query(api.campaignTime.get, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
  });
});
