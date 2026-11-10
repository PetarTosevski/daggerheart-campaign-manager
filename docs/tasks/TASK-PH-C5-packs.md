# TASK-PH-C5: Sprite packs (GM)

Tracer C5-packs. Worktree
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c5-packs`.
Not committed.

## What changed

The GM **Sprite packs** screen (`apps/mobile/src/features/packs/`) ports the website
`src/components/combat-map/packs/` flow (P8): create a pack (name and setting),
rename packs and sprites, cut sheets or single sprites on device (Skia + the shared
P2 cut core), label cuts, upload via `spriteUploadUrl` / `attachSprite`, and reorder
sprites with up/down. Pack delete uses the same two-tap confirm as the website.

`apps/mobile/app/campaign/[campaignId]/(gm)/packs.tsx` keeps the GM gate: players
still land on the dashboard and subscribe only to `campaigns:get`. The GM route
mounts `PacksScreen`, which subscribes to `spritePacks:packs`.

Optimistic updates on `spritePacks.packs` are not wired on phone (plain
`useMutation` avoids duplicate `campaigns:get` subscriptions in the harness when
`.withOptimisticUpdate` is used).

Harness tests live in `apps/mobile/test/features/packs/packs.roles.test.tsx`.

## Commands

Node v24.22.2 and pnpm 10.8.0, from the phone worktree.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 1. ESLint (warnings only in `test/features/combat-view/view.roles.test.tsx`) and `tsc --noEmit` pass. Jest: 62/64 suites passed, 239/240 tests passed. Failures outside this tracer's `owns`: `test/shell/gm-stubs.test.tsx` (expects the old Packs stub: header "Packs" and "Not built yet."; the built screen uses "Sprite packs" and subscribes to `spritePacks:packs`). `test/features/world/view.roles.test.tsx` fails to load (`Reanimated.createAnimatedComponent` in gesture-handler). |
| `pnpm exec jest --ci test/features/packs/packs.roles.test.tsx` | Exit 0. 4 tests passed. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 1. 23 passed, 1 failed: `map pins: only existing tokens, region from the pin, hidden tokens never reach players` (`gmView.entries[0]` had `tokenId: null`, `region: ""`, `regionAuto: false`). This tracer did not edit that file. |

## Not done

`test/shell/gm-stubs.test.tsx` now expects the Sprite packs screen and a `spritePacks:packs` subscription for a GM. A player still lands on the dashboard.
