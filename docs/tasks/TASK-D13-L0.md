# TASK-D13-L0: Lorekeeper foundation

Plan `.omc/plans/d13-lorekeeper.yaml`, tracer L0 (wave 1, foundation). Bead dcm-bxp.82. Analysis:
`.omc/autopilot/d13-analysis.md`. Board: `reference/designs/project/Lorekeeper.dc.html`.

Status: Review (implemented and tested in the worktree; the orchestrator merges).

## What landed

| File | Role |
|---|---|
| `convex/tables/lorekeeper.ts` | The eight D13 tables (below); `convex/schema.ts` composes them. |
| `convex/lib/validators/lorekeeper.ts` | `LOREKEEPER_LIMITS`, book keys, the role / status / verdict / visibility / failure / usage-kind / ask-resolution unions, the quote, web-result, parts, usage and reservation shapes. |
| `src/lib/errors/lorekeeper.ts` | Every D13 error code; combined in `app-error.ts` and `convex-errors.ts`. |
| `convex/lib/functions.ts` | `RATE_LIMITS.lorekeeperAsk`: token bucket, 30 per hour, capacity 10. |
| `convex/convex.config.ts` | Optional env: `LOREKEEPER_MODEL`, `LOREKEEPER_FAKE_MODEL`, `LOREKEEPER_DAILY_QUESTIONS` (40), `LOREKEEPER_CAMPAIGN_MONTHLY_USD` (50), `LOREKEEPER_MONTHLY_USD` (150). Added to L0's owns by the orchestrator. |
| `convex/lib/claude.ts` | The streaming Messages API client and the e2e fake model (below). The only reader of `ANTHROPIC_API_KEY`. |
| `convex/lib/lorekeeper/{context,retrieve,caps,web}.ts` | Stubs with final signatures (typed as `BuildContext`, `Retrieve`, `Reserve` / `Settle` / `RemainingFor`, `WebPass`); L4, L2, L5 and L8 replace the bodies. `caps.ts` also has the final `capLimits()`, `usageDay()` and `usageMonth()`. |
| `convex/lorekeeperRetention.ts` | `expireUsage` and `expireStaleRuns` (internal, batched, self-rescheduling). |
| `convex/crons.ts` | "expire lorekeeper usage" `47 4 * * *`, "end stuck lorekeeper answers" `29 * * * *`. |
| `convex/cleanup.ts` | The purge deletes asks, rulings, messages, conversations, library switches and the campaign's usage counters. |
| `src/lib/campaign-sections.ts` | `{ slug: "lorekeeper", label: "Lorekeeper", phase: "D13" }`, visible to players. |
| `src/app/(gm)/campaigns/[campaignId]/lorekeeper/{page,error}.tsx`, `lorekeeper.css` | The board-look shell; the board's `lk-*` classes under `.lk-root`. |
| `src/components/lorekeeper/slots.ts`, `sigil.tsx`, `chat/index.tsx`, `side/index.tsx` | The slot contract, the sigil, and the two slot stubs (L6 / L7 replace them; the stubs were added to L0's owns by the orchestrator, as D11 N0's). |
| `package.json`, `scripts/lorekeeper-ingest.mjs` | `pnpm lorekeeper:ingest`, a usage message only (L2 implements it). |
| `tests/fixtures/lorekeeper/` | `mini-book.txt` (invented, 13 page blocks, footers in the extracted-text format), five recorded-shape SSE streams and `sse.ts` (`sseFixture`, `sseResponse` with any chunk size). |
| Tests | `tests/convex/claude-client.test.ts` (22), `tests/convex/lorekeeper-retention.test.ts` (4), `tests/convex/cleanup.test.ts` (+1 test, seeds every new table), `tests/convex/schema-guard.test.ts` (classification; public functions loaded once, bead dcm-lm0), `tests/e2e/lorekeeper-shell.spec.ts` (2). |

## Tables and indexes

| Table | Indexes | Scope |
|---|---|---|
| `lorekeeperBooks` (key, title, subtitle, cover, pages, chunkCount, ingestedAt, schemaVersion) | `by_key` | BOUNDED, per deployment |
| `lorekeeperChunks` (bookId, page, section, text, ord) | `by_book_page`, search `search_text` (text, filter bookId) | BOUNDED, per deployment |
| `lorekeeperLibrary` (campaignId, bookId, enabled, updatedAt) | `by_campaign_book` | campaign |
| `lorekeeperConversations` (campaignId, userId, title, visibility, webSearch, messageCount, lastAt, createdAt) | `by_campaign_user_last`, `by_campaign_visibility_last` | campaign; never expired (Q10) |
| `lorekeeperMessages` (conversationId, campaignId, userId, role, status, text, parts?, errorCode?, usage?, model?, checkedAgain?, reserved?, createdAt, updatedAt) | `by_conversation`, `by_campaign_user_status`, `by_status_updated` | campaign |
| `lorekeeperRulings` (campaignId, title, text, sessionId?, fromMessageId?, pinnedBy, pinnedAt, updatedAt) | `by_campaign_pinned` | campaign |
| `lorekeeperAsks` (campaignId, messageId, askedBy, askedAt, resolvedAt?, resolution?, rulingId?) | `by_campaign_open`, `by_message` | campaign |
| `lorekeeperUsage` (kind, userId?, campaignId?, period, questions, costMicros, updatedAt) | `by_user_period`, `by_campaign_period`, `by_kind_period`, `by_updated` | campaign + 13-month retention |

