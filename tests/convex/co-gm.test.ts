import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { inviteEmail } from "../../convex/lib/inviteEmail";
import { errorCode, key } from "./helpers";
import { buildWorld, type World } from "./authz/world";

/**
 * Config G1 (plan `.omc/plans/config.yaml`, docs/tasks/TASK-CONFIG-G1.md): the co-GM role. The world's `coGm` is a
 * member the creator (the world's `gm`) promoted; `player` and `otherPlayer` are players. Every refusal asserts
 * `ConvexError.data.code`.
 */

const fail = (p: Promise<unknown>) => p.then(() => "resolved", errorCode);

async function memberRow(w: World, userId: Id<"users">) {
  return w.t.run((ctx) =>
    ctx.db
      .query("campaignMembers")
      .withIndex("by_campaign_user", (q) => q.eq("campaignId", w.campaignId).eq("userId", userId))
      .unique(),
  );
}

/** A verified account that has never joined; its client. */
async function newAccount(w: World, email: string) {
  const id = await w.t.run((ctx) => ctx.db.insert("users", { email, emailVerificationTime: 1 }));
  return { id, client: w.t.withIdentity({ subject: `${id}|session` }) };
}

const loadInvite = makeFunctionReference<"query", { inviteId: Id<"campaignInvites"> }, { asCoGm: boolean } | null>("lib/inviteEmail:load");

