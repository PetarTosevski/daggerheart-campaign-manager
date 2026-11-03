# TASK-PH-C5: world map GM edit

Tracer C5-world-edit. Branch `phone/C5-world-edit` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c5-world-edit`,
branched from `phone/A1-on-master` at `615628e`. Not committed.

## What changed

GM map tools live in `apps/mobile/src/features/world/edit/`. The slot stays
collapsed until the GM opens it, so the C3 world view test still never mounts
`world-palette` on the default screen.

Inside the tools panel the GM can:

- paint terrain (`maps.paintCells`, optimistic on `maps.get`) on a dedicated edit map;
- place markers (`maps.addToken`, `maps.addCustomType`, `maps.renameType`);
- move or remove markers (`maps.updateToken`, `maps.removeToken`);
- upload or remove custom map art (`maps.mapImageUploadUrl`, `maps.attachMapImage`, `maps.removeMapImage`);
- reset terrain (`maps.setTerrain`).

Players never mount `WorldEditSlot` with `enabled`; the palette is not visible
until the GM expands map tools.

## Tests

- `apps/mobile/test/features/world-edit/roles.test.tsx` — palette hidden for players and for a collapsed GM world screen; visible after opening tools.
- `apps/mobile/test/features/world-edit/mutations.test.tsx` — `maps:setTerrain`, `maps:removeToken`, `maps:addCustomType`.

## Commands

Node 24, from the worktree root. Set `EXPO_PUBLIC_CONVEX_URL` for mobile checks.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` (Node v24.22.2, `EXPO_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud`) | ESLint and `tsc --noEmit` pass on edit code. Jest: `test/features/world-edit/*` — 7 passed. Full-suite run also hit pre-existing failures (unrelated test timeouts under load; `test/features/world/view.roles.test.tsx` fails to load — RNGH + reanimated mock). |
| `pnpm test tests/convex/codex.test.ts` | 24 tests passed. File not edited. |

## Board wire

`WorldBoard` passes the live map payload: `<WorldEditSlot enabled={isGm} data={data} />`.
The same `maps.get` result paints the board and feeds the tools, so the slot does not subscribe again.

## Not done

Main world board gestures are unchanged. GM paint and placement use the edit map
in the tools panel until a later tracer wires the primary map viewport.
