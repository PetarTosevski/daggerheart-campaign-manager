# TASK-MV-M1: Movement on the map - blocked moves stop with feedback, the GM warning, difficult squares hatched, the token's movement-roll note

Status: Review. Plan: `.omc/plans/map-movement.yaml`, tracer M1 (wave 3). Bead: `dcm-bxp.80`.

## Decisions this tracer implements
- USER ANSWER (2026-10-21): walls and buildings stop tokens; difficult terrain is only marked (a movement roll is
  needed to pass this turn; the roll itself comes later).
- USER ANSWER (2026-10-21, doors): closed doors block, open doors don't; a switch like the light switch.
- D3: a player's blocked move is refused by the server (M0, `MOVE_BLOCKED`). The client keeps its optimistic move,
  Convex rolls it back on the error, and the map announces "Blocked" (polite `role="status"` live region) above the
  token, which shakes once (no shake with reduced motion). No error card. The GM's move always goes through. When
  `combatTokens.move` returns `blocked: true` the GM sees "Moved through a wall or building: players can't pass there."
  in the same place. Both announcements fade after 4 s.
- D5: difficult squares get a hatch (tint plus diagonal strokes, an SVG over the canvas and under the fog) in Classic
  and Sprites alike, and on image maps. The GM's own view hatches every difficult square. A player (and the GM
  previewing a PC) sees only the squares that character sees now or has explored (my choice, reversible: explored
  squares count as seen, as for the light switches). Hidden in Edit mode.
- D5 note: the selected token's card shows "Difficult terrain: a movement roll is needed to pass this turn" to the
  owner and the GM when the token's last move on this screen returned `difficult: true` and the token is still on
  that square, or when the token stands on a difficult square now (from the layout, so the GM sees it after a
  player's move too). A crossing seen only from another browser is not remembered (nothing is stored; no turn
  tracking yet).
- D8 drawing: the Classic painter draws the `door` kind as a plank leaf between two stone jambs, 2r long along `rot`.
  When open, the leaf is swung 90 degrees on its hinge (the local left jamb) and the swing arc is drawn faintly. The
  sprite painter draws an open door's sprite swung the same way (`spritePose`); the catalog has no paired open sprites.
  Clicking a door on the map toggles it through M2's on-map switch (`combat-door`, same rule as the panel). Nothing
  was duplicated.
- Partial repaints: a door's Classic bounds cover the whole swing (radius 2.4r) and its Sprites bounds cover the
  sprite closed and open, so the map canvas's existing dirty-rect repaint (old bounds plus new bounds) stays exact when
  a door toggles. `map-canvas.tsx` and `paint-spec.ts` did not need changes (`open` flows through the objects).
- Maps without doors: unchanged Classic pixels (only the `door` cases are new). The existing painter tests pass
  unchanged.

## Found while testing (M2 follow-up, outside M1's files)
A Classic door placed by hand gets `r` 0.5 (`editor/edit-model.ts` PLACEABLE_OBJECTS). Its vision and movement
footprint is a circle of `r * blockRadiusFactor("door")` = 0.275 squares (`sight.ts`). That covers none of its
square's half-square samples, which sit 0.354 from the centre, so the door blocks neither movement nor sight. The
unit tests use `r` 1. The e2e test sets the door's `r` to 1 (radius 0.55) with `updateObject`. The suggested fix, in
`src/lib/domain/combat-map/sight.ts` `blockRadiusFactor`, is `if (kind === "door") return 1;`. A door of `r` 0.5 then
covers exactly its own square and is drawn one square wide.

## Files
- `src/lib/combat-map/painter.ts`: `DoorPaintFields`, `isOpenDoor`, `doorLeaf`, `paintDoor`, the `door` bounds.
- `src/lib/combat-map/sprites/objects.ts`: `spritePose` (an open door swung on its hinge) used by the sprite, its
  shadow and its bounds.
- `src/components/combat-map/map-view/movement-overlay.tsx`: `layoutMovementGrid` / `useLayoutMovementGrid` (M0's
  `buildMovementGrid` from the layout and its cells; built-in sprite traits and `move`; an uploaded sprite moves as
  its Classic kind here, as the vision layer's light switches already treat it), `hatchedSquares`, `MovementOverlay`.
- `src/components/combat-map/tokens/move-notes.ts`: an in-memory store (per tab) of the latest announcement, the
  shake, and the tokens whose last move here was difficult.
- `src/components/combat-map/tokens/use-tokens.ts`: `move` catches `MOVE_BLOCKED` (announces instead of an error)
  and records `blocked` / `difficult` from the result.
- `src/components/combat-map/tokens/tokens-layer.tsx`, `token-panel.tsx`, `tokens.css`: the hatch, the live region,
  the shake, the card's note.

## Tests
- `tests/e2e/combat-movement.spec.ts` (runs at 1440 and at 390): a player's arrow step and a drag into a wall snap
  back with "Blocked" (server unchanged); D into a cottage is refused; the fence blocks; the gate, once opened, lets
  Ash through; a step into the garden plot gives the card's note and the hatch; a closed door blocks and hides the
  Ghoul, the player opens it on the map, sees the Ghoul, walks through and closes it again; the GM walks Ash through a
  wall with the warning. A second test opens a Classic door, the wooden door sprite and the fence gate in Classic and
  Sprites: the canvas changes, a reload (full paint) gives exactly the same pixels as the partial repaint, and
  closing them gives back the closed map's pixels.
- `tests/e2e/visual/MV-M1.spec.ts` (`E2E_VISUAL=1`): shots in `test-results/visual/MV-M1/` at 1440 and 390.
