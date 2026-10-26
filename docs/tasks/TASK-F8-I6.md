# TASK-F8-I6: Backup notes privacy, D5 follow-ups, Codex pins (dcm-bxp.101, .31, .16)

Plan `.omc/plans/followups-8.yaml`, tracer I6. Reads: `docs/tasks/TASK-D5-*.md`, `docs/tasks/TASK-D12-H17.md`.

## What landed

| File | Change |
|---|---|
| `convex/codex.ts` | `codex.update` renames the pinned World map marker when a location's name changes (`renamePin`). |
| `src/app/(gm)/campaigns/[campaignId]/world/page.tsx` | The World board reads `?token=<id>` (the Codex's "Show on map" link) as well as `?focus=<id>` (the dashboard's Locations panel), and selects and centres that marker. |
| `src/lib/validation/settings-backup.ts` | A doc note: the backup carries no notes; a campaign export that adds notes must be a new `kind` read through `permissionFor`. |
| `tests/convex/codex.test.ts` | Rename sync: other fields kept, blank or unchanged names ignored, 80-character cut, unpinned or missing marker writes nothing, a version 1 map is split first, a codex-entry edit grant never writes the map. |
| `tests/convex/settings-backup-privacy.test.ts` | The backup of the GM and of two players holds only the envelope and settings, never page or entry text (private, players-only, chosen-without-GM and GM pages exist); a pasted backup carrying notes is refused with `INVALID` and changes nothing. |
| `tests/e2e/codex.spec.ts` | GM places a marker, links a location to it, renames the location, follows "Show on map": the URL has `?token=`, the marker is selected under its new name. |

No public function was added or had its arguments changed, so the authorization matrix is unchanged (`codex.update` keeps its `world` entry).

## dcm-bxp.16 (Codex pins)

- **Rename sync.** When `codex.update` changes the name of an entry with a pin, the linked marker gets the trimmed name, cut to the
  map's 80 characters. A blank name keeps the marker's name. It runs only for a caller who may edit the map (`permissionFor`, map
  resource, `edit`): an edit grant on one codex entry alone never writes the map. A version 1 map is split into rows first
  (`writableMap`), so the marker has a row. Only that one marker row is written.
- **`?token=` focus.** The Codex has linked to `/world?token=<id>` since D7, but the board only read `?focus=`. Both are read
  now; `focus` wins if both are present.
- **Not built: drop or move a pin from the Codex picker.** The picker is `src/app/(gm)/campaigns/[campaignId]/codex/pin-picker.tsx`,
  and a new mutation needs an entry in `tests/convex/authz/world.entries.ts`; neither is in I6's `owns`. Left open on the bead.

## dcm-bxp.101 (backup notes privacy)

The D12 backup that shipped (H17, option A, user answers Q1/Q2 2026-10-21) is settings-only: no journal pages or entries at all.
It therefore never carries a page the GM may not read. The new tests pin that down so a later campaign export has to be a new
format with its own `permissionFor` checks.

## dcm-bxp.31 (D5 follow-ups)

Not changed here; every open part needs files outside I6's `owns`:

| Part | Needs |
|---|---|
| (1) `updatedAt` before each logged action | `convex/lib/validators/actionLog.ts`, `convex/lib/actionLog.ts` (new field, written by `logAction`, checked by `undoEntry`) |
| (2) `UNDO_EXPIRED`, `UNDO_USE_REST` | the throws are in `convex/lib/actionLog.ts`; `tests/unit/convex-errors.test.ts` asserts the exact code list of `actionLogMessages` |
| (3) before-snapshots in their own table | `convex/tables/actionLog.ts`, `convex/lib/actionLog.ts`, a migration (`convex/migrations.ts` belongs to I1), `docs/data-model.md` |
| (4) imported characters above level 1 | the character import code |
| (5) snapshot retention | already done (dcm-c26, closed: `cleanup.stripActionLogSnapshots`) |

## Verification (2026-10-23)

| Check | Result |
|---|---|
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm vitest run --maxWorkers=4 --testTimeout=60000` | 287 files, 7719 passed, 1 expected fail |
| `E2E_PORT=3121 E2E_CONVEX_PORT=3354 pnpm test:e2e tests/e2e/codex.spec.ts tests/e2e/world.spec.ts` | 5 passed |
| `pnpm tracer:guard .omc/plans/followups-8.yaml I6` | OK, all changed files owned |

An e2e build on port 3121 adds `.next-e2e-3121/**` to `tsconfig.json`; that edit is not in I6's `owns` and was reverted.
