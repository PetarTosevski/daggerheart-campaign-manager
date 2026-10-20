# TASK-D9-C5: Editing a map by hand

Status: Review. Plan: `.omc/plans/d9-combat-map.yaml`, tracer C5 (wave 3; depends on C3). Bead: `dcm-bxp.32`.

## Goal
In Edit mode the GM paints terrain, places, moves and deletes objects, sets any object to block sight or not, and paints
sight blockers over an uploaded image.

## Rules this tracer implements
- **R2** "Maps: several per campaign ... Generated layouts can be edited by hand AND regenerated." → hand-painted terrain in
  `combatMapCells` (layer `terrain`) and object rows, on top of whatever layout the map has.
- **R7** "anything big enough to hide behind blocks sight (walls, trees, tents, boulders, pillars, statues, masts). Bushes,
  rocks, logs, crates, barrels, chests, tables, rubble are cover only by default; the GM can set any object to block sight."
  → `setObjectSight` (block | cover | none | default), defaults from C1's `SIGHT_DEFAULTS` / `sightOf`; painted sight blockers
  (layer `block`) for uploaded images. User 2026-10-20: a dead tree keeps "no effect" by default; the GM can switch it
  (tested).
- **R9** (light switch in the object card only): a campfire or wall torch's `lit` can be set by the GM while editing; the
  play-mode switch for GM and players stays C7/C8's `toggleLight`.

## Public functions (`convex/combatMapEdit.ts`)
All `gmMutation` (player FORBIDDEN, outsider NOT_FOUND, anonymous UNAUTHENTICATED); every one returns `null` except
`addObject`. Args besides `campaignId`:

| Function | Args | Returns | Notes |
|---|---|---|---|
| `paintCells` | `mapId: string`, `squares: number[]` (`y * w + x`), `paint: Terrain \| "block" \| "eraseTerrain" \| "eraseBlock"` | null | One write per stroke: only the touched tiles are read and written; a tile left empty is deleted. eraseTerrain clears painted terrain, eraseBlock clears blockers (two tools, user 2026-10-20). Squares outside the map → INVALID. |
| `clearPaint` | `mapId`, `layer: "terrain" \| "block"` | null | The board's "Undo all painting" (terrain). |
| `addObject` | `mapId`, `kind` (the board's 18 placeable kinds), `x`, `y` | `{ objectId }` | Half squares, inside the map, the board's default radius (OBJ_R); cap MAX_COMBAT_OBJECTS → COMBAT_OBJECT_LIMIT. |
| `moveObject` | `objectId: string`, `x`, `y` | null | Quarter squares, clamped to the map. |
| `removeObject` | `objectId` | null | |
| `setObjectSight` | `objectId`, `sight: "block" \| "cover" \| "none" \| "default"` | null | `default` unsets the override. |
| `updateObject` | `objectId`, `r?`, `rot?`, `lit?` | null | r 0.3..4, rot folded to [0, 2π); `lit` only for campfire / wall torch (else INVALID). |

Errors: C0's COMBAT_MAP_NOT_FOUND, COMBAT_OBJECT_NOT_FOUND, COMBAT_OBJECT_LIMIT and the common INVALID. No new code.
No `updatedAt` bump on the map row: an edit writes only its object or tile rows (CD10).

## Client (`src/components/combat-map/editor/`)
- `edit-model.ts` (pure, shared with the server): the board's palettes (PAINT_TERRAINS + swatches, OBJ_KINDS labels and
  radii), snapping, radius/rotation bounds, `brushSquares`, `objectAt`, and the tile writer `paintTile` /
  `paintLayoutCells` (the optimistic copy of `paintCells`; a test checks it equals what the server stores).
- `editor-state.tsx`: `EditorProvider`'s state (tool, terrain, brush, kind, selected object, error).
- `edit-tools-panel.tsx` (`EditToolsPanel`): the board's "Edit by hand" card: ✋ Move view, 🖌 Terrain (palette, brush
  1/2/3, Undo all painting), 🌲 Objects (kind picker), ▦ Block sight (brush), ⌫ Erase (brush); the selected-object card
  (sight buttons with the default named and "Use the default", light switch with its reach, Smaller / Bigger, ⟲ ⟳, Done,
  Delete).
