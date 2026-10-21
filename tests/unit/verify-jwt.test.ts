// @vitest-environment node
// src/lib/auth/verify-jwt.ts: the proxy's local check of the Convex Auth token (plan performance.yaml, PF2).
// Tokens are signed here with RS256 keys made for the test, shaped like Convex Auth's (iss = site URL, aud = "convex").

import { describe, expect, it, vi } from "vitest";

import { convexSiteUrl, createJwtVerifier, JWKS_RETRY_MS, JWKS_TTL_MS } from "@/lib/auth/verify-jwt";

const ISSUER = "https://happy-otter-123.convex.site";
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

async function keyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ ...RS256, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, [
    "sign",
    "verify",
  ]);
}

function b64url(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(privateKey: CryptoKey, payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256" }) {
  const signed = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = new Uint8Array(await crypto.subtle.sign(RS256, privateKey, new TextEncoder().encode(signed)));
  return `${signed}.${b64url(signature)}`;
}

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const claims = (overrides: Record<string, unknown> = {}) => ({
  sub: "user123|session456",
  iss: ISSUER,
  aud: "convex",
  iat: NOW / 1000 - 60,
  exp: NOW / 1000 + 3600,
  ...overrides,
});

async function setup(options: { failFirst?: number } = {}) {
  const pair = await keyPair();
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  let now = NOW;
  let failures = options.failFirst ?? 0;
  const fetchJwks = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe(JWKS_URL);
    if (failures > 0) {
      failures--;
      return new Response("unavailable", { status: 503 });
    }
    return Response.json({ keys: [{ use: "sig", alg: "RS256", ...jwk }] });
  });
  const verify = createJwtVerifier({
    issuer: ISSUER,
    audience: "convex",
    jwksUrl: JWKS_URL,
    fetch: fetchJwks as unknown as typeof fetch,
    now: () => now,
  });
  return { pair, verify, fetchJwks, advance: (ms: number) => (now += ms) };
}

describe("createJwtVerifier", () => {
  it("accepts a valid Convex Auth token", async () => {
    const { pair, verify } = await setup();
    expect(await verify(await sign(pair.privateKey, claims()))).toBe(true);
  });

  it("treats an expired token as signed out", async () => {
    const { pair, verify } = await setup();
    expect(await verify(await sign(pair.privateKey, claims({ exp: NOW / 1000 - 1 })))).toBe(false);
    expect(await verify(await sign(pair.privateKey, claims({ exp: NOW / 1000 })))).toBe(false);
  });

  it("treats a token signed with another key as signed out", async () => {
    const { verify } = await setup();
    const other = await keyPair();
    expect(await verify(await sign(other.privateKey, claims()))).toBe(false);
  });

  it("treats a tampered payload as signed out", async () => {
    const { pair, verify } = await setup();
    const [header, , signature] = (await sign(pair.privateKey, claims())).split(".");
    const forged = `${header}.${b64url(JSON.stringify(claims({ sub: "someone-else" })))}.${signature}`;
    expect(await verify(forged)).toBe(false);
  });

  it("treats malformed tokens as signed out", async () => {
    const { pair, verify } = await setup();
    const valid = await sign(pair.privateKey, claims());
    for (const token of [undefined, null, "", "abc", "a.b", "a.b.c", `${valid}.extra`, valid.replace(/\./g, "!"), "x".repeat(10_000)]) {
      expect(await verify(token)).toBe(false);
    }
  });

  it("rejects the wrong issuer, audience, algorithm, a future nbf or a missing subject", async () => {
    const { pair, verify } = await setup();
    expect(await verify(await sign(pair.privateKey, claims({ iss: "https://evil.convex.site" })))).toBe(false);
    expect(await verify(await sign(pair.privateKey, claims({ aud: "not-convex" })))).toBe(false);
    expect(await verify(await sign(pair.privateKey, claims({ nbf: NOW / 1000 + 60 })))).toBe(false);
    expect(await verify(await sign(pair.privateKey, claims({ sub: undefined })))).toBe(false);
    expect(await verify(await sign(pair.privateKey, claims(), { alg: "none" }))).toBe(false);
    expect(await verify(await sign(pair.privateKey, claims(), { alg: "HS256" }))).toBe(false);
    // An audience array that contains "convex" is fine.
    expect(await verify(await sign(pair.privateKey, claims({ aud: ["other", "convex"] })))).toBe(true);
  });

  it("fetches the JWKS at most once per 10 minutes", async () => {
    const { pair, verify, fetchJwks, advance } = await setup();
    const token = () => sign(pair.privateKey, claims({ exp: NOW / 1000 + 7200 }));
    // Concurrent first requests share one fetch.
    const results = await Promise.all([1, 2, 3].map(async () => verify(await token())));
    expect(results).toEqual([true, true, true]);
    // Bad tokens do not trigger a refetch either.
    expect(await verify(await sign((await keyPair()).privateKey, claims()))).toBe(false);
    advance(JWKS_TTL_MS - 1);
    expect(await verify(await token())).toBe(true);
    expect(fetchJwks).toHaveBeenCalledTimes(1);
    advance(1);
    expect(await verify(await token())).toBe(true);
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it("fails closed while the JWKS cannot be fetched, and retries after a pause", async () => {
    const { pair, verify, fetchJwks, advance } = await setup({ failFirst: 1 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const token = await sign(pair.privateKey, claims());
    expect(await verify(token)).toBe(false);
    expect(await verify(token)).toBe(false);
    expect(fetchJwks).toHaveBeenCalledTimes(1);
    // The warning never carries the token.
    expect(warn.mock.calls.flat().join(" ")).not.toContain(token);
    advance(JWKS_RETRY_MS);
    expect(await verify(token)).toBe(true);
    expect(fetchJwks).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("convexSiteUrl", () => {
  it("derives the site URL from the Convex URL", () => {
    expect(convexSiteUrl({ NEXT_PUBLIC_CONVEX_URL: "https://happy-otter-123.convex.cloud" })).toBe(ISSUER);
    expect(convexSiteUrl({ NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3444" })).toBe("http://127.0.0.1:3445");
    expect(convexSiteUrl({ NEXT_PUBLIC_CONVEX_URL: "https://convex.example.com" })).toBeNull();
    expect(convexSiteUrl({})).toBeNull();
    expect(convexSiteUrl({ CONVEX_SITE_URL: "https://auth.example.com/", NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3444" })).toBe(
      "https://auth.example.com",
    );
  });
});
