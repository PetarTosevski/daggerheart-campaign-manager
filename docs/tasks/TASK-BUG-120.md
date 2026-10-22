# TASK-BUG-120: players.spec signs up with its own password-only email

Plan `.omc/plans/d12-bugs.yaml`, tracer B1. Bead dcm-bxp.120.

Status: Complete.

## Cause

`tests/e2e/players.spec.ts` ("email + password") signed up `e2e-password@example.test` with a password, or signed in
if the account existed. `lorekeeper-shell`, `notes-shell`, `notes-flow`, `notes-journals`, `notes-sharing` and
`visual/D11-N6` sign the same email in through the test sign-in (as the second player or the outsider). They sort
before `players`, so on a fresh backend the user already existed without a password account: sign-up showed an alert,
the fallback password sign-in answered "Wrong email or password.", and the test failed (in the full run, and alone
afterwards on the same backend).

## What changed

- `scripts/e2e-setup.mjs`: a fourth allowlisted account, `e2e-password-only@example.test`, with a comment on the
  one-email-per-sign-in-method rule. Existing worktrees need `pnpm e2e:setup` again to get the new `ALLOWED_EMAILS`.
- `tests/e2e/players.spec.ts`: `PASSWORD_ONLY_EMAIL` is used by "email + password" and by the wrong-password check in
  "a wrong password and a non-allowlisted sign-up are refused". No other spec uses this email.
- `docs/testing.md`: "One email per sign-in method" paragraph under E2E setup, listing which accounts use which
  method; "the three test accounts" is now four.
- The other specs keep `e2e-password@example.test` for the test sign-in (they are outside B1's owns). The name is
  misleading now; the docs and the setup comment say so.

## Verification

On a fresh worktree backend (no `.convex/`, then `pnpm e2e:setup`), with the servers started by hand on ports
3184 / 3480 and `E2E_REUSE_SERVERS=1`:

- `lorekeeper-shell.spec.ts`, `notes-shell.spec.ts`, `players.spec.ts` in one run, `--workers=1`: 10 passed. The
  outsider (`e2e-password@`) signed in through the test sign-in first; "email + password" then created its account.
- `.convex/` deleted again, `pnpm e2e:setup`, `players.spec.ts` alone: 5 passed (sign-up path).
- Running `players.spec.ts` again on a backend where the account already exists: 5 passed (sign-in path).
- `pnpm lint` (changed files), `pnpm typecheck`, `pnpm tracer:guard .omc/plans/d12-bugs.yaml B1`: clean.

Pitfall seen while verifying: after deleting `.convex/` and re-running `pnpm e2e:setup` (new `JWT_PRIVATE_KEY` /
`JWKS`), a Next server that was already running sent every signed-in user back to `/signin` until it was restarted.
Restart the Next server after resetting the backend.
