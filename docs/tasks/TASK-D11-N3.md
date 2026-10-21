# TASK-D11-N3: Entries

Plan `.omc/plans/d11-notes.yaml`, tracer N3 (wave 2, depends on N0 and N1). Bead dcm-bxp.10. Status: Review (the
orchestrator's merge and wave e2e are still to run).

Title: Entries - own and added entries, bullet types and quick keys, states, star, edit, move, delete, migrate, author
colour and suffix, KEY legend.

## Rules implemented (quoted from the plan)

- Q3: "Only the owner edits a page. The GM and any player who can read a page can ADD entries to it. An added entry has
  a different colour and ends with '- <author>': the author's character name for a player (fallback account name),
  'GM' for the GM. Assumed defaults: an author edits and deletes their own added entries; the page owner can delete any
  added entry but not edit it; an added entry is visible to whoever can read the page."
- D5: "Added entries: text edit by the author; delete by the author or the page owner; bullet cycle by the owner or the
  author; star and order by the owner only; migrated copies keep their author."
- D2: "A departed journal is frozen: nobody adds or edits entries, not even its owner."
- D7: "Mentions are stored in the entry text as '@[<name when written>](<codexEntryId>)' tokens (at most 10 per entry;
  the server checks each id is a codex entry of the campaign the author can see, else INVALID)". The acceptance names
  the code: NOTE_MENTION_INVALID.
- Q7: "Hope / Fear bullets are labels only (they never touch party Hope or GM Fear)."
- Q10: MAX_PAGE_ENTRIES 300, MAX_JOURNAL_ENTRIES 5000, TEXT_MAX 500.
- B4: "task • / event ○ / note – / idea ! / Hope ✦ / Fear ☠ with the board's tooltips; task open -> done (×) ->
  migrated (>) -> scheduled (<) -> struck -> open; others open <-> resolved; ★; ✎ or double-click edit (Enter / Escape /
  blur); ↑; × (no confirm); 'Bullet type' chips; 'Write a <kind> and press Enter… (@ to link)'; quick keys
  '* . o - ! + ^' + space."
- B6: "first later page of the same kind, else a new page ('Session <n>' / '<title> (cont.)'); open tasks copied as new
  open entries (author kept, D5), originals migrated; target opens." D6: "migration to a new log page uses the board
  title and no link."
- B3 (Migrate part): "'➜ Migrate open tasks' (disabled without open tasks; tooltips 'Copy open tasks to “<t>” and mark
  them > here' / 'Copy open tasks to a new page and mark them > here')"; empty lines per kind; KEY.

## What landed

### convex/notesEntries.ts (all `campaignQuery` / `campaignMutation`, `need: "view"`)

Access goes only through N0's `findPage` / `resolvePage` / `entryAccess` / `assertAction`; next states, open threads,
migration, labels and limits come from N1. Every write is one intent and updates the page and journal counters in the
same mutation (`bumpCounts`).

| Function | Args | Returns | Who (journal not departed) |
|---|---|---|---|
| `entries` | page ref | `{ kind, canAdd, canArrange, migrateTarget, entries[] }`, each entry with kind, state, star, text, order, open, added, authorLabel, canEdit, canCycle, canDelete, canStar, canMove | any reader; a template ref before the journal exists answers an empty page |
| `add` | page ref, kind, text | `{ entryId, pageId }` | any reader (template ref creates the journal) |
| `setText` | entryId, text | null | the entry's author |
| `cycle` | entryId | `{ state }` | page owner or entry author |
| `toggleStar` | entryId | `{ star }` | page owner |
| `moveUp` | entryId | null | page owner |
| `remove` | entryId | null | entry author or page owner |
| `migrateOpen` | page ref | `{ pageId, created }` | page owner |

