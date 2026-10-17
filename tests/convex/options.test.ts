import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, errorData, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

describe("campaign rule switches", () => {
  useAllowlist("gm@example.com,player@example.com");

  async function setup(frameId: "castle-high" | "witherwild") {
    const t = makeTest();
    const gmId = await t.run((ctx) => ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }));
    const playerId = await t.run((ctx) => ctx.db.insert("users", { email: "player@example.com", emailVerificationTime: 1 }));
    const gm = t.withIdentity({ subject: `${gmId}|s` });
    const player = t.withIdentity({ subject: `${playerId}|s` });
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Rules", idempotencyKey: key() });
    await gm.mutation(api.members.invite, { campaignId, email: "player@example.com" });
    return { gm, player, campaignId };
  }

  it("uses frame defaults: Castle High is less lethal and uses Hope & Fear content", async () => {
    const { gm, campaignId } = await setup("castle-high");
    const options = (await gm.query(api.campaigns.get, { campaignId }))!.options;
    expect(options).toMatchObject({ lessLethal: true, hopeAndFear: true, transformations: false });
  });

  it("a Core frame starts without Hope & Fear content; the GM can switch it on", async () => {
    const { gm, campaignId } = await setup("witherwild");
    expect((await gm.query(api.campaigns.get, { campaignId }))!.options.hopeAndFear).toBe(false);
    await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
    expect((await gm.query(api.campaigns.get, { campaignId }))!.options.hopeAndFear).toBe(true);
  });

  it("refuses rules from another frame, unknown rules, and players", async () => {
    const { gm, player, campaignId } = await setup("witherwild");
    for (const option of ["lessLethal", "nope"]) {
      expect(errorCode(await gm.mutation(api.campaigns.setOption, { campaignId, option, enabled: true }).catch((e) => e))).toBe(
        "INVALID",
      );
    }
    expect(
      errorData(await player.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true }).catch((e) => e)),
    ).toBe("FORBIDDEN");
  });
});
