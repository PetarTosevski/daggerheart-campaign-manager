import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ACCOUNT_DELETE_WAIT_MS } from "../../convex/adminAccountActions";
import { characterDraft } from "../fixtures/characters";
import { errorCode, key } from "./helpers";
import { makeTest } from "./setup";

/**
 * Config AD14 (N11): Delete account. The account is refused at once like a suspension, waits 30 days with Undo, then
 * the daily purge erases it: its campaigns go to a co-GM when they have one, else are deleted with the restore window
 * (and purged after it); its characters in other people's campaigns stay (shown as "former player"); its own rows,
 * logins and sessions go; the audit keeps the id only. docs/tasks/TASK-CONFIG-AD14.md.
 */

const NOW = Date.UTC(2026, 10, 5, 12);
const DAY = 24 * 60 * 60 * 1000;

const fail = (p: Promise<unknown>) => p.then(() => new Error("expected a failure"), (e: unknown) => e);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    owner: await ctx.db.insert("users", { email: "owner@example.com", emailVerificationTime: 1 }),
    gm: await ctx.db.insert("users", { email: "gm@example.com", name: "Mira", emailVerificationTime: 1 }),
    coGm: await ctx.db.insert("users", { email: "cogm@example.com", emailVerificationTime: 1 }),
    other: await ctx.db.insert("users", { email: "other@example.com", emailVerificationTime: 1 }),
  }));
  await t.mutation(internal.adminSetup.setOwner, { email: "owner@example.com" });
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  return { t, ids, owner: as(ids.owner), gm: as(ids.gm), coGm: as(ids.coGm), other: as(ids.other) };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

const deleteArgs = (userId: Id<"users">) => ({ userId, reason: "Asked to be removed", confirmEmail: "gm@example.com" });
const status = (t: T, userId: Id<"users">) =>
  t.run((ctx) => ctx.db.query("accountStatus").withIndex("by_user", (q) => q.eq("userId", userId)).first());

describe("scheduleDelete / cancelDelete", () => {
  it("refuses the account at once, waits 30 days, and Undo brings it back untouched", async () => {
    const { t, ids, owner, gm } = await setup();
    await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Ember", idempotencyKey: key() });
    await owner.mutation(api.adminAccountActions.scheduleDelete, deleteArgs(ids.gm));
    expect(await owner.query(api.adminAccountActions.statuses, {})).toEqual([
      { userId: ids.gm, suspended: false, deleteAfter: NOW + ACCOUNT_DELETE_WAIT_MS },
    ]);
    expect(errorCode(await fail(gm.query(api.campaigns.list, {})))).toBe("ACCOUNT_SUSPENDED");

    // Before the 30 days the purge does nothing.
    vi.setSystemTime(NOW + 29 * DAY);
    await t.mutation(internal.accountPurge.purgeDueAccounts, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get("users", ids.gm))).not.toBeNull();

    await owner.mutation(api.adminAccountActions.cancelDelete, { userId: ids.gm });
    expect(await status(t, ids.gm)).toBeNull();
    expect(await gm.query(api.campaigns.list, {})).toHaveLength(1);
    // After Undo the purge never erases it.
    vi.setSystemTime(NOW + 31 * DAY);
    await t.mutation(internal.accountPurge.purgeDueAccounts, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get("users", ids.gm))).not.toBeNull();

    const actions = (await t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").collect())).map((r) => r.action);
    expect(actions.filter((a) => a.startsWith("account."))).toEqual(["account.delete", "account.restore"]);
  });

  it("Undo keeps a suspension set by hand; Lift then clears it", async () => {
    const { t, ids, owner } = await setup();
    await owner.mutation(api.adminAccountActions.suspend, deleteArgs(ids.gm));
    await owner.mutation(api.adminAccountActions.scheduleDelete, deleteArgs(ids.gm));
    expect(await status(t, ids.gm)).toMatchObject({ suspendedAt: NOW, deleteAfter: NOW + ACCOUNT_DELETE_WAIT_MS });
    await owner.mutation(api.adminAccountActions.cancelDelete, { userId: ids.gm });
    expect(await owner.query(api.adminAccountActions.statuses, {})).toEqual([{ userId: ids.gm, suspended: true, deleteAfter: null }]);
    await owner.mutation(api.adminAccountActions.unsuspend, { userId: ids.gm });
    expect(await status(t, ids.gm)).toBeNull();
  });

  it("needs the email typed again and never targets the owner", async () => {
    const { t, ids, owner } = await setup();
    expect(errorCode(await fail(owner.mutation(api.adminAccountActions.scheduleDelete, { ...deleteArgs(ids.gm), confirmEmail: "gm@example" })))).toBe(
      "INVALID",
    );
    expect(
      errorCode(await fail(owner.mutation(api.adminAccountActions.scheduleDelete, { ...deleteArgs(ids.owner), confirmEmail: "owner@example.com" }))),
    ).toBe("FORBIDDEN");
    expect(errorCode(await fail(owner.mutation(api.adminAccountActions.cancelDelete, { userId: ids.owner })))).toBe("FORBIDDEN");
    expect(await status(t, ids.gm)).toBeNull();
    expect(await status(t, ids.owner)).toBeNull();
  });
});

