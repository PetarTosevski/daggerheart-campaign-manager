# TASK-102 — Convex + Convex Auth platform

- **Status:** In progress (code, tests and e2e pass; Convex cloud project, Google OAuth and production sign-in check pending)
- **Phase:** 1 of `.omc/plans/campaign-manager-rebuild.md`
- **bd:** `dcm-2a6.2` (epic `dcm-2a6`)
- **Branch:** `rebuild`

## Goal

Stand up Convex and Convex Auth with Google sign-in locked to the GM's
allowlisted, verified email, plus test infrastructure (convex-test and a
local-only e2e sign-in), without any game mechanic yet.

## Decisions applied

- OQ-3: Google only; `GM_EMAILS=petar.tosevski99@gmail.com` on production.
- OQ-15: tests use the project's local, account-free backend; everyday
  development uses a personal cloud dev deployment.
- OQ-2: e2e signs in through a test-only credentials provider that exists only
  on a localhost backend with `E2E_AUTH_ENABLED=true`.
- Dependency versions respect the pnpm `minimumReleaseAge` policy: `convex`
  1.46.0 (1.47.0 was one day old), `@convex-dev/auth` 0.0.96, `@auth/core`
  0.41.3, `convex-test` 0.0.62, `@edge-runtime/vm` 5.0.0. `esbuild` install
  scripts stay disabled (`allowBuilds: esbuild: false`); its binary works
  without them.

## Spike results

| Item | Result |
|---|---|
| convex-test under vitest 4.1.10 | Works (`tests/convex/*`, edge-runtime environment) |
| (a) `t.run` rolls back on throw | Yes (`tests/convex/run-rollback.test.ts`) |
| (b) `CONVEX_CLOUD_URL` at module scope | Yes: same value at module scope and at call time on the local backend |
| (c) Google `profile()` override and `emailVerified` | `@convex-dev/auth` calls `provider.profile()` and passes the result (minus `id`) to `createOrUpdateUser`; Auth.js's default Google profile drops `email_verified`, so the override is required |
| (d) Convex Auth helper under `src/proxy.ts` | Works on Next 16.2.10: build lists "Proxy (Middleware)", and `/` returns 307 to `/signin` at runtime |
| (e) Local backend flags | `CONVEX_AGENT_MODE=anonymous npx convex dev --env-file .env.e2e.local`; one local deployment per project in `.convex/local/default` |

## Acceptance criteria

- [x] Unit: `isAllowedProfile`, `isE2EDeployment` and `buildE2EProfile` tests pass (`tests/unit/allowlist.test.ts`, `tests/unit/e2e-profile.test.ts`).
- [x] Integration: `requireGm` returns an allowlisted stored user, throws `FORBIDDEN` for a non-allowlisted user (and after removal from the allowlist), and `UNAUTHENTICATED` without identity (`tests/convex/require-gm.test.ts`).
- [x] E2E: signed-out redirect, test-GM sign-in and sign-out, wrong secret refused, non-allowlisted email refused (`tests/e2e/auth.spec.ts`).
- [x] Import boundary: `src/lib/validation/countdowns.ts` uses a relative import; ESLint forbids `@/`, React, Next and `convex/react` in `src/lib/{domain,validation,frames}` and `convex/lib/allowlist.ts`.
- [x] `pnpm typecheck` (includes `convex/`) and `npx convex dev --once --typecheck=enable` pass.
- [x] `AGENTS.md` Convex sections finalised; bd blocks unchanged.
- [ ] Manual (user): on production, the GM's Google sign-in succeeds and a non-allowlisted Google account is refused with no `users` row created.

## User steps

1. ~~Install Chromium's system libraries~~ (done 2026-10-16).
2. Create the Convex project with a cloud dev deployment (`npx convex dev`, choose a new project), which rewrites `.env.local`.
3. Google Cloud OAuth client (web application) with redirect URIs `https://<deployment>.convex.site/api/auth/callback/google` for the dev and production deployments.
4. On each cloud deployment: `npx convex env set AUTH_GOOGLE_ID …`, `AUTH_GOOGLE_SECRET …`, `GM_EMAILS petar.tosevski99@gmail.com`, `SITE_URL …`, and the auth keys (`npx @convex-dev/auth`, add `--prod` for production).
5. Vercel project: `CONVEX_DEPLOY_KEY` in Production only; build command `npx convex deploy --cmd 'pnpm build'`; preview builds off.
6. After every deploy that touches auth, repeat the manual production sign-in check and record the date and result here.

## Commands run and results (2026-10-16)

| Command | Result |
|---|---|
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test` | 11 files, 68 tests passed (unit + convex projects) |
| `pnpm build` | Pass on Next.js 16.4.1; routes `/`, `/signin`, Proxy |
| `npx convex dev --once --typecheck=enable` (local) | Pass |
| `pnpm e2e:setup` (twice) | Pass; idempotent |
| `pnpm test:e2e` | 4 passed (after the user installed Chromium's system libraries) |
| `curl` against the e2e build | `/` → 307 `/signin`; `/signin` renders the Google button and the test form |

## Notes

- A wrong e2e secret makes `signIn` resolve with `signingIn: false` rather
  than throw; the test form now shows an error in that case (found by the
  e2e run).

## Security review (2026-10-16)

Verdict: pass with fixes. No path found to a session or `users` row without
passing the allowlist; the e2e provider cannot be registered on a cloud
deployment. Fixes applied:

- **High:** Next.js 16.2.10 had known advisories (including Image Optimization
  RCE/SSRF and a Proxy bypass). Upgraded `next`, `eslint-config-next` and
  `@next/env` to 16.4.1 (16.4.2 was one day old). `shadcn` (CLI) moved to
  devDependencies; pnpm overrides patch `nanoid`, `browserslist` and
  `source-map-js` in Next's build tooling. `pnpm audit --prod`: 58 → 1
  moderate.
- **Medium:** `isE2EDeployment` also rejects any `.convex.cloud` URL.
  Follow-up for the Vercel phase: fail the production deploy if
  `E2E_AUTH_ENABLED` is set on the production deployment.
- **Low:** the sign-in callback moved to `convex/lib/users.ts` and is tested
  (`tests/convex/create-or-update-user.test.ts`): unverified profile,
  non-allowlisted email and de-listed returning account are refused with no
  user created.
- **Low, accepted:** Convex Auth's own public `isAuthenticated` query does not
  call `requireGm`; it only reports whether the caller's own token is valid.
  Every app-defined public function calls `requireGm`; Phase 6 adds the
  sweep test over all public functions.
- **Low, accepted:** the proxy matcher skips paths containing a dot; that only
  skips the redirect (commented in `src/proxy.ts`).

