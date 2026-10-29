import { describe, expect, it } from "vitest";

import {
  APPLE_ISSUER,
  AppleIdentityError,
  sha256Hex,
  verifyAppleIdentityToken,
} from "../../convex/lib/appleIdentity";

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const RAW_NONCE = "raw-nonce";

function b64url(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function keyPair() {
  const pair = await crypto.subtle.generateKey({ ...RS256, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { pair, jwk: { ...jwk, kid: "test", alg: "RS256", use: "sig" } };
}

async function sign(privateKey: CryptoKey, payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "test" }) {
  const signed = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = new Uint8Array(await crypto.subtle.sign(RS256, privateKey, new TextEncoder().encode(signed)));
  return `${signed}.${b64url(signature)}`;
}

async function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: APPLE_ISSUER,
    aud: "com.dualityheart.mobile",
    exp: NOW / 1000 + 3600,
    nonce: await sha256Hex(RAW_NONCE),
    sub: "apple-user-1",
    email: "ada@example.com",
    email_verified: true,
    ...overrides,
  };
}

async function reason(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppleIdentityError);
    return (error as AppleIdentityError).reason;
  }
  throw new Error("expected AppleIdentityError");
}

describe("verifyAppleIdentityToken", () => {
  it("accepts both app audiences and a string email_verified", async () => {
    const { pair, jwk } = await keyPair();
    const production = await verifyAppleIdentityToken({
      identityToken: await sign(pair.privateKey, await claims()),
      nonce: RAW_NONCE,
      keys: [jwk],
      now: NOW,
    });
    expect(production).toMatchObject({ subject: "apple-user-1", email: "ada@example.com", emailVerified: true });
    const development = await verifyAppleIdentityToken({
      identityToken: await sign(pair.privateKey, await claims({ aud: "com.dualityheart.mobile.dev", email_verified: "true" })),
      nonce: RAW_NONCE,
      keys: [jwk],
      now: NOW,
    });
    expect(development.emailVerified).toBe(true);
  });

  it("accepts a later token that has no email", async () => {
    const { pair, jwk } = await keyPair();
    const full = await claims();
    const payload = { iss: full.iss, aud: full.aud, exp: full.exp, nonce: full.nonce, sub: full.sub };
    const identity = await verifyAppleIdentityToken({
      identityToken: await sign(pair.privateKey, payload),
      nonce: RAW_NONCE,
      keys: [jwk],
      now: NOW,
    });
    expect(identity.email).toBeUndefined();
    expect(identity.emailVerified).toBe(false);
  });

  it("rejects a bad signature, issuer, audience, expiry, and nonce", async () => {
    const { pair, jwk } = await keyPair();
    const other = await keyPair();
    const token = await sign(pair.privateKey, await claims());
    const wrongIssuer = await sign(pair.privateKey, await claims({ iss: "https://evil.test" }));
    const expired = await sign(pair.privateKey, await claims({ exp: NOW / 1000 }));
    const noneAlg = await sign(pair.privateKey, await claims(), { alg: "none", kid: "test" });
    expect(await reason(() => verifyAppleIdentityToken({ identityToken: token, nonce: RAW_NONCE, keys: [other.jwk], now: NOW }))).toBe(
      "signature",
    );
    expect(await reason(() => verifyAppleIdentityToken({ identityToken: wrongIssuer, nonce: RAW_NONCE, keys: [jwk], now: NOW }))).toBe(
      "issuer",
    );
    for (const aud of ["com.evil.app", "com.dualityheart.mobile.evil", ["com.dualityheart.mobile", "com.evil.app"]]) {
      const badAudience = await sign(pair.privateKey, await claims({ aud }));
      expect(await reason(() => verifyAppleIdentityToken({ identityToken: badAudience, nonce: RAW_NONCE, keys: [jwk], now: NOW }))).toBe(
        "audience",
      );
    }
    expect(await reason(() => verifyAppleIdentityToken({ identityToken: expired, nonce: RAW_NONCE, keys: [jwk], now: NOW }))).toBe(
      "expiry",
    );
    expect(await reason(() => verifyAppleIdentityToken({ identityToken: token, nonce: "other-nonce", keys: [jwk], now: NOW }))).toBe(
      "nonce",
    );
    expect(await reason(() => verifyAppleIdentityToken({ identityToken: noneAlg, nonce: RAW_NONCE, keys: [jwk], now: NOW }))).toBe(
      "malformed",
    );
  });
});
