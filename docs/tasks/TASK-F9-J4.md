# TASK-F9-J4: e2e sign-up codes never collide (dcm-bxp.128.2)

Plan: `.omc/plans/followups-9.yaml`, tracer J4.

## Problem

On the local e2e backend every sign-up code was `123456` (OS1 fake mode). Convex Auth stores codes by hash and looks
them up with `unique()`, so two pending sign-ups made verification fail, and an aborted run poisoned the backend until
`rm -rf .convex/local/default`. Convex Auth calls `generateVerificationToken()` with no arguments, so the code cannot be
derived from the email in the generator.

## Decision

Candidate (a): in fake mode the code is random like any real code, and the fake sender stores `{ email, code }` in an
e2e-only table that the specs read through a gated HTTP route.

Why not (b) (delete other pending codes before issuing a new one): it makes the older pending sign-up unverifiable, so
two concurrent pending sign-ups still cannot both verify. It would also touch Convex Auth's own tables.

Why not a per-email derived code: not possible, the generator has no email (see above). Recording the email in module
state before `inner()` would be mutable state shared across requests, which is forbidden.

## What changed

- `convex/lib/authEmail.ts`: `generateCode` is always random (the `E2E_FIXED_CODE` is gone). In `fakeCodeMode`
  (`isE2EDeployment` and `E2E_AUTH_ENABLED=true`) `sendCodeEmail` sends nothing and calls
  `internal.e2e.recordCode` through the action ctx Convex Auth passes to `sendVerificationRequest`. Outside fake mode
  nothing is stored and the real Resend path is unchanged.
- `convex/tables/e2e.ts`, `convex/schema.ts`: table `e2eCodes` (`email`, `code`, `createdAt`, index `by_email`).
  `recordCode` replaces the row of that email, so the table holds at most one row per email, is bounded by the emails
  the specs use, and needs no cleanup cron (rule 8 applies to tables that only grow).
- `convex/e2e.ts`: internal `recordCode` and `latestCode`, and the HTTP action `codeRoute`. `convex/http.ts` mounts it
  at `GET /e2e/code?email=&secret=`.
- Gate: the route uses `buildE2EProfile` (the same function as the test sign-in): local deployment, `E2E_AUTH_ENABLED`,
  constant-time secret match. Any failure and any unknown email is a bare 404, so a cloud deployment looks like it has
  no route.
- No new public Convex function (the two functions are `internal*`; the route is an HTTP action), so there is no
  authz-matrix entry to add and the public-function inventory/unauthenticated sweep are unchanged. The gate is covered
  by `tests/convex/auth-signup.test.ts` (wrong secret, missing secret, unknown email, cloud URL, e2e auth off: all 404,
  and nothing stored outside fake mode).
- No module-level mutable state; each request reads and writes through the database.
- Specs: `readEmailedCode(email)` in `tests/e2e/fixtures.ts` (HTTP site port = Convex port + 1); `players.spec.ts` and
  `a11y-signin.spec.ts` use it instead of `123456`. `docs/testing.md` explains the mechanism.

## Tests

- `tests/convex/auth-signup.test.ts` (new describe "e2e fake-code mode"): two pending sign-ups both verify with their
  own codes and no email is sent; a new code replaces the stored one; the route gate; no storage outside fake mode.
- `tests/unit/auth-email.test.ts`: fake mode sends no request and stores through ctx; real mode never stores; codes are
  random.

- `tests/convex/schema-guard.test.ts`: `e2eCodes` added to `BOUNDED` (at most one row per email).
