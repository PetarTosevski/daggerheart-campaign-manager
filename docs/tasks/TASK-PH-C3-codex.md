# TASK-PH-C3: Characters & Locations (Codex)

Tracer C3-codex. Branch `phone/C3-codex` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c3-codex`,
branched from `phone/A1-on-master` at `21b9441`. Not committed.

## What changed

The Characters & Locations section (`apps/mobile/src/features/codex/`) mirrors
the website codex board: kind tabs (characters / locations), region or
allegiance filters, search, list rows with cover thumbnails, and navigation to
a detail route. The GM gets create (`codex.create` with `expo-crypto`
`randomUUID`), import from map pins (`codex.importPins`), player-view preview,
full entry editing (`codex.update`, images, known flag, allegiance, region),
map pin linking (`codex.setPin` via `PinPicker`), gallery with lightbox, and GM
notes via `codex.entryText`. Players receive only `codex.list` and
`codex.entryText` player shapes: no create control, no GM notes, and only
revealed images in the gallery.

`apps/mobile/app/campaign/[campaignId]/codex/[entryId].tsx` mounts
`CodexEntryRoute` (detail). The list remains on `codex.tsx` via `CodexScreen`.
“Show on map” deep-links to `/campaign/<id>/world?token=<id>`.

Harness tests in `apps/mobile/test/features/codex/codex.roles.test.tsx` cover
player vs GM controls, entry text, create intent, map link, loading, and query
errors.

## Commands

Node v24.22.1 and pnpm 10.8.0, from the phone worktree.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. 51 suites, 195 tests. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 1. 22 passed, 2 failed. Failures: `images: players get only revealed ones; revealing marks the entry known` (`gmView.entries[0].images.map((g) => g.url)` was `[]` vs two URL strings) and a related image/cover assertion in the same area. This tracer did not edit that file. |

## Not done

No commit, no push, no merge. World map screen is still `NotBuiltYet`; the codex
only links to it with a token query.
