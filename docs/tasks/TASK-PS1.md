# TASK-PS1: Photo import works again (union-free structured-output schema)

Status: Review. Plan: `.omc/plans/photo-import-schema.yaml`, tracer PS1. Bug: dcm-5378.

## Problem

Every photo import failed in production (log 2026-11-13). The Messages API answered `400 invalid_request_error`:
"Schemas contains too many parameters with union types (29 parameters with type arrays or anyOf) ... (limit: 16
parameters with unions)". `SHEET_READING_JSON_SCHEMA` used `["string","null"]`, `["integer","null"]` and
`["boolean","null"]` for 29 fields. The tests fake the API, so they never saw it.

## Fix

- **Wire shape** (`sheetWireSchema` and `SHEET_READING_JSON_SCHEMA` in `src/lib/import/sheet-photo.ts`): no union
  types. Text is a plain string (`""` = blank or unreadable), numbers are plain integers, `gold.chest` is a plain
  boolean, and a new required `unreadable: string[]` names what Claude could not read by dotted path: `level`,
  `hpMarked`, `traits.agility`, `gold.handfuls`, `gold.chest`, `experiences.<i>.value`. Claude gives 0 (false for the
  chest) for those fields. Union count: 29 before, 0 after.
- **Experiences:** an Experience keeps its name as a string (`""` when unreadable; `draftFromReading` already drops
  nameless ones). An unreadable modifier is listed as `experiences.<i>.value`, where `<i>` is its position in the
  `experiences` list Claude returned.
- **`readingFromWire(wire)`** (pure) returns today's nullable `SheetReading`: blank strings (`""` or only spaces) and
  every field named in `unreadable` become null. The list wins over any value sent with it. Paths that name no field
  are ignored. `sheetReadingSchema`, `SheetReading`, `draftFromReading`, the review form and the draft are unchanged.
- The zod wire schema keeps the old limits: 2000 characters per text, 200 per list item, at most 20 experiences,
  40 domain cards and 60 inventory items, integers only. `unreadable` allows at most 100 paths of up to 200 characters.
- **Prompt** (`sheetPrompt`): blank or unreadable text is `""`; an unreadable number is 0 with its path in
  `unreadable` (with examples, including `experiences.1.value` and `gold.chest`); empty lists stay empty.
- **`convex/photoImport.ts` `read`:** parses the reply with `sheetWireSchema`, then `readingFromWire`, then
  `draftFromReading`. The error handling, the `console.error` on a schema mismatch and the photo deletion in `finally`
  are unchanged.

## Tests

- `tests/unit/sheet-photo.test.ts`:
  - The guard walks the schema recursively and asserts no node has an array `type`, `anyOf` or `oneOf`. Its comment
    cites the API limit of 16.
  - Every object node has `additionalProperties: false` and lists all its properties in `required`. Every node has a
    single string `type`.
  - `readingFromWire` cases: a fully readable reading; blank strings; an `unreadable` list covering top-level fields,
    traits, gold (including the chest) and an experience value, plus an unknown path.
  - Round trip: the reading and the draft match the nullable fixture's.
  - The old nullable shape and over-long or non-integer values are refused.
- `tests/convex/photo-import.test.ts`: the faked replies use the wire shape, and the draft is unchanged. The
  read's whole result equals `draftFromReading(warriorReading)`. The request sends `SHEET_READING_JSON_SCHEMA` as
  `output_config.format`. A reply in the old nullable shape fails with PHOTO_IMPORT_FAILED and still deletes the photos.

## Not verified here

The real API wasn't called: there is no `ANTHROPIC_API_KEY` locally. The orchestrator will verify a real photo
import against production after deploy.
