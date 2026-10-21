// Local check of the Convex Auth access token for src/proxy.ts (plan performance.yaml, PF2; analysis Q1).
//
// Convex Auth signs its JWT with RS256 (JWT_PRIVATE_KEY on the deployment) and publishes the public half at
// `<CONVEX_SITE_URL>/.well-known/jwks.json`; the token's `iss` is CONVEX_SITE_URL and its `aud` is "convex"
// (node_modules/@convex-dev/auth/dist/server/implementation/tokens.js, convex/auth.config.ts). Convex verifies every
// call against the same JWKS, so checking signature, issuer, audience and expiry here is the check Convex makes, without
// a round trip per request. The proxy is still only a redirect convenience: the access checks stay in Convex (rule 3).
//
// Fail closed: anything that cannot be verified (malformed, wrong key, wrong issuer or audience, expired, JWKS
// unreachable) is "signed out". Tokens are never logged.

/** How long a fetched JWKS is used before it is fetched again (acceptance: at most once per process per 10 min). */
export const JWKS_TTL_MS = 10 * 60_000;
/** After a failed JWKS fetch, wait this long before trying again (every request is "signed out" meanwhile). */
export const JWKS_RETRY_MS = 30_000;
/** Larger tokens are rejected before any parsing. Convex Auth tokens are well under 1 KB. */
const MAX_TOKEN_LENGTH = 8_192;

type Jwk = JsonWebKey & { kid?: string; use?: string };
type CachedKeys = { keys: { kid?: string; key: CryptoKey }[]; fetchedAt: number };

export type JwtVerifierOptions = {
  /** Expected `iss`, the deployment's CONVEX_SITE_URL. */
  issuer: string;
  /** Expected `aud` (Convex Auth: "convex"). */
  audience: string;
  /** Where the JWKS is served (`<issuer>/.well-known/jwks.json`). */
  jwksUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
};

export type JwtVerifier = (token: string | null | undefined) => Promise<boolean>;

function decodeBase64Url(part: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(part)) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function decodeJson(part: string): Record<string, unknown> | null {
  const bytes = decodeBase64Url(part);
  if (bytes === null) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** A verifier with its own JWKS cache. The proxy keeps one per process. */
export function createJwtVerifier(options: JwtVerifierOptions): JwtVerifier {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const issuer = stripSlash(options.issuer);
  let cached: CachedKeys | null = null;
  let failedAt: number | null = null;
  let inflight: Promise<CachedKeys | null> | null = null;

  async function fetchKeys(): Promise<CachedKeys | null> {
    try {
      const response = await doFetch(options.jwksUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`JWKS fetch returned HTTP ${response.status}`);
      const body = (await response.json()) as { keys?: unknown };
      const jwks = Array.isArray(body.keys) ? (body.keys as Jwk[]) : [];
      const keys: CachedKeys["keys"] = [];
      for (const jwk of jwks) {
        if (jwk.kty !== "RSA" || (jwk.alg !== undefined && jwk.alg !== "RS256") || (jwk.use !== undefined && jwk.use !== "sig")) continue;
        try {
          const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e }, RS256, false, ["verify"]);
          keys.push({ kid: jwk.kid, key });
        } catch {
          // A malformed key is skipped; tokens it would have verified are signed out.
        }
      }
      if (keys.length === 0) throw new Error("JWKS has no usable RS256 key");
      failedAt = null;
      return { keys, fetchedAt: now() };
    } catch (error) {
      failedAt = now();
      console.warn(`verify-jwt: could not load the JWKS from ${options.jwksUrl}:`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  async function getKeys(): Promise<CachedKeys | null> {
    const t = now();
    if (cached !== null && t - cached.fetchedAt < JWKS_TTL_MS) return cached;
    if (failedAt !== null && t - failedAt < JWKS_RETRY_MS) return cached;
    inflight ??= fetchKeys().finally(() => {
      inflight = null;
    });
    const fresh = await inflight;
    if (fresh !== null) cached = fresh;
    // A failed refresh keeps the old keys for now; with no keys at all every token is signed out.
    return cached;
  }

  return async function verify(token) {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = decodeJson(headerPart);
    const payload = decodeJson(payloadPart);
    const signature = decodeBase64Url(signaturePart);
    if (header === null || payload === null || signature === null || signature.length === 0) return false;
    if (header.alg !== "RS256" || header.crit !== undefined) return false;

    const nowSeconds = now() / 1000;
    if (typeof payload.iss !== "string" || stripSlash(payload.iss) !== issuer) return false;
    const aud = payload.aud;
    if (!(aud === options.audience || (Array.isArray(aud) && aud.includes(options.audience)))) return false;
    if (typeof payload.exp !== "number" || !(payload.exp > nowSeconds)) return false;
    if (payload.nbf !== undefined && !(typeof payload.nbf === "number" && payload.nbf <= nowSeconds)) return false;
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return false;

    const keys = await getKeys();
    if (keys === null) return false;
    const kid = typeof header.kid === "string" ? header.kid : undefined;
    const candidates = kid === undefined ? keys.keys : keys.keys.filter((k) => k.kid === undefined || k.kid === kid);
    const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
    for (const { key } of candidates) {
      try {
        if (await crypto.subtle.verify(RS256, key, signature, signed)) return true;
      } catch {
        // Try the next key.
      }
    }
    return false;
  };
}

/**
 * The deployment's CONVEX_SITE_URL (the token issuer and JWKS host), derived from NEXT_PUBLIC_CONVEX_URL:
 * `https://<name>.convex.cloud` serves its HTTP actions at `https://<name>.convex.site`, and a local backend serves
 * them on the next port (`convex dev --local-site-port`). `CONVEX_SITE_URL` in the Next.js environment overrides this
 * (custom domains). NEXT_PUBLIC_CONVEX_SITE_URL is not used: the e2e build loads .env.local, where it names the
 * developer's cloud deployment, not the local e2e backend. Returns null when it cannot be derived.
 */
export function convexSiteUrl(env: { CONVEX_SITE_URL?: string; NEXT_PUBLIC_CONVEX_URL?: string }): string | null {
  if (env.CONVEX_SITE_URL) return stripSlash(env.CONVEX_SITE_URL);
  if (!env.NEXT_PUBLIC_CONVEX_URL) return null;
  let url: URL;
  try {
    url = new URL(env.NEXT_PUBLIC_CONVEX_URL);
  } catch {
    return null;
  }
  if (url.hostname.endsWith(".convex.cloud")) {
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    return stripSlash(url.origin);
  }
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.port !== "") {
    url.port = String(Number(url.port) + 1);
    return stripSlash(url.origin);
  }
  return null;
}
