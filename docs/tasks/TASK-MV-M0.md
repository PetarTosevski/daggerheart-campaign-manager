# TASK-MV-M0: Movement rules - blocking and difficult squares; the server refuses blocked player moves

Status: Review. Plan: `.omc/plans/map-movement.yaml`, tracer M0 (wave 1). Bead: `dcm-bxp.80`.

## Decisions this tracer implements
- USER ANSWER (2026-10-21): "tokens stopped by walls and buildings, difficult terrain requires movement rolls to pass on
  the same turn (logic will be implemented later)". Blocking is enforced now; difficult terrain is only reported.
- USER ANSWER (2026-10-21, doors): doors can be opened and closed; a closed door blocks movement, an open one does not.
  M2 adds the switch (an optional `open` field on map objects, absent = closed) and the sight part. M0 adds the catalog
  `move` value `"door"`, `movement.ts` reads each object's optional `open`, and the server passes
  `(object as { open?: boolean }).open`, which is absent until M2 widens the schema, so every door is closed for now.
  Sight, the schema and the validators are untouched.
- D1 blocking: terrain `wall`, `void`; the GM's painted sight blockers (cells "block" layer, also on image maps);
  Classic kinds pillar, statue, boulder, mast, tree, deadtree; sprites whose `move` is `"block"`, and doors (`"door"`
  sprites, M2's Classic `door` kind, already listed in `CLASSIC_MOVE`) unless open.
- D2 difficult: terrain water, deep, swamp, snow, lava; Classic kinds rubble, bush, log, bones; sprites whose `move` is
  `"difficult"`. Difficult never blocks; a square that blocks is never also difficult.
- Sprite default `move`: blocks sight and tall = `"block"`; else `"difficult"` when its Classic kind is difficult in
  `CLASSIC_MOVE` (bush, log, bones, rubble); else `"open"`. The catalog overrides per item; uploaded sprites use the
  same default from their labels and `classicKind`.
- Orchestrator answers (2026-10-21): a Classic `hull` does not block; squares inside its outline (`points` polygon;
  without points its vision footprint) are deck, neither blocked nor difficult whatever the terrain under the ship
  (`deep`); masts, objects and painted blockers on the deck still count. A hull with a sprite `move` is no deck.
  Painted sight blockers block movement. Pits and chasms are difficult (by the Classic-kind default). The four-poster
  bed and the armoury rack block; the notice board and the gong stay open. The start-squares choice below stands.
- D3: a player's move of their own token whose path crosses a blocking square is refused (`MOVE_BLOCKED`); the GM's
  moves are never refused and return `blocked: true`.
- D4: the path is the supercover line between the start and end squares (both squares at an exact diagonal corner),
  and every square the token's footprint (size 1..3) covers along it is checked.
- D6: `MOVE_BLOCKED` carries no position (payload `{code}` only). Players already receive the whole layout
  (`combatMaps.live`, Q1), so `difficult` and the refusal tell them nothing they could not compute.

## Pure rules (`src/lib/domain/combat-map/movement.ts`)
Exports: `MOVE_TRAITS`, `MoveTrait` (`"open" | "difficult" | "block" | "door"`), `MoveEffect`, `MOVE_BLOCKING_TERRAINS`,
`DIFFICULT_TERRAINS`, `CLASSIC_MOVE`, `defaultMove({sight, height, classicKind?})`, `terrainMove(terrain)`,
`MovementObject` (with `points` for hulls and `open` for doors), `isDeck(object)`, `moveEffect(object)`, `MovementMapInput`, `MovementGrid`, `Square`, `buildMovementGrid(input)`, `isBlocked`,
`isDifficult`, `supercover(from, to)`, `sweptSquares(from, to, size)`, `pathBlocked(grid, from, to, size)`,
`crossedDifficult(grid, from, to, size)`, `checkMove(grid, from, to, size)`.

- Terrain comes from `rasterize` (src/lib/combat-map/raster.ts) at one sample per square, with painted cells on top. An
  uploaded image ignores terrain (as vision does). Order: terrain, then decks clear their squares, then painted
  blockers, then objects.
- Object footprints are the vision engine's (`prepareMap`): a rect sprite is its w x h rectangle turned by `rot`,
  anything else the circle `r * blockRadiusFactor(kind)`. A square counts when any of its four vision samples is covered.
- Choices (reversible): the squares a token starts on are never checked (a token may always step off where it stands,
  and leaving a difficult square does not count); a move to the same square checks nothing.

## Catalog (`src/lib/sprite-packs/catalog/**`, `traits.ts`)
- Every entry has `move`: objects from the `move` option of `obj()`/`long()` or the default above; textures from their
  terrain class (`terrainMove`).
- `spriteMove(ref, lookup)`: the catalog's `move` for a built-in key, the default from an uploaded row's labels,
  null when the ref does not resolve (the object then moves as its Classic kind). `spriteTraits` is unchanged, so the
  vision traits stay P3's shape.
- Overrides (pinned in `tests/unit/sprite-catalog.test.ts`):
  - block: wooden fence section, chicken coop with fenced run, iron fence section, iron cage, cell with bars, suit of
    armour, four-poster bed, armoury rack.
  - door: wooden door (closed), portcullis section, crypt gate, sewers iron gate, grassland wooden gate, wooden fence gate.
    The trapdoor stays open (a floor hatch).
  - difficult: vegetable garden plot, trash pile, pile of rubble, fallen tree trunk, thorn bramble, small pond, loose
    rocks, ice patch, rockslide, rock pile, underground pool, collapsed tunnel, collapsed wall, sacred pool, bubbling mud,
    rotting log, bog pool, snowdrift, frozen lake hole, sand dune (the only default-block item made difficult), oasis
    pool, tide pool, sludge pile, sewage puddle, collapsed pipe, flooded chamber, ruins rubble, mossy brick pile,
    underground lake, dark pool, lava pool. (Several of these now equal the Classic-kind default; kept explicit.)
  - open (walkable surfaces whose Classic kind would make them difficult): bedroll, fur bedroll, picnic blanket, small
    rug, great rug, desert rug, prayer mat; wooden bridge, rope bridge, stone bridge over channel, lava bridge, broken
    boardwalk, wooden pier section; stone stair, stone stair down, staircase, stair up, stairs below deck, priest's dais;
    bloodstain, animal tracks, stained-glass light pattern, sand dune ripple, cracked tile; pressure plate, lever, grate,
    valve wheel, ladder up.

## Server
- `convex/lib/combatMovement.ts` `movementGrid(ctx, campaignId, map)`: reads the map's objects (`by_map`, at most 300),
  its painted "terrain" tiles (`by_map_layer_tile`, at most 4; none for an image map), its painted "block" tiles (same
  index, at most 4) and one `get` per distinct uploaded sprite the objects use (built-in sprites and Classic objects
  read nothing).
- `combatTokens.move`: args unchanged; returns `{x, y, face, blocked, difficult}`. A move to the square the token
  stands on skips the grid (no extra reads).

| Caller | Result |
| --- | --- |
| anonymous | UNAUTHENTICATED |
| outsider | NOT_FOUND |
| player, another PC's or a non-PC token | COMBAT_NOT_YOUR_TOKEN |
| player, own token, path blocked | MOVE_BLOCKED (`{code}` only; the token stays) |
| player, own token, path clear | `{x, y, face, blocked: false, difficult}` |
| GM, any token | `{x, y, face, blocked, difficult}` (never refused) |

Reads added to one move on a full map (300 objects, every terrain and block tile): 300 + 4 + 4 = 308 documents, plus
one per distinct uploaded sprite the objects reference (0 on built-in or Classic maps; at most 300).

`tests/convex/combat-tokens.test.ts` (added to M0's owns) now expects `blocked: false, difficult: false` in `move`'s
return.

## Tests
- `tests/unit/combat-movement.test.ts`: traits, terrain, painted cells and areas, image maps, Classic footprints, a 3 x 4
  barn (upright and turned), a rotated wall section, a garden plot, supercover and diagonal corners, 2 x 2 and 3 x 3
  tokens, a fence with a gate (closed blocks, open passes, gap passes), difficult crossing, standing still, painted
  sight blockers, a hull deck over deep water (outline, footprint, sprite hull), the Classic-kind sprite default.
- `tests/unit/sprite-catalog.test.ts`: every item's `move` (default or override), textures, the plan's examples,
  `spriteMove`.
- `tests/convex/combat-token-movement.test.ts`: the role table, the payload without a position, walls from cells and
  areas, painted sight blockers, a ship's deck with a mast, water and rubble difficult, cottage / garden plot / fence /
  closed gate sprites, uploaded sprites, image maps.
