# TASK-HD1: Combat Map canvases draw at the screen's render scale

Status: Review. Plan: `.omc/plans/sharp-4k.yaml`, tracer HD1 (bead dcm-ggk3.1). User request 2026-11-13: images
should look sharper on a 4K monitor; this tracer covers the Combat Map's canvases.

## What works

- **Render scale** (`src/lib/combat-map/render-scale.ts`, pure): `renderScale(device, zoom, width, height)` =
  `device` (devicePixelRatio x the root CSS zoom) x the board zoom (no extra below 1), rounded **up** to a step of 0.5,
  at least 1, then lowered step by step to the largest that keeps the backing store within `MAX_CANVAS_SIDE` (8192)
  per side and `MAX_CANVAS_PIXELS` (16 777 216) in all. A canvas too big even at 1 keeps 1 (as before). Bad inputs
  count as 1. Examples: 4K at 200 % on a mouse screen: 2 x 0.8 = 1.6 -> 2; 150 %: 1.2 -> 1.5; a 1x mouse screen: 0.8
  -> 1 (unchanged); a 40 x 30 map at 2.4 -> 2.5 is 17.3 M pixels, so it keeps 2.
- **Hooks** (`map-canvas.tsx`): `useDeviceScale()` is a `useSyncExternalStore` over devicePixelRatio x `rootScale()`
  (css-zoom.ts), measured once and re-measured only when a watched thing changes: `matchMedia("(resolution: Ndppx)")`
  (a move to a screen with another density; re-armed after each change), `(pointer: coarse)` (the root zoom follows
  it) and a MutationObserver on `<html>` attributes (Text size, `data-text-size`). `useSettledZoom(zoom)` is a
  150 ms debounce (the state follows the zoom from a timer, never synchronously in an effect).
  `useRenderScale(width, height, zoom, followZoom)` combines them.
- **Map canvas** (Classic, Sprites, uploaded image): paints at `cell = MAP_CELL x k`; the canvas's CSS size is
  unchanged (`layout.w x 48 x zoom`), so hit testing, tokens, the viewport maths and `MAP_CELL` stay as they are. The
  paint state keeps its `cell`; a different cell is a full repaint (like a structure change), and partial repaints
  (object moves, painted squares, arrived sprite images) at the same scale work as before, with bounds and
  `mapUrls` at the same cell. While the zoom moves, the old backing store keeps being CSS-scaled; once it has been
  still for 150 ms and the scale step changed, one full repaint. `data-scale` on the canvas shows k.
- **Uploaded image map**: the image is drawn at `cell / grid.cell`; its grid lines are `cell / 48` wide, offset by
  half their width (the old `+ 0.5` at k = 1), so they stay on whole device pixels.
- **Editor overlay** (`editor-layer.tsx`): drawn at the same k as the map canvas; line widths, the sight-outline and
  ghost dashes, the blocker inset and the selection ring's gap are CSS pixels x k.
- **Fog** (`vision-layer.tsx`): FOG_PX (12) x k pixels per square, the blur (5 px) x k; k follows the device scale but
  **not** the board zoom (see judgement calls). `data-scale` on the fog canvas shows it.

## What scaled inside the painters

The painters keep an identity transform (putImageData / getImageData), so they paint at the bigger cell.
`pixelScale(cell) = max(1, cell / 48)` (exported from `painter.ts`) multiplies every fixed pixel size; at 48 and below
it is 1, so thumbnails (cell 4), the phone app (16..48) and the board at k = 1 paint exactly the pixels they did.

- Terrain (`paintTerrain`): the fixed-frequency noise (brightness `fbm(px x 0.045)`, jitter `vnoise(px x 0.22)`,
  water glints `vnoise(px x 0.06, py x 0.2)`) and the wall stripes (`(px + py) % 9`, `(px - py + 400) % 6`) now use
  `px / S`, `py / S`; the wall-edge probes (7 and 14 px), the plank seams (1.6 px) and the stone mortar (1.5 px) are
  x S. The edge displacement already scaled with the cell.
