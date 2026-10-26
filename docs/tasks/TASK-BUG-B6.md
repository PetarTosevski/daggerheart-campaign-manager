# TASK-BUG-B6: D12 follow-ups (authz `pending`, test-sign-in email, unique access tokens)

Status: Review. Plan: `.omc/plans/d12-bugs.yaml`, tracer B6. Beads: `dcm-bxp.119`, `dcm-bxp.124`, `dcm-bxp.125`.

## dcm-bxp.119: `pending` is gone from the authz matrix

D12 H24 removed `pending` support but left the field, because the area files still carried `pending: []`.

- `tests/convex/authz/harness.ts`: `Area` has no `pending` field.
- Every `tests/convex/authz/*.entries.ts` and `tests/convex/authz-synth.test.ts`: `pending: []` removed.
- `tests/convex/unauthenticated-sweep.test.ts`: `listing()` reads only entries, so its entry is no longer optional.
- `tests/convex/authz-matrix.test.ts`:
  - `pendingProblems` and the "no area lists a pending name" test are removed. The type no longer allows the field.
  - The self-test "a pending name no longer counts as listed" became "a public function with no entry fails, even
    when its area exists".
  - The inventory guard ("every public function is listed (entry or exempt)") and the missing/stale/duplicate
    self-test are unchanged.
- `docs/testing.md` (Area shape) and `docs/tasks/TASK-D12-H0.md` (the guard, Area fields, the `pending` section,
  guard item 2) no longer describe `pending` as current. H0's historical results are marked as from before the removal.

## dcm-bxp.124: one email per sign-in method, with clear names

- `e2e-password@example.test`, which only ever signed in through the test sign-in, is now `e2e-player2@example.test`.
  Changed in `scripts/e2e-setup.mjs`, lorekeeper-shell, notes-shell, notes-flow, notes-sharing, notes-journals and
  visual/D11-N6.
- `tests/e2e/auth-session-ended.spec.ts` has its own password-only account, `e2e-session-ended@example.test`, with its
  own password. It no longer shares players.spec's `e2e-password-only@example.test` (B5 Q2).
- `scripts/e2e-setup.mjs` allowlists five accounts. `docs/testing.md` has a table of every account, its single
  sign-in method and the spec that uses it.

## dcm-bxp.125: every access token is unique

Convex Auth (0.0.96) signs `{ sub, iss, aud, iat, exp }` with `iat` in whole seconds, so two tokens for one session in
the same second were byte-identical (dcm-bxp.123).

`convex/auth.ts` sets `jwt.customClaims` to return `{ token_id: crypto.randomUUID() }`.

**Deviation: the claim is `token_id`, not `jti`.** Convex Auth's `generateToken`
(`node_modules/@convex-dev/auth/src/server/implementation/tokens.ts`) treats `jti` as reserved, along with sub, iss,
aud, iat, exp and nbf. It throws `Reserved claim "jti" in custom claims`, and it has no other hook. Adding a real
`jti` would mean patching the library. The random claim fixes the same problem: tokens differ, so the Convex client
accepts the refresh.

Token verification is unchanged:
- The Convex backend still checks the signature against the JWKS, plus `iss`, `aud` and `exp`.
- Nothing reads `token_id`.

B3's client retry (`src/lib/auth/distinct-refresh.ts`) stays as a second line of defence.

`tests/convex/auth-jti.test.ts`:
- Freezes `Date`, then mints two tokens for one session through `internal.auth.store`: a sign-in, then a second
  token for the same `sessionId`, as a refresh does.
- Checks both RS256 signatures against the test key pair, and that the tokens differ.
- Checks that every claim (sub, iss, aud, iat, exp) is equal except `token_id`, a distinct UUID.
- Negative control: with `customClaims` returning `{}`, the test fails because the two tokens are identical.

## Also: visual/D11-N6 at 390

The visual spec failed with only the email rename applied: at 390 px it looked for the Shared region, but the region sits
behind the 'Pages' disclosure that N9 added. dcm-bxp.114 fixed the older specs for this, but not the visual spec.
The spec now opens the disclosure at each viewport before it shoots an index region (`shootIndex`, with the same
`openIndex` as notes-sharing.spec). The 390 shots show the Shared tabs. No app code changed.

## Checks

- `pnpm lint`, `pnpm typecheck` and `pnpm vitest run --maxWorkers=4 --testTimeout=60000` pass: 260 files, 6320
  passed, 1 expected fail (the knownBug demo).
- Fresh e2e backend (`pnpm e2e:setup`, ports 3134/3380), servers started by hand, `E2E_REUSE_SERVERS=1`:
  - lorekeeper-shell, notes-shell, notes-flow, notes-sharing, notes-journals, auth-single-run, auth-session-ended
    and players: 24 of 24 passed.
  - `E2E_VISUAL=1` visual/D11-N6: passed.
