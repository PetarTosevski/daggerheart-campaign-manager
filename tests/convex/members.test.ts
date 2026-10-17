import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { errorCode, errorData, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const PLAYER = "player@example.com";

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    gm: await ctx.db.insert("users", { email: "gm@example.com" }),
    player: await ctx.db.insert("users", { email: PLAYER, name: "Ana" }),
    stranger: await ctx.db.insert("users", { email: "other@example.com" }),
  }));
  const as = (id: string) => t.withIdentity({ subject: `${id}|session` });
  const gm = as(ids.gm);
  const player = as(ids.player);
  const stranger = as(ids.stranger);
  const { campaignId } = await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Table", idempotencyKey: key() });
  return { t, ids, gm, player, stranger, campaignId };
}

describe("campaign membership", () => {
  useAllowlist(`gm@example.com,${PLAYER},other@example.com`);

  it("an email invite makes the campaign visible to that player, read-only", async () => {
    const { gm, player, campaignId } = await setup();
    expect(await player.query(api.campaigns.get, { campaignId })).toBeNull();
    await gm.mutation(api.members.invite, { campaignId, email: " Player@Example.com " });

    const listed = await player.query(api.campaigns.list, {});
    expect(listed.map((c) => [c.name, c.role])).toEqual([["Table", "player"]]);
    expect((await player.query(api.campaigns.get, { campaignId }))?.role).toBe("player");
    expect((await gm.query(api.campaigns.get, { campaignId }))?.role).toBe("gm");

    // Players read Fear, countdowns and campaign time...
    expect(await player.query(api.countdowns.listByCampaign, { campaignId })).toEqual([]);
    expect((await player.query(api.campaignTime.get, { campaignId })).cycleDay).toBe(1);
    // ...but only the GM changes them.
    for (const call of [
      () => player.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: key() }),
      () => player.mutation(api.campaignTime.advance, { campaignId, idempotencyKey: key() }),
      () => player.mutation(api.countdowns.create, {
        campaignId,
        name: "x",
        description: "",
        category: "threat",
        startingValue: 3,
        consequence: "",
        idempotencyKey: key(),
      }),
      () => player.mutation(api.campaigns.remove, { campaignId }),
    ]) {
      expect(errorData(await call().catch((e) => e))).toBe("FORBIDDEN");
    }
  });

  it("opening the campaign turns the invite into a membership", async () => {
    const { t, gm, player, campaignId } = await setup();
    await gm.mutation(api.members.invite, { campaignId, email: PLAYER });
    await player.mutation(api.campaigns.markOpened, { campaignId });
    expect(await t.run((ctx) => ctx.db.query("campaignMembers").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("campaignInvites").collect())).toEqual([]);
    const roster = await gm.query(api.members.roster, { campaignId });
    expect(roster.players.map((p) => [p.name, p.email])).toEqual([["Ana", PLAYER]]);
  });

  it("joins with a code, ignoring case and separators; a new code replaces the old one", async () => {
    const { gm, player, stranger, campaignId } = await setup();
    const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
    expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{8}$/);
    expect(await gm.mutation(api.members.rotateJoinCode, { campaignId })).toBe(code);

    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`;
    expect(await player.mutation(api.members.joinByCode, { code: typed })).toEqual({ campaignId });
    expect(await player.mutation(api.members.joinByCode, { code })).toEqual({ campaignId });
    expect((await player.query(api.campaigns.get, { campaignId }))?.role).toBe("player");

    const fresh = await gm.mutation(api.members.rotateJoinCode, { campaignId, replace: true });
    expect(fresh).not.toBe(code);
    expect(errorCode(await stranger.mutation(api.members.joinByCode, { code }).catch((e) => e))).toBe("INVALID");
  });

  it("only the GM manages access, and players don't see emails", async () => {
    const { gm, player, campaignId } = await setup();
    await gm.mutation(api.members.invite, { campaignId, email: PLAYER });
    await player.mutation(api.campaigns.markOpened, { campaignId });
    expect(errorData(await player.query(api.members.access, { campaignId }).catch((e) => e))).toBe("FORBIDDEN");
    expect(
      errorData(await player.mutation(api.members.invite, { campaignId, email: "x@example.com" }).catch((e) => e)),
    ).toBe("FORBIDDEN");
    const roster = await player.query(api.members.roster, { campaignId });
    expect(roster.players.map((p) => p.email)).toEqual([null]);
  });

  it("removing a player revokes membership and the invite", async () => {
    const { gm, player, ids, campaignId } = await setup();
    await gm.mutation(api.members.invite, { campaignId, email: PLAYER });
    await player.mutation(api.campaigns.markOpened, { campaignId });
    const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
    await gm.mutation(api.members.removePlayer, { campaignId, userId: ids.player });
    expect(await player.query(api.campaigns.get, { campaignId })).toBeNull();
    // The old code no longer works, so the removed player can't rejoin with it.
    expect(errorCode(await player.mutation(api.members.joinByCode, { code }).catch((e) => e))).toBe("INVALID");
    expect(await player.query(api.campaigns.list, {})).toEqual([]);
  });

  it("a player can leave; the GM cannot", async () => {
    const { gm, player, campaignId } = await setup();
    await player.mutation(api.members.joinByCode, { code: await gm.mutation(api.members.rotateJoinCode, { campaignId }) });
    await player.mutation(api.members.leave, { campaignId });
    expect(await player.query(api.campaigns.get, { campaignId })).toBeNull();
    expect(errorCode(await gm.mutation(api.members.leave, { campaignId }).catch((e) => e))).toBe("INVALID");
  });

  it("strangers see nothing", async () => {
    const { stranger, campaignId } = await setup();
    expect(await stranger.query(api.campaigns.get, { campaignId })).toBeNull();
    expect(errorData(await stranger.query(api.countdowns.listByCampaign, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
    expect(errorData(await stranger.query(api.members.roster, { campaignId }).catch((e) => e))).toBe("NOT_FOUND");
  });

  it("validates invite emails", async () => {
    const { gm, campaignId } = await setup();
    expect(errorCode(await gm.mutation(api.members.invite, { campaignId, email: "nope" }).catch((e) => e))).toBe("INVALID");
    expect(errorCode(await gm.mutation(api.members.invite, { campaignId, email: "GM@example.com" }).catch((e) => e))).toBe(
      "INVALID",
    );
  });
});
