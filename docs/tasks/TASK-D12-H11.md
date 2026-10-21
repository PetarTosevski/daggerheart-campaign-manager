# TASK-D12-H11: Authz matrix - combat map and sprite packs (dcm-bxp.51, .88)

Plan `.omc/plans/d12-hardening.yaml`, tracer H11 (depends on H0). Harness API: `docs/tasks/TASK-D12-H0.md`.

## What landed

| File | Change |
|---|---|
| `tests/convex/authz/combat.entries.ts` | 63 entries (12 combatMaps, 7 combatMapEdit, 2 combatMapGenerate, 4 combatMapStyle, 17 combatTokens, 11 combatVision, 10 spritePacks); `pending` is empty. Exports the area `setup` and the `sprites` helper for the content tests. |
| `tests/convex/authz/combat.test.ts` | `runMatrix(area)` plus four content tests of the players' side of the map. |

The inventory guard listed no combat function missing: the H0 pending list already held the map-movement
(`combatTokens.move` with blocked/difficult), door (`combatVision.doors`, `toggleDoor`), sprite-pack (`spritePacks.*`,
`combatMapStyle.*`) and sprite hand-editing functions.

## Area setup (every world)

One `combatMaps.create` as the GM (the first map is live at once) and one `t.run` inserting characterA's PC token at
(5, 10) facing east (the token synthesis picks), characterB's at (5, 14), a custom Goblin at (15, 10), a closed door
at (8.5, 10.5) (the object synthesis picks) and a campfire at (7.5, 10.5), both in characterA's view. Packs, sprites,
an image map and stored files are created only in the entries that need them.

## Access classes (read from the code)

| Functions | Class | Rows |
|---|---|---|
| `combatMaps.list`, `get`, `tokenCount`, `create`, `rename`, `setLive`, `duplicate`, `remove`, `imageUploadUrl`, `attachImage`, `setGrid` | `gm` | class defaults |
| `combatMapEdit.*` (7) | `gm` | class defaults |
| `combatMapGenerate.stop` | `gm` | class defaults |
| `combatMapGenerate.generate` (userAction, own GM check `assertGm`) | `scoped` | anon UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, gm ok; `okCodes: ["COMBAT_GENERATE_UNAVAILABLE"]`; the entry's setup deletes `ANTHROPIC_API_KEY`, so the keyword layout is drawn |
| `combatMapStyle.setStyle`, `setSetting`, `settings` | `gm` | class defaults |
| `combatTokens.list`, `combatants`, `sessionEncounter`, `addParty`, `addCustom`, `rename`, `setSide`, `setSize`, `markCustom`, `toggleCustomCondition`, `remove`, `clear` | `gm` | class defaults (custom-token functions act on the Goblin) |
| `combatTokens.placeAdversaries`, `placeSessionEncounter` | `gm` | class defaults; `okCodes` `ENCOUNTER_NOT_RUNNING` / `SESSION_NO_ENCOUNTER` (the world has no running encounter or linked session) |
| `combatVision.previewAs`, `revealTo`, `unrevealTo`, `paintFog` | `gm` | class defaults |
| `spritePacks.*` (10) | `gm` | class defaults (players never get a pack) |
| `combatMaps.live`, `combatMapStyle.spriteSources`, `combatTokens.party`, `combatVision.playerView`, `doors` | `view` | class defaults plus otherPlayer ok |
| `combatTokens.move`, `turn`, `combatVision.explored`, `markExplored`, `setCarriedLight`, `toggleLight`, `toggleDoor` | `view` | class defaults: the player acts on their own token / character / an object their character sees on the live map |

`combatTokens.sessionEncounter` and `placeSessionEncounter` are here (H12 cross-references them).

## Players' view (combat.test.ts)

Domain refusals past the access check are not matrix outcomes, so these tests assert them by `ConvexError.data.code`:

- Only the live map: `combatMaps.live` gives the live map without the GM's `prompt`; on a map that is not live a
  player gets COMBAT_MAP_NOT_FOUND from `spriteSources`, `doors`, `explored`, `markExplored` and `move`, and `[]`
  from `party`; after the GM shows another map, `playerView` is `noCharacter`.
- Only what their token sees: with the door closed the Goblin is not in `playerView.others`; once the GM opens it, it
  is, with name, side, size and facing only (no stats, HP, conditions or `revealedTo`). `party` holds PC tokens only;
  the GM's `list` has the Goblin's numbers.
- Only their own character: the other player gets COMBAT_NOT_YOUR_TOKEN from `playerView` / `explored` for
  characterA and from `move`, `turn`, `setCarriedLight` on characterA's token; the player gets it on the Goblin.
- Never unseen doors or lights: a door and a campfire outside the cone are not in the player's `doors` (the GM's
  lists both); `toggleDoor` answers COMBAT_OBJECT_NOT_FOUND and `toggleLight` COMBAT_LIGHT_NOT_SEEN; the GM switches
  both.
- Never GM packs: the player's `spriteSources` holds only the sprite the map places, without name, pack or the pack's
  other sprite; the GM's holds both of the setting's pack sprites with names; `spritePacks.packs` and
  `combatMapStyle.settings` answer FORBIDDEN.

## Checklist (dcm-bxp.51, dcm-bxp.88)

- combatMaps: list, get, live, tokenCount, create, rename, setLive, duplicate, remove, imageUploadUrl, attachImage, setGrid
- combatMapGenerate: generate, stop
- combatMapEdit: paintCells, clearPaint, addObject, moveObject, removeObject, setObjectSight, updateObject
- combatTokens: list, party, combatants, addParty, placeAdversaries, addCustom, rename, setSide, setSize, markCustom,
  toggleCustomCondition, remove, clear, move, turn, sessionEncounter, placeSessionEncounter
- combatVision: playerView, previewAs, explored, markExplored, revealTo, unrevealTo, setCarriedLight, toggleLight,
  paintFog, doors, toggleDoor
- combatMapStyle: setStyle, setSetting, settings, spriteSources
- spritePacks: packs, createPack, renamePack, setPackExtends, deletePack, spriteUploadUrl, attachSprite, updateSprite,
  removeSprite, reorderSprite
- `characters.toggleCondition`, `feed.remove`, `feed.clear` (listed in dcm-bxp.51) belong to the characters and play
  areas (H7, H8).

## Known bugs

None found: every row matched the expected access.

## Checks

- `pnpm vitest run tests/convex/authz/combat.test.ts tests/convex/authz-matrix.test.ts --maxWorkers=4 --testTimeout=60000`:
  270 passed (combat 261 = 257 matrix rows + 4 content tests; guard 9).
- Area runtime: `combat.test.ts` alone 17.0 s of tests (26.9 s wall with module loading) at load average about 30;
  under the 60 s budget.
- `pnpm typecheck` clean; `pnpm exec eslint` on both test files clean; `pnpm tracer:guard .omc/plans/d12-hardening.yaml H11` OK.
