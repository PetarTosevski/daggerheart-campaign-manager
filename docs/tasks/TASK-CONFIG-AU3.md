# TASK-CONFIG-AU3: App admin Lorekeeper tab, and the GM's "Ask for higher limits"

Plan `.omc/plans/config.yaml`, tracer AU3 (bead dcm-jh6d.56), Part B. Design `reference/designs/config/Admin.dc.html`
(`.s-lore`). Servers: AD6 (`adminLorekeeper`), AD7 (80% email), AD8 (`adminLibrary`), AD12 (`lorekeeperLimitRequests`).
Answers used: Q20 a, Q21 changed, Q22 a, Q23 b, Q32 a, N6 b, N8 a, N10 (b, changed: the label from N10 a).

## Admin tab (`src/components/admin/lorekeeper/`)

`LorekeeperTab` (the slot from AD1) mounts five cards, each in its own `SlotBoundary` (rule 11).

| Card | Reads | Writes |
|---|---|---|
| Budget: 'Spend this month' meter (`role="meter"`), 'Questions this month' (a count only, Q22 a), 'Monthly spend limit' stepper ($5 a click, 'Resets on the 1st.'), 'When the limit is reached' (Pause the Lorekeeper / GMs only / Shorter answers), 'Email me at 80%' | `appAdmin.settings`, `adminLorekeeper.useByCampaign` (current UTC month) | `adminLorekeeper.setLimit` |
| Limits per person: 'Questions per day' ('For each player and GM. You have no limit.'), 'Internet searches per day', 'Let GMs ask for higher limits · You approve each request.' (N10 re-label) | `appAdmin.settings` | `setLimit` |
| Requests: pending requests oldest first (campaign, GM, date, reason, each asked number next to the campaign's current one); Approve with editable numbers (prefilled with the asked ones) / Decline | `lorekeeperLimitRequests.list` (`pending`, 10 a page, Show more) | `decide` |
| Use by campaign: the stacked bar and a row per campaign (questions, spend); 'Limits' opens the campaign's own numbers (questions / searches per day, books, book pages; empty = the app's number or no limit), each saved on its own | `useByCampaign`; `lorekeeperLimitRequests.forCampaign` (the owner reads it through the read-only campaign view, AD13) | `setCampaignLimits` |
| Book library: shared books ('412 pages · indexed' / 'No text yet'), the last upload's status ('Reading the PDF…' / 'Last upload failed: …'), Replace, 'Upload a book' (a key with no book yet) | `adminLibrary.list`, `adminLibrary.ingestStatus` per book | `uploadUrl`, then XHR with a progress bar, then `ingest` |

- Every settings click is one field with an optimistic update of `appAdmin.settings` (rule 12); a refusal rolls back and
  shows under the card. Decided requests hide at once and come back with the message if refused. `setCampaignLimits`
  updates `forCampaign` optimistically.
- Upload: a client first look (`application/pdf`, 20 MB) before any URL is asked for; the server decides (rule 10:
  owner-only, rate-limited URL, recorded type and size, storage id never proof). The form takes an optional title and
  the printed page number of the PDF's first page (N8 a, default 1). `ok: false` codes show their `adminMessages` text.
- Buttons are glass (`BrandButton`): `tool` steppers, `neutral` segments / Limits / Replace / Upload, `allow` /
  `deny` for Approve / Decline, `confirm` / `cancel` in the upload form.

## GM side (`src/components/config/sections/lorekeeper/limits.tsx`)

`LorekeeperLimits` (U4's slot) reads `forCampaign`. While `requestsOpen` is false it renders nothing. Otherwise:
'Lorekeeper limits', the campaign's questions and internet searches per day (and books / book pages when the owner set
them), then either the pending request ('Request sent 3 Nov · waiting for an answer', what was asked, Withdraw) or
'Ask for higher limits' (a form: four optional numbers 0..1000 and a reason up to 300 characters), and the last answer
('Last request approved / declined <date>'). Request and Withdraw are optimistic. The owner is never named. Own
error boundary.

## Outside edits (approved)

- `emailAt80` ("Email me at 80%", default true, Q32 a): `src/lib/admin/config.ts` (`LorekeeperSettings`,
  `DEFAULT_LOREKEEPER`), `convex/lib/validators/admin.ts` (stored validator widened with an optional field; the
  effective-settings `returns` validator), `convex/lib/appConfig.ts` (`settingsFrom`), `convex/adminLorekeeper.ts`
  (`setLimit` takes `{ field: "emailAt80", value: boolean }`, audited like the others), `convex/lib/lorekeeper/caps.ts`
  (`spendAlert` returns without sending or marking the month while it is false, so turning it back on can still send
  this month).
- Tests for it: `tests/convex/lorekeeper-budget.test.ts` (default on, saved off, audited), `tests/convex/spend-alert.test.ts`
  (off: nothing sent or marked; on again: sends).
- `tests/unit/admin/shell.test.tsx`: `LorekeeperTab` removed from the stub list; the now empty list got a type so it
  still typechecks.

## Decisions (recommended defaults)

- Steppers: $5 for the monthly limit, 1 for the daily counts. The campaign monthly budget (`campaignMonthlyUsd`) is not
  on the board, so it has no control here.
- The month is the current UTC month when the tab opens (the counters' month).
- The campaign's own numbers live in Use by campaign behind 'Limits' (one subscription, only while open); deleted
  campaigns have no Limits button.
- The GM side is fully hidden while the owner's switch is off, a pending request included.
- Overview's Recent changes words an `emailAt80` change with its default line ("changed a Lorekeeper setting to
  false"); a specific line is a follow-up for AU1's `overview/text.ts`.

## Tests

`tests/unit/admin/lorekeeper.test.tsx` (Budget, Limits per person, Requests, Use by campaign, Book library with a faked
XHR, the error boundary, and the GM side) plus the server tests above. Lint, typecheck, and the focused vitest files
(`--maxWorkers=2`) pass.
