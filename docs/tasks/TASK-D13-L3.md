# TASK-D13-L3: Lorekeeper chat server

Plan `.omc/plans/d13-lorekeeper.yaml`, tracer L3 (wave 2). Bead dcm-bxp.82. Binding user answers: Q2 (Sonnet, one
automatic Opus retry when the verdict is not 'rules', the internet pass only after Opus finds nothing and only with
the toggle on), Q3 (conversations public to the campaign by default, the asker can make one private), Q10 (no
automatic deletion; the asker deletes their own), Q11 (Stop). Orchestrator decisions: at 200 messages a conversation
refuses new questions with `LOREKEEPER_CONVERSATION_FULL` (old messages are never deleted); L5's per-pass
reserve/settle contract (`docs/tasks/TASK-D13-L5.md`).

## Files

| File | Role |
|---|---|
| `convex/lorekeeper.ts` | The public chat functions (below). |
| `convex/lorekeeperRun.ts` | The answer run (internal action) and its internal queries/mutations; `settleReservation`, `deleteConversationBatch`. |
| `tests/convex/lorekeeper-chat.test.ts` | 13 feature tests (fetch stubbed with SSE; `retrieve` mocked). |
| `tests/convex/authz/lorekeeper-chat.{entries,test}.ts` | Matrix area `lorekeeper-chat` (9 functions). |

## Public functions (all campaign wrappers, `need: "view"`)

