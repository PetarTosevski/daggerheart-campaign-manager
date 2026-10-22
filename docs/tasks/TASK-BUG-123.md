# TASK-BUG-123: A rejected cached token refreshes instead of showing "Your session has ended"

Status: Review. Plan: `.omc/plans/d12-bugs.yaml`, tracer B3. Bead: `dcm-bxp.123`.

## Symptom

`tests/e2e/auth-single-run.spec.ts` ("a cached token the server rejects is replaced by a refreshed one") sometimes ended
on the route error boundary: "Something went wrong / The app failed to load. Your session has ended. Sign in again."
Reproduced on the unfixed build: 2 of 8 with `--repeat-each 8`.

## Root cause

The suspected race (a query result arriving before the refresh) is not the cause. The cause is that the refresh can
return **the same token, byte for byte**:

1. Convex Auth's access token is an RS256 JWT of only `{ sub, iss, aud, iat, exp }`, with `iat` in whole seconds and no
   `jti` (`node_modules/@convex-dev/auth/src/server/implementation/tokens.ts`, `generateToken`). RS256 signatures are
   deterministic. So two tokens minted for the same session in the same second are identical.
2. The spec signs in, creates a campaign and opens the dashboard well inside one second. The page is rendered with the
   sign-in token, the first `Authenticate` (tampered on the wire) is rejected, and the client force-refreshes through
   `POST /api/auth`. When the refresh lands in the same wall-clock second as the sign-in, it returns the cached token.
3. The Convex client (convex 1.46.0, `browser/sync/authentication_manager.js`, `tryToReauthenticate`) only uses a
   refreshed token if `syncState.isNewAuth(token)`. An identical token is not new, so it logs "reauthentication failed,
   could not fetch a new token", clears auth and reports `onAuthChange(false)`. The reconnected socket then runs
   `settings:get` and `campaigns:get` with no identity, they throw `UNAUTHENTICATED`, and `useQuery` throws into the
   error boundary.

### Evidence

- Frame log of a passing run (temporary diagnostic spec, not committed): `Authenticate` (tampered) → `AuthError`
  ("Could not verify OIDC token claim") → the server closes the socket → `POST /api/auth` → a new socket with
  `Authenticate` of a different token → `Transition` with the results. The server never answers the queries on the
  rejected socket, so there is no early-result race.
- Trace of a failing run (`--trace retain-on-failure`, repeat 7):
  - the sign-in `POST /api/auth` (`{"provider":"e2e",...}`) and the refresh `POST /api/auth`
    (`{"refreshToken":"dummy"}`) returned **the same response body** (same SHA-1 in the trace's resources). Their
    token has `iat` 1792658701 in both.
  - the server-rendered HTML of the dashboard holds that same token (the cached token).
  - console: `WebSocket reconnected`, then `ConvexError: [CONVEX Q(settings:get)] ... {"code":"UNAUTHENTICATED"}`.
- Negative control: the new e2e test below, which makes the first refresh return the rejected token, fails 3 of 3 on
  the unfixed build with exactly "Your session has ended. Sign in again."

The same thing can happen to a real user whose token is rejected within a second of being minted (for example right
after sign-in). An expired token cannot hit it, because its refresh is minted in a later second.

## Fix

`src/lib/auth/distinct-refresh.ts`: `withDistinctRefresh(fetchAccessToken)` wraps Convex Auth's `fetchAccessToken`.

- Non-forced calls pass through. The wrapper remembers the token it handed to the Convex client.
- Forced refresh:
  - **null** (signed out, revoked, no refresh token): returned at once, with no retry. The sign-in path is unchanged.
  - **a different token**: returned at once.
  - **the same token**: wait `SAME_TOKEN_RETRY_DELAY_MS` (1.1 s, past the second it was minted in) and refresh once
    more, then hand over whatever comes back.
- At most one retry per forced refresh. If the server rejects the new token too, Convex's own limit (two fresh-token
  attempts) clears auth, so nothing loops. The wrapper never creates, alters or accepts a token; the server verifies
  everything it is handed.
- The decision is the pure `refreshStep(held, refreshed, retried)`.

`src/app/convex-client-provider.tsx`: in place of `ConvexAuthNextjsProvider` (which is only
`ConvexProviderWithAuth` plus Convex Auth's `useAuth`), the provider passes `ConvexProviderWithAuth` a hook built on
Convex Auth's `useConvexAuth` (the same `useAuth`, exported from `@convex-dev/auth/react`) with the wrapped
`fetchAccessToken`. `fetchAccessToken` is stable in Convex Auth, and so is the memoized wrapper, so `setAuth` runs
once. `initialAuthTokenReuse` is unchanged, so PF3's single `Authenticate` per page load stays.

Not changed: `src/proxy.ts`, the error boundary, the error codes. The alternative of adding a `jti` custom claim in
`convex/auth.ts` would make every token unique at the source, but that file is outside this tracer's `owns` (see
QUESTIONS in the handoff).

## Tests

- `tests/unit/auth-distinct-refresh.test.ts` covers `refreshStep` and `withDistinctRefresh`:
  - a distinct token is used at once
  - an identical token gets one retry after the delay, and never a second one
  - a null refresh means signed out, with no retry or wait
  - non-forced calls pass through
- `tests/e2e/auth-single-run.spec.ts` has a new test, "a refresh that returns the rejected token again is retried once".
  The first `Authenticate` is tampered and the first refresh is answered with the rejected token; the dashboard loads,
  a second `POST /api/auth` goes out, and Fear round-trips. It fails on the unfixed build and passes with the fix.
- Results with the fix: `auth-single-run.spec.ts --repeat-each 8` passed 32 of 32 in each of three runs (two with 1
  worker, one with 2 workers). The PF3 tests (one `Authenticate`, no early refresh; refresh before expiry) passed in every run.
