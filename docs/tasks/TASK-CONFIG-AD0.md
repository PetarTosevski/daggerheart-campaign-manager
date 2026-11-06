# TASK-CONFIG-AD0: Admin foundation

Plan `.omc/plans/config.yaml`, tracer AD0 (bead dcm-jh6d.33), Part B. Server only: the owner's identity, the
`appOwner*` wrappers, the admin tables with defaults, the audit helper, the retention crons, the admin error module
and the authz matrix class. No UI (AD1 builds the shell).

## Owner identity (Q16 a)

- One stored value: `appConfig.ownerId` (a `users` id). Written only by the **internal** mutation
  `adminSetup.setOwner { email }`:

  ```sh
  npx convex run adminSetup:setOwner '{"email": "you@example.com"}'
  ```

  Internal functions need the deployment's admin key, so whoever controls the deployment names the owner. The email is
  normalised (trim, lower case) and must belong to exactly one **verified** account (`emailVerificationTime` set; CF3):
  unknown or unverified → `NOT_FOUND`, blank or shared by two verified accounts → `INVALID`. Running it again hands the
  role over; every run writes an `owner.set` audit row. Later email changes do not move the role.
- `convex/lib/appOwner.ts` `isAppOwner(ctx, user)` is the **only** owner check. It is false signed out, while no owner
  is set, and for an owner whose email is no longer verified.
- No env var, no email matched at request time, no client flag. The client's `appAdmin.me` is UX only (CF22).

## Wrappers (`convex/lib/functions.ts`)

| Builder | Adds to ctx | Refuses |
|---|---|---|
| `appOwnerQuery` | `user` (the owner) | signed out `UNAUTHENTICATED`; anyone else (the campaign GM included) `FORBIDDEN` |
| `appOwnerMutation` | `user`; option `rateLimit?` | same |
| `appOwnerAction` | `user`; option `rateLimit?` | same (one internal query, `lib/functions:actionAppOwner`) |

The check runs in the wrapper's `input`, before any handler code. A deleted account is `FORBIDDEN` (as in every
wrapper).

## API (`convex/appAdmin.ts`)

| Function | Wrapper | Args | Returns |
|---|---|---|---|
| `appAdmin.me` | `maybeUserQuery` | `{}` | `null` signed out, else `{ isOwner }` for the caller only |
| `appAdmin.settings` | `appOwnerQuery` | `{}` | the effective settings (`appSettingsValidator`): `signUpMode`, `caps`, `lorekeeper`, `spendAlertMonth` |

`settings` returns settings only: never a key, a secret, the owner id or an env value other than the three
Lorekeeper numbers (a test sets secret env vars and checks none appears).

## Settings and defaults (`convex/lib/appConfig.ts`, `src/lib/admin/config.ts`)

`readAppConfig(ctx)`: saved values over defaults. Sign-up `open` (Q18: open stays the default). Caps (Q19 a):
campaigns per GM 10, in the app 100, characters per player per campaign 5, players per campaign 8. Lorekeeper:
`monthlyUsd` ← `LOREKEEPER_MONTHLY_USD` ← 150; `campaignMonthlyUsd` ← `LOREKEEPER_CAMPAIGN_MONTHLY_USD` ← 50;
`dailyQuestions` ← `LOREKEEPER_DAILY_QUESTIONS` ← 40; `dailyWebSearches` 20; `atLimit` `pause`; `allowGmRequests`
false. A malformed env value or a negative saved number falls back (a typo never opens or closes a gate). Nothing reads
these yet, so behaviour is unchanged until AD4 / AD5 / AD6 wire them in.

## Tables (`convex/tables/admin.ts`)

`appConfig`, `appStatus`, `featureSwitches`, `appTesters`, `adminAudit`, `adminExports`, `lorekeeperCampaignLimits`,
`lorekeeperLimitRequests`; fields and indexes in `docs/data-model.md`. `adminAudit.action` already lists every later
tracer's action (`ADMIN_AUDIT_ACTIONS`: AD3, AD6, AD8-AD14 and Q26's campaign events), so no tracer edits the stored
validator in place (rule 7). `adminAudit` also has an optional `target` (the id acted on, as a string), beyond the
plan's field list, so AD3 / AD12-AD14 never need to widen it.

`recordAdminChange(ctx, actorId, { action, field?, from?, to?, target? })` (`convex/lib/adminAudit.ts`) writes one row;
every admin mutation calls it.

## Retention (rule 8, `convex/adminRetention.ts`, `convex/crons.ts`)

| Job | When | What |
|---|---|---|
| `expireAudit` | daily 04:43 | `adminAudit` older than 365 days (Q26 a), `by_at` |
| `expireLimitRequests` | daily 04:57 | approved / declined requests created over 365 days ago, `by_status_createdAt`; pending ones wait |
| `expireExports` | hourly :03 | exports older than 1 hour and their storage file (Q30 a), `by_createdAt` |

Each takes 200 rows and reschedules itself while a full batch was handled. The campaign purge
(`convex/cleanup.ts`) deletes the campaign's `lorekeeperCampaignLimits` and `lorekeeperLimitRequests`.

## Errors (`src/lib/errors/admin.ts`)

`READ_ONLY_MODE`, `SIGN_UP_CLOSED`, `SIGN_UP_INVITE_ONLY`, `CAP_CAMPAIGNS_PER_GM`, `CAP_CAMPAIGNS_APP`, `CAP_PLAYERS`,
`CAP_CHARACTERS_PER_PLAYER`, `LOREKEEPER_PAUSED`, `LOREKEEPER_WEB_CAP`, `FEATURE_OFF`, `LIMIT_REQUEST_PENDING`,
`LIMIT_REQUESTS_OFF`, `BOOK_ALLOWANCE`, `BOOK_TOO_LARGE`, `BOOK_NOT_PDF`, `BOOK_PARSE_FAILED`, `OWNER_VIEW_READ_ONLY`,
`ACCOUNT_SUSPENDED`. No `ADMIN_ONLY`: a non-owner gets the common `FORBIDDEN`. `FEATURE_OFF` matches the HUD's
combat-code prefix (`FEATURE_`), so `src/lib/errors/refusals.ts` maps it (a toast, "Switched off").

## Authz

- The world (`tests/convex/authz/world.ts`) has a role `appOwner`: a verified account in no campaign, named with
  `adminSetup.setOwner`. Only entries that state an `appOwner` row, or the `appOwner` class, run it.
- Class `appOwner` (`tests/convex/authz/harness.ts`): anon `UNAUTHENTICATED`; outsider, otherPlayer, player, grantee,
  coGm and gm `FORBIDDEN`; appOwner `ok`. An `appOwner` entry may not override any non-owner row (`entryProblems`),
  so every non-owner row stays pinned. The guard (`tests/convex/authz-matrix.test.ts`) files `appOwner*` functions
  only under `appOwner`, and the class only for those wrappers.
- Area `admin-core`: `appAdmin.me` (class `maybe`, plus an `appOwner` row), `appAdmin.settings` (class `appOwner`).
- `tests/convex/unauthenticated-sweep.test.ts`: `appAdmin:me` is a `maybeUserQuery` (null signed out) and is listed
  in `STRANGER_OWN` (a stranger sees only `{ isOwner: false }`).

## Tests

`tests/convex/admin-foundation.test.ts` (setOwner, isAppOwner, the three wrappers through probe functions, `me`,
settings defaults / env / saved values / no secrets, crons, retention, error messages), `tests/convex/authz/admin-core.*`,
`tests/convex/schema-guard.test.ts` (retention decisions), `tests/convex/cleanup.test.ts` (purge covers the two
campaign tables).
