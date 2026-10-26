# TASK-D9-C1: Pure domain - layout spec, sight defaults, ranges, light and vision engine

Status: Done. Plan: `.omc/plans/d9-combat-map.yaml`, tracer C1 (wave 1, no dependencies). Bead: dcm-bxp.32.
Rules implemented: R6, R7, R8, R9, R10, R11 (engine side), R12 (fog marks in the engine); questions Q1 (FOG_PAD_SQUARES), Q2, Q3, Q4.

## Goal
A pure, tested TypeScript module validates a map layout and answers what a character sees (cone, line of sight, light level per
square, token visibility) for any map, time phase and set of lights. It has no framework imports and no new dependency (zod only),
so Convex queries (C7) and the browser (C8) run the same code.

## Files
- `src/lib/domain/combat-map/spec.ts`: `TERRAINS` (14, the board's TER), `OBJECT_KINDS` (22, the board's KINDS incl. `walltorch`
  and `hull`), `AREA_SHAPES` (rect, ellipse, poly, path, border), `OBJECT_VARIANTS`, the caps (w 12..44, h 10..32, 60 areas,
  300 objects, 40 points, title 80, r 0.3..4), the zod schemas `areaSchema`, `mapObjectSchema`, `mapSpecSchema` with the types
  `MapArea`, `MapObject`, `MapSpec`, and `clean(raw, seed?)`, the port of the board's `CMAP.clean`.
