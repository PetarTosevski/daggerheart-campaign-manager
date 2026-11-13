# TASK-ME4: walls on the server

Status: Review. Plan: `.omc/plans/map-editor.yaml`, tracer ME4 (bead dcm-5rhs.5, epic dcm-5rhs). Builds on ME1 (geometry, `docs/tasks/TASK-ME1.md`) and ME2 (64 x 64 maps). ME5 (draft and publish), ME6 (rendering), ME7 (wall tools) and ME12 (phone) build on it.

## Table

`combatMapWalls` (`convex/tables/combatMaps.ts`, fields in `convex/lib/combatMapWalls.ts`), one row per wall run, index `by_map` (`mapId`):

| field | meaning |
|---|---|
| `mapId` | the map (back-reference, rule 6) |
| `kind` | `wall`, `door`, `window`, `secret`, `low`, `oneway` (ME1 `WALL_KINDS`) |
| `points` | `[x, y]` in squares, 2 to 64 of them, clamped onto `[0, w] x [0, h]` |
| `open?` | doors and secret doors: `true` = open; absent = closed |
| `revealed?` | secret doors: `true` = the GM revealed it; absent = a wall |
| `side?` | one-way walls: `"right"` when the open side is on the right as drawn; absent = left |
| `style?` | `stone`, `wood`, `cave`, `hedge` (ME6 draws them); absent = the renderer's default |

Caps: `MAX_WALL_RUNS` = 400 runs per map (`COMBAT_WALL_LIMIT`), `MAX_WALL_POINTS` = 64 points per run (`INVALID`). Every read is `by_map` with `.take(400)`. No `campaignId`: a wall is reached through its map, like objects and cells (`schema-guard` lists it as map-scoped).

## Functions (`convex/combatMapWalls.ts`)

| function | who | what |
|---|---|---|
| `list({ mapId? })` | every member | `{ mapId, walls }` or null. The GM: any map (default: live), as stored. A player: the live map only (`COMBAT_MAP_NOT_FOUND` for another), each unrevealed secret door as `{ _id, kind: "wall", points, style? }` |
| `add({ mapId, kind, points, style?, side?, open?, revealed? })` | GM | `{ wallId }`. `open`, `revealed` and `side` are kept only for the kinds that use them (so the editor's undo of a delete restores a run in one call) |
| `update({ wallId, kind?, style?, side? })` | GM | a new kind keeps only what it uses; `style: null` = default; `INVALID` with nothing to change |
| `moveVertex({ wallId, index, x, y })` | GM | one point, clamped |
| `split({ wallId, index, at? })` | GM | `{ first, second }`. Without `at`: at inner point `index`. With `at`: a new point between `index` and `index + 1`. The first part keeps the id; the second copies kind, style, side, open, revealed |
| `remove({ wallId })` | GM | deletes the run |
| `setRevealed({ wallId, revealed })` | GM | secret doors only (`INVALID` otherwise). Both directions leave the door closed |

A wall id outside the campaign, or gone, is `COMBAT_WALL_NOT_FOUND` (new code, `src/lib/errors/combatMap.ts`, with a refusal entry).

## Doors in walls (`convex/combatVision.ts`)

- `toggleDoor({ objectId, open })` also takes a `combatMapWalls` id. A wall door is a `door` run or a revealed `secret` run (`isWallDoor`). The rule is D7/D8 plus B4, as for door objects. The GM can always switch it. A player can switch it only on the live map, only when one of their characters has seen a vision sample the run touches (now or explored; otherwise `COMBAT_OBJECT_NOT_FOUND`), and only when the same character has a token within Melee of a square the run touches (otherwise `COMBAT_OUT_OF_REACH`). Switching stores the samples seen now as explored (dcm-bxp.121).
- A seen run that is not a door is `INVALID`. An unrevealed secret door gets the same refusal as a plain wall, so a player learns nothing from it. The GM gets `INVALID` "Reveal the secret door first."
- `doors` returns a new optional field `wallDoors: { _id, points, open, reach }[]`. The GM gets every wall door. A player gets the ones their characters have seen. Unrevealed secret doors are never listed, not even to the GM.
- A wall door's footprint (`wallSquares`, `wallSamples`) is every cell its segments pass through. For a run lying on a square edge, that means both squares, but never the squares past its ends.

## Movement, vision and attack sight

- `convex/lib/combatMovement.ts` `movementGrid` passes the runs as `walls` to `buildMovementGrid`. Every move check uses them: `combatTokens.move` and the feature prompts.
- `convex/lib/combatVision.ts` `loadScene` passes them to `prepareMap`. The fog, token visibility, lights, `doors` and attack sight all go through `scene.prepared`: `lineOfSight` in `convex/lib/combatActions.ts` and `cardRunner`. So walls block sight, one-way walls pass sight from their open side only, and a low wall gives cover.

## Deleting

`deleteMapChildren` (`convex/lib/combatMaps.ts`) deletes walls last, within the same budget (`deleteMapWalls`). Map delete (`combatMaps.remove` and its scheduled continuation) and the campaign purge (`convex/cleanup.ts`) both go through it, so walls are deleted in batches.

## Files outside ME4's `owns`

The plan's `owns` does not cover these files, but the acceptance needs them. Each change is a few lines:

- `convex/lib/combatVision.ts`: `loadScene` loads the walls. The plan lists `convex/combatVision.ts`, but the scene is built in the lib.
- `convex/lib/combatMaps.ts`: `deleteMapChildren` calls `deleteMapWalls`. Map delete and purge both go through it.
- `tests/convex/authz/combat-maps.test.ts`: the new area's runner (the matrix guard requires one per `*.entries.ts`).
- `tests/convex/schema-guard.test.ts`: `combatMapWalls` added to `MAP_SCOPED` (every table needs a retention class).
- `src/lib/errors/refusals.ts`: entries for the two new codes (`Record<RefusalCode, Entry>` fails typecheck without them).

## Tests

- `tests/convex/combat-map-walls.test.ts`:
  - GM edits: round trip, clamping, both splits, the caps (400 runs, 2..64 points), campaign isolation, reveal and hide.
  - What players receive: the exact shape of an unrevealed secret door, the live map only.
  - Each kind's effect through the real queries: wall, window, one-way (both sides), low wall (difficult step, attack-sight cover via `loadScene` + `lineOfSight`), and doors (unseen, out of reach, wall run, open, close after walking through, GM).
  - Secret doors before and after reveal.
  - Wall-door footprint squares.
  - Map delete with a scheduled continuation; campaign purge in batches, leaving other campaigns' walls.
- `tests/convex/authz/combat-maps.entries.ts`: every new function, for every role of its access class (anonymous, outsider, player, GM and the class's other rows). Runner: `tests/convex/authz/combat-maps.test.ts`.

## Follow-ups (not in ME4)

- `combatMaps.duplicate` does not copy walls, and `adminExport` does not export them (`convex/combatMaps.ts` is ME5's).
- Undo of a `split` needs a join (or a set-points intent). ME7 should say which one it wants.
- `docs/data-model.md`: the orchestrator adds `combatMapWalls` from this file.
