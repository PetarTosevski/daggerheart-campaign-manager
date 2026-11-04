# TASK-CONFIG-AU2: App admin, Accounts tab

Plan `.omc/plans/config.yaml` (Part B), tracer AU2, bead dcm-jh6d.47. Design `reference/designs/config/Admin.dc.html`
(`.s-acc`). Server: AD3 (`convex/adminAccounts.ts`, docs/tasks/TASK-CONFIG-AD3.md) and AD0's `appAdmin.settings`.

## What changed

- `src/components/admin/accounts/index.tsx`: `AccountsTab` (the shell's slot, `AdminTabProps`) renders the two cards,
  each in its own `SlotBoundary` (rule 11): a failing account list leaves 'Who can join' working and the reverse.
- `join-card.tsx`: 'Who can join'. 'New accounts · How people get into the app.' with Invite link only / Open sign-up /
  Closed (`setSignUpMode`), and four steppers (`setCap`): Campaigns per GM ('Archived campaigns don’t count.'),
  Campaigns in the whole app ('New campaigns are refused past this.'), Characters per player in a campaign ('Includes
  retired characters.'), Players per campaign. Values come from `appAdmin.settings` (effective values: saved or the
  defaults). Each click is one single-field intent with an optimistic update of `appAdmin.settings` (rule 12); − / + are
  disabled at 1 / 1000 (the server's bounds). A refused write rolls back and its message shows in the card.
- `account-table.tsx`: Account / Role / Campaigns / Last seen / Actions over `adminAccounts.accounts`
  (`usePaginatedQuery`, 25 per page, 'Show more accounts'). The owner's row reads 'You' and has no menu. '···' opens a
  `role="menu"` with Add to testers / Remove from testers (optimistic on the loaded pages) followed by the
  account-actions slot. Escape or a click outside closes it; focus returns to the button. Testers show a 'Tester' tag.
- `account-actions/index.tsx`: the empty slot `AccountActions({ account, onDone })` that AU9 fills with Suspend / Delete
  once Q28's design is approved (N11). AU9 owns `account-actions/**`.
- `text.ts`: the board's words and the pure helpers (`lastSeenText`, `campaignList`, `steppedCap`, names).
- `accounts.css`: the segmented control, stepper, table, role pills and menu (layout only; the buttons are glass).

## Decisions (recommended defaults)

- Card title 'Who can join' (the board's '… and create' goes with the dropped 'Who can create a campaign' row).
- Buttons are arcane glass: the sign-up choices are `neutral` with `aria-pressed`, the steppers and '···' are `tool`,
  menu items `neutral`. The board's `.seg2` / `.stp` frames are kept around them.
- The owner's row shows 'You' and no '···' (adding the owner to testers changes nothing: 'Only me' covers them; AU9 says
  no menu on the owner's own row).
- No avatars: the account table has no image field, so each row shows its initial (the board's `.pf.ini`).
- Last seen: 'Now' (under 5 min), 'N min ago', 'N h ago', 'N days ago', then the date; 'Never' without a campaign open.
- Campaigns: the names joined by commas, '… and more' when the server cut the list, 'None' without any.
- No e2e spec (none in AU2's owns); AX covers the owner flows end to end.

## Tests

`tests/unit/admin/accounts.test.tsx`: the board's rows and the dropped ones absent; sign-up mode and cap intents with
optimistic values, bounds and rollback with the error text; the table's columns, roles, campaigns and last seen; no menu
on the owner's row; add / remove testers (optimistic); Escape and focus; paging; loading lines; each card's error
boundary; the helpers.
