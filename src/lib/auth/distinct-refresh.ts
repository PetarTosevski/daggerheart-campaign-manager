// A forced token refresh must hand the Convex client a token it does not hold yet (dcm-bxp.123).
//
// Convex Auth's access token is a deterministic RS256 JWT of { sub, iss, aud, iat, exp } with `iat` in whole seconds
// (node_modules/@convex-dev/auth/src/server/implementation/tokens.ts). A refresh in the same second as the sign-in that
// minted the cached token therefore returns the cached token byte for byte. When the server has rejected that token,
// the Convex client (convex 1.46, browser/sync/authentication_manager.js, `tryToReauthenticate`) sees no new token
// (`syncState.isNewAuth` is false), treats the refresh as failed, clears auth and reports "signed out"; the page's
// queries then run without an identity and land on the error boundary ("Your session has ended").
//
// So: when a forced refresh returns exactly the token Convex already holds, wait past the second the server minted it
// in and refresh once more. The token is never accepted or altered here; the server verifies whatever we hand over.
// A null refresh (signed out, revoked, no refresh token) goes straight back to Convex: the sign-in path, no retry.
// At most one retry per forced refresh, and Convex itself gives up after two rejected fresh tokens, so nothing loops.

/** The `fetchAccessToken` shape `ConvexProviderWithAuth` expects. */
export type FetchAccessToken = (args: { forceRefreshToken: boolean }) => Promise<string | null>;

/** Long enough that the server's clock has moved past the second it minted the previous token in. */
export const SAME_TOKEN_RETRY_DELAY_MS = 1_100;

export type RefreshStep = "use" | "signed-out" | "retry";

/**
 * What to do with the result of a forced refresh. `held` is the token the Convex client already holds (and that the
 * server may have rejected), `refreshed` what the refresh returned, `retried` whether this is already the retry.
 */
export function refreshStep(held: string | null, refreshed: string | null, retried: boolean): RefreshStep {
  if (refreshed === null) return "signed-out";
  if (refreshed === held && !retried) return "retry";
  return "use";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wraps Convex Auth's `fetchAccessToken` so that a forced refresh never returns, on its first try, the token the
 * Convex client already holds. Non-forced calls pass through. One wrapper per `fetchAccessToken` (the token it last
 * handed out is the one the Convex client holds).
 */
export function withDistinctRefresh(
  fetchAccessToken: FetchAccessToken,
  { wait = sleep, retryDelayMs = SAME_TOKEN_RETRY_DELAY_MS }: { wait?: (ms: number) => Promise<void>; retryDelayMs?: number } = {},
): FetchAccessToken {
  let held: string | null = null;
  return async ({ forceRefreshToken }) => {
    if (!forceRefreshToken) {
      const token = await fetchAccessToken({ forceRefreshToken: false });
      held = token;
      return token;
    }
    let token = await fetchAccessToken({ forceRefreshToken: true });
    if (refreshStep(held, token, false) === "retry") {
      await wait(retryDelayMs);
      token = await fetchAccessToken({ forceRefreshToken: true });
    }
    held = token;
    return token;
  };
}
