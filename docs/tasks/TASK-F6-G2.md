# TASK-F6-G2: Lorekeeper polish

Status: Review. Plan: `.omc/plans/followups-6.yaml`, tracer G2. Beads: dcm-bxp.82.4, .82.5, .82.10, .82.8, .82.2. The
user answers of 2026-10-22 in the beads are binding.

## dcm-bxp.82.4: a simple books note for GMs

- `copy.ts`: `ABOUT_BOOKS_LABEL` ('About books'), `ABOUT_BOOKS_TITLE` and `ABOUT_BOOKS_NOTE`, the user's text verbatim:
  "Your server's admin adds rulebooks once for everyone; switch books on/off for this campaign here; use House rules
  (notes) for table rules." `ADD_PDF_LABEL` is gone.
- `side/library.tsx`: the GM's '＋ Add PDF' button is now 'About books'. It opens a dialog with the note and 'Got it',
  and no commands. Every GM sees the same note; there is no admin role. Players see no button. The help styles that
  only the old dialog used (`lk-steps`, `lk-code`, code) are removed from `side.css`.
- `docs/lorekeeper.md` keeps the technical how-to (ingest commands, `--prod`, text outside the repo, renumbering to
  printed pages) and now describes the note.

## dcm-bxp.82.5: a separate message when internet search couldn't run

- `copy.ts`: `WEB_UNAVAILABLE` = "I couldn’t find this in your books, and couldn’t search the internet just now. Try
  again later or ask your GM."
- `lorekeeperRun.ts`, for an Opus 'none' with search on:
  - the web pass not reserved (no budget left): `WEB_UNAVAILABLE`, and no web request is made;
  - the web pass failed with a `ClaudeFailure` other than `no answer` (HTTP error, timeout, network, refusal, stream
    error): `WEB_UNAVAILABLE`;
  - `no answer` (the call completed, but there was no usable result: no search run, or a search with no usable
    result, or a `web_search_tool_result_error`): `WEB_MISS`, as before;
  - `webPass` sent nothing (a blank question; `ask` never allows one): `WEB_UNAVAILABLE`, with the reservation
    released.
- For an Opus 'unclear', every failure still keeps the Opus answer unchanged (no new message).
- A mid-answer failure keeps the earlier finished answer, as built (user answer 1).
- `answer/model.ts`: `isBooksOnlyMiss` also knows `WEB_UNAVAILABLE`, so the card shows only 'Ask the GM'.

## dcm-bxp.82.10: notice in the box's spot, one 'not set up', a remove-book command

1. **The blocked notice.** While asking is off (a cap, not set up), `Composer` renders the notice first, before the
   chips and the box, as the composer's only `role="alert"`, and the box's `aria-describedby` points at it. The
   composer gets `data-blocked`, and `chat.css` gives it `order: -1`, so it sits above the conversation with a bottom
   border.
   - Measured before the change, on the e2e build, with one answer in the column:
     - at 1440x900 the notice was at y=891-929, past the bottom of the screen;
     - at 390x844 the chat column starts at y=531 and the composer at y=1118, so even the box's own spot (y=1233) was
       below the first screen.
   - A notice that stays at the column's bottom can't be seen without scrolling at 390, so the composer moves up while
     it is blocked. The e2e test below checks that the notice is fully inside the viewport at both sizes.
   - Other notices (a failed ask, the conversation full, questions left) stay under the toggles. The composer stays in
     place for them.
2. **A conversation made private while viewed** keeps the banner and 'New conversation', as built (no change).
3. **'Not set up' once.** The empty conversation's intro shows only the sigil when the Lorekeeper is unavailable. The
   composer's notice is the one place that says it.
4. **`pnpm lorekeeper:ingest <book> --remove`.**
   - `scripts/lorekeeper-ingest.mjs`:
     - `--remove` (and `--yes`) in `parseArgs`. With `--remove` there is no text file and none of `--dry-run`,
       `--pages`, `--title`, `--subtitle`, `--cover`; `--yes` alone is refused.
     - `removeBook(run, bookKey, confirm, target, log)` runs the steps.
     - `targetLabel(opts)` names the target in the question.
     - `parseRunOutput` now also reads a printed `null`.
   - The run:
     1. finds the book (`findBook`);
     2. asks "Remove "<title>" (<key>, <n> chunks) and every campaign's switch for it from <target>? Type <key> to
        confirm:". Anything but the key cancels. Without a terminal it refuses unless `--yes` is given;
     3. deletes the chunks (`clearChunks`, repeated), the campaigns' switches (`clearSwitches`, repeated with a
        cursor), then the book row (`deleteBook`).
   - `convex/lorekeeperLibrary.ts`, three internal functions:
     - `findBook({ bookKey })`: `{ bookId, title, chunkCount }` or null.
     - `clearSwitches({ bookId, cursor })`: pages through `campaigns`, 200 at a time, and deletes each campaign's
       switch row through the `by_campaign_book` index. `lorekeeperLibrary` has no index on `bookId`, and
       `convex/tables/lorekeeper.ts` isn't this tracer's, so the walk goes by campaign: no unindexed query.
     - `deleteBook({ bookId })`: refuses (`INVALID`) while chunks are left. An absent book returns
       `{ deleted: false }`.
   - No public function changed or was added, so the authorization matrix is unchanged. The library test still checks
     that `lorekeeperLibrary` exposes only `list`, `pageText` and `setEnabled`.
   - `docs/lorekeeper.md`: a 'Removing a book' section.

