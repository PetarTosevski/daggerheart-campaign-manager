# TASK-D5-T7: Photo import with GM review

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T7 (end of D5). Decisions 13 (GM only; photos deleted after reading) and 14 (fixed default model overridable by `ANTHROPIC_MODEL`; one call per click, no automatic retry).

## Flow

1. The roster's "Import from photo" button (`src/components/party/import/index.tsx`) shows only for the GM and only when `photoImport.available` is true, that is when `ANTHROPIC_API_KEY` is set on the Convex deployment. The query returns a boolean, never the key.
2. The GM picks up to 4 photos. The browser shrinks each to at most 2000 px (JPEG), then for each one calls `photoImport.uploadUrl` (GM, rate limit `uploadUrl`), uploads it and calls `photoImport.claim`. `claim` accepts JPEG, PNG or WebP files of at most 3.5 MB (`PHOTO_MAX_BYTES`, R3), at most 4 per campaign, recorded as `files` rows of kind `photoImport` on the campaign. A rejected file is deleted, and the call returns `{ ok: false, code }` instead of throwing (CF16).
3. `photoImport.read` (userAction, rate limit `photoImport`) checks GM access and loads the photos in one internal query. It then sends one Messages API request (`fetch`, structured JSON output, model `ANTHROPIC_MODEL` or `claude-sonnet-5-5`), checks the answer with zod (`sheetReadingSchema`) and fuzzy-matches the names to SRD ids (`draftFromReading`). It returns `{ draft, unreadable, unmatched }`. In every outcome (success, API error, missing key, answer that doesn't fit the schema) the photos and their `files` rows are deleted in one internal mutation. There is no retry: the GM clicks again.
4. The review screen (`review.tsx`) lets the GM edit every field, highlights the fields Claude couldn't read or match, and asks for the owner (the GM or a player). Save stays disabled until `importProblem` (the same `sheetFromImport` checks the server runs) passes.
5. `photoImport.create` (keyedGmMutation) builds the sheet with `sheetFromImport` and saves the character at the draft's level. It logs an `import` action row (public, `undoable: false`).
6. Abandoned photos (uploaded but never read) are deleted by the hourly `cleanup.expirePhotoImports` job (oldest first, R3) once they are older than 1 hour (`PHOTO_IMPORT_TTL_MS`). `photoImport.discard` clears them when an upload fails partway, and before each new import.

## Modules

| File | What |
|---|---|
| `src/lib/import/draft.ts` | `importDraftSchema` (picked from `characterSheetSchema`, plus plain lists), limits `MAX_PHOTOS`, `MAX_PHOTO_BYTES`, `PHOTO_TYPES` |
| `src/lib/import/sheet.ts` | `sheetFromImport(draft, hopeAndFear)` (class, subclass, heritage, domain cards from the class's domains at or below the level, equipment at or below the tier, same hand, class and Spellcast rules as the wizard) and `importProblem` for the UI |
| `src/lib/import/sheet-photo.ts` | prompt, JSON schema for `output_config.format`, `sheetReadingSchema`, `similarity` / `bestMatch` (normalised edit distance, threshold 0.75, a missing last word counts as 0.9), `draftFromReading` |
| `convex/photoImport.ts` | `available`, `uploadUrl`, `claim`, `discard`, `read`, `create`; internal `readContext`, `deletePhotos` |
| `src/lib/errors/photoImport.ts` | new codes `PHOTO_IMPORT_FILE`, `PHOTO_IMPORT_TOO_MANY`, `PHOTO_IMPORT_FAILED` |

No schema change: `files.kind` already had `photoImport` (T0), and the env vars and the `photoImport` rate limit already existed.

## Book references (re-checked)

- CB 109: "Tier 2 encompasses levels 2–4. Tier 3 encompasses levels 5–7": equipment tier allowed at a level.
- CB 101, Loadout and Vault: "You can have a maximum of five active domain cards in your loadout": the first 5 imported cards go to the loadout, all of them are owned.

## Verification

`pnpm lint`, `pnpm typecheck`, `pnpm test` (new: `tests/unit/sheet-photo.test.ts`, `tests/convex/photo-import.test.ts` with a stubbed `fetch`, `tests/unit/photo-import-review.test.tsx`; extended: `tests/convex/cleanup.test.ts`), a local push with `--typecheck=enable`, and `tests/e2e/photo-import.spec.ts` (no button without the key) with `party-roster.spec.ts`. No real API call was made; the key is not set on any deployment.
