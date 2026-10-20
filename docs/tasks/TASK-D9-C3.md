# TASK-D9-C3: Maps - list, create, rename, duplicate, delete, live, image upload, grid, map view

Status: Review. Plan: `.omc/plans/d9-combat-map.yaml`, tracer C3 (wave 2; depends on C0, C1, C2). Bead: `dcm-bxp.32`.

## Goal
The GM keeps several maps per campaign, uploads a map image and aligns its square grid, pans and zooms the painted or
uploaded map, and marks one map live; players open the tab and see the live map.

## Rules this tracer implements
- **R1** "Grid: square, 1 square = 5 ft (CB p.103). The GM sizes and aligns the grid over an uploaded image." → `setGrid`
  (square size and offset in image pixels; the map's size in squares follows), the grid bar (− / value / +, offset
  nudges, "Drag to shift").
- **R2** "Maps: several per campaign; the GM marks one live (the one players see)." → `list`, `create`, `rename`,
  `duplicate`, `remove`, `setLive`; exactly one live map: the first map is live at once, `setLive` moves the mark,
  deleting the live map makes the oldest remaining one live (the board's rules).
- **Q1** "players receive the live map's whole layout (terrain, objects, the uploaded image); fog is painted on their
  screen; TOKENS are filtered on the server ... the player's fog extends FOG_PAD_SQUARES ... beyond every edge ... the
  player's pan limits and 'Fit' use that padded area" → `live` returns the whole layout (never tokens, never the GM's
  scene prompt); the player's stage is padded by `FOG_PAD_SQUARES` (24) on every side and Fit frames the padded area;
  the header line shows players the map's name only. C8 paints the fog over the padding.

CB p.103 (re-checked, Core Book printed page), "Optional Rule: Defined Ranges": "If your table would rather operate with
more precise range rules, you can use a 1-inch grid battle map during combat." One square of the grid is one map square.

## Public functions (`convex/combatMaps.ts`)
All GM functions use the gm wrappers (player FORBIDDEN, outsider NOT_FOUND, anonymous UNAUTHENTICATED); `live` is a
`campaignQuery` with `need: "view"`. Every function has `args` and `returns` validators.

| Function | Wrapper | Args (besides `campaignId`) | Returns |
|---|---|---|---|
| `list` | gmQuery | – | `{ _id, _creationTime, name, live, source, w, h, base, plankV?, areas, seed, imageUrl, updatedAt }[]`, oldest first |
| `get` | gmQuery | `mapId: string` | layout (below) with `prompt`, or null (not this campaign's map) |
| `live` | campaignQuery (view) | – | the live map's layout without `prompt`, or null |
| `tokenCount` | gmQuery | `mapId: string` | number (header line; own query so a token move re-runs only this) |
| `create` | keyedGmMutation | `size: small\|medium\|large`, `name?` | `{ mapId }` |
| `rename` | gmMutation | `mapId`, `name` (trimmed, 1..80, else INVALID) | null |
| `setLive` | gmMutation | `mapId` | null |
| `duplicate` | keyedGmMutation | `mapId` | `{ mapId }` |
| `remove` | gmMutation | `mapId` | null |
| `imageUploadUrl` | gmMutation, rate limit `uploadUrl` | – | upload URL |
| `attachImage` | gmMutation | `mapId?`, `storageId`, `width`, `height`, `name?`, `size?` | `{ ok: true, mapId } \| { ok: false, code: "INVALID", message }` |
| `setGrid` | gmMutation | `mapId`, `grid {cell, offsetX, offsetY}`, `imageWidth`, `imageHeight` | null |

Layout (`combatMapLayoutValidator`, type `CombatMapLayout`): `{ _id, name, live, source, w, h, base, plankV?, areas,
seed, updatedAt, image: { url, grid } | null, objects: { _id, kind, x, y, r, rot, variant?, len?, span?, points?,
sight?, lit? }[], cells: { layer, tile, cells }[], prompt? }`.

Internal: `deleteChildren` (continues a map delete in batches of 1000 child rows), `copyImage` (action: copies a
duplicated map's image blob into its own file) and `attachCopiedImage` (claims it, or deletes it when the map is gone
or already has an image).

Errors: only C0's codes and common ones: COMBAT_MAP_NOT_FOUND, COMBAT_MAP_LIMIT, COMBAT_MAP_SIZE (a grid that does not
fit the image), INVALID (a bad name, a grid on a map without an image, a rejected upload's result code), NOT_FOUND (an
upload that is missing or already claimed).

