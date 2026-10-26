# TASK-F6-G4: Notes follow-ups

Plan `.omc/plans/followups-6.yaml`, tracer G4. Beads dcm-bxp.106, .108, .109, .111. Status: Review (the orchestrator's merge
and wave e2e are still to run).

Title: Notes - mentions as chips while editing, hide unreadable departed journals, refuse other players' journals by
URL, a Session N page per session.

## User answers (binding, from the beads)

- dcm-bxp.106: "fix with a rich editor - mentions show as name chips while editing too (contenteditable)."
- dcm-bxp.108: "hide departed journals with no page the viewer can read."
- dcm-bxp.109: "refuse - only the GM opens other players' present journals by URL; players see shared pages in the
  Shared tabs only (journalView answers NOT_FOUND for another present player's journal)."
- dcm-bxp.111: "'Every session should create its own session # page' - each session gets its own 'Session N' default
  page; no migration of default pages into later logs." Orchestrator, with the user's choice: "when a session starts
  (goes live), every journal in the campaign gets a 'Session N[: title]' log page linked to that session (idempotent:
  don't add a second one if it already exists)." The player-on-the-GM's-journal refusal (.109) was confirmed.

## What landed

### dcm-bxp.108: `notesJournals.pastJournals`

A departed journal is listed only when the caller can read at least one of its live pages (`readableCount > 0`): one
whose pages the GM tore out, or one with only Private pages left, is gone for everyone except the Private pages' owner
(who still reads them while a member). The row shape is unchanged.

### dcm-bxp.109: `notesJournals.journalView`

After the journal is found, a caller whose campaign role is not 'gm' gets NOT_FOUND unless the journal is their own or
departed (D1, computed at read time). So a player opens their own journal and Past journals only; other players'
present journals (and the GM's journal) are refused, and a journal that turns present again (rejoin, status back to
'active') is refused from then on. The GM still opens every journal. The UI needs no change: the list of present
journals was already GM-only, and a refused URL shows the slot's error line ('The journal failed to load').

Role table (tests/convex/notes-journals.test.ts):

| journalView of | anonymous | outsider | P1 | GM | P2 |
|---|---|---|---|---|---|
| P1's present journal | UNAUTHENTICATED | NOT_FOUND | ok | ok | NOT_FOUND |
| P2's present journal | UNAUTHENTICATED | NOT_FOUND | NOT_FOUND | ok | ok |
| the GM's journal | UNAUTHENTICATED | NOT_FOUND | NOT_FOUND | ok | NOT_FOUND |
| P1's journal, P1 removed | UNAUTHENTICATED | NOT_FOUND | NOT_FOUND | ok | ok |
| P1's journal, Ash dead | UNAUTHENTICATED | NOT_FOUND | ok | ok | ok |

### dcm-bxp.106: the rich entry editor (src/components/notes/mentions/)

- `MentionInput` is now a single-line `contenteditable` (`role="textbox"`, `aria-multiline="false"`, the same names
  'New entry' / 'Edit entry', the ARIA 1.1 combobox wrapper and the listbox as before). Each mention is a chip
  (`.bj-mi-chip`, `contenteditable="false"`, the board's mention gold) showing the name its token stores; the id never
  shows. Picking an option (Enter or click) replaces the typed '@query' with a chip and a space; '@' also opens the
  list right after a chip. Backspace deletes a chip whole. Enter submits the stored text (chips as
  `@[name](id)` tokens, trimmed) and clears the field; paste inserts plain text on one line; drops and Ctrl/Cmd+B/I/U
  do nothing. The 10-mention limit counts chips.
- `editor-dom.ts`: the DOM helpers (`fillEditor`, `serializeEditor`, `caretMention`, `insertChip`, `insertPlainText`,
  `placeCaret`, `countChips`). The editor's DOM is its state: React renders no children into it, so live updates never
  move the caret, and `defaultValue` fills it once in a ref callback (no effect, CL6 / CL7).
- New props (slots.ts): `autoFocus` (the edit row focuses the field with the caret at the end) and `onBlurText` (the
  edit row saves on blur; it used to read an `<input>`'s value from the wrapper's blur).
- The placeholder is `aria-placeholder` plus a `placeholder` attribute, drawn by CSS while the field is empty
  (`data-empty`).
- `entries/index.tsx` (chip click focuses `[role="textbox"]`) and `entries/row.tsx` (props above) follow.

### dcm-bxp.111: a 'Session N' page per session

`sessions.start` calls the new `addSessionPages` (convex/lib/notes.ts) in the same mutation, right after the session
goes live: every journal of the campaign gets a log page titled `sessionLogTitle(session)` ('Session N' or
'Session N: <title>'), linked to the session (`sessionId`), with the owner's default visibility (GM 'private', player
'gm') and the next tape, counted in the journal's `pageCount` (`insertPage`). Idempotent: a journal that already has a
page linked to that session, torn out included, gets none, so restarting a session (B7) or starting the live one
again adds nothing and a torn-out session page does not come back. Skipped: departed journals (frozen, D2) and full
journals (MAX_PAGES with torn-out pages, Q10); start never fails because of notes. A journal created later still gets
its default 'Session 1' linked to the live session by `ensureJournal` (D6). Migration is unchanged (no migration of
default pages into later logs). `insertPage` now takes a plain `MutationCtx` (it only reads `ctx.db`).

### Specs that followed the new field (owns extended by the orchestrator)

`notes-entries`, `notes-mentions`, `notes-sharing`, `live-notes`, `notes-a11y`: `toHaveValue` on the entry field ->
`toHaveText` (chip names instead of token strings in notes-mentions). `tests/convex/authz/notes.entries.ts`:
journalView otherPlayer and grantee NOT_FOUND. `tests/convex/perf-reads.test.ts` (PF10): p3 is measured on the
departed journal only and asserts NOT_FOUND for the GM's and p1's present journals.

## Evidence

- `tests/convex/notes-journals.test.ts`: role table with the three present-journal rows above; P2 reads P1's pages
  through `notesSharing.shared` (players tab) instead; a past journal with every readable page torn out and only
  Private left is listed for its owner only; an empty unattached journal is never listed.
- `tests/unit/notes-mentions.test.tsx`: the editor (chips, tokens on submit, arrows / Enter / click / Escape, '@' after
  a chip, a player's list, editing keeps chips, paste, the limit, blur reports the text).
- `tests/unit/notes-entries-ui.test.tsx`: the entries slot through the editor; editing a mention shows a chip and blur
  saves the token text once.
- `tests/e2e/notes-flow.spec.ts`: new test 'mentions are name chips while writing and editing' (real browser: chip,
  Backspace, edit, stored token); `write()` checks `toHaveText("")`.
- `tests/e2e/notes-journals.spec.ts`: after Ash is active again, B's open journal view and a reload are refused.
- `tests/convex/sessions.test.ts`: start gives GM, P1 and P2 one 'Session 1: The Ford' page each (visibility, kind,
  pageCount); a restart adds none; a departed journal gets none; a torn-out session page is not recreated.
- Runs: `pnpm lint`, `pnpm typecheck` clean; `vitest run --maxWorkers=4`: 282 files, 7564 passed; e2e (local stack,
  E2E_REUSE_SERVERS=1): all eleven notes specs plus visual/D11-N5, 30 passed; sessions-live, sessions-flow,
  live-sessions, session-play, 7 passed.

## Questions

None open.
