import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { UNVERIFIED_SIGNUP_BATCH, UNVERIFIED_SIGNUP_TTL_MS } from "../../convex/cleanup";
import { makeTest } from "./setup";

const DAY = 24 * 60 * 60 * 1000;

type Test = ReturnType<typeof makeTest>;

afterEach(() => {
  vi.useRealTimers();
});

/** An unverified user with an account, a code, a session and a refresh token. */
async function seedUser(t: Test, email: string, provider = "password") {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email });
    const accountId = await ctx.db.insert("authAccounts", { userId, provider, providerAccountId: email });
    await ctx.db.insert("authVerificationCodes", { accountId, provider: "resend-otp", code: `hash-${email}`, expirationTime: 1 });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: 1 });
    await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: 1 });
    return userId;
  });
}

const exists = (t: Test, id: Id<"users">) => t.run(async (ctx) => (await ctx.db.get(id)) !== null);
const authRows = (t: Test) =>
  t.run(async (ctx) => ({
    accounts: (await ctx.db.query("authAccounts").take(1000)).length,
    codes: (await ctx.db.query("authVerificationCodes").take(1000)).length,
    sessions: (await ctx.db.query("authSessions").take(1000)).length,
    tokens: (await ctx.db.query("authRefreshTokens").take(1000)).length,
  }));

/** Moves the clock `ageDays` forward, then runs the job and everything it schedules. */
async function runAfterDays(t: Test, ageDays: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + ageDays * DAY);
  await t.mutation(internal.cleanup.expireUnverifiedSignups, {});
  await t.finishAllScheduledFunctions(() => undefined);
}

describe("expireUnverifiedSignups", () => {
  it("deletes an old unverified user with its auth rows", async () => {
    const t = makeTest();
    const id = await seedUser(t, "old@example.com");
    await runAfterDays(t, 8);
    expect(await exists(t, id)).toBe(false);
    expect(await authRows(t)).toEqual({ accounts: 0, codes: 0, sessions: 0, tokens: 0 });
  });

  it("keeps a user younger than seven days", async () => {
    const t = makeTest();
    const id = await seedUser(t, "new@example.com");
    await runAfterDays(t, 6);
    expect(await exists(t, id)).toBe(true);
    expect((await authRows(t)).accounts).toBe(1);
    expect(UNVERIFIED_SIGNUP_TTL_MS).toBe(7 * DAY);
  });

  it("keeps verified users, owners, members, character owners and other providers", async () => {
    const t = makeTest();
    const verified = await t.run((ctx) => ctx.db.insert("users", { email: "v@example.com", emailVerificationTime: 1 }));
    const owner = await seedUser(t, "owner@example.com");
    const member = await seedUser(t, "member@example.com");
    const player = await seedUser(t, "player@example.com");
    const google = await seedUser(t, "g@example.com", "google");
    const gone = await seedUser(t, "gone@example.com");
    await t.run(async (ctx) => {
      const now = Date.now();
      const campaignId = await ctx.db.insert("campaigns", {
        ownerId: owner,
        frameId: "witherwild",
        name: "C",
        nameKey: "c",
        tier: 1,
        level: 1,
        createdAt: now,
        lastOpenedAt: now,
      });
      await ctx.db.insert("campaignMembers", { campaignId, userId: member, joinedAt: now, lastOpenedAt: now });
      // The sheet blob is `v.any()` and the job only looks the row up by its owner index.
      await ctx.db.insert("characters", { campaignId, ownerId: player, createdBy: player, status: "active", sheet: {}, createdAt: 0, updatedAt: 0 });
    });
    await runAfterDays(t, 30);
    for (const id of [verified, owner, member, player, google]) expect(await exists(t, id)).toBe(true);
    expect(await exists(t, gone)).toBe(false);
  });

  it("works through more users than one batch, rescheduling itself", async () => {
    const t = makeTest();
    await t.run(async (ctx) => {
      // The verified user sorts first, so the later pages must still be reached.
      await ctx.db.insert("users", { email: "keep@example.com", emailVerificationTime: 1 });
      for (let i = 0; i < UNVERIFIED_SIGNUP_BATCH + 5; i += 1) await ctx.db.insert("users", { email: `u${i}@example.com` });
    });
    await runAfterDays(t, 8);
    const left = await t.run((ctx) => ctx.db.query("users").take(1000));
    expect(left.map((u) => u.email)).toEqual(["keep@example.com"]);
  });
});
