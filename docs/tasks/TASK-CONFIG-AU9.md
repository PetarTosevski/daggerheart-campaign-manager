# TASK-CONFIG-AU9: Suspend / Delete in the account row's menu

Plan `.omc/plans/config.yaml`, tracer AU9, Part B, on AD14 (`docs/tasks/TASK-CONFIG-AD14.md`). Built 2026-11-05
without a separate screen design (user decision), in the existing admin look (`reference/designs/config/Admin.dc.html`
`.s-acc`); N11 (2026-11-04) is binding.

## What the owner sees (App admin > Accounts)

- The '···' menu of each account row (none on the owner's own row) now lists, after Add to / Remove from testers:
  - a normal account: **Suspend**, **Delete account**;
  - a suspended account: **Lift suspension**, **Delete account**;
  - an account waiting for deletion: **Undo delete**.
  Suspend and Delete account are glass `danger`; Undo delete is `cancel` (the "back out" role); Lift is `neutral`.
- **Suspend** and **Delete account** open a confirm dialog (`Modal`): what will happen (N11 in plain words), a
  **Reason** (required, at most 300 characters, "Kept in the admin log.") and **Type <email> to confirm**; the danger
  button stays off until the reason is given and the email matches (case and spaces aside). Cancel, Escape or the
  backdrop close it and the menu, writing nothing. A refusal shows in the dialog.
- **Lift suspension** and **Undo delete** are one click.
- The row shows **Suspended**, or **Deleted in N days · Undo** (whole days left, rounded up) next to the name; the
  row's Undo cancels the deletion.

## Code

- `src/components/admin/accounts/account-actions/index.tsx`: `AccountActions` (AU2's slot: the menu items and the
  confirm dialog) and `AccountStatusMark` (the row mark). Both read `adminAccountActions.statuses` (one shared
  subscription); every write is an intent (`{ userId }` or `{ userId, reason, confirmEmail }`) with an optimistic
  update of that list (rule 12). The menu items render once the statuses have loaded.
- `text.ts` (words and pure helpers), `account-actions.css` (`aca-*`).
- Outside owns: `src/components/admin/accounts/account-table.tsx` mounts `<AccountStatusMark account now />` after
  the Tester tag (one import, one line), allowed by the orchestrator.

## Tests

- `tests/unit/admin/account-actions.test.tsx`: the menu per status, no menu on the owner's row, glass danger, the
  dialog's checks (reason + email), Suspend / Delete / Lift / Undo intents and their optimistic marks, Cancel writes
  nothing, a refusal rolls back and shows in the dialog. `tests/unit/admin/accounts.test.tsx` (AU2) still passes.
- `tests/e2e/admin-account-actions.spec.ts` was not written in this tracer (the orchestrator runs e2e; see the report).