- `src/lib/domain/combat-map/sight.ts`: `SIGHT_DEFAULTS` per kind (R7), `sightOf`, `blocksSight`, `SIGHT_LABEL`,
  `blockRadiusFactor` (the board's footprint: tree 0.8, tent 0.75, others 0.55 of r).
- `src/lib/domain/combat-map/ranges.ts`: `RANGE_BANDS`, `RANGE_SQUARES`, `VERY_FAR_MIN_SQUARES`, `rangeBandOf`.
- `src/lib/domain/combat-map/light.ts`: `lightOf(phase)`, `DIM_PHASES`, `DIM_PHASE_BADGE`, `CARRIED_LIGHTS`,
  `CARRIED_LIGHT_REACH`, `CARRIED_LIGHT_LABEL`, `MAP_LIGHT_REACH`, `isLightObject`, `isLit`.
- `src/lib/domain/combat-map/vision.ts`: the engine (below) and the explored-bitmap helpers.
- `src/lib/domain/combat-map/index.ts`: re-exports all five.
- `tests/unit/combat-map-spec.test.ts` (17 tests), `tests/unit/combat-map-vision.test.ts` (34 tests).

## Rules quoted
- **R6** "Vision cone: 70 + 15 x Instinct degrees, capped at 180 (floor 10). Never behind. Base 70 and step 15 are named constants in
  one place (the user may tune them)." -> `VISION_BASE_DEG`, `VISION_STEP_DEG`, `coneDeg`.
- **R7** "anything big enough to hide behind blocks sight (walls, trees, tents, boulders, pillars, statues, masts). Bushes, rocks,
  logs, crates, barrels, chests, tables, rubble are cover only by default; the GM can set any object to block sight."
- **R8** "Day phases and Nautical Dawn = full vision in the cone. Dim phases are ONLY Nautical Twilight (last DAY day) and Nightfall
  (first NIGHT day) ... The other night phases are night. (The board wrongly lists Nautical Dawn as dim: fix it.)"
- **R9** "Night: no light = clear in Melee (1), dim to Very Close (3), nothing beyond. Torch and lantern = clear to Close (6), dim to
  Far (12). Alistair's Torch = clear to Far (12). Wall torch (map object) = like a torch. Campfire (map object) = double: clear to 12,
  dim to 24."
- **R10** "Dim light at night hides tokens (other than PCs, see Q4). The GM asks for a roll; on a success the GM reveals that token to
  that player." **R11** "Each player sees only their own character's view. Explored areas stay faintly visible, but tokens there are
  hidden unless the character can see them now." **R12** "...can reveal or hide areas by hand with a brush."
- **Q2** a lantern is the same as a torch. **Q3** every token can carry a light; "A carried light lights the area around its bearer
  for every viewer who can see that area." **Q4** "a player always sees the other PCs' tokens, but NOT what those PCs see ... Allies
  and neutral tokens follow R10 like enemies." **Q1** fog pad `FOG_PAD_SQUARES` (default 24).

## Book pages (re-checked in `.reference-private/`, Core Book printed pages)
- **CB p.103**, "Optional Rule: Defined Ranges": "If your table would rather operate with more precise range rules, you can use a
  1-inch grid battle map during combat. If you do, use the following guidelines for play: Melee: 1 square; Very Close: 3 squares;
  Close: 6 squares; Far: 12 squares; Very Far: 13+ squares; Out of Range: Off the battlemap." -> `RANGE_BANDS`.
- **CB p.104**, "Cover, Line of Sight, and Darkness": "When you take cover behind something that makes attacking you more difficult
  (but not impossible), attack rolls against you are made with disadvantage. You usually can't be targeted if you're entirely behind
  a substantial structure like a wall ... You have line of sight if you can see the target ... Darkness can also make certain actions
  more challenging. The GM should reflect this by raising the Difficulty of action rolls or imposing disadvantage on rolls made by
  the PCs." The book has no vision ranges; the radii are the user's house rule (R9). Cover-only objects therefore never block sight.
- **CB p.129**, Alistair's Torch (loot table, 04): "You can light this magic torch at will. The flame's light fills a much larger
  space than it should, enough to illuminate a cave bright as day." -> clear to Far with no dim band, `[12, 12]`.

## The engine
Geometry: squares; vision works on half-squares ("samples", `SAMPLES_PER_SQUARE` = 2, as on the board), so a 44 x 32 map is
88 x 64 samples. A token at (x, y) with size s covers [x, x+s) x [y, y+s) and looks from its centre; facing in radians, 0 = east,
y down (the board's convention). Levels: 0 unseen/dark, 1 dim, 2 clear.

1. `prepareMap(input)` builds the blocking grid once per query: terrain `wall`/`void` from the areas rasterised in order (later
   areas win, each area only over its bounding box), hand-painted terrain (`paint`, "x,y" -> terrain) over that, painted sight
   blockers (`block`, "x,y"), and every object whose `sightOf` is `block` (circle of r x `blockRadiusFactor`). `image: true` ignores
   terrain (as the board does for uploaded maps). It also lists the lit map lights (`lit !== false`). One `PreparedMap` serves every
   viewer (C7: `playerView`, `previewAs`).
2. `createView(map, {token, characterId, instinct}, {phase, tokens, fog})` fixes the cone, the light level (`lightOf(phase)`), the
   light sources at night (the viewer's own carried light or bare night vision `[1, 3]`; every other token's carried light, Q3; lit
   map lights) and GM fog marks.
3. `sampleLevel` (lazy, cached per view): GM fog mark wins; else the sample must be in the viewer's own footprint or inside the cone
   (never behind) and in line of sight; by day and in the dim phases that is clear; at night the best level over the sources that
   reach it (`clear + 0.5` / `dim + 0.5` squares, the board's slack) and have their own line of sight to it (the viewer's own light
   needs none).
4. `los(map, ax, ay, bx, by)` walks the half-square cells along the segment exactly (Amanatides-Woo) instead of the board's 5 samples
   per square. As on the board, cells within 0.75 squares of the start do not block, the target cell itself does not block (a wall
   face is seen), and leaving the map blocks.
5. `visibleSquares(view)` returns the whole grid (`levels`, `sw`, `sh`, `scale`) for C8's fog; `pointLevel(view, x, y)` answers one
   point (C7's `toggleLight` check for a map light).
6. `tokenVisibility(view, token)`: any `side: "pc"` token -> `clear` (the viewer's own and other PCs, Q4); others take the best level
   over their samples: 2 -> `clear`; 1 -> `dim` if `revealedTo` holds the viewer's character id (R10; shown with the revealed
   outline), else `hidden`; 0 -> `hidden` even when revealed or explored (R11).
7. Explored areas (R11): `exploredLength(w, h)`, `exploredFrom(grid)`, `encodeExplored` / `decodeExplored` (6 samples per URL-safe
   character; a 44 x 32 map is 939 characters), `mergeExplored`, `exploredGrows` (send `markExplored` only when it grows). The client
   and the server use the same format.

## Deviations from the board (deliberate)
- Nautical Dawn is day, not dim (R8 fix).
- Carried lights come from every token (Q3), not only PCs.
- The board sees anything within 0.9 squares regardless of facing; here only the viewer's own footprint is always seen, so an
  adjacent token straight behind is hidden ("never behind", R6).
- `clean` drops areas with an unknown shape, polygons with fewer than 3 points, paths with fewer than 2, and unknown object kinds and
  variants (the board kept them and the painter ignored them); coordinates are clamped to 4 squares around the map, `len` to 0.5..12,
  `span` to 1..12. Everything `clean` returns passes `mapSpecSchema`.
- GM fog marks act after vision, as on the board: "reveal" makes a square clear (tokens on it are shown), "hide" makes it unseen.

## Acceptance evidence
- `pnpm vitest run tests/unit/combat-map-spec.test.ts tests/unit/combat-map-vision.test.ts`: 2 files, 51 tests pass.
- Covered: every R6-R11 row of the light table (no light, torch, lantern, Alistair's Torch, wall torch lit/unlit, campfire, day,
  dawn, both dim phases), the 180 cap and 10 floor, never behind (also at 180), a wall and a tree blocking sight, a bush not
  blocking, a bush override blocking and a tree override not blocking, painted blockers and image maps, the Nautical Dawn fix, Q3
  (enemy torch lights its surroundings; not through a wall), Q4 (other PCs always shown; their vision not shared), allies/neutrals
  under R10, reveals only for the named character, revealed-but-out-of-sight hidden, large tokens, fog marks, explored encoding.
- Speed: a 44 x 32 map with 300 objects (100 trees, 50 boulders, 60 bushes, 40 crates, 25 lit campfires, 25 lit wall torches),
  5 wall/terrain areas and 81 tokens (every 7th with a torch), viewer at the 180 cone: `prepareMap` + `createView` +
  `visibleSquares` + `tokenVisibility` for all 81 tokens. Median of 9 runs after warm-up: about 1.0 ms by day and 1.1 ms at night
  on the loaded dev machine; the test asserts < 50 ms.

## For later tracers
- C3/C5: `clean` and `mapSpecSchema` validate layouts; `sightOf` / `SIGHT_LABEL` for the object panel; `RANGE_BANDS` for rings (C6).
- C7: build `prepareMap` from the map row, its object rows (`sight`, `lit`), the `terrain` and `block` cell tiles (as "x,y" keys) and
  `image`; `createView` with the caller's PC token, its character's Instinct, the campaign phase, all tokens and the fog tiles; filter
  with `tokenVisibility`. `pointLevel(view, o.x, o.y) > 0` or the decoded explored bit says a player has seen a light.
- C8: the same calls on the client; `visibleSquares(view).levels` paints the fog; `FOG_PAD_SQUARES` pads the player's fog (Q1).
