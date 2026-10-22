/**
 * dcm-bxp.125: every Convex Auth access token carries a random id, so two tokens minted for the same session in the
 * same second differ (before, they were byte-identical and the Convex client refused the refresh, dcm-bxp.123).
 * Convex Auth reserves `jti` in `jwt.customClaims`, so the claim is `token_id` (convex/auth.ts).
 */
import { generateKeyPairSync, verify } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeTest } from "./setup";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ENV = {
  JWT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  CONVEX_SITE_URL: "https://auth-jti.example.test",
};
const previous: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [name, value] of Object.entries(ENV)) {
    previous[name] = process.env[name];
    process.env[name] = value;
  }
});
afterAll(() => {
  for (const name of Object.keys(ENV)) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
});
afterEach(() => {
  vi.useRealTimers();
});

type SignInResult = { userId: Id<"users">; sessionId: Id<"authSessions">; tokens: { token: string; refreshToken: string } | null };
type Claims = { sub: string; iss: string; aud: string; iat: number; exp: number; token_id?: unknown };

/** Checks the RS256 signature against the test key pair and returns the payload. */
function verifiedClaims(token: string): Claims {
  const [header, payload, signature] = token.split(".");
  const ok = verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url"));
  expect(ok, "the token's signature verifies").toBe(true);
  expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256" });
  return JSON.parse(Buffer.from(payload, "base64url").toString()) as Claims;
}

describe("Convex Auth access tokens (dcm-bxp.125)", () => {
  it("two tokens minted for one session in the same second differ only by a random token_id", async () => {
    // Freeze Date only: both tokens get the same `iat` and `exp`, the worst case of dcm-bxp.123.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T12:00:00.250Z"));
    const t = makeTest();
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "jti@example.test", emailVerificationTime: 1 }));

    // The sign-in, then a second token for the same session (what a refresh does).
    // `store` returns a union over every request type; a "signIn" request returns the session and its tokens.
    const first = (await t.mutation(internal.auth.store, { args: { type: "signIn", userId, generateTokens: true } })) as SignInResult;
    const second = (await t.mutation(internal.auth.store, {
      args: { type: "signIn", userId, sessionId: first.sessionId, generateTokens: true },
    })) as SignInResult;
    expect(second.sessionId).toBe(first.sessionId);

    const a = verifiedClaims(first.tokens!.token);
    const b = verifiedClaims(second.tokens!.token);
    expect(first.tokens!.token).not.toBe(second.tokens!.token);

    // Same session, same second, same issuer and audience: only the random id differs.
    expect(a.sub).toBe(`${userId}|${first.sessionId}`);
    expect(a.iat).toBe(Math.floor(Date.parse("2026-10-22T12:00:00Z") / 1000));
    const { token_id: idA, ...restA } = a;
    const { token_id: idB, ...restB } = b;
    expect(restA).toEqual(restB);
    expect(restA).toMatchObject({ iss: ENV.CONVEX_SITE_URL, aud: "convex" });
    expect(idA).toMatch(/^[0-9a-f-]{36}$/);
    expect(idB).toMatch(/^[0-9a-f-]{36}$/);
    expect(idA).not.toBe(idB);
  });
});