## Deviations from the plan and analysis (user answers Q2, Q3, Q9, Q10 and the rulebook)

- **Q3 (conversations public by default):** conversations have `visibility: "campaign" | "private"` and the
  `by_campaign_visibility_last` index. The analysis's `by_last` index is dropped (no conversation expiry).
- **Q10 (no conversation deletion):** no `expireConversations`. The retention module expires usage counters
  (13 months) and ends answers stuck in pending/streaming for over 10 minutes as `error` / `LOREKEEPER_TIMEOUT`,
  settling their reservation. That backs up L3's 3-minute watchdog. schema-guard lists only `lorekeeperUsage`
  under ALSO_RETENTION.
- **Q2 (Opus retry):** `modelFor("retry")` is `claude-opus-5-5`; messages carry `checkedAgain?`.
- **Q9 (caps changeable without a deploy):** env vars read by `capLimits()` at call time, with defaults 40 / $50 /
  $150. `npx convex env set` changes them with no deploy.
- **CD6:** usage counters key on fields (`kind`, `userId?`, `campaignId?`, `period`) rather than the analysis's
  encoded `scope` string, so there are three point-read indexes in place of `by_scope`.
- **Extra codes:** `LOREKEEPER_REFUSED`, `LOREKEEPER_TIMEOUT` and `LOREKEEPER_ASK_EXISTS` (one open ask per answer).
- **Quotes** are a union: book quotes (`bookId`, printed `page`, `section`) and ruling quotes ("📌 Table ruling").
- **Answers** store `reserved` (`micros`, `day`, `month`), so the run (or the sweep) can settle the same counters.

## The Claude client (`convex/lib/claude.ts`)

- `apiKey()`, `fakeModelEnabled()`, `lorekeeperAvailable()` (for L3's boolean `available`), `modelFor(task)`.
- `messagesStream(body, onText, onCitation, signal?, { betas? })` always sets `stream: true` and defaults the model.
  It parses `message_start`, `content_block_start` / `_delta` (`text_delta`, `citations_delta`, `input_json_delta`)
  / `_stop`, `message_delta` (stop reason, cumulative usage including `server_tool_use.web_search_requests`),
  `message_stop`, `ping` and `error`, across any chunk boundary (UTF-8 included). It resolves with
  `{ model, text, blocks, stopReason, usage }`.
- On failure it throws `ClaudeFailure` with `reason`: `unavailable`, `timeout` (120 s), `aborted` (the caller's
  signal, i.e. Stop), `network`, `HTTP <status>` (a mid-stream `overloaded_error` → `HTTP 529`), `refusal`,
  `too long`, `stream error` or `no answer`. Each failure carries `partial` (the text and usage so far). Logs hold
  the status and at most 500 characters of the API's reply, never the key; network errors log the error name only.
- **Fake model:** only when `isE2EDeployment(env)` (a localhost `CONVEX_CLOUD_URL`) and
  `LOREKEEPER_FAKE_MODEL === "true"`. On any other deployment the flag is ignored, key or no key (tested). It plays
  canned events (60 ms apart, abortable) through the same parser:
  - no documents → `VERDICT: none`;
  - a question mentioning a Hex → `unclear` plus `GM CALL:`;
  - otherwise `rules`, citing document 0;
  - a request with a `web_search*` tool → a server tool use, two example.com results and a cited web answer.

## Checks run in the worktree

- `pnpm typecheck`: clean. `pnpm lint`: clean (0 warnings).
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: every D13 test passes (claude-client 22, retention 4,
  cleanup, schema-guard). The 30 failures are all in `tests/unit/sprite-catalog.test.ts` and
  `tests/unit/sprite-builtin-pack.test.ts`. They come from the sprite-packs P11 batches on `rebuild` (catalog
  counts), not from L0.
- e2e (`E2E_REUSE_SERVERS=1`, ports 3163 / 3438): `lorekeeper-shell.spec.ts` 2 passed, and `notes-shell.spec.ts`
  3 passed (the nav still works).

## Public functions

None. L0 adds only internal functions (`lorekeeperRetention:expireUsage`, `lorekeeperRetention:expireStaleRuns`),
so the authz matrix needs no entry from L0.
