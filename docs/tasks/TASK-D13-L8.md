# TASK-D13-L8: Internet fallback pass ("If the books don't say")

Status: Review. Plan: `.omc/plans/d13-lorekeeper.yaml`, tracer L8 (wave 3). Binding user answer Q2: Sonnet 5.5
answers first, one automatic Opus 5.5 retry on 'unclear' / 'none', and the internet pass runs only after the Opus
retry also finds nothing and the conversation's toggle is on.

## What changed

`convex/lib/lorekeeper/web.ts`: `webPass(question, rulings, signal?)` replaces L0's stub (same `WebPass` type).
L3's run (`convex/lorekeeperRun.ts`, unchanged) already calls it after `reserveNextPass(..., { webSearches: 3 })`
and settles the pass against that reservation.

- Request: L1's `requestBody(question, [], rulings, emptyContext, [], { model: modelFor("web"), web: {...} })`:
  the `web_search_20260209` server tool with `max_uses` 3 and `blocked_domains` = `WEB_BLOCKED_DOMAINS` (piracy and
  PDF hosts), the "books had nothing" line, the rulings as the "Table rulings" document before the question (so
  rulings come before any web result), the question. No `fallbacks` (refusal fallback) on this pass.
- Privacy: the web pass sends only the question and the table rulings. No book excerpts, no conversation history,
  no characters, no party, no frame (the campaign-data block is the empty one), because the model writes the search
  queries itself. GM-only data never reaches any prompt (Q4) in the first place.
- Model: `modelFor("web")` (LOREKEEPER_MODEL, else ANTHROPIC_MODEL, else Sonnet 5.5), the same model L3 reserves
  for the pass through `modelForPass("web", override)`.
- Results: L1's answer parser. Citations (`web_search_result_location`) are pushed while streaming, then the
  `web_search_tool_result` blocks' results (`webResultsFromToolContent`) fill the remaining places, so cited results
  come first. At most 3, http(s) only, duplicates merged, titles one line, snippets cut to 300 chars. All plain text:
  nothing is rendered as HTML or markdown (L6 shows them as text). The prose is the reply after its verdict line.
- Usage: the stream's cumulative usage including `server_tool_use.web_search_requests`; L1's `costMicros` prices
  searches at $10 per 1,000 (`WEB_SEARCH_MICROS`).

## Contract with L3

| Outcome | webPass | L3 stores |
|---|---|---|
| at least one usable result | `WebPassResult { prose, web, usage, model }` | `done`, verdict 'none', `parts.web`, prose; cost settled |
| call completed, no usable result (tool error object, only non-http urls, nothing searched) | throws `ClaudeFailure("no answer", wholeReply)` | books-only miss; the pass's real cost settled |
| HTTP error, timeout, network, refusal | the client's `ClaudeFailure` (partial usage) | books-only miss; partial cost settled |
| Stop | `ClaudeFailure("aborted")` | `stopped` |
| blank question | `null` (nothing sent) | books-only miss |

Deliberate choice: L3 settles zero usage on `null`, so a completed call that found nothing throws `ClaudeFailure`
with the whole reply instead of returning `null`; otherwise its tokens and searches would never reach the caps.
Other exceptions are programming errors and are left to throw (rule 9).

## Tests

`tests/convex/lorekeeper-web.test.ts` (fetch stubbed with `tests/fixtures/lorekeeper/web-search.sse` and built
streams; `retrieve` mocked):

- run: 'none' twice with the toggle on → exactly one web pass (3 calls), the result stored with title, site, url and
  snippet, prose stored, cost = the three passes including one search (10,000 micros), counters equal, nothing left
  reserved; the web body has the tool (type, max_uses 3, blocked domains), one user turn, the rulings document before
  the text, no book text, the empty campaign-data block, no key;
- run: toggle off → books-only miss, 2 calls, no tool in any body;
- run: 'rules' → 1 call, no web results;
- run: a `web_search_tool_result_error` (HTTP 200) → books-only miss, the pass's tokens still costed;
- run: plain text storage: HTML-looking title and prose stored verbatim, 3 results max with the cited one first,
  `javascript:` dropped, snippet ≤ 300 with "…";
- `webPass` directly: the fixture parsed in 5-byte chunks, LOREKEEPER_MODEL override, `ClaudeFailure("no answer")`
  with usage, HTTP 500 and Stop surface as `ClaudeFailure`, a blank question sends nothing.

## Notes for later tracers

- L9 (e2e): the fake model's web mode (L0) returns two example.com results and a cited answer without a verdict
  line; the parser keeps the whole text as prose, which is what the board's internet sample shows.
