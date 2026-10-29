void 0; import { constantTimeEqual } from "./allowlist";

/**
 * Apple identity tokens for the native Sign in with Apple button.
 *
 * Expo passes `nonce` through to `ASAuthorizationAppleIDRequest.nonce` unchanged
 * (`expo-apple-authentication` ios/AppleAuthenticationRequest.swift). Apple puts
 * that value in the token. The app therefore sends Apple the SHA-256 hex of a
 * raw nonce, and sends the raw nonce here. Verification uses Apple's public
 * keys. There is no Apple client secret.
 */
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_AUDIENCES = ["com.dualityheart.mobile", "com.dualityheart.mobile.dev"] as const;

const AUDIENCES = new Set<string>(APPLE_AUDIENCES);

type AppleIdentity = {
  subject: string;
  email?: string;
  emailVerified: boolean;
};

class AppleIdentityError extends Error {
  constructor(readonly reason: "malformed" | "signature" | "issuer" | "audience" | "expiry" | "nonce" | "subject" | "keys") {
    super(reason);
    this.name = "AppleIdentityError";
  }
}

type AppleJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

async function fetchAppleIdentityKeys(fetchImpl: typeof fetch = globalThis.fetch): Promise<AppleJwk[]> {
  const response = await fetchImpl(APPLE_JWKS_URL);
  if (!response.ok) throw new AppleIdentityError("keys");
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !Array.isArray((body as { keys?: unknown }).keys)) {
    throw new AppleIdentityError("keys");
  }
  return (body as { keys: AppleJwk[] }).keys;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

async function verifyAppleIdentityToken(input: {
  identityToken: string;
  nonce: string;
  keys: readonly AppleJwk[];
  now?: number;
}): Promise<AppleIdentity> {
  const parts = input.identityToken.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) throw new AppleIdentityError("malformed");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJson(encodedHeader);
  if (!isRecord(header) || header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new AppleIdentityError("malformed");
  }
  const jwk = input.keys.find(
    (key) =>
      key.kid === header.kid &&
      key.kty === "RSA" &&
      typeof key.n === "string" &&
      typeof key.e === "string" &&
      (key.alg === undefined || key.alg === "RS256") &&
      (key.use === undefined || key.use === "sig"),
  );
  if (jwk === undefined) throw new AppleIdentityError("signature");
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256" },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = base64UrlToBytes(encodedSignature);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
  if (!valid) throw new AppleIdentityError("signature");

  const payload = decodeJson(encodedPayload);
  if (!isRecord(payload)) throw new AppleIdentityError("malformed");
  if (payload.iss !== APPLE_ISSUER) throw new AppleIdentityError("issuer");
  if (!audienceAllowed(payload.aud)) throw new AppleIdentityError("audience");
  const now = input.now ?? Date.now();
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp * 1000 <= now) {
    throw new AppleIdentityError("expiry");
  }
  if (typeof payload.nonce !== "string") throw new AppleIdentityError("nonce");
  const expected = await sha256Hex(input.nonce);
  if (!constantTimeEqual(payload.nonce, expected)) throw new AppleIdentityError("nonce");
  if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 256) {
    throw new AppleIdentityError("subject");
  }
  const email = typeof payload.email === "string" && payload.email.trim().length > 0 ? payload.email : undefined;
  return {
    subject: payload.sub,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    ...(email !== undefined ? { email } : {}),
  };
}

function audienceAllowed(aud: unknown): boolean {
  const values = Array.isArray(aud) ? aud : [aud];
  if (values.length === 0 || values.some((value) => typeof value !== "string" || !AUDIENCES.has(value))) return false;
  return true;
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as unknown;
  } catch {
    throw new AppleIdentityError("malformed");
  }
}

function base64UrlToBytes(segment: string): Uint8Array<ArrayBuffer> {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (segment.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A line that starts with `import` or `export` would register this helper in convex/_generated.
void 0; export {
  APPLE_ISSUER,
  APPLE_JWKS_URL,
  APPLE_AUDIENCES,
  AppleIdentityError,
  fetchAppleIdentityKeys,
  sha256Hex,
  verifyAppleIdentityToken,
}; export type { AppleIdentity };
