# TASK-D9-C2: Map painter and keyword fallback layout

Status: Review. Plan: `.omc/plans/d9-combat-map.yaml`, tracer C2 (wave 1). Bead: dcm-bxp.32.

## Goal

A client-side painter turns a layout (plus painted cells and objects) into the board's hand-painted top-down battle
map on a canvas, and a keyword generator makes a usable layout without Claude.

Source: `reference/designs/project/Combat.dc.html`, `CMAP.rasterize`, `CMAP.render` and `CMAP.generate`. No book rule
is implemented here (the light reaches of R9 live in C1); this tracer only draws lights lit or unlit (R9: "Map lights are
switched on/off by the GM AND by players") and paints the map that R1 and R2 describe.

## Files

- `src/lib/combat-map/raster.ts`: terrain palette, the structural `PaintSpec` type, `rasterize` and `mergePaint`. No DOM.
- `src/lib/combat-map/painter.ts`: `paintMap` (whole map), `paintMapRect` (dirty rectangle), `prepareMap`,
  `withObjects`, `objectBounds`, `terrainDirtyRect`, `mapPixelSize`. Draws into a given `CanvasRenderingContext2D`.
- `src/lib/combat-map/fallback-layout.ts`: `generateFallbackLayout(prompt, { seed, w, h })`.
- `tests/unit/combat-map-painter.test.ts`.

## API notes for later tracers

- **C3** sizes the canvas with `mapPixelSize(spec, cell)` and calls `paintMap(ctx, spec, { cell, paint })`; it keeps the
  returned `PreparedMap`. C3 also checks that C1's spec type is assignable to `PaintSpec` (every field beyond `w`/`h`
  is optional and read-only; points are `ReadonlyArray<ReadonlyArray<number>>`; `variant`/`lit`/`sail` accept `null`).
- **C5** repaints only what changed: `paintMapRect(ctx, prepared, rect, opts)` with
  `unionRect(objectBounds(old), objectBounds(new))` for an object edit (with `withObjects(prepared, objects)` so the
  terrain raster is reused), or `terrainDirtyRect(squares)` after painting terrain (with a fresh
  `prepareMap(spec, paint)`). The rectangle is in squares.
- **C8 / light switches**: a light toggle is `paintMapRect` over `objectBounds(light)`. `opts.lights` = `"spec"`
  (default, each object's `lit`), `"lit"` or `"unlit"` draws every map light one way.
- Painted terrain is passed as `PaintedTerrain` (`{ "x,y": terrain }`, `paintKey(x, y)`); decoding `combatMapCells`
  tiles into it is the caller's job, because C0 defines the tile format.
- The context must have an identity transform (`putImageData` ignores transforms).

## Deliberate deviations from the board

- Texture strokes take their random numbers per square instead of from one sequence over the whole map, so a dirty
  rectangle redraws exactly the strokes the full paint drew. The look is the same (same density, colours, shapes).
- The fallback places `walltorch` (the R9 map light) where the board placed its legacy `torch`. The painter still
  draws `torch` for old layouts.
- The fallback omits optional keys instead of setting them to `undefined`, rounds object positions to 0.01, and takes
  an optional height so the app's sizes (22x15, 30x20, 40x27) can be used as they are.
- `paintMap` does not resize the canvas (the board's `render` set `cv.width`); the caller sizes it.

## Acceptance evidence

- `tests/unit/combat-map-painter.test.ts` (25 tests): rasterize rect, ellipse, poly, path, border, later areas
  winning, unknown terrain/shape ignored, supersampling and painted tiles merged on top; the fallback for a forest
  camp, dungeon halls and a ship deck (plus snow, swamp, coast with bridge, cavern and ruins), each checked against the
  board's `CMAP.clean` limits, determinism and sizing; a painter smoke test with a recording mock context (jsdom has
  no canvas): one opaque terrain image, objects, grid and vignette, determinism per seed, lit/unlit lights,
  options, and a dirty rectangle whose terrain pixels equal the full paint's and which skips far objects.
- Visual check (scratch, not in the repo): five fallback layouts drawn by the board's `CMAP.render` and by
  `paintMap` in headless Chromium look the same; the dirty-rectangle repaint differs from the full paint only
  in anti-aliasing at shape edges (at most 25 of 255 on fewer than 0.1% of pixels).
