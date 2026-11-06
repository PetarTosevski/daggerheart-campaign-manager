# TASK-CONFIG-AU4: Feature switches tab and the tester list

Plan `.omc/plans/config.yaml` (Part B), tracer AU4, bead dcm-jh6d.48, design `reference/designs/config/Admin.dc.html`
(`.s-flags`). Builds on AD1 (shell, `AdminTabProps`, `admin.css`), AD9 (`features.list` / `setMode`, `FEATURES`) and
AD3 (`adminAccounts.accounts` / `addTester` / `removeTester`).

## What changed

- `src/components/admin/features/index.tsx`: `FeatureSwitchesTab`. The Feature switches card: the board's intro, one
  row per `FEATURES` entry in board order (no combat HUD, Q25 b) with the name, the description, 'Changed 2 Nov'
  ('Changed —' when never saved; another year adds the year) and the four-way choice Off / Only me / Testers /
  Everyone (a `role="group"` named after the feature, glass neutral `sm` buttons with `aria-pressed`). A click on
  another mode calls `features.setMode({ key, mode })` with an optimistic update of `features.list` (mode and
  `changedAt`); the current mode writes nothing. Errors show inline and roll back. Journal and Share links are inert
  (N2 a): saved like the others, with the gold note 'Always on for now: the old Sessions and Notes pages are gone.' /
  'Not built yet.' from `FEATURES[].note`.
- `src/components/admin/features/testers.tsx`: `TestersCard`. AD9 has no tester list, so the card reads AD3's account
  table (`usePaginatedQuery(adminAccounts.accounts, {}, 50)`) and lists the loaded accounts with `tester: true`
  ('Luka and Mira', initials, 'See features set to Testers.'; none: 'No testers yet'). Edit opens a `Modal` picker over
  the same table: one row per account (the owner left out: the owner always sees Testers features), Add / Remove
  (`addTester` / `removeTester`, optimistic through `optimisticallyUpdateValueInPaginatedQuery`), and 'Show more
  accounts' for the next page.
- `src/components/admin/features/text.ts`: the board's text, mode labels, `changedLabel`, `joinNames`, `accountName`.
- `src/components/admin/features/features.css`: `.seg2.sm` (`.afs-seg`), the note, the date, the initials, the picker.

## Decisions (recommended defaults)

- Tester list from the account table: testers in accounts older than the loaded pages are not in the card until Edit
  loads more; the card then says 'Older accounts are not loaded yet; Edit shows them.' A dedicated bounded
  `features.testers` query would remove that gap (follow-up, server side).
- The owner is not offered in the picker (Testers mode includes the owner already).
- Remove uses the cancel glass role, Add and Edit neutral; no confirm step (one click, undone by the other button).

## Tests

- `tests/unit/admin/features.test.tsx`: intro and rows in board order without the combat HUD, descriptions, dates,
  pressed mode, N2 notes, setMode intent + optimistic + no-op + rollback, loading; the Testers card's names, empty
  and 'older accounts' lines, the picker (owner left out, add / remove optimistic, load more, refused change).

## Edits outside `owns`

- `tests/unit/admin/shell.test.tsx`: the "stubs render nothing" case no longer lists `FeatureSwitchesTab` (it is
  built now).