Role table (tests/convex/notes-entries.test.ts; P1 owns a 'gm' page holding P1's task and a task the GM added):

| Function | anonymous | outsider | owner P1 | GM (reader) | P2 / P3 (cannot read) |
|---|---|---|---|---|---|
| entries | UNAUTHENTICATED | NOT_FOUND | ok | ok | NOTE_PAGE_NOT_FOUND |
| add | UNAUTHENTICATED | NOT_FOUND | ok | ok | NOTE_PAGE_NOT_FOUND |
| setText (owner's) | UNAUTHENTICATED | NOT_FOUND | ok | NOTE_FORBIDDEN_ACTION | NOTE_ENTRY_NOT_FOUND |
| setText (GM's added) | UNAUTHENTICATED | NOT_FOUND | NOTE_FORBIDDEN_ACTION | ok | NOTE_ENTRY_NOT_FOUND |
| cycle (owner's) | UNAUTHENTICATED | NOT_FOUND | ok | NOTE_FORBIDDEN_ACTION | NOTE_ENTRY_NOT_FOUND |
| cycle (GM's added) | UNAUTHENTICATED | NOT_FOUND | ok | ok | NOTE_ENTRY_NOT_FOUND |
| toggleStar | UNAUTHENTICATED | NOT_FOUND | ok | NOTE_FORBIDDEN_ACTION | NOTE_ENTRY_NOT_FOUND |
| moveUp | UNAUTHENTICATED | NOT_FOUND | ok | NOTE_FORBIDDEN_ACTION | NOTE_ENTRY_NOT_FOUND |
| remove (owner's) | UNAUTHENTICATED | NOT_FOUND | ok | NOTE_FORBIDDEN_ACTION | NOTE_ENTRY_NOT_FOUND |
| remove (GM's added) | UNAUTHENTICATED | NOT_FOUND | ok | ok | NOTE_ENTRY_NOT_FOUND |
| migrateOpen | UNAUTHENTICATED | NOT_FOUND | ok | NOTE_FORBIDDEN_ACTION | NOTE_PAGE_NOT_FOUND |

Plus: a chosen player (recipient of a 'chosen' page) reads and adds; a player who is not chosen, and the GM when not
ticked (D4), get NOTE_PAGE_NOT_FOUND. Any write on a departed journal (character dead, or player removed) answers
NOTE_JOURNAL_CLOSED (the removed player gets NOT_FOUND from the wrapper).

Author labels: 'GM' when the author is the campaign's GM; else the name on the sheet of `authorCharacterId` (the
author's current journal character when they wrote it), else the account `name`, else 'Player' (N1 `authorLabel`).
Account names do not fall back to the email prefix, so no part of an email reaches other players.

Mentions: each token id must normalise to a `codexEntries` id of this campaign; `permissionFor` on the `codexEntry`
resource with edit (the GM, or an edit grant) accepts any, view accepts only entries the party knows (what `codex.list`
shows players).

### UI (src/components/notes/entries/)

- `index.tsx`: `Entries` (rows, empty line per kind, the 'Bullet type' radiogroup with `aria-checked` only and arrow
  keys, the add row through the mentions slot `MentionInput` with N1 quick keys and placeholder, a refusal line, KEY)
  and `MigrateButton` (owner only; disabled without open tasks; N1 `migrationTip`; opens the target with `onPage`).
- `row.tsx`: one entry: bullet (N1 glyph, colour, glow, `bulletTip` as title and aria label; `aria-disabled` for readers
  who may not cycle), ★ (inside the text), text through `EntryText`, added entries in `bj-added` ending ' - <author>',
  ✎ / double-click edit (Enter or blur saves once, Escape cancels), ↑ (disabled on the first row), ×; each action only
  when its flag allows; search highlight (`bj-hit`) with N1 `matches` over the plain text.
- `use-entries.ts`: the query and the six mutations with their optimistic updates; `pageRefOf` (no `?page=`: the first
  default page).
- `entries.css`: the board's remaining inline styles and the 390 px layout.
- `src/lib/optimistic/notes-entries.ts`: updaters for add, setText, cycle, toggleStar, moveUp and remove over every
  loaded `entries` result (`getAllQueries`), with N1 `nextState` / `isOpenThread`. An optimistic row has no actions
  until its real id arrives.

## Visual check

| Region | App shot | Board shot | Verdict |
|---|---|---|---|
| Page, 1440 | `test-results/visual/D11-N3/page-1440.png` | `test-results/visual/board/notes-page-1440.png` | Matches: same sample lines, glyphs, colours, glow, dimmed / struck states, ★ placement, chips, add row and KEY. Deviations: an added GM entry in the blue-green `bj-added` ink with ' - GM' (Q3, not on the board); the mention in line 1 renders as plain text (N5's EntryText stub); title input, meta, Tape and the tape title belong to N2 (stub shows 'Journal'), the sharing chip to N6, Tear out to N7. |
| Rows on hover, 1440 | `rows-hover-1440.png` | board (hover not shot) | ★ ✎ ↑ × appear on hover / focus as on the board. |
| Page, 390 | `page-390.png` (`rows-hover-390.png` lost the hover when the viewport changed; the 390 e2e test checks the hovered actions' 44 px size) | none (board has no phone layout) | One column, no horizontal scroll, 44 px bullets, chips and actions; actions on a line under the text, shown on hover / focus with a pointer and always on touch. |

## Evidence

- `tests/convex/notes-entries.test.ts`: 24 tests (11 role-table rows, chosen / not chosen / GM not ticked, labels for
  'GM', a character and 'Player', author edit / delete and owner delete, reader star / move / migrate, departure by
  death and by removal, template ref, the task cycle and open threads, star / move / trim / length, mentions, caps,
  Hope / Fear change neither the campaign (Fear) nor any character (Q7), migration to a new page and to a later page);
  counters checked against the rows after the operations.
- `tests/unit/notes-entries-ui.test.tsx`: 9 tests (loading and empty line; two quick clicks on a task bullet send two
  intents and show '>' at once (CL4); '^ ambush' adds a Fear; radiogroup; ' - GM' in the added colour; a reader sees the
  add row and no owner controls; star / move / edit / delete; search highlight; Migrate).
- `tests/e2e/notes-entries.spec.ts`: 3 tests (GM flow incl. migrate, confirmed on the server with `expect.poll`;
  player + GM on the player's page; 390 px). `tests/e2e/visual/D11-N3.spec.ts`: 1 @visual test.

## Deviations and questions

1. The e2e 'a player opens a GM page shared with everyone and adds an entry that shows " - <character>"' needs N6's
   sharing (no public function sets visibility before N6). The e2e covers the GM adding to the player's 'gm' page
   (' - GM' for both); the player-on-an-everyone-page case and the character label are covered in the Convex test. The
   e2e can switch to the board's case once N6 lands.
2. N0's `notes/page.tsx` loads Caveat with `weight: ["500", "700"]`; Google serves the same variable file for both
   weights and Turbopack's `next build` fails ("next/font/google queries have exactly one entry"), so `pnpm test:e2e`
   cannot build on rebuild as is. For these runs the line was changed locally to
   `Caveat({ subsets: ["latin"], variable: "--font-caveat" })` and reverted before the commit; the fix belongs to N0's
   file (orchestrator).
3. The default pages share one `createdAt`, so migrating from a default page never finds a "later" default page and
   creates '<title> (cont.)' (the board behaves the same).
4. `entries` returns an object for a template ref before the journal exists (`entries: []`, plus kind and flags) rather
   than a bare `[]`, so the UI knows the empty line and that the caller may write.
