import { describe, expect, it } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ACCOUNTS_PAGE_MAX, CAP_MAX } from "../../convex/adminAccounts";
import { DEFAULT_CAPS } from "../../src/lib/admin/config";
import { errorCode } from "./helpers";
import { makeTest } from "./setup";

/**
 * Config AD3: the owner sets the sign-up mode and the four caps (single-field intents, one audit row per change),
 * reads the paginated account table and adds or removes testers. docs/tasks/TASK-CONFIG-AD3.md.
 */

const fail = (p: Promise<unknown>) => p.then(() => new Error("expected a failure"), (e: unknown) => e);

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    owner: await ctx.db.insert("users", { email: "owner@example.com", name: "Olive", emailVerificationTime: 1 }),
    gm: await ctx.db.insert("users", { email: "gm@example.com", name: "Mira", emailVerificationTime: 1 }),
    player: await ctx.db.insert("users", { email: "player@example.com", emailVerificationTime: 1 }),
  }));
  await t.mutation(internal.adminSetup.setOwner, { email: "owner@example.com" });
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  return { t, ids, owner: as(ids.owner), gm: as(ids.gm), player: as(ids.player) };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

const audit = (t: T) => t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").collect());
const settings = (t: T) => t.run((ctx) => ctx.db.query("appConfig").withIndex("by_key", (q) => q.eq("key", "app")).unique());

async function campaign(t: T, ownerId: Id<"users">, name: string, extra: { deletedAt?: number } = {}) {
  return t.run((ctx) =>
    ctx.db.insert("campaigns", {
      ownerId,
      frameId: "witherwild",
      name,
      nameKey: name.toLowerCase(),
      tier: 1,
      level: 1,
      createdAt: 1,
      lastOpenedAt: 1,
      ...extra,
    }),
  );
}

describe("setSignUpMode", () => {
  it("saves the mode and writes one audit row per change; the same mode again writes nothing", async () => {
    const { t, ids, owner } = await setup();
    const before = (await audit(t)).length;
    await owner.mutation(api.adminAccounts.setSignUpMode, { mode: "invite" });
    expect((await settings(t))?.signUpMode).toBe("invite");
    expect((await owner.query(api.appAdmin.settings, {})).signUpMode).toBe("invite");
    await owner.mutation(api.adminAccounts.setSignUpMode, { mode: "invite" });
    await owner.mutation(api.adminAccounts.setSignUpMode, { mode: "closed" });
    const rows = (await audit(t)).slice(before);
    expect(rows).toMatchObject([
      { action: "signUpMode.set", actorId: ids.owner, from: "open", to: "invite" },
      { action: "signUpMode.set", actorId: ids.owner, from: "invite", to: "closed" },
    ]);
  });

  it("refuses everyone but the owner, and writes nothing for them", async () => {
    const { t, gm } = await setup();
    const before = (await audit(t)).length;
    expect(errorCode(await fail(t.mutation(api.adminAccounts.setSignUpMode, { mode: "closed" })))).toBe("UNAUTHENTICATED");
    expect(errorCode(await fail(gm.mutation(api.adminAccounts.setSignUpMode, { mode: "closed" })))).toBe("FORBIDDEN");
    expect((await settings(t))?.signUpMode).toBeUndefined();
    expect((await audit(t)).length).toBe(before);
  });
});

