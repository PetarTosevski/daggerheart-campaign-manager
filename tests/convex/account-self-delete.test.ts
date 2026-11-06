import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SELF_DELETE_REASON } from "../../convex/accountSelfDelete";
import { ACCOUNT_DELETE_WAIT_MS } from "../../convex/adminAccountActions";
import { signInCallback } from "../../convex/auth";
import {
  APPLE_NATIVE_PROVIDER_ID,
  appleClientSecret,
  exchangeAppleAuthorizationCode,
  revokeAppleToken,
  signAppleClientSecret,
} from "../../convex/lib/appleRevoke";
import { errorCode, key } from "./helpers";
import { makeTest } from "./setup";

/**
 * Self-service account deletion (plan account-deletion DEL1, bead dcm-gdzi.8; user 2026-11-06): the account is refused
 * and signed out everywhere at once, the existing purge erases it after 30 days, signing in within those days cancels
 * it (an owner-imposed suspension still refuses), its Apple tokens are revoked (logged and skipped without the env),
 * and the app owner can't delete their own account. docs/tasks/TASK-DEL1.md.
 */

const NOW = Date.UTC(2026, 10, 6, 12);
const DAY = 24 * 60 * 60 * 1000;
const APPLE_ENV = ["APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY", "APPLE_CLIENT_SECRET"] as const;

const fail = (p: Promise<unknown>) => p.then(() => new Error("expected a failure"), (e: unknown) => e);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const name of APPLE_ENV) vi.stubEnv(name, "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => ({
    owner: await ctx.db.insert("users", { email: "owner@example.com", emailVerificationTime: 1 }),
    gm: await ctx.db.insert("users", { email: "gm@example.com", name: "Mira", emailVerificationTime: 1 }),
    other: await ctx.db.insert("users", { email: "other@example.com", emailVerificationTime: 1 }),
  }));
  await t.mutation(internal.adminSetup.setOwner, { email: "owner@example.com" });
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|s` });
  return { t, ids, owner: as(ids.owner), gm: as(ids.gm), other: as(ids.other) };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

const status = (t: T, userId: Id<"users">) =>
  t.run((ctx) => ctx.db.query("accountStatus").withIndex("by_user", (q) => q.eq("userId", userId)).first());

async function session(t: T, userId: Id<"users">) {
  return t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 1e9 });
    await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: Date.now() + 1e9 });
    return sessionId;
  });
}

/** An `apple-native` login with a stored refresh token, as `saveAppleRefreshToken` leaves it. */
async function appleLogin(t: T, userId: Id<"users">) {
  await t.run((ctx) => ctx.db.insert("authAccounts", { userId, provider: APPLE_NATIVE_PROVIDER_ID, providerAccountId: "apple-sub" }));
  return t.mutation(internal.accountSelfDelete.saveAppleToken, {
    userId,
    token: { clientId: "com.dualityheart.mobile", refreshToken: "rt-secret" },
  });
}

async function p256Pem(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der));
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`, publicKey: pair.publicKey };
}

const fromB64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

describe("deleteMyAccount", () => {
  it("refuses the account at once and signs it out everywhere; others keep their sessions", async () => {
    const { t, ids, gm } = await setup();
    await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Ember", idempotencyKey: key() });
    await session(t, ids.gm);
    await session(t, ids.gm);
    await session(t, ids.other);

    expect(await gm.mutation(api.accountSelfDelete.deleteMyAccount, {})).toEqual({ deleteAfter: NOW + ACCOUNT_DELETE_WAIT_MS });

    const row = await status(t, ids.gm);
    expect(row).toMatchObject({ userId: ids.gm, by: ids.gm, deleteAfter: NOW + ACCOUNT_DELETE_WAIT_MS, reason: SELF_DELETE_REASON });
    expect(row?.suspendedAt).toBeUndefined();
    const sessions = await t.run((ctx) => ctx.db.query("authSessions").collect());
    expect(sessions.map((s) => s.userId)).toEqual([ids.other]);
    expect(await t.run((ctx) => ctx.db.query("authRefreshTokens").collect())).toHaveLength(1);
    expect(errorCode(await fail(gm.query(api.campaigns.list, {})))).toBe("ACCOUNT_SUSPENDED");
    // A second call is refused by the wrapper like any other call.
    expect(errorCode(await fail(gm.mutation(api.accountSelfDelete.deleteMyAccount, {})))).toBe("ACCOUNT_SUSPENDED");
    const audit = await t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").collect());
    expect(audit.filter((r) => r.action.startsWith("account.")).map((r) => [r.action, r.field, r.actorId])).toEqual([["account.delete", "self", ids.gm]]);
  });

  it("refuses the app owner (OWNER_ACCOUNT_UNDELETABLE) and changes nothing", async () => {
    const { t, ids, owner } = await setup();
    expect(errorCode(await fail(owner.mutation(api.accountSelfDelete.deleteMyAccount, {})))).toBe("OWNER_ACCOUNT_UNDELETABLE");
    expect(await status(t, ids.owner)).toBeNull();
  });

  it("refuses a signed-out caller", async () => {
    const { t } = await setup();
    expect(errorCode(await fail(t.mutation(api.accountSelfDelete.deleteMyAccount, {})))).toBe("UNAUTHENTICATED");
  });

  it("is erased by the existing purge after 30 days, not before", async () => {
    const { t, ids, gm } = await setup();
    await gm.mutation(api.campaigns.create, { frameId: "witherwild", name: "Ember", idempotencyKey: key() });
    await gm.mutation(api.accountSelfDelete.deleteMyAccount, {});

    vi.setSystemTime(NOW + 29 * DAY);
    await t.mutation(internal.accountPurge.purgeDueAccounts, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get("users", ids.gm))).not.toBeNull();

    vi.setSystemTime(NOW + 31 * DAY);
    await t.mutation(internal.accountPurge.purgeDueAccounts, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get("users", ids.gm))).toBeNull();
    expect(await status(t, ids.gm)).toBeNull();
  });
});

