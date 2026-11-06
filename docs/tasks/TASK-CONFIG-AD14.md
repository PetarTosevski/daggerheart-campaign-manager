# TASK-CONFIG-AD14: Suspend and delete accounts (server)

Plan `.omc/plans/config.yaml`, tracer AD14, Part B (Q28 b). Built 2026-11-05 on the user's decision to go ahead
without a separate screen design; the N11 answers of 2026-11-04 (`.omc/plans/config-briefs.md`) are binding. AU9 puts
the controls in the account row's '···' menu.

## What the owner gets

- **Suspend**: the account is signed out everywhere, can't sign in and can't use the app; nothing is deleted; its
  campaigns stay playable for everyone else. **Lift suspension** undoes it at any time.
- **Delete account**: the account is refused at once, like a suspension, and erased 30 days later unless the owner
  chooses **Undo**. Then: each campaign it created goes to a co-GM if it has one (the earliest to join becomes its
  creator), otherwise it is deleted as its GM's Delete would and purged after the usual 30-day restore window; its
  characters in other people's campaigns stay and show as "Former player"; that campaign's GM can retire or delete them.
- **Safeguards**: Suspend and Delete need a reason (1-300 characters) and the account's email typed again; the owner's
  own account can never be suspended or deleted; every step writes an audit row.

## API (`convex/adminAccountActions.ts`)

Every function is an `appOwner*` builder: signed out `UNAUTHENTICATED`, anyone else `FORBIDDEN`.

| Function | Args | Effect | Audit |
|---|---|---|---|
| `suspend` | `{ userId, reason, confirmEmail }` | `accountStatus.suspendedAt`; deletes the account's sessions and refresh tokens | `account.suspend`, `to` = reason |
| `unsuspend` | `{ userId }` | clears `suspendedAt` (a waiting deletion stays) | `account.unsuspend` |
| `scheduleDelete` | `{ userId, reason, confirmEmail }` | `accountStatus.deleteAfter` = now + 30 days; deletes sessions | `account.delete`, `field: "scheduled"`, `to` = reason |
| `cancelDelete` | `{ userId }` | clears `deleteAfter` (a suspension set by hand stays) | `account.restore` |
| `statuses` | `{}` | every suspended / to-be-deleted account: `{ userId, suspended, deleteAfter }` (at most 200) | - |

Errors: missing account `NOT_FOUND`; the owner (or the caller) as target `FORBIDDEN`; empty / too long reason or an
email that doesn't match (case and spaces aside) `INVALID`. A step that changes nothing writes nothing.

## Enforcement

- `convex/lib/functions.ts`: every builder (`userQuery`, `maybeUserQuery`, the mutation, action, campaign and
  `appOwner` ones) throws `ACCOUNT_SUSPENDED` right after the sign-in check when `isAccountSuspended` says so (one
  indexed read of `accountStatus.by_user`; the table only holds suspended / to-be-deleted accounts).
- `convex/lib/users.ts` `createOrUpdateUser`: a sign-in of an existing account, or a Google sign-in that lands on an
  existing user, is refused with `ACCOUNT_SUSPENDED`. (Convex Auth does not call this callback for a password sign-in
  of an existing account; that sign-in gets a session, but every call is refused, so the app is unusable.)

## Data

`accountStatus` (`convex/tables/admin.ts`, additive): `{ userId, suspendedAt?, deleteAfter?, reason, by, updatedAt }`,
indexes `by_user` and `by_deleteAfter`. One row per suspended / to-be-deleted account, deleted on Lift / Undo when
the other mark is clear, and by the purge. Schema guard: `bounded`.

## Purge (`convex/accountPurge.ts`, rule 8)

Daily cron `erase deleted accounts` (05:27) runs `purgeDueAccounts`, which starts `purgeAccount` for the oldest account
past `deleteAfter`; each account's run goes on to the next due one. `purgeAccount` is batched and reschedules itself:

1. `live` (20 campaigns a run): co-GM handover (`ownerId` = the co-GM, its member row deleted; a clashing name gets
   " (2)", " (3)" …; audit `account.delete` `field: "campaign.handedOver"`, `target` = campaign, `to` = new GM) or
   soft delete (`deletedAt`; audit `campaign.delete`).
2. `deleted` (paged): `internal.cleanup.purgeCampaign` is scheduled for the end of each deleted campaign's 30-day
   window (the global campaign purge cron is off).
3. `rows` (200 rows a run): memberships, campaign opens, invites to its email, preferences, UI state, drafts, hand
   folds, upload notices, Lorekeeper day counters, tester row, GM settings, sharing grants to the user, auth accounts
   with their codes, sessions with their refresh tokens; then the user and the `accountStatus` row; audit
   `account.delete` `field: "erased"`. Audit rows keep the user id only, never the email.

It stops at once when the deletion was undone. Kept on purpose: rows inside campaigns that stay (characters, journals,
Lorekeeper conversations, action log, files): they belong to the campaign and go with its purge.

## "Former player"

No new code: `ownerLabel` (`src/components/party/party-display.ts`) already shows "Former player" for a character
whose owner is not in the campaign's roster; the purge deletes the member row, and every user lookup of the
character's owner already handles a missing user.

## Tests

- `tests/convex/account-suspend.test.ts`, `tests/convex/account-delete.test.ts`.
- `tests/convex/authz/admin-account-actions.*` (class `appOwner`).
- `tests/convex/schema-guard.test.ts` (`accountStatus` bounded).
- `tests/convex/perf-reads.test.ts` (outside owns): `combatMaps.list` may use one more index range (the suspension
  check).