describe("setCap", () => {
  it("saves one cap, keeps the others at their defaults and audits the change", async () => {
    const { t, ids, owner } = await setup();
    await owner.mutation(api.adminAccounts.setCap, { cap: "campaignsPerGm", value: 3 });
    await owner.mutation(api.adminAccounts.setCap, { cap: "playersPerCampaign", value: 6 });
    expect((await settings(t))?.caps).toEqual({ campaignsPerGm: 3, playersPerCampaign: 6 });
    expect((await owner.query(api.appAdmin.settings, {})).caps).toEqual({ ...DEFAULT_CAPS, campaignsPerGm: 3, playersPerCampaign: 6 });
    const rows = (await audit(t)).filter((row) => row.action === "cap.set");
    expect(rows).toMatchObject([
      { actorId: ids.owner, field: "campaignsPerGm", from: DEFAULT_CAPS.campaignsPerGm, to: 3 },
      { actorId: ids.owner, field: "playersPerCampaign", from: DEFAULT_CAPS.playersPerCampaign, to: 6 },
    ]);
    // The value already in force writes nothing.
    await owner.mutation(api.adminAccounts.setCap, { cap: "campaignsPerGm", value: 3 });
    await owner.mutation(api.adminAccounts.setCap, { cap: "campaignsApp", value: DEFAULT_CAPS.campaignsApp });
    expect((await audit(t)).filter((row) => row.action === "cap.set")).toHaveLength(2);
  });

  it("takes only whole numbers from 1 to 1000", async () => {
    const { t, owner } = await setup();
    for (const value of [0, -1, 1.5, CAP_MAX + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(errorCode(await fail(owner.mutation(api.adminAccounts.setCap, { cap: "charactersPerPlayer", value })))).toBe("INVALID");
    }
    await owner.mutation(api.adminAccounts.setCap, { cap: "charactersPerPlayer", value: 1 });
    await owner.mutation(api.adminAccounts.setCap, { cap: "campaignsApp", value: CAP_MAX });
    expect((await settings(t))?.caps).toEqual({ charactersPerPlayer: 1, campaignsApp: CAP_MAX });
  });

  it("refuses everyone but the owner", async () => {
    const { t, gm } = await setup();
    expect(errorCode(await fail(gm.mutation(api.adminAccounts.setCap, { cap: "campaignsApp", value: 5 })))).toBe("FORBIDDEN");
    expect(await settings(t)).toMatchObject({ key: "app" });
    expect((await settings(t))?.caps).toBeUndefined();
  });
});

describe("accounts", () => {
  it("lists every account with role, up to 5 campaign names, last seen and the tester flag", async () => {
    const { t, ids, owner } = await setup();
    const live = await campaign(t, ids.gm, "Ashfall");
    await campaign(t, ids.gm, "Gone", { deletedAt: 5 });
    await t.run(async (ctx) => {
      await ctx.db.insert("campaignMembers", { campaignId: live, userId: ids.player, joinedAt: 1, lastOpenedAt: 1 });
      await ctx.db.insert("campaignOpens", { userId: ids.player, campaignId: live, lastOpenedAt: 100 });
      await ctx.db.insert("campaignOpens", { userId: ids.player, campaignId: live, lastOpenedAt: 300 });
    });
    await owner.mutation(api.adminAccounts.addTester, { userId: ids.player });

    const result = await owner.query(api.adminAccounts.accounts, { paginationOpts: { cursor: null, numItems: 10 } });
    expect(result.isDone).toBe(true);
    const byId = new Map(result.page.map((row) => [row.userId, row]));
    expect(byId.get(ids.owner)).toMatchObject({ role: "owner", name: "Olive", email: "owner@example.com", tester: false, lastSeen: null });
    expect(byId.get(ids.gm)).toMatchObject({ role: "gm", campaigns: ["Ashfall"], moreCampaigns: false, tester: false });
    expect(byId.get(ids.player)).toMatchObject({ role: "player", name: null, campaigns: ["Ashfall"], lastSeen: 300, tester: true });
    // Newest accounts first.
    expect(result.page.map((row) => row.userId)).toEqual([ids.player, ids.gm, ids.owner]);
  });

  it("returns only the table's fields: no password, key, session or verification data", async () => {
    const { t, ids, owner } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("authAccounts", { userId: ids.gm, provider: "password", providerAccountId: "gm@example.com", secret: "hash-secret-xyz" }),
    );
    const result = await owner.query(api.adminAccounts.accounts, { paginationOpts: { cursor: null, numItems: 10 } });
    for (const row of result.page) {
      expect(Object.keys(row).sort()).toEqual(
        ["campaigns", "createdAt", "email", "lastSeen", "moreCampaigns", "name", "role", "tester", "userId"].sort(),
      );
    }
    expect(JSON.stringify(result)).not.toContain("hash-secret-xyz");
  });

  it("shows at most 5 names and flags the rest", async () => {
    const { t, ids, owner } = await setup();
    for (let i = 0; i < 7; i++) await campaign(t, ids.gm, `C${i}`);
    const result = await owner.query(api.adminAccounts.accounts, { paginationOpts: { cursor: null, numItems: 10 } });
    const gmRow = result.page.find((row) => row.userId === ids.gm)!;
    expect(gmRow.campaigns).toHaveLength(5);
    expect(gmRow.moreCampaigns).toBe(true);
  });

  it("paginates and clamps the page size", async () => {
    const { t, owner } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < ACCOUNTS_PAGE_MAX + 5; i++) await ctx.db.insert("users", { email: `u${i}@example.com` });
    });
    const first = await owner.query(api.adminAccounts.accounts, { paginationOpts: { cursor: null, numItems: 1000 } });
    expect(first.page).toHaveLength(ACCOUNTS_PAGE_MAX);
    expect(first.isDone).toBe(false);
    const second = await owner.query(api.adminAccounts.accounts, { paginationOpts: { cursor: first.continueCursor, numItems: 1000 } });
    expect(second.page).toHaveLength(8);
    expect(second.isDone).toBe(true);
  });

  it("refuses everyone but the owner", async () => {
    const { t, gm, player } = await setup();
    const args = { paginationOpts: { cursor: null, numItems: 10 } };
    expect(errorCode(await fail(t.query(api.adminAccounts.accounts, args)))).toBe("UNAUTHENTICATED");
    expect(errorCode(await fail(gm.query(api.adminAccounts.accounts, args)))).toBe("FORBIDDEN");
    expect(errorCode(await fail(player.query(api.adminAccounts.accounts, args)))).toBe("FORBIDDEN");
  });
});

