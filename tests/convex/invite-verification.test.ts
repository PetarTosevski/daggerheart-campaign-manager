import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const PLAYER = "player@example.com";

/** A GM's campaign with an invite for PLAYER, who signed up verified (Google) or not (password). */
async function setup(verified: boolean) {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com", emailVerificationTime: 1 }),
    player: await ctx.db.insert("users", verified ? { email: PLAYER, emailVerificationTime: 1 } : { email: PLAYER }),
  }));
  const gm = t.withIdentity({ subject: `${ids.gm}|session` });
  const player = t.withIdentity({ subject: `${ids.player}|session` });
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Table", idempotencyKey: key() });
  await gm.mutation(api.members.invite, { campaignId, email: " Player@Example.com " });
  const members = () => t.run((ctx) => ctx.db.query("campaignMembers").collect());
  return { gm, player, campaignId, members };
}

describe("invites honour only verified emails", () => {
  useAllowlist(`gm@example.com,${PLAYER}`);

  it("an unverified (password) account with the invited email gets no access", async () => {
    const { player, campaignId, members } = await setup(false);
    expect(await player.query(api.campaigns.get, { campaignId })).toBeNull();
    expect(errorCode(await player.query(api.countdowns.listByCampaign, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(await player.query(api.campaigns.list, {})).toEqual([]);
    expect(errorCode(await player.mutation(api.campaigns.markOpened, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(await members()).toEqual([]);
  });

  it("a verified (Google) invitee sees the campaign and becomes a member on opening it", async () => {
    const { player, campaignId, members } = await setup(true);
    expect((await player.query(api.campaigns.get, { campaignId }))?.role).toBe("player");
    expect((await player.query(api.campaigns.list, {})).map((c) => [c.name, c.role])).toEqual([["Table", "player"]]);
    await player.mutation(api.campaigns.markOpened, { campaignId });
    expect(await members()).toHaveLength(1);
  });

  it("joinByCode still works for an unverified account", async () => {
    const { gm, player, campaignId, members } = await setup(false);
    const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
    expect(await player.mutation(api.members.joinByCode, { code })).toEqual({ ok: true, campaignId });
    expect((await player.query(api.campaigns.get, { campaignId }))?.role).toBe("player");
    expect(await members()).toHaveLength(1);
  });
});
