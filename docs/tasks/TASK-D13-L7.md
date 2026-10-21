# TASK-D13-L7: Sidebar cards, mobile fold and the drawer over every campaign page

Plan `.omc/plans/d13-lorekeeper.yaml`, tracer L7 (wave 4). Bead dcm-bxp.82. Board: `reference/designs/project/Lorekeeper.dc.html`
(page variant: the sidebar; drawer variant: the panel over a dimmed page). Binding user answers: Q6 (Add PDF = the
local `pnpm lorekeeper:ingest`), Q7 (house rules off by default, a GM switch), Q8 (the GM's Rulings card lists open
Ask-the-GM requests), Q12 (phones: a 'Library & rulings' fold above the chat), Q13 (page and drawer), Q14 (only the GM
pins). Orchestrator decision on L6's question 3: pinning from the Rulings card resolves the ask as pinned; Dismiss
resolves it as dismissed.

Status: Review (implemented and tested in the worktree; the orchestrator merges).

## Files

| File | Role |
|---|---|
| `src/components/lorekeeper/side/index.tsx` | The slot exports `LorekeeperSide` (the three cards inside the phones' fold) and `IndexPill` (names and props of `slots.ts` kept); the How I answer card. |
| `side/library.tsx` | Library card (`lorekeeperLibrary.list` / `setEnabled`), the Add PDF help dialog, `IndexPillView` ('<N> books indexed'). |
| `side/rulings.tsx` | Table rulings card (`lorekeeperRulings.list` / `pin` / `update` / `unpin`), the GM's open asks (`lorekeeperAsks.listOpen` / `resolve`), the ruling dialog (edit, or pin for an ask) and the unpin confirm. |
| `side/optimistic.ts` | Optimistic updaters: book switch (pill and count), unpin, edit, resolve. |
| `side/side.css` | What lorekeeper.css lacks: the board's inline row styles, GM controls, asks, Add PDF help, the fold. |
| `src/components/lorekeeper/drawer/index.tsx` | `LorekeeperDrawer`: the floating pill (in an error boundary); loads the panel with `next/dynamic` on first open. |
| `drawer/panel.tsx` | `DrawerPanel`: the native modal `<dialog>` with the 440 px panel (chat header, ✕, L6's `LorekeeperChat variant="drawer"`); imports `lorekeeper.css` itself. |
| `drawer/drawer.css`, `drawer/labels.ts` | Dialog / backdrop / panel placement; the pill's two labels. |
| `src/app/(gm)/campaigns/[campaignId]/layout.tsx` | Mounts `<LorekeeperDrawer />` inside `CampaignShell`, after the page. |
| `tests/e2e/lorekeeper-side.spec.ts` | 3 tests (fake model). |
| `tests/e2e/visual/D13-L7.spec.ts` | App and board shots (sidebar 1440, drawer 1440 / 390, fold 390). |

## Behaviour

- **Library:** 'Library', the board's copy, one row per book in the server's order (spine `lk-cover-<token>`, name,
  subtitle, green 'Indexed' / red 'Off'). For the GM the pill is a `role="switch"` button (`aria-checked`, label
  '<title>: Indexed|Off'); the click flips it at once (optimistic on `list`, including `indexedCount`), an error shows
  under the card. Players see plain pills. House rules come from the server off by default (Q7). '＋ Add PDF' (GM only)
  opens 'Add a PDF': extract the text outside the project, run `pnpm lorekeeper:ingest <book> <text file>`, the book
  keys, `--prod`, re-running replaces, `--help`.
- **Index pill:** '<N> books indexed' (`booksIndexedLabel`, singular for 1) in the chat header, from the same query.
- **How I answer:** the board's three legend rows verbatim (`VERDICT_COPY`).
- **Table rulings:** '<N> pinned', the board's copy, a card per ruling (title, text, 'Pinned by the GM · Session N'
  from the server). The GM gets Edit (dialog; only changed fields go to `update`, optimistic) and Unpin (confirm
  dialog, optimistic removal). Empty: 'No rulings yet.'.
- **Asks (GM only):** above the rulings, 'Asked of you' lists open requests (oldest first): 'Asked by <character name,
  else account name>', the question and the suggested call. 'Pin a ruling' opens the ruling dialog prefilled (title =
  the question, cut to 80; text = the GM call, cut to 600), pins it from the asked answer (`fromMessageId`, plus the
  live session's id when one is running, so the card says 'Session N'), then `resolve` with the ruling id. 'Dismiss'
  calls `resolve` without one. Both remove the ask optimistically; the player's 'Sent to the GM' turns back into
  'Ask the GM' (their ask is no longer open).
- **Phones (<= 760 px, Q12):** the cards sit in a 'Library & rulings' disclosure button (`aria-expanded`, closed at
  first, 48 px) above the chat; wider screens hide the button and always show the cards. The campaign nav is the
  shell's (unchanged).
- **Drawer (Q13):** a fixed pill bottom-right ('Ask the Lorekeeper', the board's gold-on-dark look) on every campaign
  page except `/lorekeeper`, only when `lorekeeper.available` is true. Pressing it loads the panel chunk (first time
  only) and opens a native modal `<dialog>` over the dimmed page (backdrop): the 440 px panel on the right (full width
  under 760 px), the chat header (sigil, 'The Lorekeeper', subtitle, ✕ 'Close the Lorekeeper') and the chat column.
  While open the pill reads 'The Lorekeeper is open' (`aria-expanded`), and the board's copy of that pill is drawn
  left of the panel (decorative, hidden under 760 px). ✕, Escape and a click on the dim close it; focus returns to
  the pill. Moving to another page (e.g. 'Show on Combat Map' in an answer) closes it. The conversation shown is
  L6's shared selection, so reopening (or the Lorekeeper page) shows the same one.
- **Bundles (PF5):** campaign pages carry only the pill (`drawer/index.tsx`: one query, the sigil icon, Tailwind
  classes). `panel.tsx`, `lorekeeper.css`, `drawer.css` and the chat column are a separate chunk loaded on first open
  (`next/dynamic`, `ssr: false`).

## Strings not in copy.ts (UI chrome; L1 owns copy.ts)

'Ask the Lorekeeper' and 'The Lorekeeper is open' (drawer/labels.ts), 'Close the Lorekeeper', 'Library & rulings',
'Add a PDF' (+ its help text, 'Got it'), 'Asked of you', 'Asked by <name>', 'Suggested: <call>', 'Pin a ruling',
'Dismiss', 'Edit', 'Unpin', 'Edit ruling', 'Save', 'Unpin this ruling?' (+ body), 'Loading…'.

## Checks

- `pnpm lint` clean, `pnpm typecheck` clean, `pnpm tracer:guard .omc/plans/d13-lorekeeper.yaml L7` passes.
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 233 files, 5,608 passed, 1 expected fail.
- e2e (backend and `scripts/e2e-next.mjs` started by hand, ports 3197 / 3506, `E2E_REUSE_SERVERS=1`, load average
  about 50 on 16 cores): `lorekeeper-side.spec.ts` 3 passed; `visual/D13-L7.spec.ts` (E2E_VISUAL=1) passed. One
  earlier run failed once: the fake model's first answer came back as the error card ('couldn't answer just now')
  under that load; the rerun passed.
- `lorekeeper-shell.spec.ts` (L0): the 1440 test passes; **the 390 test fails by design** now: it expects the three
  card headings visible at 390, but Q12 puts them in the closed 'Library & rulings' fold. Fix at merge (L0's file,
  not in L7's owns): in that test, before `expectShell(page)`, add
  `await page.getByRole("button", { name: "Library & rulings" }).click();`.
- **Bundles (PF5):** in the e2e build, the Party page's client manifest holds only the pill's chunk (2.7 kB); the panel
  chunk (30 kB, with the chat column) and the Lorekeeper CSS (10.5 kB + 3.2 kB) are not in it and load on first open.
- **e2e setup note:** like L6's specs, both L7 specs set `LOREKEEPER_FAKE_MODEL=true` and ingest the fixture as the core
  book in `beforeAll` until L9 moves that into `scripts/e2e-setup.mjs`.

### e2e lorekeeper-side

1. GM on the Lorekeeper page: the legend's rows; core 'Indexed' as a switch; house rules 'Off' (Q7); switching core
   off shows 'Off' at once and the header pill drops by one; the player's library (no switches, no Add PDF) shows
   'Off'; switching back shows 'Indexed' on the player's open page; Add PDF opens 'Add a PDF' with the command.
2. Player: 'Do Hexes stack?' → Ask the GM → 'Sent to the GM'. GM: 'Asked by Liriel' in the Rulings card → Pin a ruling
   (prefilled question and GM call) → the ask leaves the card, the ruling shows 'Pinned by the GM', '1 pinned', and
   `listOpen` is empty; the player sees the ruling read only and 'Ask the GM' again; a second ask is dismissed (no
   new ruling); Edit changes the text on both screens; Unpin (confirm) → 'No rulings yet.' on both.
3. No pill on the Lorekeeper page. Party page: 'Ask the Lorekeeper' opens the dialog 'The Lorekeeper' (440 px panel,
   'The Lorekeeper is open'), the 'Critical hits' chip streams a 'From the rules' answer; ✕ closes and focus is on the
   pill; reopening keeps the answer; Escape closes. 390: the panel is 390 px wide, no sideways scroll; the Lorekeeper
   page's fold starts closed, opens to the cards, no sideways scroll.

## Visual comparison (test-results/visual/D13-L7)

| Shot | Board | Verdict | Notes |
|---|---|---|---|
| side-1440 | board-side-1440 | Match | Same cards, spines, pills, legend, ruling cards. The e2e library has 2 books (only the fixture core book is ingested, plus the house-rules row), the board 4. Added for the GM: '＋ Add PDF' is live, Edit / Unpin under each ruling, and 'Asked of you' with the open ask (dashed amber card, gold 'Pin a ruling'). The rulings say 'Pinned by the GM' without a session (seeded outside a session). |
| drawer-1440 | board-drawer-1440 | Match | Panel 440 px, border and shadow, header with sigil, ✕ (44 px here, 32 on the board), the stream and composer from L6, the 'The Lorekeeper is open' pill 466 px from the right. The dimmed page is the real Party page under the dialog's backdrop (board: a sketch of it). |
| drawer-390 | board-drawer-390 | Match | Full width; header, stream and composer as the board; the decorative pill is hidden (the board's sits off screen). |
| fold-390 | (none: the board hides the sidebar at 760 px) | Added (Q12) | 'Library & rulings' disclosure above the chat, open in the shot; the chat header's title now keeps the row beside the sigil and the index pill and Conversations wrap below (side.css). |

## QUESTIONS

1. `lorekeeper-shell.spec.ts` (L0) needs the one-line fold click at 390 (above). Apply at merge?
2. The pill's closed label is 'Ask the Lorekeeper' (the board only draws the open state, 'The Lorekeeper is open').
   Keep, or another wording?
3. Rulings pinned from an ask carry the live session (so the card says 'Session N') only while a session runs; between
   sessions they say 'Pinned by the GM'. Should they take the last played session instead? L6's chat Pin passes no
   session at all.
4. side.css styles the page header's title column at <= 760 px (`.lk-chat .lk-chathead-text`), because L7's index pill
   plus L6's Conversations button crushed it. That rule arguably belongs in L0's lorekeeper.css; move it there later?
5. The strings listed above are not in `copy.ts` (as L6's); move them in a later L1 pass?
