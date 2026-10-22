# TASK-D13-L10: Internet search also runs when the books are unclear, and a web miss says so

Status: Review. Plan: `.omc/plans/d13-lorekeeper.yaml`, tracer L10 (depends on L8). Binding: the user report of
2026-10-22 ("its selected still doesnt search net") and the orchestrator defaults D1-D5 in the plan entry.

## The report

With "Search the internet too" on:

- "Do our Hexes stack?" ended 'Rules unclear' after the Opus retry with no web pass: `nextStep` sent only an Opus
  'none' to the web pass.
- "Whats the meaning of life" reached the web pass, the model ran no search, `webPass` threw
  `ClaudeFailure("no answer")`, and the run stored `BOOKS_ONLY_MISS` ("internet search is off"), which was false. The
  log line named only the class `ClaudeFailure`, not the reason.

## The pass rules now

| Opus retry verdict | Toggle | Next | Stored |
|---|---|---|---|
| rules | any | done | the book answer |
| unclear | off | done | the Opus answer (verdict, quotes, GM call) |
| unclear | on | web | web results: the Opus answer, its prose + "\n\n" + the web note, the web results under it (D2); no usable result, a failed pass or no budget: the Opus answer unchanged |
| none | off | booksOnlyMiss | `BOOKS_ONLY_MISS` ("internet search is off") |
| none | on | web | web results: the web answer (verdict 'none'), as in L8; no usable result, a failed pass or no budget: `WEB_MISS` (D3) |

The primary pass is unchanged ('rules' is done, anything else is retried with Opus). When the retry is skipped (no
budget) or fails, the first answer stands and no web pass runs, as before.

- `src/lib/lorekeeper/flow.ts`: `nextStep` returns `web` after a retry 'unclear' or 'none' with the toggle on (D1).
- `src/lib/lorekeeper/copy.ts`: `WEB_MISS` = "I couldn’t find this in your books or online. Ask your GM." (D3).
  `BOOKS_ONLY_MISS` is now stored only with the toggle off.
- `src/lib/lorekeeper/prompt.ts`: `RequestOptions.web.books` ('none' default, or 'unclear') and `webInstruction`.
  The 'unclear' line says the books touch on the question but don't settle it (not that they had nothing) and asks
  for the verdict 'unclear'. Both lines tell the model to run at least one web search for the question
  (Daggerheart rulings, designer answers, forum readings) instead of deciding not to (D4). An off-topic question can
  still find nothing; then the D3 text is stored.
- `convex/lib/lorekeeper/web.ts`: `webPass(question, rulings, signal?, books = "none")` passes `books` to the
  prompt. The request is otherwise L8's: only the question and the table rulings, the empty campaign-data block, no
  book excerpts and no history, `max_uses` 3, the blocked domains.
- `convex/lorekeeperRun.ts`: the web step above. The web pass is still reserved first
  (`reserveNextPass(..., { webSearches: 3 })`) and settled after every outcome (results, nothing usable, failure,
  Stop). A failed web pass logs `Lorekeeper: the internet pass failed (<ClaudeFailure.reason>); answering without
  it.` (D5): the reason only, never the key, the question or the request body. An error other than `ClaudeFailure`
  is a programming error and now ends the row as `LOREKEEPER_FAILED` and rethrows (rule 9) after the pass's
  reservation is settled.
- `src/components/lorekeeper/answer/model.ts`: `isBooksOnlyMiss` also knows `WEB_MISS` (only 'Ask the GM' under
  it). The answer card already rendered the internet block for any verdict; an 'unclear' answer now shows its pill,
  book quotes, GM call and the internet block with its disclaimer.

## Tests

- `tests/unit/lorekeeper/pricing.test.ts` (flow): retry 'unclear' / 'none' with the toggle on -> `web`; toggle off
  -> `done` / `booksOnlyMiss`; 'rules' never searches.
- `tests/unit/lorekeeper/prompt.test.ts`: the 'none' and 'unclear' web lines, the always-search line, the question
  and the empty campaign data.
- `tests/unit/lorekeeper/copy.test.ts`: `WEB_MISS`.
- `tests/unit/lorekeeper-ui/model.test.ts`, `components.test.tsx`: the web miss counts as a miss; an 'unclear' card
  shows its book quote chip, the GM call, the internet block and disclaimer, and 'Ask the GM'.
- `tests/convex/lorekeeper-web.test.ts` (fetch stubbed with SSE): unclear + web results (verdict, GM call, web
  results, prose joined, the unclear prompt line, no campaign data, cap and blocked domains, costs); unclear + tool
  error keeps the Opus answer (pass costed); unclear + toggle off makes no web call; none + no search ("Whats the
  meaning of life") stores `WEB_MISS`, logs `(no answer)` and never the key or the question; none + tool error
  stores `WEB_MISS`; toggle off still stores `BOOKS_ONLY_MISS`. With the e2e fake model (`LOREKEEPER_FAKE_MODEL`,
  local deployment URL, no fetch): "Do our Hexes stack?" with the toggle on stores verdict 'unclear', the book
  quote, the GM call and the fake's two web results, costs settled; with the toggle off no web block.

## Not changed

`convex/lib/claude.ts` (the fake model) needed no change: it already answers a web-tool request with web results.
