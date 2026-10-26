# TASK-D13-L2: Rules source - local ingest, search retrieval, library list and per-campaign book switches

Plan `.omc/plans/d13-lorekeeper.yaml`, tracer L2 (wave 2). Bead dcm-bxp.82. Binding user answers: Q1 (the user's own
rulebook text, ingested by a local script into Convex, never in git), Q5 ('Open in the book' shows the page text),
Q6 (`pnpm lorekeeper:ingest` run locally by the GM), Q7 (house rules = GM pages shared with everyone, off by default).

Status: Review (implemented and tested in the worktree; the orchestrator merges).

## What landed

| File | Role |
|---|---|
| `convex/lorekeeperLibrary.ts` | Public `list`, `setEnabled`, `pageText`; internal `ingestBook`, `clearChunks`, `ingestChunks`, `ensureHouseRulesBook`; `bookDefaults(key)`. |
| `convex/lib/lorekeeper/retrieve.ts` | `retrieve()` (body replaced, signature unchanged) plus the library helpers `campaignBooks`, `campaignBook`, `bookKeyEnabled`, `bookVisibleTo`, `enabledByDefault`, `searchTerms`. |
| `scripts/lorekeeper-ingest.mjs` | The ingest script (below); its pure helpers are exported and unit-tested. |
| `tests/convex/lorekeeper-library.test.ts` | 20 tests: house-rules book, ingest, idempotent re-run, bounded clear, refusals, no public writer, script helpers, retrieval (hit, miss, disabled book, frame dedupe, neighbours, budget, term cap), list, switches, page text. |
| `tests/convex/authz/lorekeeper-library.{entries,test}.ts` | Matrix area `lorekeeper-library` (3 entries). |

## Public functions

| Function | Wrapper | Args | anon | outsider | player / otherPlayer | GM | Domain errors |
|---|---|---|---|---|---|---|---|
| `lorekeeperLibrary:list` | campaignQuery view | - | UNAUTHENTICATED | NOT_FOUND | ok | ok | - |
| `lorekeeperLibrary:pageText` | campaignQuery view | bookId, page | UNAUTHENTICATED | NOT_FOUND | ok | ok | LOREKEEPER_BOOK_NOT_FOUND (absent, other frame, off, empty page) |
| `lorekeeperLibrary:setEnabled` | gmMutation | bookId, enabled | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | ok | LOREKEEPER_BOOK_NOT_FOUND |

`list` returns `{ books: [{ bookId, key, title, subtitle, cover, pages, chunkCount, enabled }], indexedCount }` in the
board's order (core, Hope & Fear, the campaign's frame book, house rules, others by title); never chunk text.
`indexedCount` (the header's '<N> books indexed') counts the books switched on. Other frames' frame books are hidden
from a campaign and cannot be switched (BOOK_NOT_FOUND). `pageText` returns `{ bookId, bookTitle, page, sections:
[{ section, text }] }` (at most 20 chunks, book order).

Defaults without a `lorekeeperLibrary` row: on for `core`, `hopeFear` and `frame:<campaign.frameId>`; off for
`houseRules` and everything else (Q7). L4 reads the house-rules switch with `bookKeyEnabled(ctx, campaign, "houseRules")`.

## Internal ingest

- `ingestBook({ bookKey, title?, subtitle?, cover?, pages })` upserts the book by key with the board's defaults
  (frame books take the frame's name and 'Campaign frame'), resets `chunkCount` to 0, records `CHUNK_SCHEMA_VERSION`,
  and inserts the 'House rules (notes)' pseudo-book (no chunks) when missing. Unknown key → INVALID.
- `ensureHouseRulesBook({})` inserts the `houseRules` book (no chunks) when missing and returns its id; idempotent.
  The script calls it for `pnpm lorekeeper:ingest houseRules`; every `ingestBook` does the same. (Coordinator request
  after L4: the house-rules switch needs that row.)
- `clearChunks({ bookId })` deletes at most 500 of the book's chunks; returns `{ deleted, done }`.
- `ingestChunks({ bookId, chunks })` inserts at most 100 chunks (1..4,000 chars, integer page/ord; section cut to 200)
  and adds them to `chunkCount`.

## The script

```
pnpm lorekeeper:ingest <bookKey> <textFile> [--pages a-b] [--title t] [--subtitle s] [--cover c]
                       [--dry-run] [--prod | --deployment <name> | --env-file <file> | --e2e]
```

- Keys: `core`, `hopeFear`, `frame:<frameId>` (`frame:witherwild` defaults to core pp. 254-261, checked against the
  extract), `houseRules` (no file: registers the switch only).
- Reads the file, refuses paths inside this checkout or the main checkout except `tests/fixtures`, chunks it with L1's
  `chunkBook` (loaded through Node 24's type stripping), prints only counts.
- Calls `ingestBook`, `clearChunks` until done, then `ingestChunks` per batch (≤ 100 chunks and ≤ 100 kB of JSON, under
  Linux's 128 KiB per-argument limit) through the Convex CLI's `convex run` with `--typecheck disable --codegen disable`.
  The CLI targets `.env.local`'s deployment (or `CONVEX_DEPLOY_KEY` when set); `--prod`, `--deployment` and
  `--env-file` pass through; `--e2e` goes through `scripts/convex-e2e.mjs` (L9's e2e setup can use
  `node scripts/lorekeeper-ingest.mjs core tests/fixtures/lorekeeper/mini-book.txt --e2e`).
- Dry runs on the private extracts (not committed): core 1,189 chunks / 377 pages / 15 batches; Hope & Fear 547 / 188 /
  8; Witherwild 16 / 8 / 1.

## Retrieval

`searchTerms` lower-cases the question, drops stopwords and repeats, keeps 16 terms (Convex's limit). Per enabled
book with chunks, `withSearchIndex("search_text")` filtered by `bookId`, top 10; merged by the number of distinct terms
a chunk holds, then its rank in its book; top 10 overall; then the other chunks of those pages (≤ 8 each); at most
32,000 characters (about 8k tokens); a chunk whose exact text is already in the list (frame book cut from the core
book) is dropped.

## Checks

- Ingest against the local e2e backend (`E2E_CONVEX_PORT=3386`) with the mini-book fixture: 13 chunks; a re-run
  removed the 13 old chunks and left 13; the real search index ranks page 3 'Critical Hits' first for "happens
  critical hit".
- `pnpm typecheck` clean; `pnpm lint` clean; `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 218 files, 5,319
  passed, 1 expected fail (after merging rebuild a60a1c0 with L4 and L5).
