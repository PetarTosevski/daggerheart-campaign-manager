import { describe, expect, it, vi } from "vitest";

import {
  APPLE_DEV_AUDIENCE,
  APPLE_ISSUER,
  APPLE_KEYS_MIN_REFETCH_MS,
  APPLE_KEYS_TTL_MS,
  AppleIdentityError,
  AppleKeyCache,
  appleAudiences,
  appleTokenKeyId,
  sha256Hex,
  verifyAppleIdentityToken,
  type AppleJwk,
} from "../../convex/lib/appleIdentity";

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const RAW_NONCE = "raw-nonce";
/** A cloud deployment with no dev rail set: what production looks like to the audience check. */
const PRODUCTION = { CONVEX_CLOUD_URL: "https://prod-example-123.convex.cloud" };

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
  it("accepts the store and preview audiences everywhere, and a string email_verified", async () => {
    const { pair, jwk } = await keyPair();
    const production = await verifyAppleIdentityToken({
      identityToken: await sign(pair.privateKey, await claims()),
      nonce: RAW_NONCE,
      keys: [jwk],
      now: NOW,
      env: PRODUCTION,
    });
    expect(production).toMatchObject({ subject: "apple-user-1", email: "ada@example.com", emailVerified: true });
    const preview = await verifyAppleIdentityToken({
      identityToken: await sign(pair.privateKey, await claims({ aud: "com.dualityheart.mobile.preview", email_verified: "true" })),
      nonce: RAW_NONCE,
      keys: [jwk],
      now: NOW,
      env: PRODUCTION,
    });
    expect(preview.emailVerified).toBe(true);
  });

  it("refuses the dev build's audience on production, accepts it on the cloud dev and a local deployment", async () => {
    const { pair, jwk } = await keyPair();
    const token = await sign(pair.privateKey, await claims({ aud: APPLE_DEV_AUDIENCE }));
    const verify = (env: Record<string, string | undefined>) =>
      verifyAppleIdentityToken({ identityToken: token, nonce: RAW_NONCE, keys: [jwk], now: NOW, env });
    expect(await reason(() => verify(PRODUCTION))).toBe("audience");
    expect(await reason(() => verify({ ...PRODUCTION, ALLOW_DEV_APPLE_SIGN_IN: "1" }))).toBe("audience");
    expect((await verify({ ...PRODUCTION, ALLOW_DEV_APPLE_SIGN_IN: "true" })).subject).toBe("apple-user-1");
    expect((await verify({ CONVEX_CLOUD_URL: "http://127.0.0.1:3210" })).subject).toBe("apple-user-1");
    expect([...appleAudiences(PRODUCTION)].sort()).toEqual(["com.dualityheart.mobile", "com.dualityheart.mobile.preview"]);
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

describe("appleTokenKeyId", () => {
  it("reads the kid of an RS256 token and refuses anything else before a key is fetched", async () => {
    const { pair } = await keyPair();
    expect(appleTokenKeyId(await sign(pair.privateKey, await claims(), { alg: "RS256", kid: "k1" }))).toBe("k1");
    for (const header of [{ alg: "none", kid: "k1" }, { alg: "RS256" }, { alg: "RS256", kid: "" }, { alg: "HS256", kid: "k1" }]) {
      expect(await reason(async () => appleTokenKeyId(await sign(pair.privateKey, await claims(), header)))).toBe("malformed");
    }
    for (const token of ["", "a.b", "a..c", "!!!.e30.sig"]) {
      expect(await reason(async () => appleTokenKeyId(token))).toBe("malformed");
    }
  });
});

describe("AppleKeyCache", () => {
  const key = (kid: string) => ({ kty: "RSA", n: "n", e: "AQAB", kid }) as AppleJwk;

  function cache(responses: Array<AppleJwk[] | Error>) {
    let now = NOW;
    const fetchKeys = vi.fn(async () => {
      const next = responses.shift();
      if (next === undefined || next instanceof Error) throw next ?? new Error("no response");
      return next;
    });
    return { cache: new AppleKeyCache(fetchKeys, () => now), fetchKeys, advance: (ms: number) => (now += ms) };
  }

  it("fetches once for repeat sign-ins with a known kid", async () => {
    const { cache: keys, fetchKeys, advance } = cache([[key("a")]]);
    for (let i = 0; i < 5; i++) {
      expect((await keys.keysFor("a")).map((k) => k.kid)).toEqual(["a"]);
      advance(APPLE_KEYS_MIN_REFETCH_MS);
    }
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  it("shares one fetch between concurrent sign-ins", async () => {
    const { cache: keys, fetchKeys } = cache([[key("a")]]);
    await Promise.all([keys.keysFor("a"), keys.keysFor("a"), keys.keysFor("a")]);
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  it("refetches on an unknown kid (Apple rotated), at most once a minute", async () => {
    const { cache: keys, fetchKeys, advance } = cache([[key("a")], [key("a"), key("b")]]);
    await keys.keysFor("a");
    expect((await keys.keysFor("b")).map((k) => k.kid)).toEqual(["a"]);
    expect(fetchKeys).toHaveBeenCalledTimes(1);
    advance(APPLE_KEYS_MIN_REFETCH_MS);
    expect((await keys.keysFor("b")).map((k) => k.kid)).toEqual(["a", "b"]);
    expect(fetchKeys).toHaveBeenCalledTimes(2);
    await keys.keysFor("b");
    expect(fetchKeys).toHaveBeenCalledTimes(2);
  });

  it("refetches after the TTL and keeps the stale keys when that refetch fails", async () => {
    const { cache: keys, fetchKeys, advance } = cache([[key("a")], new Error("down"), [key("c")]]);
    await keys.keysFor("a");
    advance(APPLE_KEYS_TTL_MS);
    expect((await keys.keysFor("a")).map((k) => k.kid)).toEqual(["a"]);
    expect(fetchKeys).toHaveBeenCalledTimes(2);
    expect((await keys.keysFor("a")).map((k) => k.kid)).toEqual(["c"]);
    expect(fetchKeys).toHaveBeenCalledTimes(3);
  });

  it("throws when the first fetch fails and there are no keys yet", async () => {
    const { cache: keys } = cache([new AppleIdentityError("keys")]);
    expect(await reason(() => keys.keysFor("a"))).toBe("keys");
  });
});
