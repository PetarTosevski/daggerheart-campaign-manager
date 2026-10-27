# TASK-OS-OS5: Clean up abandoned unverified sign-ups

Status: Review. Plan: `.omc/plans/open-signup.yaml`, tracer OS5. Bead: `dcm-bxp.128`.

## What changed

- `convex/cleanup.ts`: `internal.cleanup.expireUnverifiedSignups({ after? })`. Reads `users` through the built-in
  `by_creation_time` index, older than `UNVERIFIED_SIGNUP_TTL_MS` (7 days), `UNVERIFIED_SIGNUP_BATCH` (100) per run, from the
  `_creationTime` cursor `after`. A user with an `emailVerificationTime` only moves the cursor. The job reschedules itself with the new
  cursor while a full page was read, so verified users at the front never starve later pages.
- A user is deleted together with its `authAccounts` (and their `authVerificationCodes`) and `authSessions` (and their
  `authRefreshTokens`), all through indexes (`userIdAndProvider`, `accountId`, `userId`, `sessionId`), `.take` only.
- A user is kept when it owns a campaign (`campaigns.by_owner_deletedAt_lastOpened`), has a `campaignMembers` row (`by_user`), owns a
  character (`characters.by_owner`), or has an account of a provider other than `password`. Email invites are not a reason to keep
  a user (an invite is keyed by address, not by user).
- `convex/crons.ts`: "expire unverified sign-ups", daily at 04:13 (odd minute).
- `tests/convex/cleanup-unverified-signups.test.ts`: old user and all four auth tables cleaned; a 6-day-old user kept; verified, owner,
  member, character owner and Google users kept; more users than one batch, with a verified one first, still cleaned.

## dcm-bxp.128.2 (e2e fixed code collision): not fixed here

`convex/lib/authEmail.ts` and `convex/auth.ts` are outside OS5's `owns`. Cause: Convex Auth looks a code up by its hash with
`unique()`, and `generateCode` returns `E2E_FIXED_CODE` (`123456`) for every address, so two pending sign-ups have the same hash.
Needed change, in `convex/lib/authEmail.ts`: when `fakeCodeMode(env)`, the code must differ per pending address, for example
`generateCode(env, email)` returning `E2E_FIXED_CODE` only for a reserved test pattern, or a per-email code derived from the
address (the e2e specs then compute it with the same helper instead of typing `123456`). Deleting older codes on the
replace-unverified path in `auth.ts` fixes only a retry for one address, not two different addresses. This also means the
OS6 spec wording "code 123456" must change with the fix.
