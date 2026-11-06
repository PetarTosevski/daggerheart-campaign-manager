import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Caps } from "../../src/lib/admin/config";
import { characterDraft } from "../fixtures/characters";
import { errorCode, key } from "./helpers";
import { makeTest } from "./setup";

/**
 * Config AD5b (plan `.omc/plans/config.yaml`, docs/tasks/TASK-CONFIG-AD5b.md, Q19 a): the players-per-campaign cap
 * (join, invite, invite acceptance; co-GMs count, the creator doesn't) and the characters-per-player cap (retired
 * included; the GM's and co-GMs' characters exempt). Refusals assert `ConvexError.data.code`.
 */

const fail = (p: Promise<unknown>) => p.then(() => "resolved", errorCode);

async function setup(caps: Partial<Caps>) {
  const t = makeTest();
  await t.run((ctx) => ctx.db.insert("appConfig", { key: "app", caps, updatedAt: 1 }));
  const account = async (email: string) => {
    const id = await t.run((ctx) => ctx.db.insert("users", { email, emailVerificationTime: 1 }));
    return { id, client: t.withIdentity({ subject: `${id}|s` }) };
  };
  const gm = await account("gm@example.com");
  const { campaignId } = await gm.client.mutation(api.campaigns.create, { frameId: "witherwild", name: "Capped", idempotencyKey: key() });
  const code = await gm.client.mutation(api.members.rotateJoinCode, { campaignId });
  const members = (): Promise<number> =>
    t.run(async (ctx) => (await ctx.db.query("campaignMembers").withIndex("by_campaign_user", (q) => q.eq("campaignId", campaignId)).collect()).length);
  return { t, gm, campaignId, code, account, members };
}

const create = (client: { mutation: ReturnType<typeof makeTest>["mutation"] }, campaignId: Id<"campaigns">, name: string, ownerId?: Id<"users">) =>
  client.mutation(api.characters.create, { campaignId, draft: characterDraft(name), idempotencyKey: key(), ...(ownerId ? { ownerId } : {}) });

describe("players per campaign (AD5b)", () => {
  it("joinByCode refuses past the cap; the creator doesn't count, joining again stays harmless", async () => {
    const { campaignId, code, account, members } = await setup({ playersPerCampaign: 2 });
    const a = await account("a@example.com");
    const b = await account("b@example.com");
    const c = await account("c@example.com");
    await a.client.mutation(api.members.joinByCode, { code });
    await b.client.mutation(api.members.joinByCode, { code });
    expect(await fail(c.client.mutation(api.members.joinByCode, { code }))).toBe("CAP_PLAYERS");
    expect(await members()).toBe(2);
    // A member joining again is not a new seat.
    expect(await a.client.mutation(api.members.joinByCode, { code })).toEqual({ ok: true, campaignId });
  });

  it("co-GMs count as players", async () => {
    const { gm, campaignId, code, account } = await setup({ playersPerCampaign: 2 });
    const a = await account("a@example.com");
    const b = await account("b@example.com");
    const c = await account("c@example.com");
    await a.client.mutation(api.members.joinByCode, { code });
    await gm.client.mutation(api.members.setCoGm, { campaignId, userId: a.id, coGm: true });
    await b.client.mutation(api.members.joinByCode, { code });
    expect(await fail(c.client.mutation(api.members.joinByCode, { code }))).toBe("CAP_PLAYERS");
  });

  it("invite refuses a new invite at the cap; an invite already pending is returned", async () => {
    const { gm, campaignId, code, account } = await setup({ playersPerCampaign: 1 });
    const pendingId = await gm.client.mutation(api.members.invite, { campaignId, email: "late@example.com" });
    const a = await account("a@example.com");
    await a.client.mutation(api.members.joinByCode, { code });
    expect(await fail(gm.client.mutation(api.members.invite, { campaignId, email: "new@example.com" }))).toBe("CAP_PLAYERS");
    expect(await gm.client.mutation(api.members.invite, { campaignId, email: "late@example.com" })).toBe(pendingId);
  });

  it("markOpened refuses to accept an invite at the cap; the invite stays pending", async () => {
    const { t, gm, campaignId, code, account, members } = await setup({ playersPerCampaign: 1 });
    await gm.client.mutation(api.members.invite, { campaignId, email: "late@example.com" });
    const a = await account("a@example.com");
    await a.client.mutation(api.members.joinByCode, { code });
    const late = await account("late@example.com");
    expect(await fail(late.client.mutation(api.campaigns.markOpened, { campaignId }))).toBe("CAP_PLAYERS");
    expect(await members()).toBe(1);
    const invites = await t.run((ctx) =>
      ctx.db.query("campaignInvites").withIndex("by_campaign_email", (q) => q.eq("campaignId", campaignId).eq("email", "late@example.com")).collect(),
    );
    expect(invites).toHaveLength(1);
  });

  it("a lowered cap removes nobody; the creator still opens and runs the campaign", async () => {
    const { t, gm, campaignId, code, account, members } = await setup({ playersPerCampaign: 3 });
    for (const email of ["a@example.com", "b@example.com", "c@example.com"]) await (await account(email)).client.mutation(api.members.joinByCode, { code });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("appConfig").withIndex("by_key", (q) => q.eq("key", "app")).unique();
      await ctx.db.patch("appConfig", row!._id, { caps: { playersPerCampaign: 1 } });
    });
    expect(await members()).toBe(3);
    await gm.client.mutation(api.campaigns.markOpened, { campaignId });
    expect(await fail((await account("d@example.com")).client.mutation(api.members.joinByCode, { code }))).toBe("CAP_PLAYERS");
  });
});