describe("accountPurge", () => {
  it("hands campaigns to a co-GM, deletes the rest with the restore window, keeps characters elsewhere, erases the account", async () => {
    const { t, ids, owner, gm, coGm, other } = await setup();
    // Shared: the GM's campaign with a co-GM. Solo: no co-GM. Old: deleted 10 days ago by the GM.
    const shared = (await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Shared", idempotencyKey: key() })).campaignId;
    const solo = (await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Solo", idempotencyKey: key() })).campaignId;
    const old = (await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Old", idempotencyKey: key() })).campaignId;
    await gm.mutation(api.campaigns.remove, { campaignId: old });
    await coGm.mutation(api.members.joinByCode, { code: await gm.mutation(api.members.rotateJoinCode, { campaignId: shared }) });
    await gm.mutation(api.members.setCoGm, { campaignId: shared, userId: ids.coGm, coGm: true });
    // The co-GM already runs a campaign called "Shared": the handed-over one gets "Shared (2)".
    await coGm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Shared", idempotencyKey: key() });
    // Elsewhere: the GM plays a character in another GM's campaign.
    const elsewhere = (await other.mutation(api.campaigns.create, { frameId: "witherwild", name: "Elsewhere", idempotencyKey: key() })).campaignId;
    await gm.mutation(api.members.joinByCode, { code: await other.mutation(api.members.rotateJoinCode, { campaignId: elsewhere }) });
    const { characterId } = await gm.mutation(api.characters.create, { campaignId: elsewhere, draft: characterDraft("Ash"), idempotencyKey: key() });
    // Personal rows and a login with a session.
    await t.run(async (ctx) => {
      await ctx.db.insert("userPreferences", { userId: ids.gm, dice3d: false, updatedAt: NOW });
      await ctx.db.insert("appTesters", { userId: ids.gm, addedAt: NOW, addedBy: ids.owner });
      await ctx.db.insert("authAccounts", { userId: ids.gm, provider: "password", providerAccountId: "gm@example.com" });
      const sessionId = await ctx.db.insert("authSessions", { userId: ids.gm, expirationTime: NOW + DAY });
      await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: NOW + DAY });
    });

    await owner.mutation(api.adminAccountActions.scheduleDelete, deleteArgs(ids.gm));
    vi.setSystemTime(NOW + 30 * DAY + 1);
    await t.mutation(internal.accountPurge.purgeDueAccounts, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers, 1000);
    const erasedAt = Date.now();
    const purges = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((f) => f.name === "cleanup:purgeCampaign");

    const after = await t.run(async (ctx) => ({
      user: await ctx.db.get("users", ids.gm),
      status: await ctx.db.query("accountStatus").collect(),
      shared: await ctx.db.get("campaigns", shared),
      solo: await ctx.db.get("campaigns", solo),
      old: await ctx.db.get("campaigns", old),
      coGmMember: await ctx.db.query("campaignMembers").withIndex("by_campaign_user", (q) => q.eq("campaignId", shared).eq("userId", ids.coGm)).first(),
      gmMember: await ctx.db.query("campaignMembers").withIndex("by_user", (q) => q.eq("userId", ids.gm)).first(),
      character: await ctx.db.get("characters", characterId),
      prefs: await ctx.db.query("userPreferences").withIndex("by_user", (q) => q.eq("userId", ids.gm)).first(),
      tester: await ctx.db.query("appTesters").withIndex("by_user", (q) => q.eq("userId", ids.gm)).first(),
      accounts: await ctx.db.query("authAccounts").collect(),
      sessions: await ctx.db.query("authSessions").collect(),
      tokens: await ctx.db.query("authRefreshTokens").collect(),
      audit: await ctx.db.query("adminAudit").withIndex("by_at").collect(),
    }));
    expect(after.user).toBeNull();
    expect(after.status).toEqual([]);
    // N11: handed to the co-GM, who becomes its creator (no member row), under a free name.
    expect(after.shared).toMatchObject({ ownerId: ids.coGm, name: "Shared (2)", nameKey: "shared (2)" });
    expect(after.shared?.deletedAt).toBeUndefined();
    expect(after.coGmMember).toBeNull();
    // N11: no co-GM, so deleted as its GM's Delete would, with its purge scheduled for the end of the restore window.
    expect(after.solo?.deletedAt).toBe(NOW + 30 * DAY + 1);
    const soloPurge = purges.find((f) => (f.args[0] as { campaignId: string }).campaignId === solo);
    expect(soloPurge?.scheduledTime).toBeGreaterThan(NOW + 60 * DAY);
    // The one the GM had deleted 30 days ago is past its window, so it is purged now.
    expect(after.old).toBeNull();
    // N11: the character in someone else's campaign stays; with no member row the party shows "Former player".
    expect(after.character).toMatchObject({ ownerId: ids.gm, campaignId: elsewhere });
    expect(after.gmMember).toBeNull();
    expect(after.prefs).toBeNull();
    expect(after.tester).toBeNull();
    expect(after.accounts).toEqual([]);
    expect(after.sessions).toEqual([]);
    expect(after.tokens).toEqual([]);
    // The other GM still reads the character and can delete it.
    expect(await other.query(api.charactersReads.get, { characterId })).toBeTruthy();
    // Every step audited, by id only.
    const steps = after.audit.filter((r) => r.action.startsWith("account.") || r.action === "campaign.delete");
    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "account.delete", field: "scheduled", target: ids.gm }),
        expect.objectContaining({ action: "account.delete", field: "campaign.handedOver", target: shared, to: ids.coGm }),
        expect.objectContaining({ action: "campaign.delete", target: solo }),
        expect.objectContaining({ action: "account.delete", field: "erased", target: ids.gm }),
      ]),
    );
    expect(JSON.stringify(after.audit)).not.toContain("gm@example.com");

    // At the end of its window the scheduled purge erases the deleted campaign.
    vi.setSystemTime(erasedAt + 31 * DAY);
    await t.mutation(internal.cleanup.purgeCampaign, { campaignId: solo });
    await t.finishAllScheduledFunctions(vi.runAllTimers, 1000);
    expect(await t.run((ctx) => ctx.db.get("campaigns", solo))).toBeNull();
  });
});