describe("signing in within 30 days", () => {
  it("cancels a self-deletion: a credentials sign-in is allowed and clears it", async () => {
    const { t, ids, gm } = await setup();
    await gm.mutation(api.accountSelfDelete.deleteMyAccount, {});
    vi.setSystemTime(NOW + 10 * DAY);
    expect(await t.mutation(internal.accountSelfDelete.signInAllowed, { userId: ids.gm })).toBe(true);
    expect(await status(t, ids.gm)).toBeNull();
    expect(await gm.query(api.campaigns.list, {})).toEqual([]);
    const audit = await t.run((ctx) => ctx.db.query("adminAudit").withIndex("by_at").collect());
    expect(audit.filter((r) => r.action.startsWith("account.")).map((r) => [r.action, r.field])).toEqual([
      ["account.delete", "self"],
      ["account.restore", "self.signIn"],
    ]);
    // The purge never erases it now.
    vi.setSystemTime(NOW + 31 * DAY);
    await t.mutation(internal.accountPurge.purgeDueAccounts, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get("users", ids.gm))).not.toBeNull();
  });

  it("cancels a self-deletion on an OAuth sign-in (createOrUpdateUser callback)", async () => {
    const { t, ids, gm } = await setup();
    await gm.mutation(api.accountSelfDelete.deleteMyAccount, {});
    const userId = await t.run((ctx) =>
      signInCallback(ctx, { existingUserId: ids.gm, provider: { id: "google" }, profile: { email: "gm@example.com", emailVerified: true } }),
    );
    expect(userId).toBe(ids.gm);
    expect(await status(t, ids.gm)).toBeNull();
  });

  it("no longer cancels once the 30 days are over", async () => {
    const { t, ids, gm } = await setup();
    await gm.mutation(api.accountSelfDelete.deleteMyAccount, {});
    vi.setSystemTime(NOW + 31 * DAY);
    expect(await t.mutation(internal.accountSelfDelete.signInAllowed, { userId: ids.gm })).toBe(false);
    expect(errorCode(await fail(t.run((ctx) => signInCallback(ctx, { existingUserId: ids.gm, profile: {} }))))).toBe("ACCOUNT_SUSPENDED");
  });

  it("still refuses an owner-imposed suspension, also on a self-deleted account", async () => {
    const { t, ids, owner } = await setup();
    await owner.mutation(api.adminAccountActions.suspend, { userId: ids.gm, reason: "Spam", confirmEmail: "gm@example.com" });
    expect(await t.mutation(internal.accountSelfDelete.signInAllowed, { userId: ids.gm })).toBe(false);
    expect(errorCode(await fail(t.run((ctx) => signInCallback(ctx, { existingUserId: ids.gm, profile: {} }))))).toBe("ACCOUNT_SUSPENDED");
    expect((await status(t, ids.gm))?.suspendedAt).toBe(NOW);

    // A self-deleted account the owner then suspends: the row is the owner's, so sign-in is refused and nothing clears.
    const { t: t2, ids: ids2, owner: owner2, gm: gm2 } = await setup();
    await gm2.mutation(api.accountSelfDelete.deleteMyAccount, {});
    await owner2.mutation(api.adminAccountActions.suspend, { userId: ids2.gm, reason: "Spam", confirmEmail: "gm@example.com" });
    expect(await t2.mutation(internal.accountSelfDelete.signInAllowed, { userId: ids2.gm })).toBe(false);
    expect(await status(t2, ids2.gm)).toMatchObject({ suspendedAt: NOW, deleteAfter: NOW + ACCOUNT_DELETE_WAIT_MS });
  });

  it("still refuses a deletion the owner scheduled", async () => {
    const { t, ids, owner } = await setup();
    await owner.mutation(api.adminAccountActions.scheduleDelete, { userId: ids.gm, reason: "Asked", confirmEmail: "gm@example.com" });
    expect(await t.mutation(internal.accountSelfDelete.signInAllowed, { userId: ids.gm })).toBe(false);
    expect(await status(t, ids.gm)).not.toBeNull();
  });
});

