# TASK LN-U: Upload byte check on every upload path

Plan `.omc/plans/lanes.yaml`, tracer U (lane `w2-upload-check`), bead dcm-bxp.93. User answer 2026-10-23: "add a byte
(magic-number) check on every upload path: an internal action reads the blob's first bytes, deletes on mismatch with
the png/jpeg/webp/gif allowlist. Extend CF16 in docs/best-practices.md."

## What landed

| File | What |
|------|------|
| `convex/lib/files.ts` | `sniffImageType` (png, jpeg, webp, gif magic numbers from the first 12 bytes). `claimFile`, which every upload path already calls last (after its size and recorded-type check), now also schedules `checkUploadBytes` (internal action: reads the blob's first bytes; passes when they are the recorded type). On a mismatch it runs `rejectUpload` (internal mutation): takes the file off its record (`detachFile`, per kind), deletes the `files` row and the blob, returns normally (CF16), logs a warning. A file already replaced or removed is left alone. Function references by name (`lib/files:...`), as `lib/inviteEmail.ts`, so `_generated/api` needs no regeneration. |
| `docs/best-practices.md` | CF16: the byte check through `claimFile` on every upload path; the stale `acceptUpload` name replaced by `isAllowedImage`. |
| `tests/convex/lane-u-upload-bytes.test.ts` | `sniffImageType` cases; for each upload path (`maps.attachMapImage`, `codex.attachImage`, `characters.attachPortrait`, `combatMaps.attachImage` new map and replacing a layout, `spritePacks.attachSprite`, `photoImport.claim`): every allowed header stays; an SVG or HTML body sent as image/png and a PNG recorded as JPEG is attached first, then deleted with its record cleared. Also: a rejected replacement map leaves no map image; rejecting a bad sprite keeps its pack siblings; a duplicated image map's copy (`combatMaps.copyImage`) is checked and kept; a file removed before its check is left alone. |

What each upload path does when the bytes fail (the record simply loses the image, as when the GM removes it):

- `maps.attachMapImage`: `customMap` is removed (a published frame shows its own art again).
- `codex.attachImage`: the image leaves the entry; if it was the cover, the cover becomes none (as `codex.removeImage`).
- `characters.attachPortrait`: the portrait is removed.
- `combatMaps.attachImage`: the map loses `image` but keeps its squares, tokens and name (a replaced layout is not
  restored; as a duplicate whose image copy failed).
- `combatMaps.copyImage` / `attachCopiedImage` (duplicate): the copy goes through `claimFile` too. A server-made copy may
  have no recorded type; then its bytes must still be one of the four types.
- `spritePacks.attachSprite`: the sprite row is removed (as `removeSprite`; objects that used it fall back to their
  Classic kind) and the pack is touched.
- `photoImport.claim`: the photo's `files` row and blob go; `read` then skips it.

No public function's args or returns changed: the authz matrix entries are unchanged in meaning.

## Tests changed outside `owns` (orchestrator: accept these or move them)

Fixtures that attached fake bytes (zeros, "png", "img") now fail the byte check; with real timers convex-test runs the
scheduled check in the background, so 8 tests in 4 files failed and the rest raced it. One helper in
`tests/convex/helpers.ts` (`imageBytes`, `imageBlob`: a real magic number of the type, at least 12 bytes) replaces the
fake bodies, same sizes otherwise:

- `tests/convex/helpers.ts` (the helper)
- `tests/convex/authz/combat.entries.ts`, `tests/convex/authz/world.entries.ts` (fixture bodies only, no entry change)
- `tests/convex/characters-summary.test.ts`, `characters.test.ts`, `cleanup.test.ts`, `codex-read-budget.test.ts`,
  `codex.test.ts`, `combat-map-edit-sprites.test.ts`, `combat-map-generate-sprites.test.ts`,
  `combat-map-generate.test.ts`, `combat-map-style.test.ts`, `combat-maps.test.ts`, `combat-token-movement.test.ts`,
  `combat-vision-sprites.test.ts`, `maps.test.ts`, `photo-import.test.ts` (also: the exact-bytes test's body starts
  with a PNG header), `sprite-fields.test.ts`, `sprite-packs.test.ts`, `upload-claims.test.ts`

E2e specs upload real PNGs or canvas output, so they need no change.

## Decisions (simplest defaults)

- The bytes must be the recorded type, not just any of the four: a PNG recorded as image/jpeg is rejected. Storage
  serves the recorded type, and photo import sends it to the API as the media type, so a mismatch is a broken file.
- No message to the user: the image disappears (the attach already returned `{ ok: true }`). Only a hand-made request
  or a mislabelled file (an SVG renamed .png) reaches it; the honest upload screens send real images or canvas output.
- The check lives in `claimFile`, so no upload path can skip it; `attachCopiedImage` (a copy of a checked file) is
  checked as well, which is cheap.

## QUESTIONS

1. Should a file that fails the byte check after attach tell the GM (a toast, or a feed line such as "The image for X
   was removed: it isn't a PNG, JPEG, WebP or GIF")? Built: it disappears silently, with a server log line.
2. Should a mislabelled but real image (PNG bytes recorded as JPEG) be accepted instead of rejected? Built: rejected.

## Merge-time actions

- Accept the test fixture changes listed above (outside `owns`).
- No `convex/_generated` regeneration is needed for this lane (references by name), but the usual regeneration after
  merge picks up `lib/files:checkUploadBytes` and `lib/files:rejectUpload` in `api.d.ts` harmlessly.
- AGENTS.md / CLAUDE.md top-15 rule 10 still says "check size and an explicit type allowlist"; it could add "and the
  scheduled byte check" (not this lane's files).