- `editor-layer.tsx` (`EditorLayer`): pointer handling (stroke → one `paintCells` on release; Objects: click places and
  selects, click selects, drag moves) and an overlay canvas with painted blockers (red), sight outlines (solid red = blocks,
  dashed blue = cover; painted maps only, as on the board), the selected ring and a drag ghost. Move view sets
  `pointer-events: none`, so the map pans; other tools take the left button (`preventDefault`, C3's contract) and leave
  right-drag to pan. Delete / Backspace removes the selected object, Escape drops it.
- `use-edit-mutations.ts`: every mutation with an optimistic update on `combatMaps.get` (painting feels immediate; C3's
  `MapCanvas` then repaints only the changed squares or the object's old + new bounds).

## Acceptance evidence
- `tests/convex/combat-map-edit.test.ts`: 18 tests: access for anonymous / outsider / player / GM on all 7 functions;
  cross-campaign and bad ids; painting writes only touched tiles (an untouched tile row stays identical); players' `live`
  sees the paint; blockers, Erase across both layers and empty-tile deletion; a painted blocker and a painted wall block C1's
  `los`; clearPaint; out-of-map squares INVALID; a whole Large map in one stroke; optimistic copy = stored copy over 5 mixed
  strokes; placing (snap, default size, clamped), the 301st object, move/resize/turn/remove, lights only, a crate set to
  block sight blocks `los` and `default` restores it, a tree set to none stops blocking, the dead-tree default; brush,
  hit-testing and the placeable-kind list.
- `pnpm vitest run`: 134 files, 1521 tests pass. `pnpm lint` (zero warnings) and `pnpm typecheck` clean.
- `tests/e2e/combat-map-edit.spec.ts` (2 tests): the GM paints a stone floor with one 3-square stroke (24 squares stored;
  every painter `putImageData` after the stroke is narrower than the full map: no full repaint), adds a tree and a crate,
  sets the crate to block sight, reloads and finds both with their sight settings, drags the tree, deletes the crate with
  Delete, paints and erases a blocker; an uploaded image offers Move view / Block sight / Erase only and a blocker painted on
  it is stored; Move view lets pointers through. C3's `combat-maps.spec.ts` and C0's `combat-map-shell.spec.ts` still pass
  (8/8 together).

## Visual comparison
App: `test-results/visual/C5/{gm-edit,gm-edit-object}-{1440,1024,390}.png` (E2E_VISUAL=1 `tests/e2e/visual/C5.spec.ts`).
Board: `test-results/visual/board/combat-gm-edit-{1440,1024,390}.png`.

| Region | Verdict |
|---|---|
| Edit by hand card, tool row | Matches the board's buttons and order, with "⌫ Clear sight" (blockers) as on the board plus "⌫ Erase terrain" (painted terrain), split at the user's request 2026-10-20. No "⊞ Grid" tool: the grid bar stays C3's, above the map. |
| Terrain palette and brush | Matches the board: two-column swatch buttons, Brush 1 / 2 / 3, "Undo all painting" when there is painted terrain. |
| Objects picker | Matches the board's 18 kinds and the hint line. |
| Selected-object card | Matches the board (gold border, Cinzel name, sight buttons, Smaller / Bigger / ⟲ / ⟳, Done / Delete); adds a line naming the kind's default and "Use the default". |
| Map overlay | Matches: solid red outline for sight blockers, dashed blue for cover, red painted blocker squares; a gold ring marks the selected object. |
| 390 px | Single column, 44 px targets, no horizontal scroll. |

## Deliberate deviations
- Painting writes once per stroke on release (the stroke previews on the overlay while dragging), not per square.
- Terrain and Objects are hidden on uploaded-image maps (the painter draws neither over an image); a painter tool picked on a
  painted map falls back to Move view there.
- A tile stored for another width (an image map whose grid size changed after painting) is rewritten from empty on its
  next stroke, because it can no longer be read square by square.

## QUESTIONS
1. Erase clears both painted terrain and sight blockers (plan says "Erase"; the board had "Clear sight" for blockers only).
   Reversible: split into two tools if the user prefers the board.
2. `updateObject.lit` lets the GM switch a light from the edit card; C7's `toggleLight` remains the play-mode switch for
   everyone. If C7 wants one entry point, drop `lit` here.
3. `GridControls` stays in C3's grid bar (map-board.tsx, now owned by C8); moving it into this card would need that file.
