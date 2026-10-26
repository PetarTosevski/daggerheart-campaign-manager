# TASK-PF-PF2: Middleware checks the JWT locally

Status: Review. Plan: `.omc/plans/performance.yaml`, tracer PF2 (analysis Q1, default: yes).

## What changed

- **`src/lib/auth/verify-jwt.ts`** (new): `createJwtVerifier({ issuer, audience, jwksUrl })` returns
  `verify(token) → Promise<boolean>`. It uses WebCrypto only (`crypto.subtle`), no new dependency. `jose` sits under
  `@convex-dev/auth` but is not resolvable from `src/`, and `package.json` is not in PF2's owns.
  - **Signature:** RS256 (`RSASSA-PKCS1-v1_5` / SHA-256) against the deployment's JWKS at
    `<site>/.well-known/jwks.json`. Convex Auth serves the `JWKS` env there, and Convex itself verifies with it. Only
    `alg: "RS256"` is accepted (`none`, `HS256` and a `crit` header are refused). A token `kid`, if present, narrows
    the keys.
  - **Claims:** `iss` = the site URL (CONVEX_SITE_URL, as `tokens.js` sets it), `aud` = `"convex"` (a string or an
    array holding it), `exp` in the future (no leeway), `nbf` (if present) not in the future, and a non-empty `sub`.
  - **JWKS cache:** one fetch per process per 10 min (`JWKS_TTL_MS`). Concurrent first requests share one fetch.
    Unknown or forged tokens never trigger a refetch, so bad tokens cannot amplify traffic. After a failed fetch it
    waits 30 s (`JWKS_RETRY_MS`) before trying again.
  - **Fail closed:** malformed, oversized (> 8 KB), wrong key, wrong `iss` or `aud`, expired, or no JWKS → `false`, which
    means signed out and redirected. Tokens are never logged. The only log line is a JWKS fetch failure, with the URL
    and the HTTP status.
  - **`convexSiteUrl(env)`:** `CONVEX_SITE_URL`, if set (custom domains). Otherwise it is derived from
    `NEXT_PUBLIC_CONVEX_URL`: `*.convex.cloud` → `*.convex.site`, and a local backend → the next port (the local backend's
    issuer is `http://127.0.0.1:<port+1>`; checked against its `/.well-known/openid-configuration`). It does not use
    `NEXT_PUBLIC_CONVEX_SITE_URL`, because the e2e build loads `.env.local`, where that variable names the developer's
    cloud deployment.
- **`src/proxy.ts`:** `signedIn = await verifyToken(await convexAuth.getToken())` instead of
  `convexAuth.isAuthenticated()`, which ran `fetchQuery("auth:isAuthenticated")`. The redirects are unchanged.
  `convexAuthNextjsMiddleware` still proxies `/api/auth` and refreshes a token that is about to expire (`auth:signIn`),
  so `getToken()` returns the refreshed token, or null if the refresh failed. If no site URL can be derived, it warns
  once and every request counts as signed out.
- **Prefetches are not skipped** (deviation from the plan's goal). Next.js 16 deletes the flight headers
  (`rsc`, `next-router-prefetch`, `next-router-segment-prefetch`, ...) from the request before the proxy sees it
  (`node_modules/next/dist/server/web/adapter.js`, `FLIGHT_HEADERS`). Checked with curl: a request with
  `next-router-prefetch: 1` still got a redirect from a header-based skip. A router prefetch therefore cannot be told
  apart from a navigation in the proxy. With the JWKS cached, the local check costs no network call, which is what
  skipping was for. Only `purpose` / `sec-purpose` (browser speculative loads) would have been detectable. Those were
  left checked too, so the redirect behaviour stays exactly as before.

The proxy is still a redirect convenience. Identity and access are decided in Convex from `ctx.auth` (rule 3).

## Measurements

Same worktree and local e2e backend, production builds of rebuild 0dda7dc (before) and PF2 (after), run back to back.
Backend function calls were counted with `node scripts/convex-e2e.mjs logs --success` during each
`measure.mjs --profile local --runs 3` run. The before run also seeded the bench data. Both runs warm every route.

| | before (0dda7dc) | PF2 |
|---|---:|---:|
| `auth:isAuthenticated` calls (seed + warm + 3 runs) | **266** | **0** |
| `auth:signIn` calls (token refresh through `/api/auth`) | 8 | 7 |
| backend function log lines | 621 | 367 |
| hard load: `Authenticate` frames / `POST /api/auth` | 2 / 1 | 2 / 1 (PF3's target) |

The host load differed a lot between the two runs: load average 15 → 10 before, and 33 → 30 after, because other
tracers were building. The millisecond columns are not comparable, so they are not reported. On this local setup
each removed call was a loopback round trip. In production it is a Vercel→Convex round trip plus a Convex function
call in front of every document, RSC and prefetch request.

## Tests

- `tests/unit/verify-jwt.test.ts` (node environment, RSA keys made in the test):
  - a valid token → signed in
  - expired (including `exp == now`), signed with another key, tampered payload and malformed tokens → signed out
  - wrong `iss` or `aud`, `alg` `none` or `HS256`, a future `nbf` and a missing `sub` → signed out; an `aud` array
    holding "convex" → signed in
  - the JWKS is fetched once for concurrent first requests, not again for a bad token, and not again until 10 min have
    passed
  - while the JWKS is unreachable, every token is signed out, the warning does not contain the token, and the fetch is
    retried after 30 s
  - `convexSiteUrl` derivation and override
- e2e on the PF2 build (`E2E_REUSE_SERVERS=1`): `unauthenticated.spec.ts` (every page route redirects when signed out,
  and a non-member sees "Campaign not found"), `auth.spec.ts` and `players.spec.ts` (join with the GM's code, the
  email invite, sign-up): 11 passed.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass. One full-run failure was in `tests/convex/notes-sharing.test.ts`
  (two rows with the same timestamp, ordered either way under load). It is unrelated to PF2 and passed 3 of 3 times on
  its own.

## QUESTIONS

1. Prefetch skipping is not possible in the proxy (Next strips the header), so PF2 checks prefetches locally like
   every other request. Is that acceptable, or should prefetches be excluded some other way, for example a `matcher`
   `missing` rule on the stripped header? That would need a check that Next evaluates `missing` before the strip.
2. If production uses a Convex custom domain (not `*.convex.cloud`), `CONVEX_SITE_URL` must be set in the Vercel
   environment. Without it, the proxy warns and treats everyone as signed out. Is production on the default
   `*.convex.cloud` URL?
