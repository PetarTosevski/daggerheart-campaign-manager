import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, key, OTHER_EMAIL, setupWithCampaign, useAllowlist } from "./helpers";

const fearOf = async (gm: Awaited<ReturnType<typeof setupWithCampaign>>["gm"], campaignId: string) =>
  (await gm.query(api.campaigns.get, { campaignId }))?.fear;

describe("fear", () => {
  useAllowlist();

  it("adjusts by one within 0 to 12", async () => {
    const { gm, campaignId } = await setupWithCampaign();
    expect(await gm.mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() })).toEqual({
      previousValue: 0,
      newValue: 1,
    });
    await gm.mutation(api.fear.adjust, { campaignId, direction: "decrease", idempotencyKey: key() });
    const below = await gm
      .mutation(api.fear.adjust, { campaignId, direction: "decrease", idempotencyKey: key() })
      .catch((e) => e);
    expect(errorCode(below)).toBe("FEAR_RANGE");
    expect(await fearOf(gm, campaignId)).toBe(0);
  });

  it("refuses to go above 12", async () => {
    const { gm, campaignId } = await setupWithCampaign("beast-feast");
    await gm.mutation(api.fear.set, { campaignId, value: 12, idempotencyKey: key() });
    const above = await gm
      .mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() })
      .catch((e) => e);
    expect(errorCode(above)).toBe("FEAR_RANGE");
  });

  it("sets Fear directly and rejects values outside 0 to 12", async () => {
    const { gm, campaignId } = await setupWithCampaign();
    await gm.mutation(api.fear.set, { campaignId, value: 7, idempotencyKey: key() });
    expect(await fearOf(gm, campaignId)).toBe(7);
    // Setting the current value again changes nothing.
    expect(await gm.mutation(api.fear.set, { campaignId, value: 7, idempotencyKey: key() })).toEqual({
      previousValue: 7,
      newValue: 7,
    });
    for (const value of [-1, 13, 2.5]) {
      const error = await gm.mutation(api.fear.set, { campaignId, value, idempotencyKey: key() }).catch((e) => e);
      expect(errorCode(error)).toBe("FEAR_RANGE");
    }
  });

  it("replays a retried request and rejects a reused key with a different request", async () => {
    const { gm, campaignId } = await setupWithCampaign();
    const k = key();
    const first = await gm.mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: k });
    const again = await gm.mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: k });
    expect(again).toEqual(first);
    expect(await fearOf(gm, campaignId)).toBe(1);
    const mismatch = await gm
      .mutation(api.fear.adjust, { campaignId, direction: "decrease", idempotencyKey: k })
      .catch((e) => e);
    expect(errorCode(mismatch)).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("hides other owners' campaigns and requires sign-in", async () => {
    const { t, other, campaignId } = await setupWithCampaign();
    const foreign = await other.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(foreign)).toBe("NOT_FOUND");
    const anon = await t.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: key() }).catch((e) => e);
    expect(errorCode(anon)).toBe("UNAUTHENTICATED");
  });

  it("lets players read Fear but not change it", async () => {
    const { gm, other, campaignId } = await setupWithCampaign();
    await gm.mutation(api.members.invite, { campaignId, email: OTHER_EMAIL });
    expect(await fearOf(other, campaignId)).toBe(0);
    for (const call of [
      other.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: key() }),
      other.mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() }),
    ]) {
      expect(errorCode(await call.catch((e) => e))).toBe("FORBIDDEN");
    }
  });
});