## Details
- **Create blank**: Small 22×15 / Medium 30×20 / Large 40×27, base grass, no areas, seed 1, named "Map N" by default.
- **Duplicate**: the map row (name "<name> (copy)", not live), every object and painted-cell tile; tokens and explored
  areas are not copied. An image is copied into a new blob by a scheduled internal action, so every `files` row owns
  its own blob (deleting one map never breaks the other's image).
- **Delete**: the image file (row and blob), the map row, then `deleteMapChildren` (C0) with a budget of 1000 rows:
  the largest map (300 objects, 12 tiles, 80 tokens, explored rows) goes in one transaction; anything beyond
  reschedules `deleteChildren` until none is left (tested with 1100 objects).
- **Upload** (CF10, CF16, CF17; the World map's flow): `imageUploadUrl` (GM, rate-limited) → POST to storage →
  `attachImage`. The target map is checked first; a missing or already-claimed file is NOT_FOUND; a type outside
  png/jpeg/webp/gif, more than 8 MB, or a bad pixel size deletes the file and returns `{ ok: false }`. `refId` = the map
  id. Without `mapId` a new map is made (named after the file); with it, the image replaces the map's layout (objects,
  painted cells and explored areas go, the previous image file is deleted, tokens stay and move inside the new size).
  The first grid fits the chosen size's width across the image (`cell = max(16, round(width / 30))` for Medium, the
  board's rule).
- **Grid** (R1): the map is `floor((image - offset) / cell)` squares each way, clamped to 12..44 × 10..32; past the
  image's edge the canvas is dark. Cell ≥ 8 px and whole; offsets whole and within the image. Tokens outside a smaller
  map move onto its edge.

## Client
- `src/components/combat-map/maps/`: `useCurrentMap` (GM: picked map, else live, else newest; player: `live`),
  `MapsPanel` (the board's maps card: thumbnail, name, LIVE, size and source, Set live / Rename / Duplicate / Image /
  Delete with the board's two-click confirm; "＋ New map" opens Small / Medium / Large and "From my own map image"),
  `MapHeaderLine` ("Name · W × H squares · N tokens" for the GM, the name for players), `MapImageButton` (also for C4's
  Scene card "Use my own map image"). Optimistic updates: set live, rename, delete (on `list`) and the grid (on `get`).
- `src/components/combat-map/map-view/`: `MapBoard` (toolbar: title, LIVE / Make live, Aa Names (N, per viewer in
  localStorage), − zoom % + Fit; the viewport; the grid bar for image maps in Edit; the board's hint line), `MapCanvas`
  (C2's painter at 48 px per square, zoom via CSS; repaints only changed objects' bounds or changed painted squares
  after the first paint, so C5's edits never repaint the whole map; uploaded image + grid lines), `useMapZoom` (the
  World map's pattern: Fit on mount and on resize, Ctrl/Cmd + scroll anchored on the cursor; the board's range 15–250 %,
  ×1.2 buttons), drag the background to pan (mouse; touch scrolls natively), `GridControls`, `useMapView()` context.

### For later tracers
- **Cell decoder** (orchestrator note 2): `src/components/combat-map/map-view/cells.ts`, pure (no React, no Convex):
  `decodeCells(tiles, w, h) → { paint: Record<"x,y", Terrain>, block: Set<"x,y">, fog: Record<"x,y", "reveal" | "hide"> }`
  feeds C2's `paintMap(..., { paint })` and C1's `prepareMap({ paint, block })` / `createView(..., { fog })`. Also
  `cellKey`, `tileOf`, `indexInTile`, `terrainOfCode`, `codeOfTerrain` and the code constants (equal to C0's in
  `convex/lib/combatMaps.ts`; tests/convex/combat-maps.test.ts asserts they agree, since importing C0's module into the
  client would pull server code). Squares outside the map and unknown codes are ignored.
- `toPaintSpec(layout)` (`map-view/paint-spec.ts`) and `imageMapSize(image, grid)` / `MIN_GRID_CELL` (`map-view/grid.ts`).
- Layers get `CombatMapViewport` (cell 48, zoom, w, h, pad, toSquares, showNames) and may call `useMapView()` for the
  layout, decoded cells and the image size. A layer that handles a pointer down calls `preventDefault()` so the map does
  not pan; a click on the bare map clears the token selection (the board).
- C4: `MapImageButton` for "Use my own map image" (without `mapId` it makes a new map; with it, it replaces the map's
  layout); `get` returns the scene `prompt`.
- C5: `GridControls` can move into the Edit tools card later; today the grid bar sits above the map in Edit.

## Type check (orchestrator note 1)
C1's `MapSpec` (zod-inferred) is assignable to C2's structural `PaintSpec`: `expectTypeOf<MapSpec>().toMatchTypeOf<PaintSpec>()`
and a typed assignment in tests/convex/combat-maps.test.ts compile under `pnpm typecheck`.

## Acceptance evidence
- `tests/convex/combat-maps.test.ts`: 25 tests (access for anonymous / outsider / player / GM on all 12 functions,
  cross-campaign ids, sizes, idempotent create, the 30-map cap, rename, exactly one live map, no prompt for players,
  duplicate and delete of the largest map, a delete continued in scheduled batches, image delete and copy, upload
  rejections deleting the file and returning `{ ok: false }`, the grid sizes, the cell decoder against C0's
  constants, the MapSpec → PaintSpec type check).
- `pnpm vitest run`: 133 files, 1503 tests pass. `pnpm lint` (zero warnings) and `pnpm typecheck` clean.
- `tests/e2e/combat-maps.spec.ts`: 3 tests (two maps, rename, image upload, grid, zoom, set live, reload, player sees
  the live map and no Scene card / maps / grid / size, the player follows a live switch; the player's empty state;
  duplicate and two-click delete). `tests/e2e/combat-map-shell.spec.ts` (C0) still passes.

## Visual comparison
App: `test-results/visual/C3/{map-list,gm-grid,player-live}-{1440,1024,390}.png` (E2E_VISUAL=1).
Board: `test-results/visual/board/combat-{map-list,gm-edit,player-day}-{1440,1024,390}.png`.

| Region | Verdict |
|---|---|
| Maps card (map-list) | Matches the board's rows: 84×56 thumbnail (painted terrain or the image), bold name, LIVE badge and size, small buttons; the list scrolls past 300 px as on the board. Adds the source label and an Image button. |
| Toolbar | Matches: title, LIVE / Make live, Aa Names, − zoom % + Fit. "Hide all circles" is C6's. |
| Map area, painted map | Matches the board's frame and C2's painting; the viewport has a fixed height (board: content height) so Fit has a stable box. |
| Grid over an image (gm-grid) | The board's controls and copy (Square − value + px, Offset arrows, drag to shift), in a bar above the map instead of the Edit tools card. |
| Player (player-live) | Map name in the header, no LIVE badge, no size. Deviation (Q1): the stage is padded by 24 squares on every side and Fit frames the padded area, so the map looks small until C8 paints the fog and fits to explored squares; the board fits the map itself. |
| 390 px | Single column, 44 px targets, no horizontal scroll; the toolbar wraps. |

## Deliberate deviations
- "＋ New map" opens a size chooser (the plan's Small / Medium / Large blank maps) and an image upload instead of the
  board's spec-less map.
- The board's map row is one clickable `div` with buttons inside; here the name is the button that opens the map and the
  actions are sibling buttons (CL13). An "Image" button per row uploads an image onto that map.
- The grid bar sits above the map area in Edit (the board has it in the Edit tools card, which is C5's slot).
- The board's "Hide all circles" toolbar button is C6's (the circles' state is the tokens feature's).
- Objects are not drawn over uploaded images (as on the board).
