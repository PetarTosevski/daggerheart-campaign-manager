# TASK-D11-N7: Bin

Plan `.omc/plans/d11-notes.yaml`, tracer N7 (wave 3, depends on N2 and N3). Bead dcm-bxp.10. Status: Review (the
orchestrator's merge and wave e2e are still to run).

Title: Bin - tear out with the rip, 10-second Undo, torn-out pages list, restore, 30-day purge cron.

## Rules implemented (quoted from the plan)

- Q11: "Tearing out a page gives a 10-second Undo and moves it to a bin for 30 days, restorable by the owner; then an
  internal, batched, self-rescheduling cron in convex/crons.ts purges it (rule 8)."
- D2: "the GM may tear out its [a departed journal's] non-private pages into the bin (restorable by the GM, purged after
  30 days)."
- Analysis 3.2: "restore from bin: whoever tore it out, while the owner / GM still has access".
- B8: "Tear out (l.326): rip animation (two clip-path halves, scraps) and synthesised tear sound; skipped under reduced
  motion."
- Q10: MAX_PAGES 200 per journal, bin included (so restore does not check NOTE_PAGE_LIMIT again).

## What landed

### convex/notesBin.ts

Access goes only through N0's `resolvePage` / `pageAccess` / `assertAction` (canBin, canRestore from N1's action table);
counters through `bumpJournal`; the purge through `deletePageRows` and N1's `binCutoff`.

