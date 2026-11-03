# TASK-PH-C4: combat map view

Tracer C4-combat. Branch `phone/C4-combat` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c4-combat`,
branched from `phone/A1-on-master`. Not committed.

## What changed

The phone combat map tab loads `combatMaps.live` and `combatVision.playerView`,
paints Classic or Sprites layouts through the C1 Skia adapter, composites player
fog from `playerView` vision masks, draws visible tokens, and supports pan/pinch/zoom
(reusing the world map pan/zoom helper). Contract slots stub play, GM tools and edit
for C5/C6.

## Queries

| Role | Subscribes |
| --- | --- |
| Player | `campaigns:get`, `combatMaps.live`, `combatVision.playerView` |
| GM | `campaigns:get`, `combatMaps.live`, `combatVision.playerView` |

Players must not subscribe to `combatMaps.list`, `combatMaps.get`,
`combatTokens.list`, or `combatVision.previewAs` (harness tests).

## Validation

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` (Node v24.22.1, `EXPO_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud`) | ESLint and `tsc --noEmit` pass. Jest: 218 tests pass; `test/features/world/view.roles.test.tsx` fails to load (RNGH + reanimated mock — pre-existing). `combat-view/*` and `combat-spike/*` pass. |
| `pnpm test tests/convex/codex.test.ts` | Failed to start vitest: missing `rolldown-binding.darwin-arm64.node` in this checkout. File not edited. |
