# TASK-F5-F7: GM 'Delete permanently' for deleted campaigns (dcm-bxp.30)

Plan `.omc/plans/followups-5.yaml`, tracer F7. User decision 2026-10-18: no automatic campaign purge; the GM deletes a
soft-deleted campaign for good from Load Campaign, after a confirm, reusing `internal.cleanup.purgeCampaign`.

## What landed

| File | Change |
|---|---|
| `convex/campaigns.ts` | `listDeleted` (userQuery), `purge` (userMutation), `PURGE_REQUESTED_AT`; `restore` refuses a campaign being purged. |
| `src/app/(gm)/campaigns/chronicle.tsx` | "Deleted campaigns" section under the saved ones: Restore, and Delete permanently behind an in-page confirm. |
| `tests/convex/campaigns.test.ts` | Listing, purge with its data, only that campaign, idempotent, restore refused, role and INVALID codes. |
| `tests/convex/authz/core.entries.ts` | Matrix entries for `campaigns:listDeleted` (user) and `campaigns:purge` (scoped). |
| `tests/e2e/campaign-delete-permanently.spec.ts` | Delete permanently (Keep it backs out, then the second click deletes) and Restore, at 1440 and 390. |

## How it works

- `purgeCampaign` (in `convex/cleanup.ts`, unchanged) purges only a campaign deleted more than `PURGE_AFTER_MS` (30
  days) ago. `purge` therefore sets the campaign's `deletedAt` to `PURGE_REQUESTED_AT` (1, older than any real
  deletion) and schedules `internal.cleanup.purgeCampaign` for it, which deletes everything in batches and finally the
  campaign row.
- The marker also hides the campaign at once: `listDeleted` reads `by_owner_deletedAt_lastOpened` with
  `deletedAt > PURGE_REQUESTED_AT` (newest deletion first, at most 50), and `restore` answers `NOT_FOUND` because part
  of the data may already be gone. Asking for the purge twice is a no-op.
- The confirm names the campaign ("Delete **name** permanently? ... This can't be undone.") and needs a second click
  on "Delete name forever"; "Keep it" closes it. No `confirm()` dialog.

### `campaigns:purge` roles

Checked by `permissionFor(..., "owner")`, like `restore`.

| Caller | Deleted campaign | Live campaign |
|---|---|---|
| Signed out | UNAUTHENTICATED | UNAUTHENTICATED |
| Outsider | NOT_FOUND | NOT_FOUND |
| Player / grantee / other table's player | NOT_FOUND | FORBIDDEN (player) |
| Its GM (owner) | ok (schedules the purge) | INVALID |
| Unknown or already purged id | NOT_FOUND | - |

## Follow-up for the orchestrator

`purgeCampaign`, once done, schedules `purgeDeletedCampaigns`, which purges the oldest campaign deleted more than 30
days ago. With the cron off (user decision 2026-10-18) that means a permanent delete also purges any campaign
soft-deleted over 30 days earlier, one after another. `convex/cleanup.ts` is not this tracer's file; dropping that
chain call (or limiting it to `PURGE_REQUESTED_AT`) needs its own change.

## Verification

- `pnpm vitest run tests/convex/campaigns.test.ts tests/convex/authz/core.test.ts tests/convex/authz-matrix.test.ts`
  pass; `pnpm test --maxWorkers=4 --testTimeout=60000`: 224 files, 5465 passed, 1 expected fail.
- `pnpm lint`, `pnpm typecheck` clean.
- E2E (ports 3185 / 3482, servers started by hand, `E2E_REUSE_SERVERS=1`, `--workers=1`): 4 passed (1.6 min); with
  `campaigns.spec.ts` at `--workers=2`, 11 passed. At load average 50-60 some runs failed on backend 1 s timeouts
  ("Function execution timed out" for `campaigns:purge`, `campaigns:fear` and others in `convex logs`), not on the
  feature.
- `pnpm tracer:guard .omc/plans/followups-5.yaml F7` passes.