- Texture strokes: grass blade length and lean, dirt / snow speck radii, line widths, water ripple radii.
- Objects: every line width, shadow offset (tent, log, crate, barrel, hull, mast), `shadowBlur` (dead tree), the dead
  tree's branch cut-off (4 px; otherwise it would recurse deeper at k = 2), canopy outline (2.4 px) and leaf arcs,
  rubble and mushroom spot radii, chest bands, mast boom, torch corner radius, glow gradients' inner radius, door
  (minimum thickness, swing dash, jamb and knob).
- Grid: `S` px wide at `S / 2` past the edge (Classic and Sprites painters).
- `objectBounds`: the 12 px margin is x S, so bounds in squares are the same at 48 and 96.

## Judgement calls

1. **Fog resolution.** The plan says the vision canvas should be 2x its CSS size at k = 2. The fog canvas has never
   been CSS-sized: it is 12 px per square (a quarter of the CSS size at zoom 1), blurred, and CSS-scaled. Making it
   48 x k px per square would change the pixel coordinates that `combat-vision.spec.ts`, `live-combat.spec.ts` and
   `sprite-packs-flow.spec.ts` (outside HD1's `owns`) read with `FOG_PX = 12`, for a blur that has no detail to gain.
   HD1 scales the fog by k from its own base instead (24 px per square at k = 2), and leaves the board zoom out of
   the fog's k: with it, a player's Fit to the explored area (zoom often > 1.25) would move the fog off 12 px per
   square in those specs too. The hidpi spec asserts the fog at 2x its base. If the full CSS-size fog is wanted,
   those three specs need their `FOG_PX` helpers to read the canvas's `data-scale` (one line each).
2. **Fixed pixel sizes scale only above 48 px squares**, so no existing caller changes (thumbnails, phone,
   k = 1 board). The painter derives the scale from the cell instead of a new option, which also covers Classic
   objects drawn on a Sprites map through `sprites/objects.ts` (not in `owns`) without touching it.
3. The device scale is cached and re-measured on the watched events rather than read in every render
   (`rootScale()` forces layout).

## Not covered (outside `owns`)

- `src/lib/combat-map/sprites/terrain.ts`: the textured wall rim probes 7 and 14 fixed pixels; at k = 2 the darkened
  band along walls on textured squares is half as wide (in CSS pixels) as at k = 1.
- `src/lib/combat-map/sprites/objects.ts`: `PX_MARGIN / cell` in sprite bounds shrinks with k (still ample: the
  shadow reach scales with the cell). `sprites/shadows.ts`: the 2 px minimum shadow offset and 1 px minimum blur are
  fixed (only tiny props).
- Cost: the Classic terrain is painted per pixel in JS. In Node a 30 x 20 map takes about 0.25 s at k = 1 and about
  1 s at k = 2 (4x the pixels); the repaint happens once per scale-step change, not per wheel tick.

## Tests

- `tests/unit/render-scale.test.ts`: step rounding, the floor of 1, no extra below zoom 1, bad inputs, the side cap,
  the pixel cap, too big at 1.
- `tests/unit/combat-map-painter.test.ts` ("painter at a HiDPI cell"): `pixelScale`; a cell of 96 makes the same
  calls as 48 with every length, line width, blur and dash exactly doubled (whole scene, and a door open and closed);
  grid lines 2 px on whole pixels; cells of 48 and below keep the fixed widths; `objectBounds` is the same in squares at
  48, 72 and 96.
- `tests/e2e/combat-map-hidpi.spec.ts` (deviceScaleFactor 2, root zoom 0.8): the map canvas is `w x 48 x 2` for
  Classic, Sprites and an uploaded image; the CSS size is `w x 48 x zoom`; the fog is `w x 12 x 2`; zooming past
  125 % repaints the map at the bigger scale (fog unchanged); Fit brings it back.
- Existing specs (`combat-map-*.spec.ts`, `combat-maps.spec.ts`, `combat-movement.spec.ts`,
  `map-zoom-scrollbars.spec.ts`, `sprite-*.spec.ts`): 32 of 33 pass. The one failure is not caused by HD1:
  `sprite-edit.spec.ts:196` expects the player's own token to be named "Open Ash’s sheet", but since 59e3ac15 (FH-UI
  .32.21) that token is named "Ash (your character): actions". The locator needs updating. It was left as is because
  that fix has nothing to do with this tracer.