describe("testers", () => {
  it("adds and removes a tester once each, auditing each change", async () => {
    const { t, ids, owner } = await setup();
    await owner.mutation(api.adminAccounts.addTester, { userId: ids.player });
    await owner.mutation(api.adminAccounts.addTester, { userId: ids.player });
    const testers = () => t.run((ctx) => ctx.db.query("appTesters").withIndex("by_user", (q) => q.eq("userId", ids.player)).collect());
    expect(await testers()).toMatchObject([{ userId: ids.player, addedBy: ids.owner }]);
    await owner.mutation(api.adminAccounts.removeTester, { userId: ids.player });
    await owner.mutation(api.adminAccounts.removeTester, { userId: ids.player });
    expect(await testers()).toEqual([]);
    const rows = (await audit(t)).filter((row) => row.action.startsWith("tester."));
    expect(rows).toMatchObject([
      { action: "tester.add", actorId: ids.owner, target: ids.player },
      { action: "tester.remove", actorId: ids.owner, target: ids.player },
    ]);
  });

  it("refuses an account that no longer exists", async () => {
    const { t, ids, owner } = await setup();
    await t.run((ctx) => ctx.db.delete(ids.player));
    expect(errorCode(await fail(owner.mutation(api.adminAccounts.addTester, { userId: ids.player })))).toBe("NOT_FOUND");
  });

  it("refuses everyone but the owner", async () => {
    const { t, ids, gm } = await setup();
    expect(errorCode(await fail(gm.mutation(api.adminAccounts.addTester, { userId: ids.gm })))).toBe("FORBIDDEN");
    expect(errorCode(await fail(gm.mutation(api.adminAccounts.removeTester, { userId: ids.gm })))).toBe("FORBIDDEN");
    expect(await t.run((ctx) => ctx.db.query("appTesters").withIndex("by_user").collect())).toEqual([]);
  });
});
