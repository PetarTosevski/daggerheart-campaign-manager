# TASK-PF-PF3: One Authenticate per page load

Status: Review. Plan: `.omc/plans/performance.yaml`, tracer PF3 (user answer Q2: use the experimental option, pinned
at convex 1.46, with an e2e test that catches a regression).

## What changed

- **`src/app/convex-client-provider.tsx`**: `new ConvexReactClient(url, { initialAuthTokenReuse: true })`.
- **What the option does** (checked in the installed convex 1.46.0, `browser/sync/authentication_manager.js` and
  `esm-types/browser/sync/client.d.ts`):
  - Without it, once the server confirms the cached token (the one the page was rendered with, from
    `ConvexAuthNextjsServerProvider`), the client calls `fetchToken({ forceRefreshToken: true })` at once.
  - With @convex-dev/auth 0.0.96 that call is a `POST /api/auth` (refresh through the middleware). A second
    `Authenticate` follows, and the server re-runs every subscribed query.
  - With it, the client keeps the confirmed token and schedules the refresh for `exp - 10 s` (default
    `refreshTokenLeewaySeconds`). It estimates the server's clock from the clock skew in the confirming `Transition`.
  - Rejected tokens are handled as before: on an `AuthError`, the client force-refreshes and authenticates with the new
    token.
- The token the page gets always has at least a minute left. The Next middleware refreshes a token with less than
  1 minute left on every document request (`REQUIRED_TOKEN_LIFETIME_MS` in `@convex-dev/auth/nextjs/server`), so the
  scheduled refresh is never immediate.
- `convex` stays pinned at exactly `1.46.0` in `package.json` (unchanged). The option is marked "experimental: it may
  change or disappear". If an upgrade drops it, the client quietly goes back to the double run, and
  `tests/e2e/auth-single-run.spec.ts` fails.

## Tests

`tests/e2e/auth-single-run.spec.ts` (new):

1. A hard load of `/campaigns/<id>` sends exactly 1 `Authenticate` frame (`tokenType: "User"`), 0 `POST /api/auth`
   and no `AuthError` in the first 5 s. **Fails on the baseline** (2 `Authenticate` frames), passes with PF3.
2. **Refresh before expiry.** The spec fakes a short-lived token: an init script runs any timer of 30 min or more after
   2 s, so the client's refresh (scheduled about an hour ahead) fires at once. Then:
   - a `POST /api/auth` goes out
   - a second `Authenticate` carries a different token
   - there is no `AuthError`
   - a GM mutation (Fear) still round-trips on the new identity
3. **Rejected cached token** (stands in for an expired one). The spec corrupts the signature of the first `Authenticate`
   frame on the wire. The server rejects it, the client refreshes through `POST /api/auth`, and the dashboard loads.
   Fear still round-trips.

The observation window in test 1 is a plain 5 s timer, not `page.waitForTimeout` (TE10). The assertion is negative
("no refresh within 5 s"), and no UI event marks the end of it.

Results with PF3:

- Pass: `auth-single-run.spec.ts` (3), `auth.spec.ts` (4: sign-in, sign-out, wrong secret, not allowlisted) and all
  13 live specs (`live-*.spec.ts`, GM and player in two contexts).
- `pnpm test`: 223 files, 5,436 passed, 1 expected fail.
- Lint and typecheck are clean.

## Measurements

PF0 harness (`scripts/perf/measure.mjs`, median of 3 runs), same worktree, local e2e stack. The baseline is rebuild
0dda7dc without the option. The baseline and PF3 builds ran back to back.

| Hard load of the dashboard | local before | local PF3 | wan before | wan PF3 |
|---|---:|---:|---:|---:|
| `Authenticate` frames | 2 | **1** | 2 | **1** |
| `POST /api/auth` | 1 | **0** | 1 | **0** |
| 2nd `Authenticate` at (ms) | 562 | none | 1,527 | none |
| first queries sent (ms) | 399 | 459 | 1,063 | 1,066 |
| dashboard data, `lastData` (ms) | 538 | 653 | 1,585 | 1,531 |
| load average (1 min) at start | 14.7 | 30 | 12.2 | 25.5 |

The title menu cold load also drops from 2 / 1 to 1 / 0 (`Authenticate` frames / `POST /api/auth`).

Findings:

- **Counts.** Every hard load now sends 1 `Authenticate` and makes no token refresh, so the server runs each of the
  11 queries once instead of twice. That also removes one Next server request per load (a Vercel function call in
  production).
- **Data time.** The acceptance thresholds are met: wan 1,531 ms ≤ 2,000 and local 653 ms ≤ 1,100. But this
  session's baseline was already under them (538 / 1,585 ms), so the thresholds do not show the gain.
  - As PF0 found, the page's queries usually answer before the refreshed token arrives. The double run then costs
    server work and a request, but not first-data time.
  - The PF3 runs ran at about twice the host load (25-30 vs 12-15), which hides the time saved.
  - Judge PF3 by the counts, as `docs/performance.md` says.