## dcm-bxp.82.8: e2e spec cleanup

- `lorekeeper-chat.spec.ts`, `lorekeeper-side.spec.ts`: `const expect = baseExpect.configure({ timeout: 20_000 })`
  replaces the statement that changed nothing. Their `beforeAll` blocks that set `LOREKEEPER_FAKE_MODEL` and ingested
  the mini-book are gone, and the header says to rerun `pnpm e2e:setup`, which does both since L9.
- `lorekeeper-shell.spec.ts`: a 120 s test timeout and a 20 s expect timeout. The stale "L0 has no Lorekeeper
  functions yet" line is gone.
- Not done: `tests/e2e/visual/D13-L6.spec.ts` and `D13-L7.spec.ts` have the same two problems, but they are not in
  G2's `owns` (see QUESTIONS).

## dcm-bxp.82.2: webPass reports progress; the run's duplicate request is gone

- `convex/lib/lorekeeper/web.ts`: `webPass(question, rulings, signal?, books?, onProgress?)`. `onProgress` gets
  `{ prose, web }` (the parser's snapshot) after every text delta and citation.
- `lorekeeperRun.ts`: `streamWeb` and its copy of L8's request (`requestBody` with the empty campaign-data block,
  `max_uses` and blocked domains, the tool-result loop) are deleted. The run calls `webPass` with the Stop signal and
  an `onProgress` that shows the pass once it has a web result, and otherwise only ticks the heartbeat.
- The request is unchanged. The web tests (body, rulings first, no book text, no campaign data, live streaming,
  Stop, costs) pass through `webPass` now.

## Tests

- `tests/unit/lorekeeper/copy.test.ts`: `WEB_UNAVAILABLE` differs from `WEB_MISS`; the About books label and note,
  with no `pnpm` in them.
- `tests/unit/lorekeeper-ui/model.test.ts`: `WEB_UNAVAILABLE` is a miss, with or without parts.
- `tests/unit/lorekeeper-ui/components.test.tsx`:
  - the blocked notice is the composer's first child and only alert, before the chips, and the box points at it;
  - `data-blocked` is set;
  - other notices stay last, with no `data-blocked`.
- `tests/unit/lorekeeper-ui/books-and-setup.test.tsx` (new):
  - a GM's 'About books' opens the note with no command; a player has no button;
  - `ChatView` with `available: false` says 'not set up' once (the notice), with no intro text; when available, the
    intro shows.
- `tests/convex/lorekeeper-web.test.ts`:
  - 'none' plus a web HTTP 500, 429 or 529 gives `WEB_UNAVAILABLE`. No text shows before it, the cost is settled,
    and the log names the reason.
  - 'none' with no budget left for the web pass gives `WEB_UNAVAILABLE` with no web call.
  - 'unclear' plus a web HTTP error keeps the Opus answer.
  - `webPass`'s `onProgress` gets the prose first, then the cited result.
- `tests/convex/lorekeeper-library.test.ts`:
  - `removeBook` on convex-test asks once, then deletes the chunks, both campaigns' switches and the row. Another
    book and its switches stay, and the library drops the removed book.
  - A refused confirmation or an absent book removes nothing.
  - `deleteBook` refuses while chunks are left and is idempotent.
  - `clearSwitches` returns a cursor.
  - `parseArgs --remove` and `parseRunOutput` of `null`.
- e2e:
  - `lorekeeper-side.spec.ts`: 'About books' shows the note and no command; the player has no button.
  - `lorekeeper-chat.spec.ts`, a new test:
    - with a campaign budget of $0, the cap notice is inside the viewport at 1440x900 and at 390x844, with an answer
      in the column, and the box is disabled;
    - with the fake model off, in a new conversation, 'not set up' appears once (the notice, inside the viewport at
      both sizes) and the intro text is absent.

## Checks

- `pnpm lint` and `pnpm typecheck` clean.
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 283 files, 7,576 passed, 1 expected fail.
- e2e: the backend and `scripts/e2e-next.mjs` were started by hand on ports 3180 / 3472 and run with
  `E2E_REUSE_SERVERS=1`, at a load of about 15 to 32.
  - `lorekeeper-chat` (3 tests), `lorekeeper-side` (3) and `lorekeeper-shell` (2) passed.
  - In the first run, while the full vitest suite ran beside it, one answer in the chat spec's 390 px test ended as
    'couldn't answer' on the books-only Hex question, a path G2 did not change. The chat spec passed on its own
    (3 of 3).
  - Also run, though not G2's: `lorekeeper-flow` (3) passed. Its axe-and-keyboard test lost one Enter on the drawer
    pill under load once, then passed alone. The flow spec's cap assertions (the alert inside the composer, the box
    disabled) still hold.
- `pnpm tracer:guard .omc/plans/followups-6.yaml G2` passes.
