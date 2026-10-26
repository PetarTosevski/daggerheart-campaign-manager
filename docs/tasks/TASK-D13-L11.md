# TASK-D13-L11: Think before showing - clear answers stream, uncertain ones wait for the final check with a visible process

Status: Review. Plan: `.omc/plans/d13-lorekeeper.yaml`, tracer L11 (depends on L10). Bead dcm-bxp.82.1.

The user asked for this on 2026-10-22, and the decision is binding: "show clear answers immediately, hold uncertain
answers until final model check, show the process searching... checking w stronger searching the internet".

## What the reader sees

| First pass verdict | Search | Answer row while it runs | Then |
|---|---|---|---|
| rules | any | 'Searching your books…', then the text streams as before | done |
| unclear / none | off | 'Searching your books…' -> 'Checking again with a stronger model…' | the retry's answer (or the books-only miss) appears once |
| unclear / none, retry 'rules' | on | as above | the retry's answer appears once |
| unclear / none, retry unclear / none | on | ... -> 'Searching the internet…' | the final answer appears once (the L10 rules) |

A first pass whose verdict line hasn't arrived yet shows nothing. If the line never comes, the pass is held and the
parser's fallback verdict decides the next step.

## The phase field

- `lorekeeperMessages.phase?`: `books | retry | web | done` (`answerPhaseValidator`, in
  `convex/lib/validators/lorekeeper.ts`). It is optional and widen-only, and an older row without it reads as
  `books`. `ask` inserts `books`. `finalize` and `stop` set `done`.
- `lorekeeper.listMessages`: the `messageView` returns validator widens with `phase?`. For an in-flight row in
  `retry` or `web`, `toMessageView` also blanks `text`, `parts` and `checkedAgain`. This is defence in depth: the run
  never writes them there. Players and the GM read the same row, so they see the same phase.

## The run (`convex/lorekeeperRun.ts`)

- `AnswerWriter` starts hidden.
  - In the first pass, the verdict line decides once. `streamsLive("primary", "rules")` calls `show()`, and the text
    streams as in L3.
  - Any other verdict calls `setPhase(phaseForStep(nextStep(...)))`, which sets `retry`.
  - While the writer is hidden, a snapshot counts only as progress. Every `HEARTBEAT_MS` (10 s) an
    `appendAnswer({ touch })` moves `updatedAt`, so the watchdog sees a long hidden retry as alive. The Stop check
    still runs every `PATCH_MS`.
- `appendAnswer` takes `phase?` and `touch?`. The old `restart` arg is gone: no retry text is ever written mid-run,
  so it has nothing to clear.
- The phase moves to `retry` before the retry is reserved and to `web` before the web pass is reserved.
  `checkedAgain` becomes true only when the retry finishes.
- Stop:
  - During a live 'rules' answer, the text so far is kept (as before).
  - Otherwise the best finished answer is kept: the first pass's while the retry runs, the retry's while the web pass
    runs.
  - Without a finished answer, the row ends stopped with no text. A hidden partial is never kept.
  - `finalize` writes the kept answer into the stopped row.
- Costs, caps and reservations are unchanged. Each pass is reserved and settled as before, a stopped pass included.

## The UI

- `src/lib/lorekeeper/flow.ts` adds `AnswerPhase`, `streamsLive(pass, verdict)` and `phaseForStep(step)`.
- `src/lib/lorekeeper/copy.ts` adds `RETRY_THINKING_TEXT`, `WEB_THINKING_TEXT` and `PHASE_TEXT`.
- `ThinkingRow({ phase })` in `answer-card.tsx`:
  - The phase text sits in `role="status" aria-live="polite" aria-atomic="true"`. The region stays mounted while the
    phase changes, so each step is announced once.
  - The dots are `aria-hidden` and already static under `prefers-reduced-motion` (lorekeeper.css). The text changes
    in place, with no animation.
- `AnswerCard` shows `ThinkingRow phase={answer.phase}` while an in-flight answer has no text.

## Tests

- `tests/unit/lorekeeper/phase.test.ts`: the phase sequence for each verdict path (rules; unclear/none with the
  retry settling it or search off; still unclear/none with search on), `streamsLive` and `PHASE_TEXT`.
- `tests/unit/lorekeeper-ui/components.test.tsx`:
  - The phase text sits in one polite live region that changes in place from retry to web to the final card.
  - A stop without a finished answer shows only 'Stopped.'.
- `tests/convex/lorekeeper-chat.test.ts`:
  - A 'rules' answer streams under `books` and ends `done`.
  - Unclear: no text, parts or `checkedAgain` reach the row or the GM's `listMessages` during the first pass or the
    retry. The retry's answer is then revealed once, and costs settle.
  - A Stop mid-retry keeps the first pass's answer and GM call, not the retry's partial text. Both passes are costed.
  - A Stop during the hidden first pass ends stopped with no text.
  - `listMessages` blanks a hidden in-flight row.
- `tests/convex/lorekeeper-web.test.ts`:
  - With the e2e fake model, "Do our Hexes stack?" with search on walks `books -> retry -> web -> done` and shows no
    text or parts before it ends.
  - A Stop during the web pass keeps the retry's answer. The web pass is costed and nothing stays reserved.
- `tests/e2e/lorekeeper-chat.spec.ts`:
  - On the Hex question, a MutationObserver records the phase texts and any answer text in a busy card.
  - The run fails if any text shows early, or if 'Checking again with a stronger model…' and then 'Searching the
    internet…' don't appear.
  - It then checks the final answer and its internet block.

## Not changed

`convex/lib/claude.ts`: the fake model already gives 'unclear' twice for a Hex question and web results to the web
pass.
