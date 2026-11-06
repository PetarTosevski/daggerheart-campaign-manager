# TASK-DEL1: self-service account deletion and Apple token revocation

Plan `.omc/plans/account-deletion.yaml`, tracer DEL1; bead dcm-gdzi.8 (App Store guideline 5.1.1(v)). User decisions
of 2026-11-06.

## What works

- **Delete account** (web: the account Preferences popover, last item; hidden for the app owner). A confirm step says
  the account is signed out on every device at once, erased after 30 days, and that signing in again within those 30
  days cancels the deletion. Confirming calls `accountSelfDelete.deleteMyAccount`, then signs this browser out and goes
  to `/signin`.
- **Server** (`convex/accountSelfDelete.ts`, `userMutation`, no args): writes the account's `accountStatus` row with
  `deleteAfter = now + 30 days` (`ACCOUNT_DELETE_WAIT_MS`), `by` = the account itself, reason "Deleted by the account
  holder"; deletes its sessions and refresh tokens (`endSessions`); schedules the revocation of its stored Apple
  tokens; writes `adminAudit` `account.delete` / field `self`. Every wrapper then refuses the account
  (`ACCOUNT_SUSPENDED`), and the existing daily purge (`accountPurge.purgeDueAccounts`) erases it after the 30 days.
  The owner's account table shows it as waiting for deletion; the owner's Undo works on it too.
- **App owner**: refused with `OWNER_ACCOUNT_UNDELETABLE` (`src/lib/errors/admin.ts`).
- **Signing in cancels** (within the 30 days): every sign-in path clears the account's own waiting deletion first and
  writes `account.restore` / field `self.signIn`:
  - credentials sign-ins (password, e2e, the phone's Apple provider) through `refuseSuspendedSignIn` in
    `convex/auth.ts`, which now asks `internal.accountSelfDelete.signInAllowed` (a mutation: cancel, then answer);
  - OAuth (Google) through the `createOrUpdateUser` callback (`signInCallback` in `convex/auth.ts`), when the sign-in
    lands on an existing login (`existingUserId`). Linking a *new* login method to a self-deleted account is still
    refused; sign in with a method the account already has.
- **Owner-imposed stays refused.** A self-deletion is told apart by its row: `by === userId` (the owner's functions
  can never write that: they refuse the owner's own account) and `suspendedAt` unset, and `deleteAfter` still ahead.
  When the owner suspends a self-deleted account, `by` becomes the owner and sign-in is refused; an owner-scheduled
  deletion is refused as before. After the 30 days sign-in no longer cancels (the purge may be running).

## Apple token revocation

`convex/lib/appleRevoke.ts`, checked against Apple's REST API docs (developer.apple.com, 2026-11-06):

- `POST https://appleid.apple.com/auth/revoke`, form-encoded `client_id` (the bundle id), `client_secret`, `token`,
  `token_type_hint=refresh_token`. 200 with an empty body when revoked or already invalid.
- Only refresh or access tokens can be revoked, not identity tokens. So the phone's native Apple sign-in must also send
  its one-time `authorizationCode` and schedule `internal.accountSelfDelete.rememberAppleSignIn` with it (user id,
  bundle id = the identity token's `aud`); that trades it at `POST /auth/token` (`grant_type=authorization_code`) for a
  refresh token and keeps it on the user's `apple-native` `authAccounts` row (`secret`, as JSON with `schemaVersion`;
  that credentials provider never uses the field).
- On self-delete the tokens are taken off the rows and revoked at once (`internal.accountSelfDelete.revokeAppleTokens`).
  The purge revokes any token still stored before it deletes the logins, which covers the owner's Delete account.
- **Without the env, revocation is logged (`console.warn`) and skipped**; deletion never waits on Apple. An Apple or
  network error is logged and the other tokens still go.

### Env the user must set (`npx convex env set`, on the production deployment)

Either (preferred, never expires):

- `APPLE_TEAM_ID`: the 10-character Team ID;
- `APPLE_KEY_ID`: the 10-character key id of a Sign in with Apple key (Certificates, IDs & Profiles → Keys);
- `APPLE_PRIVATE_KEY`: the downloaded `.p8` file's full PEM text (real newlines or literal `\n`).

A client secret (ES256 JWT, `iss` team, `aud` https://appleid.apple.com, `sub` bundle id, 5 minutes) is signed per call.

Or `APPLE_CLIENT_SECRET`: a ready-made client-secret JWT. It works only for the bundle id in its `sub` and expires
within six months, so it must be renewed.

## Not in this tracer (orchestrator / follow-ups)

- `convex/convex.config.ts` should declare the four `APPLE_*` variables (`v.optional(v.string())`) so the typed `env`
  knows them; until then `accountSelfDelete.appleEnv` reads them through a cast of `env` (same object at runtime).
- The phone branch: the Apple provider must send `authorizationCode` and schedule `rememberAppleSignIn`; the phone's
  DeleteAccount screen calls `accountSelfDelete.deleteMyAccount`.

## Tests

- `tests/convex/account-self-delete.test.ts`: delete → refused + sessions gone; owner refused; signed out refused;
  purge after 30 days, not before; credentials and OAuth sign-in cancel; no cancel after 30 days; owner suspension and
  owner-scheduled deletion still refuse; Apple revoke with a mocked fetch and a verified ES256 secret; skipped without
  env; purge revokes for the owner's delete; error handling; code exchange.
- `tests/convex/authz/account-self-delete.*`: matrix entry (`user`; the owner's row ok via `OWNER_ACCOUNT_UNDELETABLE`).
- `tests/unit/config/delete-account.test.tsx`: confirm step text, confirm → mutation + sign-out + /signin, refusal
  message, hidden for the owner / loading / signed out.
