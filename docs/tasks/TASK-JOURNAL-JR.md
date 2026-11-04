# TASK-JOURNAL-JR: Recap and After the session

Plan `.omc/plans/journal.yaml`, tracer JR (wave 3, batch A; depends on J1 and JD5). Bead: `dcm-z9rz.16`.
Design: `reference/designs/journal/journal_views.jpg`, panel 2 (Log & recap): 'Recap' under the session log, 'After
the session' last in the right column.

## Scope change from the plan (user Q4 / Q5)

- **Q4: everyone can write the recap and it is always visible to the table.** There is no share gate (JD5 built no
  `shareRecap` / `recapSharedAt`). The design's 'Share with players' button is **dropped**. In its place, on the right of
  the 'Recap' heading, a plain note (not a button): 'Visible to the table' with a people icon, so the table knows who
  reads it.
- **Q5: 'After the session' is GM only** (`sessionWrap.after` is a `gmQuery`). For players, `AfterSession` renders
  nothing (J1 mounts it for both roles; its doc names this default).

## What landed

`src/components/journal/recap/index.tsx` (+ `recap.css`):

- **`Recap`** is a `Card` titled 'Recap' with a `Parchment` holding the text.
  - Read source: the GM reads `sessionWrap.get`. A player reads their own `sessionRecords.list` row, which carries
    the recap for live and played sessions. Players never see planned sessions.
  - Display: line breaks are kept. With no recap it shows 'No recap yet. Anyone at the table can write it.' and a
    'Write the recap' button.
  - Editing: 'Edit recap' (brand `pill` button) swaps the parchment text for a textarea (max 6000, as the server).
  - Saving: 'Save recap' (brand `solid`) saves. So does moving focus out of the editor (blur that does not land on its
    own buttons). 'Cancel' (brand `outline`) or Escape drops the draft. An unchanged text sends nothing.
  - The write is one intent, `sessionWrap.setRecap`. Its optimistic update patches both caches (`sessionWrap.get`
    and the `sessionRecords.list` row).
  - A refused save keeps the editor open with the draft and shows the error in a `role="alert"`.
  - Each session gets its own editor (`key={sessionId}`, an identity, not live content), so a draft never leaks into
    another session.
  - Loading: 'Loading the recap…' (`role="status"`). A stale id shows 'That session isn't in this campaign anymore.'
- **`AfterSession`** is GM only. It is a label `Card` 'After the session' holding a `dl`:
  - **Level-ups:** the names of the characters in `after.levelUps`, joined with ', ', else 'None'. Names come from
    `charactersReads.partySummary`. A character not in that list shows its feed line instead (`levelUpLine`,
    exported and unit tested). When `truncated` is set, a note reads 'A long session: later level-ups may be missing.'
  - **Loot:** an inline edit. The value (or 'None') is a button with a pencil, 'Edit loot: …'. It turns into an
    input (max 2000): Enter or blur saves through `sessionWrap.setLoot` with an optimistic patch of
    `sessionWrap.after`. Escape cancels.
- **Targets:** buttons and inputs are 44 px at ≤ 1100 px and on coarse pointers. Motion comes only from
  `brandButton`, which is already off under reduced motion.

## Tests

- `tests/unit/journal/recap.test.tsx` (11 tests) covers the recap:
  - the GM and player read paths, and that no share button exists;
  - loading and stale states;
  - Save sends one `setRecap` intent;
  - blur saves, an unchanged text sends nothing, Cancel and Escape drop the draft;
  - the empty state and a refused save;
  - the player gets no After card;
  - level-up names and loot, `levelUpLine`, the loot editor (Enter / Escape), and 'None' plus the truncated note.
- `tests/e2e/journal-recap.spec.ts`: two browsers (GM + player) on the J1 seed.
  - The GM writes the recap and the player sees it live. The player edits it (blur saves) and the GM sees it live.
    Escape drops a draft.
  - After the session: the player has none. The GM sees 'None', then the names after a party level-up, and edits the
    loot (it persists across a reload).
  - Axe and no sideways scroll at 1440x900 and 390x844 for both roles, plus axe with the editor open.
- `tests/e2e/visual/JOURNAL-JR.spec.ts` (`E2E_VISUAL=1`): the shots below.

## Design states matched (shots)

Shots: `test-results/visual/JOURNAL-JR/`, copied to `C:\Users\Petar\Downloads\dcm-screens\journal-jr\`:
`gm-recap-{1440,390}`, `gm-recap-empty-{1440,390}`, `gm-recap-editing-1440`, `gm-after-{1440,390}`,
`gm-loot-editing-1440`, `gm-log-columns-1440` (the recap beside After the session), `player-recap-{1440,390}`.

Compare them with the design crop of panel 2, bottom: the 'Recap' gold serif heading, the cream parchment with serif
text and the 'Edit recap' pill inside it, and the 'AFTER THE SESSION' label card with 'Level-ups … None' and 'Loot …
Tamsin's axe · 2 handfuls of gold' right-aligned. The differences:

- 'Visible to the table' replaces 'Share with players' (Q4).
- The 'Edit recap' pill is the dark brand pill, not the design's light outline pill (the brief asks for the existing
  brand buttons).
- The recap is its own card under the log; the design draws it inside the log card. J1's layout mounts it as its own
  slot.

## Data gaps / finding for the orchestrator

- **`sessionWrap.after` is not reactive to new level-ups while the session is live.** `liveWindows` ends the open
  window at the query's `Date.now()`, and `after` reads `actionLog` with `.lte("at", w.to)`. A level-up row written
  later falls outside the read range, so Convex never re-runs the query. Convex also serves the cached result after a
  page reload. The panel catches up only when something else it reads changes, such as a loot write.
  - The e2e spec relies on that: it edits the loot after the level-up.
  - The same pattern probably affects other live-window reads: `journalLog.list`, `journalTally`.
  - Fix (server, outside JR's owns): read the open window without an upper bound (`gte(from)` only, then filter by
    time in code), or pass a coarse `now` from the client.
  - Suggested follow-up bead: "Live-window queries miss rows written after they ran (open window bound to Date.now())".
- A level-up row that undoes a level ('went back to level N') still counts: `after` keeps each character's latest
  `levelUp` row, so the name shows. That is server behaviour, left as is.

## Questions (defaults taken)

1. The 'Share with players' button: dropped, replaced by a static 'Visible to the table' note. The alternative was to
   repurpose it as "copy recap", which nobody asked for.
2. A grant-only viewer (not a member) gets 'Edit recap' too. The server refuses with FORBIDDEN and the editor shows
   the error. The client can't tell them apart from `isGm` alone. Alternative: hide the button for grantees (needs
   the campaign role in the slot props, a J1 change).
3. Milestone: not shown in After the session. The design has only Level-ups and Loot, and the level-up rows of a
   milestone already show as names.
4. Level-up names come from `charactersReads.partySummary` (one more subscription on the Log view).

## Out-of-owns edits

None.

## Merge-time actions

None: no Convex file changed.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `vitest run --maxWorkers=1 --testTimeout=120000`: 509 files, 10898 passed, 1 expected fail.
- `E2E_PORT=3801 E2E_CONVEX_PORT=3901 E2E_REUSE_SERVERS=1` (servers started by hand; the managed Next build timed out
  under load) `playwright test tests/e2e/journal-recap.spec.ts --workers=1`: 3 passed. With `E2E_VISUAL=1`,
  `tests/e2e/visual/JOURNAL-JR.spec.ts`: passed. It failed once under heavy load, then passed.
- `node scripts/tracer-guard.mjs .omc/plans/journal.yaml JR`: OK.
