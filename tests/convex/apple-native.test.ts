/**
 * Native Sign in with Apple (`apple-native`). The identity token is signed with a test key that the
 * action receives as Apple's JWKS. Assertions use ConvexError.data.code, never message text.
 */
import { generateKeyPairSync } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import { APPLE_ISSUER, APPLE_JWKS_URL, sha256Hex } from "../../convex/lib/appleIdentity";
import { errorCode } from "./helpers";
import { makeTest } from "./setup";

const { privateKey: sessionKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ENV: Record<string, string> = {
  JWT_PRIVATE_KEY: sessionKey.export({ type: "pkcs8", format: "pem" }).toString(),
  CONVEX_SITE_URL: "https://apple-native.example.test",
  SITE_URL: "https://app.example.test",
};
const previous: Record<string, string | undefined> = {};

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

function b64url(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let signingKey: CryptoKey;
let jwk: JsonWebKey & { kid: string; alg: string; use: string };

beforeAll(async () => {
  for (const [name, value] of Object.entries(ENV)) {
    previous[name] = process.env[name];
    process.env[name] = value;
  }
  const pair = await crypto.subtle.generateKey({ ...RS256, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, [
    "sign",
    "verify",
  ]);
  signingKey = pair.privateKey;
  jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "test", alg: "RS256", use: "sig" };
});

afterAll(() => {
  for (const name of Object.keys(ENV)) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url !== APPLE_JWKS_URL) throw new Error(`unexpected fetch ${url}`);
      return Response.json({ keys: [jwk] });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function identityToken(payload: Record<string, unknown>) {
  const header = { alg: "RS256", kid: "test" };
  const signed = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = new Uint8Array(await crypto.subtle.sign(RS256, signingKey, new TextEncoder().encode(signed)));
  return `${signed}.${b64url(signature)}`;
}

async function claims(rawNonce: string, overrides: Record<string, unknown> = {}) {
  return {
    iss: APPLE_ISSUER,
    aud: "com.dualityheart.mobile",
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: await sha256Hex(rawNonce),
    sub: "apple-user-1",
    ...overrides,
  };
}

type SignInResult = { tokens?: { token: string; refreshToken: string } | null };

function signIn(t: ReturnType<typeof makeTest>, identityTokenValue: string, nonce: string, name?: string) {
  return t.action(api.auth.signIn, {
    provider: "apple-native",
    params: { identityToken: identityTokenValue, nonce, ...(name ? { name } : {}) },
  }) as Promise<SignInResult>;
}

const caught = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);
const users = (t: ReturnType<typeof makeTest>) => t.run((ctx) => ctx.db.query("users").collect());

describe("apple-native sign-in", () => {
  it("signs a verified email into an existing verified user and stores the Apple id", async () => {
    const t = makeTest();
    const existing = await t.run((ctx) => ctx.db.insert("users", { email: "ada@example.com", emailVerificationTime: 1 }));
    const nonce = "nonce-link";
    const result = await signIn(t, await identityToken(await claims(nonce, { email: "Ada@example.com", email_verified: true })), nonce, "Ada Lovelace");
    expect(result.tokens?.token).toEqual(expect.any(String));
    expect(await users(t)).toHaveLength(1);
    expect((await users(t))[0]?._id).toBe(existing);
    const accounts = await t.run((ctx) => ctx.db.query("authAccounts").collect());
    expect(accounts).toMatchObject([{ provider: "apple-native", providerAccountId: "apple-user-1", userId: existing }]);
  });

  it("creates a separate user for a Hide My Email address", async () => {
    const t = makeTest();
    const firstNonce = "nonce-real";
    await signIn(
      t,
      await identityToken(await claims(firstNonce, { email: "ada@example.com", email_verified: "true", name: "ignored" })),
      firstNonce,
      "Ada",
    );
    const relayNonce = "nonce-relay";
    const relay = await signIn(
      t,
      await identityToken(
        await claims(relayNonce, {
          sub: "apple-user-relay",
          email: "hide@privaterelay.appleid.com",
          email_verified: true,
        }),
      ),
      relayNonce,
    );
    expect(relay.tokens?.token).toEqual(expect.any(String));
    const rows = await users(t);
    expect(rows.map((user) => user.email).sort()).toEqual(["ada@example.com", "hide@privaterelay.appleid.com"]);
    expect(rows.find((user) => user.email === "ada@example.com")?.name).toBe("Ada");
  });

  it("refuses an identity token with no email_verified and creates no user", async () => {
    const t = makeTest();
    const nonce = "nonce-unverified";
    const error = await caught(signIn(t, await identityToken(await claims(nonce, { email: "ada@example.com" })), nonce));
    expect(errorCode(error)).toBe("FORBIDDEN");
    expect(await users(t)).toEqual([]);
  });

  it("signs in again when the token has no email and the Apple user id already has an account", async () => {
    const t = makeTest();
    const firstNonce = "nonce-first";
    await signIn(t, await identityToken(await claims(firstNonce, { email: "ada@example.com", email_verified: true })), firstNonce, "Ada");
    const againNonce = "nonce-again";
    const again = await signIn(t, await identityToken(await claims(againNonce)), againNonce);
    expect(again.tokens?.token).toEqual(expect.any(String));
    expect(await users(t)).toHaveLength(1);
    expect((await users(t))[0]?.email).toBe("ada@example.com");
  });

  it("refuses a token with no email when that Apple user id has no account", async () => {
    const t = makeTest();
    const nonce = "nonce-new";
    const error = await caught(signIn(t, await identityToken(await claims(nonce)), nonce));
    expect(errorCode(error)).toBe("INVALID");
    expect(await users(t)).toEqual([]);
  });

  it("refuses the wrong audience, a bad signature, and the development audience is accepted", async () => {
    const t = makeTest();
    const badNonce = "nonce-aud";
    const bad = await caught(
      signIn(t, await identityToken(await claims(badNonce, { aud: "com.evil.app", email: "ada@example.com", email_verified: true })), badNonce),
    );
    expect(errorCode(bad)).toBe("FORBIDDEN");
    const other = await crypto.subtle.generateKey({ ...RS256, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, [
      "sign",
      "verify",
    ]);
    const header = { alg: "RS256", kid: "test" };
    const payload = await claims("nonce-sig", { email: "ada@example.com", email_verified: true });
    const signed = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = new Uint8Array(await crypto.subtle.sign(RS256, other.privateKey, new TextEncoder().encode(signed)));
    const forged = await caught(signIn(t, `${signed}.${b64url(signature)}`, "nonce-sig"));
    expect(errorCode(forged)).toBe("FORBIDDEN");
    expect(await users(t)).toEqual([]);

    const devNonce = "nonce-dev";
    const dev = await signIn(
      t,
      await identityToken(await claims(devNonce, { aud: "com.dualityheart.mobile.dev", email: "dev@example.com", email_verified: true })),
      devNonce,
    );
    expect(dev.tokens?.token).toEqual(expect.any(String));
    expect((await users(t))[0]?.email).toBe("dev@example.com");
  });

  it("refuses an existing Apple account that is suspended (AD14)", async () => {
    const t = makeTest();
    const firstNonce = "nonce-before-suspension";
    await signIn(t, await identityToken(await claims(firstNonce, { email: "ada@example.com", email_verified: true })), firstNonce);
    await t.run(async (ctx) => {
      const user = (await ctx.db.query("users").first())!;
      await ctx.db.insert("accountStatus", { userId: user._id, suspendedAt: Date.now(), updatedAt: Date.now(), reason: "Spam", by: user._id });
    });
    const nonce = "nonce-suspended";
    expect(errorCode(await caught(signIn(t, await identityToken(await claims(nonce)), nonce)))).toBe("ACCOUNT_SUSPENDED");
  });

  it("fetches Apple's keys once for repeat sign-ins", async () => {
    // A fresh module graph, so the key cache starts empty for this test.
    vi.resetModules();
    const t = makeTest();
    for (const nonce of ["nonce-cache-1", "nonce-cache-2", "nonce-cache-3"]) {
      const result = await signIn(t, await identityToken(await claims(nonce, { email: "ada@example.com", email_verified: true })), nonce);
      expect(result.tokens?.token).toEqual(expect.any(String));
    }
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("refuses a malformed token without fetching keys or spending the limit", async () => {
    vi.resetModules();
    const t = makeTest();
    for (const token of ["not-a-jwt", `${b64url(JSON.stringify({ alg: "none", kid: "test" }))}.e30.sig`]) {
      expect(errorCode(await caught(signIn(t, token, "nonce-malformed")))).toBe("FORBIDDEN");
    }
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("caps apple-native attempts with RATE_LIMITED", async () => {
    const t = makeTest();
    const forged = `${b64url(JSON.stringify({ alg: "RS256", kid: "test" }))}.${b64url(JSON.stringify(await claims("nonce-flood")))}.c2ln`;
    const codes = new Set<unknown>();
    for (let i = 0; i < 60; i++) codes.add(errorCode(await caught(signIn(t, forged, "nonce-flood"))));
    expect(codes).toEqual(new Set(["FORBIDDEN"]));
    expect(errorCode(await caught(signIn(t, forged, "nonce-flood")))).toBe("RATE_LIMITED");
    // The cap holds a real token too: the bucket is spent before the signature is checked.
    const nonce = "nonce-after-flood";
    const real = await identityToken(await claims(nonce, { email: "ada@example.com", email_verified: true }));
    expect(errorCode(await caught(signIn(t, real, nonce)))).toBe("RATE_LIMITED");
    expect(await users(t)).toEqual([]);
  });

  it("answers a retryable RATE_LIMITED when Apple's keys cannot be fetched", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    const t = makeTest();
    const nonce = "nonce-outage";
    const token = await identityToken(await claims(nonce, { email: "ada@example.com", email_verified: true }));
    expect(errorCode(await caught(signIn(t, token, nonce)))).toBe("RATE_LIMITED");
    expect(await users(t)).toEqual([]);
  });
});

describe("apple-native remembers the authorization code (PXF)", () => {
  it("schedules rememberAppleSignIn with the code and the bundle id, new and existing", async () => {
    const t = makeTest();
    const nonce = "n1";
    await t.action(api.auth.signIn, { provider: "apple-native", params: { identityToken: await identityToken(await claims(nonce, { email: "a@x.com", email_verified: true })), nonce, authorizationCode: "code-1" } });
    let s = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const u = (await users(t))[0]!._id;
    expect(s.map((f) => [f.name, f.args[0]])).toEqual([["accountSelfDelete:rememberAppleSignIn", { userId: u, clientId: "com.dualityheart.mobile", authorizationCode: "code-1" }]]);
    const n2 = "n2";
    await t.action(api.auth.signIn, { provider: "apple-native", params: { identityToken: await identityToken(await claims(n2, { aud: "com.dualityheart.mobile.dev" })), nonce: n2, authorizationCode: "code-2" } });
    s = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(s).toHaveLength(2);
    expect(s[1]!.args[0]).toEqual({ userId: u, clientId: "com.dualityheart.mobile.dev", authorizationCode: "code-2" });
    const n3 = "n3";
    await t.action(api.auth.signIn, { provider: "apple-native", params: { identityToken: await identityToken(await claims(n3)), nonce: n3 } });
    s = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(s).toHaveLength(2);
    const n4 = "n4";
    expect(errorCode(await caught(t.action(api.auth.signIn, { provider: "apple-native", params: { identityToken: await identityToken(await claims(n4)), nonce: n4, authorizationCode: 5 } })))).toBe("INVALID");
  });
});