describe("Apple token revocation", () => {
  it("revokes the stored token at once on delete, with a signed client secret", async () => {
    const { pem, publicKey } = await p256Pem();
    vi.stubEnv("APPLE_TEAM_ID", "TEAM123456");
    vi.stubEnv("APPLE_KEY_ID", "KEY1234567");
    vi.stubEnv("APPLE_PRIVATE_KEY", pem);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { t, ids, gm } = await setup();
    expect(await appleLogin(t, ids.gm)).toBe(true);

    await gm.mutation(api.accountSelfDelete.deleteMyAccount, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://appleid.apple.com/auth/revoke");
    expect(init?.method).toBe("POST");
    const form = new URLSearchParams(String(init?.body));
    expect(form.get("client_id")).toBe("com.dualityheart.mobile");
    expect(form.get("token")).toBe("rt-secret");
    expect(form.get("token_type_hint")).toBe("refresh_token");
    const [h, p, s] = form.get("client_secret")!.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromB64Url(h!)))).toEqual({ alg: "ES256", kid: "KEY1234567" });
    expect(JSON.parse(new TextDecoder().decode(fromB64Url(p!)))).toMatchObject({
      iss: "TEAM123456",
      aud: "https://appleid.apple.com",
      sub: "com.dualityheart.mobile",
    });
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromB64Url(s!), new TextEncoder().encode(`${h}.${p}`));
    expect(valid).toBe(true);
    // The token is taken off the login row, so the purge doesn't revoke it twice.
    const login = await t.run((ctx) => ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", ids.gm)).first());
    expect(login?.secret).toBeUndefined();
  });

  it("logs and skips without the Apple env; the deletion still happens", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { t, ids, gm } = await setup();
    await appleLogin(t, ids.gm);
    await gm.mutation(api.accountSelfDelete.deleteMyAccount, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Apple token revocation skipped"));
    expect((await status(t, ids.gm))?.deleteAfter).toBe(NOW + ACCOUNT_DELETE_WAIT_MS);
  });

  it("the purge revokes a token still stored (the owner's Delete account)", async () => {
    vi.stubEnv("APPLE_CLIENT_SECRET", "ready-made-jwt");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { t, ids, owner } = await setup();
    await appleLogin(t, ids.gm);
    await owner.mutation(api.adminAccountActions.scheduleDelete, { userId: ids.gm, reason: "Asked", confirmEmail: "gm@example.com" });
    vi.setSystemTime(NOW + 31 * DAY);
    await t.mutation(internal.accountPurge.purgeDueAccounts, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const form = new URLSearchParams(String(fetchMock.mock.calls[0]![1]?.body));
    expect(form.get("client_secret")).toBe("ready-made-jwt");
    expect(form.get("token")).toBe("rt-secret");
    expect(await t.run((ctx) => ctx.db.get("users", ids.gm))).toBeNull();
  });

  it("reports an Apple error as failed without throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response('{"error":"invalid_client"}', { status: 400 }));
    const result = await revokeAppleToken({ clientId: "c", refreshToken: "r" }, { APPLE_CLIENT_SECRET: "s" }, fetchMock);
    expect(result).toBe("failed");
    const offline = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await revokeAppleToken({ clientId: "c", refreshToken: "r" }, { APPLE_CLIENT_SECRET: "s" }, offline)).toBe("failed");
  });

  it("prefers signing with the key over a ready-made secret; null with neither", async () => {
    const { pem } = await p256Pem();
    const signed = await appleClientSecret({ APPLE_TEAM_ID: "T", APPLE_KEY_ID: "K", APPLE_PRIVATE_KEY: pem, APPLE_CLIENT_SECRET: "x" }, "app");
    expect(signed?.split(".")).toHaveLength(3);
    expect(await appleClientSecret({ APPLE_CLIENT_SECRET: "x" }, "app")).toBe("x");
    expect(await appleClientSecret({}, "app")).toBeNull();
    // Literal "\n" in a pasted key works too.
    expect((await signAppleClientSecret({ teamId: "T", keyId: "K", privateKey: pem.replace(/\n/g, "\\n"), clientId: "app" })).split(".")).toHaveLength(3);
  });

  it("exchanges a sign-in's authorization code for the refresh token it keeps", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ access_token: "a", token_type: "Bearer", expires_in: 3600, refresh_token: "rt-new", id_token: "i" }),
    );
    const token = await exchangeAppleAuthorizationCode({ clientId: "app", authorizationCode: "code1" }, { APPLE_CLIENT_SECRET: "s" }, fetchMock);
    expect(token).toBe("rt-new");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://appleid.apple.com/auth/token");
    const form = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(form)).toEqual({ client_id: "app", client_secret: "s", code: "code1", grant_type: "authorization_code" });
    expect(await exchangeAppleAuthorizationCode({ clientId: "app", authorizationCode: "c" }, {}, fetchMock)).toBeNull();
  });
});