| Function | What | anon | outsider | player (asker) | otherPlayer / grantee / GM |
|---|---|---|---|---|---|
| `lorekeeper:available` | boolean only (key or e2e fake model) | UNAUTHENTICATED | NOT_FOUND | ok | ok |
| `lorekeeper:listConversations` | `{ mine, shared }`: own (newest 30) and others' public ones (newest 30) | UNAUTHENTICATED | NOT_FOUND | ok | ok |
| `lorekeeper:getConversation` | one readable conversation (title, toggle, visibility, `mine`) | UNAUTHENTICATED | NOT_FOUND | ok | public: ok; private: LOREKEEPER_NOT_FOUND |
| `lorekeeper:listMessages` | paginated, newest first, `returns` validator (no reservation, usage or raw failure) | UNAUTHENTICATED | NOT_FOUND | ok | public: ok; private: LOREKEEPER_NOT_FOUND |
| `lorekeeper:ask` | rate limit `lorekeeperAsk`; `{ conversationId?, question, webSearch, visibility? }` → `{ conversationId, answerId }` | UNAUTHENTICATED | NOT_FOUND | ok | ok (own conversations; another's id → LOREKEEPER_NOT_FOUND) |
| `lorekeeper:stop` | own answer only; a finished one is left alone | UNAUTHENTICATED | NOT_FOUND | ok | LOREKEEPER_NOT_FOUND |
| `lorekeeper:setWebSearch` | own conversation's toggle | UNAUTHENTICATED | NOT_FOUND | ok | LOREKEEPER_NOT_FOUND |
| `lorekeeper:setVisibility` | own conversation `campaign` / `private` (Q3) | UNAUTHENTICATED | NOT_FOUND | ok | LOREKEEPER_NOT_FOUND |
| `lorekeeper:removeConversation` | own conversation; LOREKEEPER_BUSY while an answer is on its way | UNAUTHENTICATED | NOT_FOUND | ok | LOREKEEPER_NOT_FOUND |

`ask` refuses in this order: `LOREKEEPER_QUESTION_INVALID` (trimmed empty or over 1,000 chars),
`LOREKEEPER_UNAVAILABLE`, `LOREKEEPER_NOT_FOUND` (not the caller's conversation), `LOREKEEPER_CONVERSATION_FULL`
(messageCount + 2 > 200), `LOREKEEPER_BUSY` (the caller has a pending/streaming answer in this campaign), then the
caps codes from `caps.reserve`. The matrix row for a member is LOREKEEPER_UNAVAILABLE (no key in the matrix; an
okCode), so no run is scheduled there.

## Internal functions (`convex/lorekeeperRun.ts`)

`run` (action), `prepare` (query: question, toggle, `buildContext`, `retrieve`, last 8 messages of history, open
reservation, in one transaction), `appendAnswer`, `finalize`, `reserveNextPass`, `settlePass`, `release`,
`watchdog`, `purgeConversation`.

## Streaming design (analysis 4, option A)

1. `ask` (mutation) inserts the question (`done`) and a `pending` answer with `reserved` from `caps.reserve`, bumps
   the conversation, and schedules `run` (now) and `watchdog` (3 minutes).
2. `run` reads everything in one `prepare` query (null when the answer was stopped or deleted first: it then
   `release`s the reservation and ends). It builds L1's `requestBody` (documents with citations, rulings incl. their
   ids and house-rule pages as rulings, campaign data, history, `refusalFallback` + its beta on Sonnet/Opus 5.5) and
   calls L0's `messagesStream`, feeding deltas and citations into L1's `createAnswerParser`.
3. `AnswerWriter` patches the row through `appendAnswer` every 250 ms, or at once after 200 new characters, one patch
   at a time (a chain); between text it still calls `appendAnswer` with nothing to write as the Stop check.
   `appendAnswer` only patches an in-flight row and never with an older `at` than its `updatedAt`, and returns
   `go: false` once the row is stopped / ended / gone; the writer then aborts the stream (`AbortController` passed to
   `messagesStream`). Parts appear once the verdict line is complete.
4. Passes (Q2) via L1's `nextStep` / `modelForPass(pass, modelFor("answer"))`: Sonnet; when the verdict is not
   'rules', `reserveNextPass` (L5 `reservePass`) and the Opus retry (the row's text restarts, `checkedAgain: true`;
   no budget → keep the first answer; a failed retry → keep the first answer); when Opus says 'none': with the
   toggle on, `reserveNextPass` with 3 web searches and L8's `webPass` (null, failure or no budget → books-only miss);
   with the toggle off the books-only miss (`BOOKS_ONLY_MISS`, verdict 'none').
5. `finalize` writes `done` (text, parts, model, usage summed over passes), `stopped` (text so far) or `error`
   (`LOREKEEPER_REFUSED` / `_TIMEOUT` / `_UNAVAILABLE` / `_FAILED`, empty text: the card shows generic copy). A row a
   Stop ended stays `stopped` and takes the final text so far; a row the watchdog ended keeps its error.
6. Money: after every pass (also failed or stopped ones, with the partial usage) `settlePass` settles that pass's
   real cost against its reservation. `settleReservation` never takes more than `reserved.micros` (always the
   still-open reservation), so Stop and the watchdog can release everything at once and a later settle by the run only
   adds the real cost: no order of Stop / watchdog / run / stale-run sweep counts a reservation twice. The question
   stays counted.
7. `watchdog`: an in-flight answer with no patch for 3 minutes ends as `error` / `LOREKEEPER_TIMEOUT` and releases
   its reservation; one still progressing is rechecked (the Opus retry and web pass can take a run past 3 minutes).
   L0's `expireStaleRuns` (10 minutes) is the backstop.

Deleting a conversation removes the conversation row, then its messages and their `lorekeeperAsks` (by `by_message`)
in batches of 100 (`purgeConversation` continues).

## Tests

`tests/convex/lorekeeper-chat.test.ts` (fetch stubbed: recorded-shape fixtures from `tests/fixtures/lorekeeper` and
built SSE; `retrieve` mocked with two chunks of an inserted book):

- a cited answer is seen mid-stream (the stream is held after its first deltas until a patch shows them), then ends
  with the quote's book id, page and section, usage, model; the body has the system prompt, cited documents and the
  question and never the key; counters equal the real cost, nothing stays reserved;
- unclear → Opus retry stores the GM call (`checkedAgain`, models Sonnet then Opus, both passes settled);
- no budget for the retry keeps the first answer;
- books-only miss with the toggle off (two calls);
- refusal → `LOREKEEPER_REFUSED`; HTTP 529 and a mid-stream overload → `LOREKEEPER_FAILED`;
- Stop mid-stream: the GM cannot stop it (NOT_FOUND); the asker's Stop aborts the fetch, keeps the text so far,
  counts only the usage received;
- watchdog ends a stuck row, leaves a progressing one;
- ask validation, UNAVAILABLE / `available`, BUSY (another member is not blocked), NOT_FOUND on another's
  conversation, history sent with the second question, CONVERSATION_FULL with no message deleted;
- Q3: public conversations readable by the GM, private ones not (list, get, messages), only the asker toggles,
  makes private or deletes; delete removes messages and asks; delete refused while answering.

## Notes for later tracers

- L6: `listMessages` is newest first (reverse for display); `parts.quotes` book quotes carry `bookId` only (resolve
  the title from `lorekeeperLibrary.list`); ruling quotes carry `title` and `rulingId` when L4 gave one. A
  `LOREKEEPER_CONVERSATION_FULL` error should offer 'Start a new conversation'. Name askers of shared conversations
  from the roster (`userId`).
- L8: `webPass(question, rulings, signal)` runs after `reserveNextPass(..., { webSearches: 3 })`; the run settles its
  `usage` / `model` against that reservation. A thrown `ClaudeFailure` counts its partial usage.