describe("co-GM (config G1)", () => {
  it("a co-GM runs GM mutations: Fear and session start", async () => {
    const w = await buildWorld();
    const coGm = w.as("coGm");
    await coGm.mutation(api.fear.adjust, { campaignId: w.campaignId, direction: "increase", idempotencyKey: key() });
    expect(await coGm.query(api.campaigns.fear, { campaignId: w.campaignId })).toBe(1);
    await coGm.mutation(api.sessions.start, { campaignId: w.campaignId, idempotencyKey: key() });
  });

  it("campaigns.get reports the creator and a co-GM as gm, only the creator as isCreator", async () => {
    const w = await buildWorld();
    const get = (role: "gm" | "coGm" | "player") => w.as(role).query(api.campaigns.get, { campaignId: w.campaignId });
    expect(await get("gm")).toMatchObject({ role: "gm", isCreator: true });
    expect(await get("coGm")).toMatchObject({ role: "gm", isCreator: false });
    expect(await get("player")).toMatchObject({ role: "player", isCreator: false });
    const own = await w.as("gm").query(api.campaigns.list, {});
    expect(own.find((c) => c._id === w.campaignId)).toMatchObject({ role: "gm", isCreator: true });
  });

  it("campaigns.list reports a co-GM as gm (badged Co-GM), a player as player (dcm-6dtb)", async () => {
    const w = await buildWorld();
    const listed = async (role: "coGm" | "player") =>
      (await w.as(role).query(api.campaigns.list, {})).find((c) => c._id === w.campaignId);
    expect(await listed("coGm")).toMatchObject({ role: "gm", isCreator: false });
    expect(await listed("player")).toMatchObject({ role: "player", isCreator: false });
  });

  it("a co-GM can't delete, restore or purge the campaign", async () => {
    const w = await buildWorld();
    const coGm = w.as("coGm");
    const campaignId = w.campaignId;
    expect(await fail(coGm.mutation(api.campaigns.remove, { campaignId }))).toBe("FORBIDDEN");
    // A live campaign: restore and purge are the creator's alone.
    expect(await fail(coGm.mutation(api.campaigns.restore, { campaignId }))).toBe("FORBIDDEN");
    expect(await fail(coGm.mutation(api.campaigns.purge, { campaignId }))).toBe("FORBIDDEN");
    // Deleted by the creator: the co-GM no longer sees it at all.
    await w.as("gm").mutation(api.campaigns.remove, { campaignId });
    expect(await fail(coGm.mutation(api.campaigns.restore, { campaignId }))).toBe("NOT_FOUND");
    expect(await fail(coGm.mutation(api.campaigns.purge, { campaignId }))).toBe("NOT_FOUND");
    await w.as("gm").mutation(api.campaigns.restore, { campaignId });
  });

  it("a co-GM can't promote or demote co-GMs, nor remove the creator or another co-GM; it removes players", async () => {
    const w = await buildWorld();
    const coGm = w.as("coGm");
    const campaignId = w.campaignId;
    expect(await fail(coGm.mutation(api.members.setCoGm, { campaignId, userId: w.users.player, coGm: true }))).toBe("FORBIDDEN");
    expect(await fail(coGm.mutation(api.members.setCoGm, { campaignId, userId: w.users.coGm, coGm: false }))).toBe("FORBIDDEN");
    expect(await fail(coGm.mutation(api.members.removePlayer, { campaignId, userId: w.users.gm }))).toBe("INVALID");
    await w.as("gm").mutation(api.members.setCoGm, { campaignId, userId: w.users.otherPlayer, coGm: true });
    expect(await fail(coGm.mutation(api.members.removePlayer, { campaignId, userId: w.users.otherPlayer }))).toBe("CO_GM_CREATOR_ONLY");
    expect(await memberRow(w, w.users.otherPlayer)).not.toBeNull();
    await coGm.mutation(api.members.removePlayer, { campaignId, userId: w.users.player });
    expect(await memberRow(w, w.users.player)).toBeNull();
    // The creator removes a co-GM.
    await w.as("gm").mutation(api.members.removePlayer, { campaignId, userId: w.users.otherPlayer });
    expect(await memberRow(w, w.users.otherPlayer)).toBeNull();
  });

  it("setCoGm: a non-member is CO_GM_NOT_MEMBER; promoting twice is a no-op; demoting returns them to player", async () => {
    const w = await buildWorld();
    const gm = w.as("gm");
    const campaignId = w.campaignId;
    expect(await fail(gm.mutation(api.members.setCoGm, { campaignId, userId: w.users.outsider, coGm: true }))).toBe("CO_GM_NOT_MEMBER");
    expect(await fail(gm.mutation(api.members.setCoGm, { campaignId, userId: w.users.gm, coGm: true }))).toBe("CO_GM_NOT_MEMBER");
    await gm.mutation(api.members.setCoGm, { campaignId, userId: w.users.coGm, coGm: true });
    expect((await memberRow(w, w.users.coGm))?.role).toBe("coGm");

    await gm.mutation(api.members.setCoGm, { campaignId, userId: w.users.coGm, coGm: false });
    expect((await memberRow(w, w.users.coGm))?.role).toBeUndefined();
    const former = w.as("coGm");
    expect(await fail(former.mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await former.query(api.campaigns.get, { campaignId })).toMatchObject({ role: "player", isCreator: false });
    await gm.mutation(api.members.setCoGm, { campaignId, userId: w.users.coGm, coGm: false });
  });

  it("the roster marks co-GMs", async () => {
    const w = await buildWorld();
    const roster = await w.as("player").query(api.members.roster, { campaignId: w.campaignId });
    const byId = new Map(roster.players.map((p) => [p.userId, p.coGm]));
    expect(byId.get(w.users.coGm)).toBe(true);
    expect(byId.get(w.users.player)).toBe(false);
    // A co-GM gets the GM's roster (with emails).
    expect((await w.as("coGm").query(api.members.roster, { campaignId: w.campaignId })).viewer).toBe("gm");
  });

  it("leave works for a co-GM, not for the creator; leaving and removal delete the member's hand folds", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    const fold = (userId: Id<"users">) =>
      w.t.run((ctx) => ctx.db.insert("handFolds", { userId, campaignId, characterId: w.characterA, updatedAt: 0 }));
    const folds = (userId: Id<"users">) =>
      w.t.run(async (ctx) => (await ctx.db.query("handFolds").withIndex("by_user_character", (q) => q.eq("userId", userId)).collect()).length);
    await fold(w.users.coGm);
    await fold(w.users.otherPlayer);
    await fold(w.users.player);

    expect(await fail(w.as("gm").mutation(api.members.leave, { campaignId }))).toBe("INVALID");
    await w.as("coGm").mutation(api.members.leave, { campaignId });
    expect(await memberRow(w, w.users.coGm)).toBeNull();
    expect(await folds(w.users.coGm)).toBe(0);

    await w.as("gm").mutation(api.members.removePlayer, { campaignId, userId: w.users.otherPlayer });
    expect(await folds(w.users.otherPlayer)).toBe(0);
    expect(await folds(w.users.player)).toBe(1);
  });
});

