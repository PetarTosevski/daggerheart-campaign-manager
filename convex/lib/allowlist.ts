/**
 * Sign-in policy for the single-GM app. Pure functions only: they take the
 * environment as an argument so they can be unit-tested and so the Convex
 * bundle does not depend on where `process.env` is readable.
 *
 * Everything fails closed: a missing or malformed value means "not allowed".
 */

/**
 * Environment lookups used here: `GM_EMAILS`, `CONVEX_CLOUD_URL`,
 * `E2E_AUTH_ENABLED` and `E2E_AUTH_SECRET`. Typed as a plain record so
 * `process.env` can be passed directly.
 */
export type Env = Readonly<Record<string, string | undefined>>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Parses the comma-separated `GM_EMAILS` value into normalised addresses. */
export function parseGmEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map(normalizeEmail)
      .filter((email) => email.length > 0),
  );
}

export function isAllowedEmail(
  email: unknown,
  env: Env,
): email is string {
  if (typeof email !== "string" || email.trim().length === 0) return false;
  return parseGmEmails(env.GM_EMAILS).has(normalizeEmail(email));
}

/**
 * A sign-in profile is allowed only when the provider vouches that the email
 * is verified (`emailVerified === true`) and the email is on the allowlist.
 */
export function isAllowedProfile(
  profile: { email?: unknown; emailVerified?: unknown },
  env: Env,
): boolean {
  return profile.emailVerified === true && isAllowedEmail(profile.email, env);
}

/** True only for a Convex backend running on this machine. */
export function isE2EDeployment(env: Env): boolean {
  if (!env.CONVEX_CLOUD_URL) return false;
  try {
    const { hostname } = new URL(env.CONVEX_CLOUD_URL);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Compares two strings in time independent of where they first differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Builds the profile for the test-only e2e sign-in. Returns `null` unless this
 * is a local deployment with e2e auth enabled and the secret matches; only
 * then is the email marked as verified.
 */
export function buildE2EProfile(
  input: { email?: unknown; secret?: unknown },
  env: Env,
): { email: string; emailVerified: true } | null {
  if (!isE2EDeployment(env) || env.E2E_AUTH_ENABLED !== "true") return null;
  const expected = env.E2E_AUTH_SECRET;
  if (!expected || typeof input.secret !== "string") return null;
  if (!constantTimeEqual(input.secret, expected)) return null;
  if (typeof input.email !== "string" || input.email.trim().length === 0) {
    return null;
  }
  return { email: normalizeEmail(input.email), emailVerified: true };
}