| Function | Kind | Args | Returns | Who |
|---|---|---|---|---|
| `bin` | campaignQuery | - | `{ _id, title, kind, tape, binnedAt, purgeAt, from }[]` | any member: the pages they tore out and can still restore (own journals' `by_journal_binned`, plus `by_campaign_visibility_binned` for the four shareable visibilities; each row passes `pageAccess().canRestore`) |
| `binPage` | campaignMutation | page ref | page id | owner of a present journal; the GM for a non-private page of a departed journal |
| `restorePage` | campaignMutation | page ref | null | whoever tore it out, while they can still read it |
| `purgeBinned` | internalMutation | - | null | the cron `purge torn-out journal pages`, daily at 04:23 |

- `binPage` sets `binnedAt` / `binnedBy` and subtracts the page's 1 / entryCount / openCount from its journal's
  counters; recipients stay, so a restore brings the sharing back. A template ref creates the journal first (CL6).
- `restorePage` clears both fields and adds the counters back. A page that is not torn out, or that someone else tore
  out, answers NOTE_NOT_BINNED; an unreadable one NOTE_PAGE_NOT_FOUND.
- `bin` returns `purgeAt`, not 'days left': no `Date.now()` in a query (CF10). The client shows N1
  `daysLeftLabel(binDaysLeft(binnedAt, max(now, binnedAt)))`.
- `purgeBinned`: `by_binned` range `binnedAt in [0, binCutoff(now))`, at most `PURGE_PAGE_BATCH` (25) pages and
  `PURGE_ROW_BUDGET` (400) entry + recipient rows per run; it reschedules itself (`ctx.scheduler.runAfter(0, ...)`)
  when it filled the page batch or ran out of budget mid-page. A purged page is already out of the counters.

Role table (tests/convex/notes-bin.test.ts; P1 owns a 'chosen' page shared with the GM and P2; P3 not chosen):

| Function | anonymous | outsider | owner P1 | GM (chosen reader) | P2 (chosen reader) | P3 (not chosen) |
|---|---|---|---|---|---|---|
| binPage (live page) | UNAUTHENTICATED | NOT_FOUND | ok | NOTE_FORBIDDEN_ACTION | NOTE_FORBIDDEN_ACTION | NOTE_PAGE_NOT_FOUND |
| restorePage (P1 tore it out) | UNAUTHENTICATED | NOT_FOUND | ok | NOTE_PAGE_NOT_FOUND | NOTE_PAGE_NOT_FOUND | NOTE_PAGE_NOT_FOUND |
| bin | UNAUTHENTICATED | NOT_FOUND | ok (1 row) | ok ([]) | ok ([]) | ok ([]) |

Departed journals (same file): after `members.removePlayer`, the GM tears out P1's 'everyone' page (ok, listed in the
GM's bin 'from Ash'), gets NOTE_PAGE_NOT_FOUND for the 'private' page, P2 gets NOTE_FORBIDDEN_ACTION, P1 NOT_FOUND
(not a member); the GM restores it. With the character 'dead': P1 gets NOTE_JOURNAL_CLOSED, the GM tears out the
'players' page; P1's own restore is NOTE_NOT_BINNED (P1 did not tear it out); back to 'active', the page is hidden from
the GM again, so it leaves the GM's bin and the GM's restore is NOTE_PAGE_NOT_FOUND.

### convex/crons.ts

`crons.cron("purge torn-out journal pages", "23 4 * * *", internal.notesBin.purgeBinned, {})` (not at minute 0, CD17).

### src/components/notes/bin/

- `index.tsx`: `TearOutButton` ('Tear out page' → 'Click again to tear out'; blur or Escape disarms), `TornOutPages`
  (title + tape tab, 'N days left', 'from <character>’s journal' for the GM's departed pages, 'Restore'; mounts
  `TearLayer`), `BinView` (a torn-out page read only with 'Restore page'; entries through N3's `Entries`, whose flags
  are all off on a torn-out page).
- `TearLayer`, portalled into `.bj-root` (so the `--bj-*` tokens apply): the rip frame and the role=status toast
  'Page torn out · Undo' (10 s, N1 `UNDO_MS`; Undo calls `restorePage` and reopens the page).
- `tear-store.ts`: a small `useSyncExternalStore` store, because the rip and the toast outlive the torn page's own
  components.
- `tear-sound.ts`: the board's synthesised tear (Web Audio noise through high-pass and band-pass filters), played only
  inside the second click and never under reduced motion.
- `optimistic.ts`: `binPageLocally` (the page leaves `notes.journal` and its counters, joins `notesBin.bin`) and
  `restorePageLocally` (leaves `notesBin.bin`).
- `bin.css`: the board's `bjRip` / `bjStub` / `bjScrap` keyframes and clip-path polygons (l.39-47), the tear button
  (l.135), toast and list.

## Acceptance evidence

- `pnpm vitest run tests/convex/notes-bin.test.ts`: 11 tests pass (3 role-table rows, bin listing, NOT_BINNED /
  double tear, tear-out and restore with lists and counters, template ref, 2 departed scenarios, 2 purge tests). The
  purge tests: a 31-day-old page goes with its 3 entries and its recipient, a 29-day-old one stays, a second run
  changes nothing and schedules nothing; 30 due pages plus a 450-entry page: the first run deletes 400 rows and
  schedules `notesBin:purgeBinned`; `finishAllScheduledFunctions` runs two more (both `success`) and everything due is
  gone, the 1-day-old page stays.
- Full suite: `pnpm test` 175 files, 2332 tests pass; `pnpm lint` and `pnpm typecheck` clean.
- `tests/e2e/notes-bin.spec.ts` (4 tests, 1440x900 and 390x844): the GM tears out a page (the rip frame appears, one
  AudioContext is created only after the second click), the toast's Undo brings it back and reopens it; tears it out
  again, the toast goes after 10 s, the row says '30 days left', the torn-out page opens read only, Restore brings it
  back; a player under reduced motion tears out a page the GM could read (no rip frame, no AudioContext) and the GM's
  `entries` answers NOTE_PAGE_NOT_FOUND. Every step is checked on the server with expect.poll. No horizontal scroll at
  390.

## Visual (tests/e2e/visual/D11-N7.spec.ts, E2E_VISUAL=1)

| Region | Shots | Board | Verdict |
|---|---|---|---|
| Rip frozen at 600 ms | `test-results/visual/D11-N7/tear-1440.png`, `tear-390.png` | `notes:tear` (`test-results/visual/board/notes-tear-1440.png`) | Matches the board's polygons, keyframes, scraps and tear button. The board shot itself shows the page before the tear. |
| Toast | `toast-1440.png`, `toast-390.png` | not on the board | Board tokens (card, accent button), 44 px Undo |
| Torn-out pages | `bin-1440.png`, `bin-390.png` | not on the board | Index-column style, struck title, tape tab, 44 px targets at 390 |
| Torn-out page | `bin-page-1440.png`, `bin-page-390.png` | not on the board | Paper with tape, read-only entries, 'Restore page' |

Deliberate deviations: the rip is a fixed overlay with two clones of the paper (the page is already gone underneath
and the next page shows through as the stub fades), where the board swaps the paper column. The bin, toast and torn-out
page view are additions (Q11).

## QUESTIONS

1. When the GM tears out a departed page and the player then comes back (rejoin or 'active'), the GM can no longer
   read it, so nobody can restore it and it waits for the purge. The owner sees it in no list. That follows the rule
   "whoever tore it out, while they still have access". Should the owner be able to restore it in that case?
2. The e2e covers "a player who could read the page loses it" with a player's 'gm' page torn out by its owner (the GM
   loses it). No GM page can be made readable by players yet (visibility is N6). N9's flow should repeat it with a GM
   page shared with everyone.
3. Optimistic updaters live in `src/components/notes/bin/optimistic.ts`, not in `src/lib/optimistic/notes-bin.ts`,
   because N7 owns no file under src/lib.
