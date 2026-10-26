# TASK-OS-OS2: Remove the invite allowlist

Status: Review. Plan: `.omc/plans/open-signup.yaml`, tracer OS2. Bead: `dcm-bxp.128`.

Decision (user, 2026-10-23): sign-up is always open; the invite allowlist is deleted, with no `SIGNUP_MODE` switch.

## What changed

- `convex/lib/allowlist.ts`: `allowedEmails`, `parseGmEmails` and the `ALLOWED_EMAILS` / `GM_EMAILS` parsing are deleted.
  `normalizeEmail`, `isE2EDeployment`, `buildE2EProfile`, `constantTimeEqual`, `seedAccountsEnabled`, `seedAccountsFor` and
  `parseSeedAccounts` stay (the e2e-only and seed-account rails). The header comment describes open sign-up.
- Compatibility shims `isAllowedEmail` / `isAllowedProfile` stay, exported, marked "removed by OS3". They return true for a
  non-empty email (and, for the profile, `emailVerified === true`). Reason: `convex/lib/users.ts` (OS3's file) still calls them.
- `convex/lib/auth.ts`: `sessionUser` returns null without a session and the stored user otherwise; a deleted user row is
  still `FORBIDDEN`. `requireUser` / `getUser` keep their codes.
- `scripts/e2e-setup.mjs`: no `ALLOWED_EMAILS`, `E2E_ALLOWED` is now a comment table of who uses which method.
- Tests: `useAllowlist` (helpers) and `allowWorldEmails` (authz/world) are now empty deprecated functions, because 114 test
  files outside this tracer's `owns` still call them. The env writes in `settings`, `campaigns`, `characters`,
  `character-intents` and `require-user` tests are gone. `require-user` now proves any stored user passes and a deleted one is
  `FORBIDDEN`. `allowlist.test.ts` covers the seed-account rail; `e2e-profile.test.ts` shows any email gets a verified profile.
- `tests/e2e/auth.spec.ts`: "not allowlisted is refused" is replaced by "any email signs in through the test form".

## Grep report (not edited, outside OS2 ownership)

- `convex/lib/users.ts` (OS3): imports the shims.
- `convex/convex.config.ts`: still declares optional `ALLOWED_EMAILS` / `GM_EMAILS` env vars, and mentions the allowlist.
- `tests/convex/create-or-update-user.test.ts`, `tests/convex/unauthenticated-sweep.test.ts` (comment).
- `tests/e2e/players.spec.ts:124`: "a wrong password and a non-allowlisted sign-up are refused" will fail once run, because a
  non-listed sign-up now succeeds (OS3 / OS6 area).
- `tests/e2e/lorekeeper-shell.spec.ts`, `tests/e2e/notes-shell.spec.ts`: comments "An allowlisted account".
- Docs: `AGENTS.md` (lines 198-199, 227), `README.md:49`, `docs/deploy.md:107`, `docs/testing.md` (27, 42-43, 54),
  `docs/best-practices.md` CF20, and the historical task docs / `docs/decisions-d3-d11.md` / `docs/design-port-roadmap.md`.
- Env on existing backends: a leftover `ALLOWED_EMAILS` on the e2e backend or Convex deployments is now ignored.
