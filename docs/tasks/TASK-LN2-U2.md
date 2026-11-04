# TASK LN2-U2: Upload check follow-up (notice on a rejected file, retype a mislabelled real image)

Plan `.omc/plans/lanes-2.yaml`, tracer U2 (lane `w2-upload-check`), bead dcm-vqs0. User answers 2026-10-31: (1) when the
byte check rejects a file the uploader sees "That file isn't a real PNG/JPEG/WebP/GIF image, so it was removed."; (2) a
real image whose bytes differ from its recorded type is accepted and its type fixed.

## What landed

| File | What |
|------|------|
| `convex/tables/files.ts` | `fileKindValidator` (shared by `files.kind` and the new table). `files.contentType` (optional): the type the bytes show, set only when it differs from the recorded one. New table `uploadNotices` (`userId`, `kind`, `scope`, `createdAt`; indexes `by_user`, `by_user_scope`). |
| `convex/lib/files.ts` | `claimFile` passes the file's `kind` to `checkUploadBytes`. The check: bytes no allowed image → `rejectUpload` (as before) which now also writes an upload notice for `files.uploadedBy`; bytes a real image of another type → `retypeUpload` records `files.contentType`. A photo-import photo is stored again as a blob of the right type (`photoImport.read` sends the blob's type to the Messages API) and its row moves onto it; one whose bytes are a GIF is rejected (photo import takes no GIF). At most `MAX_UPLOAD_NOTICES` (10) notices per user: writing another drops the oldest, so the table is bounded without a cron. |
| `convex/uploadNotices.ts` | `mine` (userQuery, `returns` validator): the caller's notices for one upload screen (`kind` + `scope`). `dismiss` (userMutation): deletes one of the caller's notices; someone else's is NOT_FOUND, an already gone one is a no-op. |
| `src/components/uploads/upload-notice.tsx` | `UploadNotice`: the line plus a Dismiss button (optimistic), in its own error boundary (rule 11); nothing when there is no notice. No mutation from an effect. |
| Six upload UIs | portrait, photo import, combat map image button (scope: the map it made or replaces), sprite pack uploader, codex gallery (GM), world map image. |
| `tests/convex/lane-u2-upload-notices.test.ts` | notice written, scoped, private, dismissed, capped; portrait and sprite scopes; mislabelled real image kept and retyped; photo re-stored under the right type; GIF photo rejected with a notice. |
| `tests/convex/authz/core.entries.ts` | `uploadNotices.mine` (user), `uploadNotices.dismiss` (scoped: GM's notice; everyone else NOT_FOUND). |

Scope of a notice (the id the upload screen knows): portrait → character, codexImage → codex entry, combatMap → combat
map, sprite → sprite pack, map and photoImport → campaign.

## Edits outside `owns` (orchestrator: accept)

- `tests/convex/lane-u-upload-bytes.test.ts`: the "PNG recorded as JPEG is deleted" case is removed from the reject
  test; the user's answer reverses it, and the new behaviour is tested in the lane-u2 file.
- `tests/convex/schema-guard.test.ts`: `uploadNotices` added to `BOUNDED` (10 rows per user, capped on write).
- `convex/_generated`: not committed; regenerate at merge (new module `uploadNotices`).

## Beads

- dcm-vqs0: done (both halves).

## Follow-ups

None. A notice outlives a deleted campaign or character until dismissed or pushed out by newer ones (bounded).

## QUESTIONS

None.
