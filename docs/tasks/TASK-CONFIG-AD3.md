# TASK-CONFIG-AD3: Accounts server

Plan `.omc/plans/config.yaml`, tracer AD3 (bead dcm-jh6d.37), Part B. Server only: the sign-up mode and caps
setters, the account table and testers. AU2 builds the Accounts tab on it; AD4 / AD5a / AD5b enforce the settings.

## API (`convex/adminAccounts.ts`)

Every function is an `appOwner*` builder (AD0): signed out `UNAUTHENTICATED`, anyone else (a campaign's GM included)
`FORBIDDEN`, before the handler runs.

| Function | Wrapper | Args | Returns | Audit |
|---|---|---|---|---|
| `setSignUpMode` | `appOwnerMutation` | `{ mode: "open" \| "invite" \| "closed" }` | `null` | `signUpMode.set` from / to |
| `setCap` | `appOwnerMutation` | `{ cap: "campaignsPerGm" \| "campaignsApp" \| "charactersPerPlayer" \| "playersPerCampaign", value }` | `null` | `cap.set`, `field` = cap, from / to |
| `accounts` | `appOwnerQuery` | `{ paginationOpts }` | page of accounts | - |
| `addTester` | `appOwnerMutation` | `{ userId }` | `null` | `tester.add`, `target` = userId |
| `removeTester` | `appOwnerMutation` | `{ userId }` | `null` | `tester.remove`, `target` = userId |

- Single-field intents (rule 12). Each change writes one `adminAudit` row; setting the value already in force (or
  adding a tester twice, removing a non-tester) writes nothing, so repeated clicks don't fill the audit.
- `setCap`: a whole number from 1 to 1000, else `INVALID`. `from` in the audit is the effective value (the default when
  nothing was saved). Only the one cap is written; the others stay unset (= default).
- `addTester` on a missing account: `NOT_FOUND`.

## Account table

`accounts` pages `users` by `by_creation_time`, newest first; `numItems` is clamped to `ACCOUNTS_PAGE_MAX` (50). Each
row picks only: `userId`, `name`, `email`, `role`, `campaigns`, `moreCampaigns`, `lastSeen`, `tester`, `createdAt`.
Never a password, an auth account, a session, a key or verification data (a test checks the keys and that a stored
password secret never appears).

- `role`: `owner` (`isAppOwner`, the one owner check), `gm` (runs a campaign that is not deleted), else `player`.
- `campaigns`: up to 5 names, the campaigns they run first, then the ones they play in; deleted campaigns are skipped.
  Per-account reads are bounded by `ADMIN_READ_BOUND` (20) on `campaigns.by_owner_deletedAt_lastOpened` and
  `campaignMembers.by_user`; `moreCampaigns` says there are more than shown.
- `lastSeen`: the newest `campaignOpens` row (`by_user_lastOpened`, desc, first), or null.
- `tester`: an `appTesters` row exists (`by_user`).

## Decisions

- No "Who can create a campaign", no GM approval, no "Make GM" (user decision).
- Archived campaigns count for the GM role and appear in the names (they are not deleted). Recommended default; the
  brief only says "GM = owns a live campaign".
- No-op changes are not audited (recommended default; the acceptance says each change writes one row).

## Tests

- `tests/convex/admin-accounts.test.ts`: setters, audit rows, bounds, no-op, the table's fields and pagination,
  testers, refusals.
- `tests/convex/authz/admin-accounts.entries.ts` (+ `.test.ts`): all five functions in class `appOwner`.
