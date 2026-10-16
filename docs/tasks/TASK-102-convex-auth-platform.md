# TASK-102 — Convex + Convex Auth platform

- **Status:** In progress (e2e run blocked on Playwright system libraries; user setup steps pending)
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
- [ ] E2E: signed-out redirect, test-GM sign-in and sign-out, wrong secret refused, non-allowlisted email refused (`tests/e2e/auth.spec.ts`). Written; not yet run because Chromium's system libraries are missing.
- [x] Import boundary: `src/lib/validation/countdowns.ts` uses a relative import; ESLint forbids `@/`, React, Next and `convex/react` in `src/lib/{domain,validation,frames}` and `convex/lib/allowlist.ts`.
- [x] `pnpm typecheck` (includes `convex/`) and `npx convex dev --once --typecheck=enable` pass.
- [x] `AGENTS.md` Convex sections finalised; bd blocks unchanged.
- [ ] Manual (user): on production, the GM's Google sign-in succeeds and a non-allowlisted Google account is refused with no `users` row created.

## User steps

1. Install Chromium's system libraries: `sudo pnpm exec playwright install-deps chromium`.
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
| `pnpm test` | 10 files, 64 tests passed (unit + convex projects) |
| `pnpm build` | Pass; routes `/`, `/signin`, Proxy |
| `npx convex dev --once --typecheck=enable` (local) | Pass |
| `pnpm e2e:setup` (twice) | Pass; idempotent |
| `pnpm test:e2e` | Not run to completion: Chromium fails to start (`libnspr4.so` missing) |
| `curl` against the e2e build | `/` → 307 `/signin`; `/signin` renders the Google button and the test form |