describe("co-GM by email (config G1, Q8 b)", () => {
  it("the creator invites as co-GM; before accepting they are a player; markOpened makes them a co-GM", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    const inviteId = await w.as("gm").mutation(api.members.invite, { campaignId, email: "New.CoGm@example.com", asCoGm: true });
    const access = await w.as("gm").query(api.members.access, { campaignId });
    expect(access.invites.find((i) => i._id === inviteId)).toMatchObject({ email: "new.cogm@example.com", asCoGm: true });
    expect(await w.t.query(loadInvite, { inviteId })).toMatchObject({ asCoGm: true });

    const invitee = await newAccount(w, "new.cogm@example.com");
    expect(await invitee.client.query(api.campaigns.get, { campaignId })).toMatchObject({ role: "player", isCreator: false });
    expect(await fail(invitee.client.mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() }))).toBe(
      "FORBIDDEN",
    );

    await invitee.client.mutation(api.campaigns.markOpened, { campaignId });
    expect((await memberRow(w, invitee.id))?.role).toBe("coGm");
    expect(await invitee.client.query(api.campaigns.get, { campaignId })).toMatchObject({ role: "gm", isCreator: false });
    await invitee.client.mutation(api.fear.adjust, { campaignId, direction: "increase", idempotencyKey: key() });
  });

  it("a plain invite accepted with markOpened makes a player", async () => {
    const w = await buildWorld();
    await w.as("coGm").mutation(api.members.invite, { campaignId: w.campaignId, email: "plain@example.com" });
    const invitee = await newAccount(w, "plain@example.com");
    await invitee.client.mutation(api.campaigns.markOpened, { campaignId: w.campaignId });
    const row = await memberRow(w, invitee.id);
    expect(row).not.toBeNull();
    expect(row?.role).toBeUndefined();
  });

  it("joining by code with a pending co-GM invite makes a co-GM", async () => {
    const w = await buildWorld();
    await w.as("gm").mutation(api.members.invite, { campaignId: w.campaignId, email: "coder@example.com", asCoGm: true });
    const invitee = await newAccount(w, "coder@example.com");
    await invitee.client.mutation(api.members.joinByCode, { code: w.joinCode });
    expect((await memberRow(w, invitee.id))?.role).toBe("coGm");
  });

  it("a co-GM can't invite as co-GM nor change a pending invite's role; the creator can", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    const coGm = w.as("coGm");
    expect(await fail(coGm.mutation(api.members.invite, { campaignId, email: "x@example.com", asCoGm: true }))).toBe("CO_GM_CREATOR_ONLY");
    const roleOf = (inviteId: Id<"campaignInvites">) => w.t.run(async (ctx) => (await ctx.db.get("campaignInvites", inviteId))?.role ?? null);

    const pending = await w.as("gm").mutation(api.members.invite, { campaignId, email: "pending@example.com", asCoGm: true });
    // Inviting the same email again as a player would demote a pending co-GM invite: the creator's call only.
    expect(await fail(coGm.mutation(api.members.invite, { campaignId, email: "pending@example.com" }))).toBe("CO_GM_CREATOR_ONLY");
    expect(await roleOf(pending)).toBe("coGm");
    // The same invite again is the same row.
    expect(await w.as("gm").mutation(api.members.invite, { campaignId, email: "pending@example.com", asCoGm: true })).toBe(pending);
    expect(await w.as("gm").mutation(api.members.invite, { campaignId, email: "pending@example.com" })).toBe(pending);
    expect(await roleOf(pending)).toBeNull();
    // A co-GM's plain invite to a pending player invite is a no-op; a co-GM revokes invites (unchanged).
    expect(await coGm.mutation(api.members.invite, { campaignId, email: "pending@example.com" })).toBe(pending);
    await coGm.mutation(api.members.revokeInvite, { inviteId: pending });
    expect(await w.t.run((ctx) => ctx.db.get("campaignInvites", pending))).toBeNull();
  });

  it("nobody invites the creator", async () => {
    const w = await buildWorld();
    expect(await fail(w.as("coGm").mutation(api.members.invite, { campaignId: w.campaignId, email: "gm@example.com" }))).toBe("INVALID");
  });

  it("the invite email says 'as co-GM' only for a co-GM invite", () => {
    const coGm = inviteEmail("Ana", "Ashfall", "https://example.com/signin", true);
    expect(coGm.subject).toBe("Ana invited you to Ashfall as co-GM on Duality Heart");
    expect(coGm.text).toContain("join Ashfall as co-GM on Duality Heart.");
    expect(coGm.html).toContain("as co-GM");
    const player = inviteEmail("Ana", "Ashfall", "https://example.com/signin");
    expect(player.subject).toBe("Ana invited you to Ashfall on Duality Heart");
    expect(player.text).not.toContain("co-GM");
  });
});
