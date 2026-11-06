# TASK-CONFIG-AD10: Maintenance server

Plan `.omc/plans/config.yaml`, tracer AD10 (bead dcm-jh6d.44), Part B. Server only: read-only mode enforced on every
write, the banner status, key and connection status, backups info. AU5 builds the Maintenance tab and the banner.
Answers: Q29 (a) link to the Convex dashboard; Q31 (a) the owner and background jobs are exempt.

## Read-only mode (`convex/lib/functions.ts`)

- Every mutation builder (`userMutation`, `keyedUserMutation`, `campaignMutation`, `keyedCampaignMutation`, `gm*`,
  `creator*` mutations) and `userAction` read the `appStatus` singleton once and throw `READ_ONLY_MODE` while
  `readOnly` is on. Order: sign-in, campaign access, archived guard, **read-only**, rate limit. A stranger still gets
  `NOT_FOUND`, a player `FORBIDDEN`, signed out `UNAUTHENTICATED`, and a refused call spends no rate-limit token.
- Exempt (Q31 a):
  - the app owner (`isAppOwner`, checked only while the mode is on), on every builder; the `appOwner*` builders let
    only the owner in, so the owner can always turn the mode off;
  - functions that pass `readOnly: "allow"`: only `campaigns.markOpened` and `presence.heartbeat` / `disconnect`
    (otherwise every page load fails). `markOpened` also accepts a pending email invite, so that still works in
    read-only mode;
  - queries, and every `internal*` function: crons keep cleaning and a Lorekeeper answer already started finishes;
  - Convex Auth sign-in (sessions are written). Blocking sign-ups in read-only mode is AD4's job (`createOrUpdateUser`).
- `userAction` gets the user and the refusal in its one internal query (`lib/functions:actionUser`, now
  `{ user, readOnlyRefused } | null`).
- The per-campaign loaders (`refuseArchivedWrite`) need no read-only twin: they all run inside a wrapped mutation,
  which already checked. `http.ts` has no write route besides Convex Auth's and the e2e code route.

## API

| Function | Wrapper | Args | Returns |
|---|---|---|---|
| `appStatus.get` | `maybeUserQuery` | `{}` | `{ readOnly: true, message }` while on (message or null), `null` while off; signed out too |
| `adminMaintenance.setReadOnly` | `appOwnerMutation` | `{ on, message? }` | `null`; message trimmed, at most 200 (`INVALID` over), kept only while on; audit `readOnly.set` (`field: "readOnly"`, from, to) |
| `adminMaintenance.keys` | `appOwnerQuery` | `{}` | booleans only: `database` (always true), `anthropicKey`, `resendKey`, `mailFrom`, `siteUrl`, `google` (`AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`); blank = false |
| `adminMaintenance.backups` | `appOwnerQuery` | `{}` | `{ dashboardUrl, note }`: `https://dashboard.convex.dev/d/<deployment>/settings/backups` from `CONVEX_CLOUD_URL` (null off Convex cloud), note "Backups are managed in the Convex dashboard." No "last backup" time |

`appStatus.get` answers null while off (not `{ readOnly: false }`), so the unauthenticated sweep's signed-out rule for
`maybeUserQuery` reads (null) and the stranger rule hold without an exemption; the client shows the banner when the
answer is not null.

## Tests

- `tests/convex/read-only-mode.test.ts`: walks the inventory (every public mutation and action is on a builder the
  file probes, and exactly the three Q31 functions pass `readOnly: "allow"`); a probe per builder refuses with
  `READ_ONLY_MODE` and runs again once off; a real function per builder in use refuses and changes nothing; access
  order; markOpened, heartbeat, disconnect and queries still work; the owner's writes run and the owner turns it off;
  only the owner toggles; banner for everyone; message cap and audit; keys are booleans and no returned string equals
  any env value; the backups link.
- `tests/convex/authz/admin-maintenance.*`: the matrix rows (`appStatus.get` maybe, the three `adminMaintenance`
  functions `appOwner`).

## Notes for later tracers

- `READ_ONLY_MESSAGE_MAX` lives in `convex/adminMaintenance.ts`; AU5 may move it to `src/lib/admin/config.ts`.
- A new mutation builder must call `refuseReadOnly` and be added to `PROBED` in the test, which fails until it is.
