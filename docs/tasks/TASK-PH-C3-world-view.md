# TASK-PH-C3: world map view

Tracer C3-world. Branch `phone/C3-world` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c3-world`,
branched from `phone/A1-on-master` at `21b9441`. Not committed.

## What changed

The phone world screen loads `maps.get` and renders the map art, terrain overlay,
hex crawl layers, party trail, tokens and the travel legend. Player-visible
tokens and hexes come from the server-filtered `maps.get` payload; the client
does not call `playerMapView` again.

Terrain and hex geometry batch into a small number of Skia `Path` nodes via
`apps/mobile/src/features/world/paths/layers.ts` (not one node per hex). GM
paint, the place-on-map palette and token editing live in
`apps/mobile/src/features/world/edit/` as stubs for C5-world-edit.

## Tests

- `apps/mobile/test/features/world/view.roles.test.tsx` — player subscribes to
  `maps:get` only (with `campaigns:get`); neither role mounts `world-palette`.
- `apps/mobile/test/features/world/batching.test.tsx` — 4,000 hex fixture uses
  at most three Skia path layers.

## Commands

Node 24, from the worktree root. Set `EXPO_PUBLIC_CONVEX_URL` for mobile checks.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Node v24.22.1, `EXPO_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud`. ESLint, `tsc --noEmit`, and Jest passed (includes `world/view.roles.test.tsx` and `world/batching.test.tsx`). Exit 0. |
| `pnpm test tests/convex/codex.test.ts` | 24 tests passed. Exit 0. File not edited. |

## Not done

No GM paint or palette (C5). No commit, push, or merge into `master`.
