# TASK-D12-H17: Settings backup, restore and reset (TitleMenu 'Saved data', option A)

Plan `.omc/plans/d12-hardening.yaml`, tracer H17 (depends on H0, H2). Design: analysis section 6
(`.omc/autopilot/d12-analysis.md`), option A. User answers Q1/Q2 (2026-10-21): a settings-only backup as
copy-and-paste text with a line saying campaigns sync through the account; "Erase all data…" becomes "Reset
settings…" with an in-page confirm; no account deletion.

## What landed

| File | Role |
|---|---|
| `src/lib/validation/settings-backup.ts` | The backup format: `settingsBackupText(settings)` writes `{ daggerheartBackup: 2, kind: "settings", schemaVersion: 1, settings }`; `parseSettingsBackup(text)` parses it (JSON, format 2, kind, dispatch on `schemaVersion`, strict objects, the settings rules of `settingsSchema`) and throws a `ZodError`; `readSettingsBackup(text)` is the dialog's safe-parse. |
| `convex/settings.ts` | `settings.restore({ text })` and `settings.reset({})`, both `userMutation`, `returns: v.null()`. |
| `src/app/(gm)/settings-dialog.tsx` | The board's "Saved data" section: copy, Show backup, Restore from pasted backup, Reset settings…, the `Backup data` textarea, the status line and the `Confirm reset` alertdialog. |
| `tests/unit/settings-backup.test.ts` | Shape, round trip, trimming, every refusal (ZodError and message). |
| `tests/convex/settings.test.ts` | Round trip on two accounts, replace-all, 12 refusals asserting `ConvexError.data.code === "INVALID"` with the row unchanged, reset (defaults back, campaigns and the other account untouched, no-op twice), signed out `UNAUTHENTICATED`. |
| `tests/convex/authz/settings-backup.entries.ts` + `.test.ts` | Matrix area `settings-backup`: restore and reset, class `user`. |
| `tests/e2e/settings-backup.spec.ts` | GM and player in two browser contexts, at 1440x960 and 390x844. |

## Public functions

| Function | Wrapper | args | returns | anon | outsider | player | GM |
|---|---|---|---|---|---|---|---|
| `settings:restore` | userMutation | `{ text: v.string() }` | `v.null()` | UNAUTHENTICATED | ok (own row) | ok (own row) | ok (own row) |
| `settings:reset` | userMutation | `{}` | `v.null()` | UNAUTHENTICATED | ok (own row) | ok (own row) | ok (own row) |

Both act only on the caller's own `settings` row (`ctx.user`, rule 3); no campaign is involved.

## Decisions

- **Restore takes the pasted text, not a parsed object.** The server is the one that validates: a typed object
  validator would refuse an unknown field or a newer `schemaVersion` with a Convex argument error instead of an
  `AppError`, and could not dispatch on the version (CD3). `parseSettingsBackup` turns every refusal (bad JSON, a
  foreign or format-1 board backup, another `kind`, an unknown `schemaVersion`, an unknown field at any level, an
  accent outside the palette, a name over 80 characters, a paste over 4000 characters) into a `ZodError`, which the
  wrapper converts to `{ code: "INVALID", message }`. The dialog runs the same parser first for an instant answer.
- **Restore replaces every setting** (table name, GM name, accent, the Hope & Fear default, including clearing it). It
  is a deliberate whole-object write, so it is its own mutation, not a snapshot through `settings.update` (rule 12).
- **Reset deletes the settings row**, so `settings.get` returns the defaults. Campaigns are untouched.
- The name fields are uncontrolled (`defaultValue`, saved on blur). After a restore or reset the Table section is
  re-mounted with a local counter as its `key` (an event counter, not live content, rule 13), so they show the
  replaced values.
- Nothing goes to `localStorage`; the e2e checks it.

## Not built here

- **dcm-bxp.89** (GM setting for the default map style, Classic / Sprites): the `settings` table has no such field yet,
  so it is not in the backup. When that field lands, add it to `backupSettingsV1` as optional (a widen, still
  `schemaVersion: 1`, since older backups stay valid) or bump to `schemaVersion: 2` with a `case 2` in
  `parseSettingsBackup`.
- A campaign export (analysis option B) stays a later bead.

## Verification

- `pnpm vitest run --maxWorkers=4 --testTimeout=60000` on the H17 files (unit, `settings.test.ts`, the
  `settings-backup` and `core` matrix areas, `authz-matrix.test.ts`): all pass. The full suite: 3344 passed; the only
  failures are `tests/unit/sprite-catalog.test.ts` and `tests/unit/sprite-builtin-pack.test.ts` (30 tests), which
  read the git-ignored sprite sheets and built-in pack and fail in a fresh worktree without them; they import nothing
  H17 touches.
- `tests/e2e/settings-backup.spec.ts` (ports 3152 / 3416, `E2E_REUSE_SERVERS=1`, servers started by hand): 2 passed,
  twice in a row. `campaigns.spec.ts` (which also uses the Settings dialog) passes.
- `pnpm lint`, `pnpm typecheck` and `pnpm tracer:guard .omc/plans/d12-hardening.yaml H17` pass.
