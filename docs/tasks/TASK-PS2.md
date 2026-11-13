# TASK PS2: photo import never rejects photos (dcm-ccnm)

Plan `.omc/plans/photo-import-schema.yaml`, wave 2. User 2026-11-13: "when an image is uploaded, if the importer is
unsure what to put, mark those fields in red & have a message asking for a manual input there, never outright reject
the image." Answers: an unsure field shows Claude's guess, prefilled, in red; when Claude can't be reached the GM sees
"Importer can't be reached: <reason>".

## What changed

- **Wire schema** (`src/lib/import/sheet-photo.ts`): a required `uncertain: string[]` with the same dotted paths as
  `unreadable` (values read but not sure of, such as messy handwriting). Still union-free; the guard test stays at 0.
  The prompt tells Claude to give its best guess and list the path.
- **Result** (`PhotoReadResult` in `src/lib/import/draft.ts`, `readResultValidator` in `convex/photoImport.ts`): adds
  `uncertain: string[]` and `blank: boolean`. Paths are draft paths. `wireToDraftPaths` renames wire paths
  (`className` to `classId`, `hpMarked` to `hp`, `ancestry` to the select or selects), re-indexes Experiences once
  blank names are dropped, and flags an item of `domainCards` or `inventory` as the whole list. A path that is both
  unreadable and uncertain counts as unreadable only. The chest, pronouns and description now carry flags when Claude
  lists them.
- **Salvage** (`salvageWire`, `readResultFromReply`): if the reply is JSON but fails the wire schema, each field is
  parsed on its own:
  - A field that parses is kept. Any other field gets its blank value (`""`, `0`, `false`) and its path joins
    `unreadable`; this covers each trait and each gold field separately.
  - In `domainCards` and `inventory`, invalid items are dropped and the list name is flagged. A list longer than its
    limit keeps its first items and is flagged.
  - An Experience without a valid name is dropped and `experiences` is flagged. One with a valid name but an invalid
    modifier is kept with `experiences.<i>.value` unreadable.
  - Invalid `unreadable` and `uncertain` entries are ignored.
- **Blank form** (`blankReadResult`): the reply gives the default draft with every path in `ALL_DRAFT_PATHS` unreadable
  and `blank: true` when it is:
  - a refusal;
  - cut off at max_tokens;
  - "no answer" (an incomplete or unparseable API reply);
  - not JSON, or JSON that isn't an object;
  - a reading with nothing in it: no text, no list item, every number 0 and no chest.
- **Unreachable** (`convex/photoImport.ts`): `read` throws
  `ConvexError({ code: "PHOTO_IMPORT_UNREACHABLE", reason, message })` and keeps the photos (no delete). Every other
  outcome deletes them, as before. `PHOTO_IMPORT_FAILED` is gone, since nothing throws it now.
  `PHOTO_IMPORT_UNAVAILABLE` (no key) is unchanged and still deletes the photos.
- **Claude client** (`convex/lib/claude.ts`, added to `owns` by the orchestrator): `ClaudeFailure` gets an optional
  `detail?: { errorType?, billing? }`. It is set only in `messagesCreate`'s `!response.ok` branch, which reads the body
  once, still logs it, and keeps only the API's `error.type` and whether its message matches
  `/credit balance|billing/i` (the whole body when it isn't JSON). `messagesStream` and the Lorekeeper are unchanged.

## Reason mapping (`unreachableReason` in `convex/photoImport.ts`)

| ClaudeFailure | reason key |
| --- | --- |
| `HTTP 529`, `HTTP 503` | `overloaded` |
| `HTTP 429` | `rateLimited` |
| `HTTP 401`, `HTTP 403` | `key` |
| `HTTP 402`; `HTTP 400` with `detail.billing` | `credits` |
| `timeout` | `timeout` |
| `network` | `network` |
| any other `HTTP n` (a 400 from our own request included), `stream error`, `aborted` | `other` |
| `refusal`, `too long`, `no answer` | none: the blank form, not an error |
| `unavailable` | PHOTO_IMPORT_UNAVAILABLE, as before |

## Wording (texts live in `src/lib/errors/photoImport.ts` and `review.tsx`)

- Unreachable: "Importer can't be reached: <reason>.", where the reason is:
  - overloaded: "the API is overloaded"
  - timeout: "the request timed out"
  - credits: "the API credits are used up"
  - key: "the API key was refused"
  - rateLimited: "rate limited (too many requests)"
  - network: "network error"
  - other: "the API refused the request (a problem on our side)"
- Review notes, each in red under its field, linked with `aria-describedby`, with `aria-invalid` on the control:
  - unreadable: "Couldn't read this: fill it in." The field opens empty; for a number the draft value becomes NaN, so
    Save waits for it.
  - uncertain: "Not sure this is right: check it against the sheet." The guess stays in the field.
  - unmatched: "Read as “X”, which matched nothing: choose it."
  - Priority: unmatched first, then unreadable, then uncertain.
- Intro line: "Check every field against the paper sheet. Fields in red need your input." when anything is flagged,
  otherwise "Check every field against the paper sheet."
- Blank form top note: "Claude couldn't read anything from these photos. Fill in the sheet by hand."
- Red uses the existing tokens `text-danger`, `border-danger`, `ring-danger` and `bg-danger-bg`; no new hex.

## Flow (`flow.tsx`)

- On PHOTO_IMPORT_UNREACHABLE the error's message shows in the alert, the photos are kept, and "Read photos" becomes
  "Try again". Try again calls `read` again without uploading.
- Cancel discards the kept photos. Picking new photos also discards them first.
- Any other error discards the photos, as before. Photos nobody discards expire through the existing cleanup cron
  (`convex/cleanup.ts`).

## Judgement calls

- An error's payload stays the `AppError` shape plus `reason`. The type lives in `src/lib/errors/photoImport.ts`
  (`PhotoImportUnreachable`), so `app-error.ts` (not owned) is unchanged. The full text is sent as `message`, so
  `errorMessage` shows it everywhere. The client reads `reason` only to decide on Try again (`unreachableReasonOf`).
- "no answer" (no text block, an unexpected stop reason, a 200 reply whose body isn't JSON) counts as a reply with
  nothing usable, so it gives the blank form rather than an unreachable error.
- Claude's own `experiences.<i>` paths refer to its original list. If salvage drops an Experience, the later indexes
  may be off by one, but the list itself is flagged red in that case.
- In the review, unreadable numbers open empty instead of with a default (the user asked for "manual input there").
  `draftFromReading` still fills defaults; the form empties them through a `useState` initializer.
- The authz matrix entry for `read` is unchanged. The test deployment has no key, so it still answers
  PHOTO_IMPORT_UNAVAILABLE or PHOTO_IMPORT_RULE.
- The coordinator named the new client test `tests/unit/claude-client.test.ts`. The existing streaming tests are in
  `tests/convex/claude-client.test.ts` (not owned), so the `messagesCreate` cases went into the new unit file. They
  run in jsdom, and `env` is `process.env`.

## Checks

- `npx vitest run --maxWorkers=2` on:
  - `tests/unit/sheet-photo.test.ts`
  - `tests/convex/photo-import.test.ts`
  - `tests/unit/photo-import-review.test.tsx`
  - `tests/unit/photo-import-flow.test.tsx`
  - `tests/unit/claude-client.test.ts`
  - plus `tests/convex/claude-client.test.ts`, `tests/convex/error-payloads.test.ts` and
    `tests/convex/authz-matrix.test.ts`
- `pnpm lint`, `pnpm typecheck`.
