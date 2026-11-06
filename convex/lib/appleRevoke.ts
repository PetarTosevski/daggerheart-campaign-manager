import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Revoking a deleted account's Sign in with Apple tokens (App Store guideline 5.1.1(v), bead dcm-gdzi.8).
 *
 * Apple's REST API, checked against developer.apple.com on 2026-11-06:
 * - Revoke: `POST https://appleid.apple.com/auth/revoke`, form-encoded `client_id`, `client_secret`, `token`,
 *   `token_type_hint` (`refresh_token` | `access_token`). 200 with no body when the token is revoked or was already
 *   invalid; an error body otherwise.
 * - Only a refresh or access token can be revoked, never the identity token, so the native sign-in must also send its
 *   one-time `authorizationCode` (valid five minutes), which `exchangeAppleAuthorizationCode` trades at
 *   `POST https://appleid.apple.com/auth/token` (`grant_type=authorization_code`, `code`, `client_id`,
 *   `client_secret`; no `redirect_uri` for a native app) for a refresh token, kept by `saveAppleRefreshToken`.
 * - `client_secret` is an ES256 JWT, header `{ alg: "ES256", kid }`, claims `iss` (Team ID), `iat`, `exp` (at most six
 *   months on), `aud: "https://appleid.apple.com"`, `sub` (the `client_id`: the app's bundle id).
 *
 * Client secret from the Convex env (`npx convex env set`): `APPLE_TEAM_ID` + `APPLE_KEY_ID` + `APPLE_PRIVATE_KEY`
 * (the .p8 key's PEM text) sign a fresh one per call for any bundle id; otherwise `APPLE_CLIENT_SECRET`, a ready-made
 * JWT, is used as is (it only works for the bundle id in its `sub`, and expires within six months). With neither, the
 * revocation is logged and skipped: deleting the account never waits on Apple.
 *
 * Where the refresh token lives: on the account's `apple-native` login row (`authAccounts.secret`, unused by that
 * credentials provider, which never passes a secret to `retrieveAccount`), as JSON with `schemaVersion` (rule 7). The
 * account purge deletes that row with the account.
 */

/** The phone's native Sign in with Apple provider id (`convex/auth.ts` on the phone branch). */
export const APPLE_NATIVE_PROVIDER_ID = "apple-native";

const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_AUDIENCE = "https://appleid.apple.com";
/** Lifetime of a signed client secret: it is used at once, so a few minutes is plenty. */
const CLIENT_SECRET_TTL_S = 5 * 60;

/** The Convex env variables this module reads. Declare them in `convex/convex.config.ts` (`env`). */
export type AppleEnv = {
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  APPLE_CLIENT_SECRET?: string;
};

/** One Apple login's token to revoke: the bundle id it was issued to and the refresh token. */
export type AppleToken = { clientId: string; refreshToken: string };

/** What a revocation did, for the log and the tests. */
export type AppleRevokeResult = "revoked" | "skipped" | "failed";

type Fetch = typeof fetch;

const STORED_SCHEMA_VERSION = 1;

function base64Url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  // `npx convex env set` keeps real newlines; a value pasted with literal "\n" works too.
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Signs an ES256 client secret for `clientId` with the team's Sign in with Apple key. */
export async function signAppleClientSecret(
  input: { teamId: string; keyId: string; privateKey: string; clientId: string },
  nowMs: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: input.keyId }));
  const payload = base64Url(
    JSON.stringify({ iss: input.teamId, iat, exp: iat + CLIENT_SECRET_TTL_S, aud: APPLE_AUDIENCE, sub: input.clientId }),
  );
  const key = await crypto.subtle.importKey("pkcs8", pemToPkcs8(input.privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  // WebCrypto's ECDSA signature is the raw r || s pair, which is what JWS ES256 wants.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

/** The client secret for `clientId` from the env (see the module comment), or null when it isn't configured. */
export async function appleClientSecret(env: AppleEnv, clientId: string, nowMs?: number): Promise<string | null> {
  const { APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_CLIENT_SECRET } = env;
  if (APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY) {
    return signAppleClientSecret({ teamId: APPLE_TEAM_ID, keyId: APPLE_KEY_ID, privateKey: APPLE_PRIVATE_KEY, clientId }, nowMs);
  }
  return APPLE_CLIENT_SECRET ? APPLE_CLIENT_SECRET : null;
}

/**
 * Revokes one refresh token at Apple. Never throws: a missing client secret is "skipped", any Apple or network error
 * is "failed"; both are logged without the token.
 */
export async function revokeAppleToken(token: AppleToken, env: AppleEnv, fetchImpl: Fetch = fetch): Promise<AppleRevokeResult> {
  let clientSecret: string | null;
  try {
    clientSecret = await appleClientSecret(env, token.clientId);
  } catch (error) {
    console.error("Apple token revocation failed: the APPLE_PRIVATE_KEY could not sign a client secret.", error);
    return "failed";
  }
  if (clientSecret === null) {
    console.warn(
      "Apple token revocation skipped: set APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (or APPLE_CLIENT_SECRET) in the Convex env.",
    );
    return "skipped";
  }
  try {
    const response = await fetchImpl(APPLE_REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: token.clientId,
        client_secret: clientSecret,
        token: token.refreshToken,
        token_type_hint: "refresh_token",
      }).toString(),
    });
    if (response.ok) return "revoked";
    console.error(`Apple token revocation failed with HTTP ${response.status}: ${await response.text().catch(() => "")}`);
    return "failed";
  } catch (error) {
    console.error("Apple token revocation failed: Apple could not be reached.", error);
    return "failed";
  }
}

