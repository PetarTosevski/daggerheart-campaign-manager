import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const CUSTOM = {
  pitch: "A drowned kingdom.",
  tones: ["Dark"],
  themes: "",
  touchstones: "",
  partySize: 4,
  startingTier: 1,
  background: "custom",
};

describe("custom tome", () => {
  useAllowlist("gm@example.com,player@example.com");

  async function setup() {
    const t = makeTest();
    const gmId = await t.run((ctx) => ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }));
    const playerId = await t.run((ctx) => ctx.db.insert("users", { email: "player@example.com", emailVerificationTime: 1 }));
    const gm = t.withIdentity({ subject: `${gmId}|s` });
    const player = t.withIdentity({ subject: `${playerId}|s` });
    const { campaignId } = await gm.mutation(api.campaigns.create, {
      frameId: "custom",
      name: "Saltwake",
      custom: CUSTOM,
      idempotencyKey: key(),
    });
    await gm.mutation(api.members.invite, { campaignId, email: "player@example.com" });
    return { gm, player, campaignId };
  }

  it("the GM writes chapters; players read them", async () => {
    const { gm, player, campaignId } = await setup();
    expect((await gm.query(api.campaigns.get, { campaignId }))?.tome).toBeNull();
    await gm.mutation(api.campaigns.updateTome, { campaignId, chapter: "incident", text: "The tide goes out." });
    expect((await player.query(api.campaigns.get, { campaignId }))?.tome).toEqual({
      overview: "",
      incident: "The tide goes out.",
      mechanics: "",
    });
    const error = await player
      .mutation(api.campaigns.updateTome, { campaignId, chapter: "overview", text: "hi" })
      .catch((e) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
  });

  it("is only for custom campaigns and has a length limit", async () => {
    const { gm, campaignId } = await setup();
    const { campaignId: framed } = await gm.mutation(api.campaigns.create, {
      frameId: "witherwild",
      name: "Framed",
      idempotencyKey: key(),
    });
    expect(
      errorCode(await gm.mutation(api.campaigns.updateTome, { campaignId: framed, chapter: "overview", text: "x" }).catch((e) => e)),
    ).toBe("INVALID");
    expect(
      errorCode(
        await gm
          .mutation(api.campaigns.updateTome, { campaignId, chapter: "overview", text: "x".repeat(20001) })
          .catch((e) => e),
      ),
    ).toBe("INVALID");
  });
});
