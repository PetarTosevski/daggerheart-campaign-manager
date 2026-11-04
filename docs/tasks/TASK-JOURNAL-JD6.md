# TASK-JOURNAL-JD6: Threads raised (server)

Plan `.omc/plans/journal.yaml`, tracer JD6 (bead dcm-z9rz.9). Server only; JTh renders it.

## What landed

`convex/journalThreads.ts`:

- `raised({ sessionId: string })`: `campaignQuery`, `need: "view"`, `enough: "owner"`. Returns
  `{ entryId, pageId, pageTitle, kind, state, text }[]` (`raisedThreadValidator`). `text` keeps the D7 mention
  tokens, so render it with EntryText.
- **Which lines (user Q1 / Q2).** It returns the open threads on the caller's own current journal (`currentJournal`)
  whose page is linked to the session (`journalPages.sessionId`) and is not torn out. An open thread is an open task
  or an unresolved Fear, the entry's `open` flag. Added lines on the caller's own page count, as in Notes threads (D5).
  It never returns a page from another journal: a GM page for a player, another player's page, or a page shared with
  the caller.
- **Order.** By page creation, then by entry order.
- **Errors.** A bad id or another campaign's session gives `SESSION_NOT_FOUND`. A planned session for anyone below
  `owner` (`ctx.permission`) gives the same code, because players never see planned sessions (D10 Q4). Without a
  journal, the result is `[]`. The wrapper handles anonymous (UNAUTHENTICATED) and outsider (NOT_FOUND) callers.
- **Bounded reads.** It reads the journal's pages that are not torn out (`by_journal_binned`, `take(MAX_PAGES)`),
  then the journal's open entries (`by_journal_open`, `take(MAX_THREADS)` = 500, the same cap as
  `notesThreads.threads`), and keeps the entries whose page is linked. When no linked page has `openCount > 0`, it
  skips the entries read.

Tests:

- `tests/convex/journal-threads.test.ts`: the role table; the open task and Fear in page and entry order, while
  done tasks, notes, other sessions and unlinked pages stay out; per viewer, including another player's line added
  to the owner's shared page; torn-out pages and resolved threads; `SESSION_NOT_FOUND` for a bad id, a non-session
  id, another campaign's session, and a planned session for a player; the GM reading a planned session.
- Authz area `journal-threads`: every member is ok on their own journal.

## Deviations from the acceptance text

- **`by_journal_open` instead of `by_page_order`.** Reading per linked page with `by_page_order` costs up to
  MAX_PAGE_ENTRIES (300) per page, and there is no `by_page_open` index. The journal-wide open index stays bounded
  at 500 rows, matches the Notes threads view (Q1), and needs no schema change.
- **`state` added to the row.** The bullet glyph needs it. The field is additive.

## Questions (defaults taken)

1. **Planned session for a player.** The default is `SESSION_NOT_FOUND`, consistent with `sessionRecords.list`.
   Returning `[]` instead would reveal that the session exists.
2. **More than 500 open threads.** A journal with more than 500 open threads is truncated the same way the Notes
   threads view is. It is not paged.

## Merge-time actions

- Regenerate `convex/_generated` (new module `journalThreads`).
