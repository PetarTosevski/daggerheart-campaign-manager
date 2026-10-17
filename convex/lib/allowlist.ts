/**
 * Sign-in policy. Pure functions only: they take the environment as an
 * argument so they can be unit-tested; Convex callers pass the typed `env`
 * from `_generated/server`, read inside their handlers.
 *
 * Sign-up is limited for now to an allowlist (user decision 2026-10-17): the
 * union of `ALLOWED_EMAILS`, the legacy `GM_EMAILS` and, on a local e2e
 * deployment only, the emails of the env-defined test accounts in
 * `SEED_ACCOUNTS`. Everything fails closed: a missing or malformed value means
 * "not allowed".
 */

/**
 * Environment lookups used here: `ALLOWED_EMAILS`, `GM_EMAILS`,
 * `SEED_ACCOUNTS`, `CONVEX_CLOUD_URL`, `E2E_AUTH_ENABLED` and
 * `E2E_AUTH_SECRET`. Typed as a plain record so the typed Convex `env` (or a
 * test fixture) can be passed directly.
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

export type SeedAccount = { email: string; password: string };

/**
 * Parses `SEED_ACCOUNTS`: `email:password` pairs separated by `;` (passwords
 * may contain `:`). Malformed entries are skipped.
 */
export function parseSeedAccounts(raw: string | undefined): SeedAccount[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((entry) => {
      const at = entry.indexOf(":");
      if (at <= 0) return null;
      const email = normalizeEmail(entry.slice(0, at));
      const password = entry.slice(at + 1);
      return email && password ? { email, password } : null;
    })
    .filter((a): a is SeedAccount => a !== null);
}

/**
 * The test accounts `accounts:seed` may create. Throws unless this is a local
 * e2e deployment, so known passwords never become logins on a cloud one.
 */
export function seedAccountsFor(env: Env): SeedAccount[] {
  if (!isE2EDeployment(env)) {
    throw new Error("accounts:seed runs only on a local (e2e) deployment.");
  }
  return parseSeedAccounts(env.SEED_ACCOUNTS);
}

export function allowedEmails(env: Env): Set<string> {
  return new Set([
    ...parseGmEmails(env.ALLOWED_EMAILS),
    ...parseGmEmails(env.GM_EMAILS),
    // Seed accounts have env-stored passwords; allowlist them only locally.
    ...(isE2EDeployment(env) ? parseSeedAccounts(env.SEED_ACCOUNTS).map((a) => a.email) : []),
  ]);
}

export function isAllowedEmail(
  email: unknown,
  env: Env,
): email is string {
  if (typeof email !== "string" || email.trim().length === 0) return false;
  return allowedEmails(env).has(normalizeEmail(email));
}

/**
 * An OAuth (or e2e) sign-in is allowed only when the provider vouches that
 * the email is verified (`emailVerified === true`) and it is allowlisted.
 */
export function isAllowedProfile(
  profile: { email?: unknown; emailVerified?: unknown },
  env: Env,
): boolean {
  return profile.emailVerified === true && isAllowedEmail(profile.email, env);
}

/**
 * True only for a Convex backend running on this machine. Cloud deployments
 * (`*.convex.cloud`) are rejected explicitly as well, as defence in depth.
 */
export function isE2EDeployment(env: Env): boolean {
  const url = env.CONVEX_CLOUD_URL;
  if (!url || url.includes(".convex.cloud")) return false;
  try {
    const { hostname } = new URL(url);
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
