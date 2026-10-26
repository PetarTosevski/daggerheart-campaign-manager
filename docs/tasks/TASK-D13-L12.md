# TASK-D13-L12: Process follow-ups - the retry status starts with the retry, a note on an early Stop, the kept pass writes out live

Status: Review. Plan: `.omc/plans/d13-lorekeeper.yaml`, tracer L12 (depends on L11). Binding: the three user answers
of 2026-10-22 in the plan entry.

## What the reader sees

| First pass | Search | Retry | Phase row, in order | What writes out live |
|---|---|---|---|---|
| rules | any | - | books | the first pass |
| unclear / none | any | rules | books -> retry | the retry |
| unclear / none | off | unclear | books -> retry | the retry (it is final) |
| unclear / none | off | none | books -> retry | nothing; `BOOKS_ONLY_MISS` appears at the end |
| unclear / none | on | unclear | books -> retry -> web | the kept book answer appears as the web pass starts, with 'Searching the internet…' under it; the web part writes out under it once the pass has a result |
| unclear / none | on | none | books -> retry -> web | the web answer, once the pass has a result; a miss shows `WEB_MISS` at the end |

Shown text only ever grows: nothing is shown and later replaced.

## 1. The retry phase starts with the retry

- `flow.ts`: `phaseForStep` is replaced by `phaseForPass(pass)`: `primary` gives `books`, `retry` gives `retry`, and
  `web` gives `web`.
- `lorekeeperRun.ts`: the first pass's verdict line no longer touches the phase. `retry` is written only after the
  Opus pass is reserved, and `web` only after the web pass is reserved. The run awaits the phase patch
  (`AnswerWriter.setPhase` returns the flush) before the pass's request goes out. A retry skipped for budget never
  shows 'Checking again…'.

## 2. A note on an early Stop

- `copy.ts`: `STOPPED_EARLY_NOTE` = "Stopped before an answer was ready. Ask again to get one."
- The note is stored as the row's `text`, with no parts, when a stopped answer has no text:
  - `finalize` stores it for a `stopped` outcome with empty text (a Stop during the hidden first pass).
  - `finalize` also stores it for a stopped row whose run then ended in an error.
  - `release` stores it for a row stopped before its run started.
- The `stop` mutation still writes no text. So a Stop during a hidden retry still ends with the first pass's
  answer, and the card never shows the note first and then replaces it.
- The card (`answer-card.tsx`) shows the note under 'Stopped.' with no actions (`model.ts` `isStoppedEarly`).
  The row is not `done`, so it never reaches the model's history.

## 3. The kept pass writes out live

- `flow.ts` `streamsLive(pass, verdict, webSearch)` is true for a book pass when
  `nextStep(...) === "done"`. That is a first-pass 'rules', a retry 'rules', or a retry 'unclear' with search off.
  - A retry 'none' with search off is false: `BOOKS_ONLY_MISS` replaces that answer.
  - A retry 'unclear' or 'none' with search on is false: the web pass follows.
  - The web pass is false here: the run decides it by its results.
- `AnswerWriter` changes:
  - `show(view)` writes a kept pass's text and parts. `tick()` counts hidden progress for the heartbeat.
  - A view whose text does not extend the shown text keeps the shown text (the parts still update).
  - `shown` is what a Stop keeps.
- The web pass streams.
  - The run carries its own copy of L8's request: the question and the rulings only, the empty campaign-data block,
    `max_uses` 3 and the blocked domains. `webPass` in `convex/lib/lorekeeper/web.ts` has no progress callback and
    that file is not this tracer's, so the run builds the same request through `requestBody`.
  - Its text is shown only once the parser has at least one web result. Before that, a miss is still possible.
  - For 'unclear', the kept book answer (with `checkedAgain`, via the new `appendAnswer.checkedAgain`) is written
    with the `web` phase as the pass starts. The web prose is then appended as `book + "\n\n" + web`, exactly the
    stored final text.
  - For 'none', the web answer writes out.
- A Stop keeps what is shown (a live pass's text so far, or the book answer plus any web part). Otherwise it keeps
  the best finished answer (the first pass's during a hidden retry, the retry's during a 'none' web pass).
  Otherwise it stores the note.
- `lorekeeper.listMessages` no longer blanks in-flight `retry`/`web` rows. The run writes text only for a kept pass,
  so the row is the view.
- The card shows the 'Searching the internet…' status (the same polite live region markup) under a kept book answer
  while `phase` is `web`.

Unchanged: costs, caps and reservations (every pass is reserved and settled as before, a stopped pass included),
the heartbeat, the watchdog, the D5 log line and rule 9 for programming errors.

## Tests

- `tests/unit/lorekeeper/phase.test.ts`: the walk per path (phases set as passes start, which pass writes out, a web
  miss shows nothing), `streamsLive` for every pass, verdict and search value, `phaseForPass`, and the note text.
- `tests/unit/lorekeeper-ui/components.test.tsx`:
  - The early-Stop note with no actions.
  - The kept book answer in the `web` phase with 'Searching the internet…' under it, then the final card.
  - A live retry with no status row.
- `tests/unit/lorekeeper-ui/model.test.ts`: `isStoppedEarly`.
- `tests/convex/lorekeeper-chat.test.ts` (fetch stubbed):
  - The phase stays `books` after the first 'unclear' verdict line. It is `retry` when the Opus request goes out.
    A retry 'rules' writes out live under `retry`, and the text only grows.
  - With search off, a retry 'unclear' writes out live with its GM call.
  - With search on, a retry 'unclear' stays hidden (row and `listMessages`). The web pass then shows the book answer
    first, and the text only grows.
  - A Stop during a hidden retry keeps the first answer. A Stop during a live retry keeps the retry's text.
  - A Stop during the first pass stores the note.
  - A row stopped before its run started gets the note from `release`.
  - `listMessages` returns the kept text in the `web` phase.
  - A books-only miss never shows text before it ends.
- `tests/convex/lorekeeper-web.test.ts`:
  - unclear + web: the row holds the book answer when the web request goes out, the web part writes out live under
    it (gated stream), and the text only grows.
  - none + web: nothing shows before the result, then the web answer writes out.
  - A web miss goes from empty straight to `WEB_MISS`.
  - A Stop during the web pass shows and keeps the book answer.
  - With the e2e fake model, the Hex question walks `books -> retry -> web -> done`. No text shows before `web`, the
    first text is the book answer, and the text only grows.
- `tests/e2e/lorekeeper-chat.spec.ts`: the MutationObserver now records the events in order (each new phase text,
  then the first text of an in-flight card) and every card text that does not extend the previous one.
  - Hex with search on: books -> retry -> web, then text, with no swaps.
  - Hex with 'Books only' (390 px test): books -> retry, then text (the live retry), with no swaps.

## Not changed

`convex/lib/claude.ts`. Its fake web reply sends its citation after the text, so in the e2e run the web part appears
in one step when the citation arrives, not word by word. With the real API, citations arrive while the text streams.
