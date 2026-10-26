/**
 * Sign-in rails. Pure functions only: they take the environment as an
 * argument so they can be unit-tested; Convex callers pass the typed `env`
 * from `_generated/server`, read inside their handlers.
 *
 * Sign-up is open (user decision 2026-10-23): any email may create an
 * account, and there is no invite-only list. The rails that remain are
 * separate safety gates: the local e2e sign-in (`isE2EDeployment`,
 * `buildE2EProfile`) and the seed accounts, which exist only on a local e2e
 * deployment or where `ALLOW_SEED_ACCOUNTS` is `"true"` (never production).
 * The file name is historical.
 */

/**
 * Environment lookups used here: `SEED_ACCOUNTS`, `ALLOW_SEED_ACCOUNTS`,
 * `CONVEX_CLOUD_URL`, `E2E_AUTH_ENABLED` and `E2E_AUTH_SECRET`. Typed as a
 * plain record so the typed Convex `env` (or a test fixture) can be passed
 * directly.
 */
export type Env = Readonly<Record<string, string | undefined>>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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
 * Seed accounts (known, env-stored passwords) are enabled only on a local e2e
 * deployment, or where `ALLOW_SEED_ACCOUNTS` is exactly `"true"`. Set that
 * flag on the cloud dev deployment only, never on production.
 */
export function seedAccountsEnabled(env: Env): boolean {
  return isE2EDeployment(env) || env.ALLOW_SEED_ACCOUNTS === "true";
}

/**
 * The test accounts `accounts:seed` may create. Throws unless seed accounts
 * are enabled, so known passwords never become logins on production.
 */
export function seedAccountsFor(env: Env): SeedAccount[] {
  if (!seedAccountsEnabled(env)) {
    throw new Error(
      "accounts:seed runs only on a local (e2e) deployment or with ALLOW_SEED_ACCOUNTS=true.",
    );
  }
  return parseSeedAccounts(env.SEED_ACCOUNTS);
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