/**
 * Trades a native sign-in's one-time `authorizationCode` for a refresh token, or null when the client secret isn't
 * configured or Apple refuses (logged). The phone's Apple sign-in calls this, then `saveAppleRefreshToken`.
 */
export async function exchangeAppleAuthorizationCode(
  input: { clientId: string; authorizationCode: string },
  env: AppleEnv,
  fetchImpl: Fetch = fetch,
): Promise<string | null> {
  const clientSecret = await appleClientSecret(env, input.clientId).catch(() => null);
  if (clientSecret === null) return null;
  try {
    const response = await fetchImpl(APPLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: clientSecret,
        code: input.authorizationCode,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!response.ok) {
      console.error(`Apple authorization code exchange failed with HTTP ${response.status}.`);
      return null;
    }
    const body: unknown = await response.json();
    const refreshToken = (body as { refresh_token?: unknown } | null)?.refresh_token;
    return typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : null;
  } catch (error) {
    console.error("Apple authorization code exchange failed: Apple could not be reached.", error);
    return null;
  }
}

/** The token stored on an `apple-native` login row, or null (none stored, or not this shape). */
export function storedAppleToken(account: Doc<"authAccounts">): AppleToken | null {
  if (account.provider !== APPLE_NATIVE_PROVIDER_ID || account.secret === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(account.secret);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { schemaVersion, clientId, refreshToken } = parsed as Record<string, unknown>;
    if (schemaVersion !== STORED_SCHEMA_VERSION || typeof clientId !== "string" || typeof refreshToken !== "string") return null;
    return { clientId, refreshToken };
  } catch {
    return null;
  }
}

/** Keeps a refresh token on the user's `apple-native` login row (replacing an older one). False when there is no row. */
export async function saveAppleRefreshToken(ctx: MutationCtx, userId: Id<"users">, token: AppleToken): Promise<boolean> {
  const account = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", APPLE_NATIVE_PROVIDER_ID))
    .first();
  if (account === null) return false;
  await ctx.db.patch("authAccounts", account._id, {
    secret: JSON.stringify({ schemaVersion: STORED_SCHEMA_VERSION, clientId: token.clientId, refreshToken: token.refreshToken }),
  });
  return true;
}

/**
 * Takes the user's stored Apple tokens off their login rows and returns them for revocation (at most one per login:
 * a user has few). The caller schedules `internal.accountSelfDelete.revokeAppleTokens` with them.
 */
export async function takeAppleTokens(ctx: MutationCtx, userId: Id<"users">): Promise<AppleToken[]> {
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", APPLE_NATIVE_PROVIDER_ID))
    .take(10);
  const tokens: AppleToken[] = [];
  for (const account of accounts) {
    const token = storedAppleToken(account);
    if (token === null) continue;
    tokens.push(token);
    await ctx.db.patch("authAccounts", account._id, { secret: undefined });
  }
  return tokens;
}
