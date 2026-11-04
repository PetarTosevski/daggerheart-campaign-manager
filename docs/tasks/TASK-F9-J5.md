# TASK-F9-J5: a Google user can add a password through Create account (dcm-bxp.128.3)

Plan: `.omc/plans/followups-9.yaml`, tracer J5.

## Problem

A user who signed up with Google and then used Create account (email + password) with the same email got EMAIL_TAKEN
and had no way to add a password.

## Decision

Use the library's own mechanism: `createAccount` from the Password `signUp` flow calls our `createOrUpdateUser`; if it
returns the existing user's id, Convex Auth inserts the `authAccounts` row for that user. No custom table.

- `convex/lib/users.ts`: a password sign-up for an email whose user is VERIFIED and has no password account returns
  that user's id (nothing on the user is patched, so the stranger's name is ignored). Unverified user, or a user that
  already has a password account: `EMAIL_TAKEN` as before.
- `convex/auth.ts` (`withAuthErrors`): a password account is EMAIL_TAKEN only when its `emailVerified` is set. Before,
  a verified user also made it EMAIL_TAKEN, which would block a second attempt at a pending link. A pending (code never
  entered) account is replaced: password changed, fresh code sent, old code dead.

## Security

- The new account has no `emailVerified`, so `signIn` with the password returns a code step, not a session; the library
  issues a session only after `email-verification`. A wrong or expired code changes nothing.
- The Google user is untouched until the code: no field patched, no session or account removed, Google keeps working.
- A stranger who registers the email gets a pending account only. The owner's own sign-up replaces it, so the
  stranger's password never becomes usable. The stranger can at worst send the owner code emails (already limited:
  5 codes/hour/address, 10 sign-ups/hour/address, global cap).
- No new email disclosure: the sign-up answer for a Google email is now the same code step as for a new email. An
  existing password account still answers EMAIL_TAKEN (as before). Because Google and new emails look the same, the code
  step text stays generic ("Enter the 6-digit code we emailed to ..."); no UI change was needed.

## Tests

- `tests/convex/auth-signup.test.ts`: Google user -> code sent, pending state (no session, user unchanged, password
  cannot sign in), wrong code leaves it unchanged, right code links the password to the same user id (one user, accounts
  google + password), password sign-in works, then EMAIL_TAKEN; stranger's pending password is replaced by the owner's;
  unverified user without password stays EMAIL_TAKEN; existing rate-limit test adjusted for the extra sign-up.
- `tests/convex/create-or-update-user.test.ts`: link to the same user, EMAIL_TAKEN for a user with a password account,
  EMAIL_TAKEN for an unverified user.
- `tests/e2e/auth.spec.ts`: a test-sign-in user (verified, no password) signs out, creates a password account with the
  emailed code, lands signed in as the same email, signs out and signs in with the password.
