# TASK-D11-N5: @ picker and links

Plan `.omc/plans/d11-notes.yaml`, tracer N5 (wave 3, depends on N3). Bead dcm-bxp.10. Status: Review (the
orchestrator's merge and wave e2e are still to run).

Title: @ picker and links - store Codex entry ids, current names, plain text for viewers who cannot see the entry,
Codex opens on the entry.

## Rules implemented (quoted from the plan)

- Q6: "An @ picker stores the Codex entry id, so links survive renames; the current name is shown; viewers who cannot
  see the entry get plain text."
- D7: "Mentions are stored in the entry text as '@[<name when written>](<codexEntryId>)' tokens (at most 10 per entry;
  the server checks each id is a codex entry of the campaign the author can see, else INVALID); a viewer who can see the
  entry gets a link with its current name, everyone else the stored name as plain text."
- B4: "'Write a <kind> and press Enter… (@ to link)'" (the placeholder is N3's; the '@' now opens the picker).

## What landed

No new Convex function (token validation is N3's `checkedText`, NOTE_MENTION_INVALID).

- `src/components/notes/mentions/index.tsx`
  - `MentionInput`: a controlled input (initial value `defaultValue`, no prop-to-state effect). Typing '@' at the start
    or after a space (N1 `activeMentionQuery`) opens a listbox of the writer's `api.codex.list` entries (GM: every
    entry; player: the entries the party knows - exactly what the server accepts) filtered by the typed prefix (name
    prefix first, then a later word's prefix, by name, at most 8; unnamed entries never). ArrowDown / ArrowUp move
    (wrapping), Enter or a click inserts the N1 token with `insertMention` and puts the caret after it, Escape closes the
    list (a second Escape is the edit's cancel). The list shows only while the input has focus; option presses keep the
    focus (so the edit row's blur-save never fires). At MAX_MENTIONS tokens the list only says 'At most 10 links in one
    entry.' and reads nothing. Enter with nothing to choose submits the trimmed text, as the stub did.
  - ARIA: the ARIA 1.1 combobox pattern - a `combobox` wrapper (`aria-expanded`, `aria-haspopup="listbox"`,
    `aria-controls`, `aria-owns`) and the input a `textbox` with `aria-autocomplete="list"`, `aria-controls` and
    `aria-activedescendant`; options `role="option"` with `aria-selected`. With nothing to choose a single disabled
    option says why ('Loading…', 'Nothing in Characters & Locations yet.', 'No match in Characters & Locations.'), so
    the active descendant always exists. The input keeps its textbox role and name ('New entry' / 'Edit entry'), which
    N3's unit and e2e tests query.
  - `EntryText`: text without tokens renders as written and subscribes to nothing; otherwise N1 `renderParts` against
    the viewer's `codex.list`: a visible entry is a `next/link` `.bj-mention` with its CURRENT name, the role (else
    'Character' / 'Location') as `title`, to `/campaigns/<id>/codex?entry=<id>`; any other token is its stored name as
    plain text (no link, no role). While the list loads, stored names show as plain text.
  - The codex list is read only by `MentionedText` (rows with tokens) and the open list (`MentionOptions`), never by a
    closed input.
- `src/components/notes/mentions/options.ts`: `pickerOptions`, `visibleRefs`, `displayName`, `roleTip`, `codexHref`.
- `src/components/notes/mentions/mentions.css`: the list in the board's paper tokens (cream #fffaf0, paper border, ink,
  the mention's gold wash and border for the active option), 44 px options.
- `src/app/(gm)/campaigns/[campaignId]/codex/page.tsx`: reads `?entry=`; once that id is in the viewer's visible list it
  selects the entry, its kind tab, the 'All' group and clears the search, adjusted during render once per link (CL7,
  React's "adjusting state when a prop changes"); an id the viewer cannot see changes nothing. The body moved into
  `CodexBoard` inside a `<Suspense>` because `useSearchParams` needs one (the Notes page does the same). No other change.

## Visual check

| Region | App shot | Board shot | Verdict |
|---|---|---|---|
| Page with mentions, 1440 | `test-results/visual/D11-N5/page-1440.png` | `test-results/visual/board/notes-page-1440.png` | Matches: `.bj-mention` gold wash with the gold underline, link text without '@' (board l.229), same Caveat ink and Fear colour. A mention of a deleted entry ('The Hooded One') is plain text (Q6). |
| Page with mentions, 390 | `page-390.png` | none (no phone board) | Links wrap with the line; no horizontal scroll. |
| Open picker, 1440 | `picker-1440.png` | not on the board (judged on its tokens) | Paper-cream list under the add row, name in Plex 600 and role line in the soft ink; active option in the mention gold with a gold left rule. |
| Open picker, 390 | `picker-390.png` | not on the board | Fits the paper column (width min(360px, 100%)), 44 px options, no horizontal scroll. |

## Evidence

- `tests/unit/notes-mentions.test.tsx`: 11 tests (pickerOptions ranking / cap / tips; typing @ opens the combobox
  listbox, arrows move `aria-selected` and `aria-activedescendant`, Enter inserts the token, Enter again submits; click
  inserts; Escape closes without cancelling, second Escape cancels; a player's picker offers only their list and 'No
  match' submits as written; editing keeps existing tokens and 'mag@ford' / '@ ' open nothing; the limit of 10; blur
  closes; EntryText: no tokens reads nothing, a renamed entry shows its current name with role tooltip and ?entry= href,
  an invisible entry is the stored name as plain text, loading shows stored names).
- `tests/unit/notes-entries-ui.test.tsx` (N3): still 9/9 with the real slot.
- `tests/e2e/notes-mentions.spec.ts`: 2 tests, both pass. (1) The GM picks an unrevealed NPC by keyboard, the link
  shows; a rename shows at once; the player's picker offers nothing until the GM marks it known, then updates live and
  the player picks it; hidden again and renamed, the player reads the stored name as plain text; known again, a link
  with the current name; clicking opens the Codex on that NPC (Characters tab, entry current, detail heading). (2) At
  390 px: 44 px options, touch pick keeps focus, no horizontal scroll, a location link opens the Codex on the Locations
  tab. Server state confirmed with `expect.poll` through a Convex client before leaving each page.
- `tests/e2e/visual/D11-N5.spec.ts`: 1 @visual test (4 shots above).

## Deviations and questions

1. The plan's e2e case is a GM page shared with everyone, read by the player. No UI shows another person's page on
   `rebuild` yet: N2's `JournalPage` answers 'Missing page' for a page outside the caller's journal, and the readers'
   views are N6 (`SharedPageView`) and N8 (`JournalView`) stubs. The e2e covers the same behaviour with each writer on
   their own page (the player's own line flips between plain stored name and live link as the GM hides, renames and
   reveals the NPC). It can switch to the shared-page case once N6 lands. The same gap affects N3's e2e test 2 (it opens
   the player's page as the GM by `?page=`), which likely fails on `rebuild` now that N2 is merged.
2. The input shows tokens as written (`@[Marlow](k57…)`) while editing; a rich editor that hides the id would need a
   contenteditable and is not in the plan.
3. The ARIA 1.1 combobox wrapper (instead of 1.2's `role=combobox` on the input) keeps the input a textbox for N3's
   tests; screen readers support both.
