# TASK-D5-R3: Photo import robustness and worktree ports

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer R3 (end of D5). Fixes review M4 and L7 (`.omc/audit/d5-review.md`) and integration polish item 32.

## M4: photo size, memory, expiry

- `claim` keeps photos of at most `PHOTO_MAX_BYTES` = 3.5 MB (`convex/photoImport.ts`). The Messages API limits each image to 5 MB of base64, which is 3.75 MB of raw bytes, so 3.5 MB leaves margin. The browser shrinks photos to 2000 px JPEG, far below this. `read` also skips any blob over the cap. The `PHOTO_IMPORT_FILE` message now says 3.5 MB.
- `read` builds fewer copies. Each photo is base64-encoded in 24 KB slices, so no binary string of the whole photo is built. The request body is joined once from its pieces, with the base64 inserted directly, instead of `JSON.stringify` over an object that holds every photo. The per-photo strings are dropped before the request goes out.
- `cleanup.expirePhotoImports` is its own internal mutation. It runs hourly (`crons.ts`, minute 41) and reads the new `files.by_kind_created` index (`["kind", "createdAt"]`), oldest first, `BATCH` rows per run. It reschedules itself after a full batch. It used to run inside the daily orphan sweep and read in `refId` order, which could skip old rows.

## L7: one read per click

`ImportFlow.readPhotos` (`src/components/party/import/flow.tsx`) now switches to the reading step (button disabled) before its first `await`. A ref ignores a second call that arrives before React re-renders. The ref resets in `finally`.

## Polish 32: worktree ports

`scripts/worktree-setup.mjs` derives a slot (0-99) from an FNV-1a hash of the worktree's absolute path. The suggested ports are `3100 + slot` (Next.js) and `3312 + 2 * slot` (Convex, plus its site proxy on the next port). Both ranges avoid the main checkout's 3000 and 3212-3213. The script checks each derived port with `isPortBusy`. When one is busy, it tries the next slot, wrapping around the range. Two worktrees can still hash to the same slot (about a 1% chance per pair). The busy check covers that case as long as the first worktree's servers are running.

## Tests

- `tests/convex/photo-import.test.ts`: the 3.5 MB cap (3.5 MB accepted, one byte more refused), and the exact bytes round-tripping through a body that parses as JSON (100 001 bytes, several slices, a length that isn't a multiple of 3).
- `tests/convex/cleanup.test.ts`: the hourly cron, expiry of rows and blobs, and oldest first across campaigns past a full batch.
- `tests/unit/photo-import-flow.test.tsx`: a double click on "Read photos" reads once, and the button stays disabled until the read ends.
- `tests/unit/workflow-scripts.test.ts`: the slot is stable and differs between worktrees, derived ports are used when free, and busy ports are skipped with wrap-around.