describe("characters per player (AD5b)", () => {
  it("refuses a player's next character at the cap, retired characters included", async () => {
    const { t, campaignId, code, account } = await setup({ charactersPerPlayer: 2 });
    const a = await account("a@example.com");
    await a.client.mutation(api.members.joinByCode, { code });
    const { characterId } = await create(a.client, campaignId, "One");
    await t.run((ctx) => ctx.db.patch("characters", characterId, { status: "retired" }));
    await create(a.client, campaignId, "Two");
    expect(await fail(create(a.client, campaignId, "Three"))).toBe("CAP_CHARACTERS_PER_PLAYER");
  });

  it("the GM assigning a character to a player at the cap is refused too", async () => {
    const { gm, campaignId, code, account } = await setup({ charactersPerPlayer: 1 });
    const a = await account("a@example.com");
    await a.client.mutation(api.members.joinByCode, { code });
    await create(a.client, campaignId, "One");
    expect(await fail(create(gm.client, campaignId, "Gift", a.id))).toBe("CAP_CHARACTERS_PER_PLAYER");
  });

  it("the GM's and a co-GM's own characters are not counted", async () => {
    const { gm, campaignId, code, account } = await setup({ charactersPerPlayer: 1 });
    await create(gm.client, campaignId, "NPC one");
    await create(gm.client, campaignId, "NPC two");
    const co = await account("co@example.com");
    await co.client.mutation(api.members.joinByCode, { code });
    await gm.client.mutation(api.members.setCoGm, { campaignId, userId: co.id, coGm: true });
    await create(co.client, campaignId, "Co one");
    await create(co.client, campaignId, "Co two");
  });

  it("the cap is per campaign, and the session's extra-characters switch doesn't lift it", async () => {
    const { gm, campaignId, code, account } = await setup({ charactersPerPlayer: 1 });
    const a = await account("a@example.com");
    await a.client.mutation(api.members.joinByCode, { code });
    await gm.client.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    await gm.client.mutation(api.sessions.allowExtraCharacters, { campaignId, allow: true, idempotencyKey: key() });
    await create(a.client, campaignId, "One");
    expect(await fail(create(a.client, campaignId, "Two"))).toBe("CAP_CHARACTERS_PER_PLAYER");
    // Another campaign has its own count.
    const other = await gm.client.mutation(api.campaigns.create, { frameId: "witherwild", name: "Second", idempotencyKey: key() });
    const otherCode = await gm.client.mutation(api.members.rotateJoinCode, { campaignId: other.campaignId });
    await a.client.mutation(api.members.joinByCode, { code: otherCode });
    await create(a.client, other.campaignId, "Elsewhere");
  });

  it("the default cap is 5 (Q19 a)", async () => {
    const { gm, campaignId, code, account } = await setup({});
    const a = await account("a@example.com");
    await a.client.mutation(api.members.joinByCode, { code });
    // XC1 lifts the one-active rule, so five active characters can be made in a row.
    await gm.client.mutation(api.sessions.start, { campaignId, idempotencyKey: key() });
    await gm.client.mutation(api.sessions.allowExtraCharacters, { campaignId, allow: true, idempotencyKey: key() });
    for (let i = 0; i < 5; i += 1) await create(a.client, campaignId, `PC ${i}`);
    expect(await fail(create(a.client, campaignId, "Sixth"))).toBe("CAP_CHARACTERS_PER_PLAYER");
  });
});
