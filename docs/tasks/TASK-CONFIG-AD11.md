# TASK-CONFIG-AD11: Export everything as JSON

Plan `.omc/plans/config.yaml`, tracer AD11 (bead dcm-jh6d.45), Part B. Server only; AU5 builds the button.
Answer: Q30 (a) an in-app JSON export to a temporary file, downloaded through an owner-checked route and deleted after
1 hour; auth secrets, book text and rate-limit state are excluded.

## API (`convex/adminExport.ts`)

| Function | Kind | Args | Returns |
|---|---|---|---|
| `adminExport.start` | `appOwnerMutation` | `{}` | the export id. Writes a pending `adminExports` row, audits `export.request` (`target`: the id), schedules `build`. While the newest live export is still pending, answers that one instead (no second build). |
| `adminExport.status` | `appOwnerQuery` | `{}` | the newest export younger than the TTL, `{ exportId, status, createdAt, expiresAt }`, or `null` |
| `adminExport.build` | `internalAction` | `{ exportId }` | pages every table in `EXPORTED_TABLES` through `adminExport.page`, writes one JSON file to storage, then `finish` (ready + `fileId`); any error marks it `failed` |
| `adminExport.page` | `internalQuery` | `{ table, cursor }` | one page: at most `PAGE_ROWS` (200) rows and `PAGE_BYTES` (4 MiB) read, redacted |
| `GET /admin/export?id=<exportId>` | `httpAction` (`http.ts`) | `Authorization: Bearer <Convex Auth token>` | the file as `attachment; filename="dualityheart-export-YYYY-MM-DD.json"`, `Cache-Control: no-store` |

Download answers: 401 `{ code: "UNAUTHENTICATED" }` without a token, 403 `FORBIDDEN` for anyone but the app owner
(`isAppOwner`, checked on every download, so a former owner is refused at once), 404 `NOT_FOUND` for a malformed id,
a pending or failed export, or one older than the TTL (refused even before the hourly cron deletes it). CORS allows
only `SITE_URL` (an `OPTIONS` preflight route answers for the `Authorization` header). Never a `getUrl` link (CF18).

## File format

`{ format: "dualityheart-export", schemaVersion: 1, exportedAt, excludedTables, redactedFields, tables: { <table>: [rows] } }`.
Rows are stored documents as is (`_id`, `_creationTime`), minus `REDACTED_FIELDS`. Storage files appear by id only.

## What is never exported

`EXCLUDED_TABLES`: `authAccounts`, `authSessions`, `authRefreshTokens`, `authVerificationCodes`, `authVerifiers`,
`authRateLimits` (password hashes, sessions, tokens, codes), `lorekeeperChunks` (book text), `operations`
(idempotency records and their results), `adminExports`, `e2eCodes`. Rate-limiter state lives in its component and
is not reachable. `REDACTED_FIELDS`: `campaigns.joinCode` (a join credential). Every schema table is in exactly one
of `EXPORTED_TABLES` and `EXCLUDED_TABLES` (tested), so a new table needs a decision.

## Retention

AD0's `adminRetention.expireExports` (hourly) deletes rows older than an hour and their files. If a row expires while
its build runs, `finish` deletes the new file.

## Known limit

The build holds the whole file in one action's memory (default runtime, 64 MiB) and must finish within the action
time limit. Fine at today's size; past that, use `npx convex export`.

## Tests

`tests/convex/admin-export.test.ts`; the matrix `tests/convex/authz/admin-export.*`.
