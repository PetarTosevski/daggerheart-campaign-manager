# TASK-HD6: the Sprites painter's fixed pixel sizes follow the cell

Status: Review. Plan: `.omc/plans/sharp-4k.yaml`, tracer HD6 (bead dcm-ggk3.6). Follows HD1, whose "Not covered"
list named these sizes.

## What changed

HD1 paints a HiDPI canvas with `cell = MAP_CELL x k` and an identity transform, and multiplies every fixed pixel
size in `painter.ts` by `pixelScale(cell) = max(1, cell / 48)`. The Sprites painter's own files still had fixed sizes,
so at k = 2 those details were half their size in CSS pixels. Each now takes the same factor (`S = pixelScale(cell)`).
At 48 px squares and below `S` is 1, so the board at k = 1, thumbnails and the phone app paint exactly the same pixels
as before.

| File | Size | Before | Now | New helper |
| --- | --- | --- | --- | --- |
| `sprites/terrain.ts` | wall rim probes (dark band, light band) | 7 px, 14 px | `7 S`, `14 S` (`WALL_RIM_PX`) | `terrainPx(cell).rim` |
| `sprites/terrain.ts` | grid step of the low-frequency noise (brightness, variant mix) | 8 px | `8 S` (`NOISE_STEP`) | `terrainPx(cell).noiseStep` |
| `sprites/objects.ts` | bounds margin | 12 px (`PX_MARGIN`) | `12 S` | `objectPx(cell).margin` |
| `sprites/objects.ts` | inner radius of a light glow's gradient | 1 px | `1 S` (`GLOW_INNER_PX`, as the Classic glows since HD1) | `objectPx(cell).glowInner` |
| `sprites/shadows.ts` | minimum shadow offset | 2 px (`SHADOW_MIN_OFFSET_PX`) | `2 S` | `shadowFloors(cell).offset` |
| `sprites/shadows.ts` | minimum shadow blur | 1 px | `1 S` (`SHADOW_MIN_BLUR_PX`) | `shadowFloors(cell).blur` |

The noise step was not in the task's list: the noise frequencies already scale with the cell, so with a fixed 8 px
step a cell of 96 sampled the noise twice as densely; at `8 S` the same grid points in squares are used, so the
brightness and variant mix of a k = 2 map are the k = 1 picture exactly (and half the noise evaluations).

The shadow floors only bind at small cells (a low sprite's offset at 48 px squares is at least 0.1 x 0.5 x 48 =
2.4 px, its blur 2.4 px), so on the board they change nothing at any k; they now stay proportional anyway.

## Sweep: numeric literals left in the three files

`grep -nE "(^|[^a-zA-Z_.0-9])[0-9]+(\.[0-9]+)?" src/lib/combat-map/sprites/{terrain,objects,shadows}.ts`, comments
excluded. Every hit is one of these; none is a fixed pixel size of the picture.

- **Sizes in squares or shares** (scale with the cell by construction): `FEATHER`, `TILE_BLEND`, `MIX_SQUARES`,
  `MIX_SOFT`, `MACRO_SQUARES`, `MACRO_AMP`, `EDGE_REACH` (fine cells), the displacement `C x 0.38` and `C x 1.1`,
  `SHADOW_BLUR`, `SHADOW_OFFSET`, `Math.max(0.5, radiusSquares)`, `CLASSIC_DIAMETER`, `MAPPED_SCALE_*`, `GLOW` radii,
  `o.len || 2.5`, `0.5 x hypot(sw, sh)`.
- **Colours, weights, hashes and angles**: `WALL_RIM` shades, `GLOW_GAIN`, `GLOW_ADD`, `SHADOW_ALPHA`, `SHADOW_RGB`,
  the hash primes, the fbm weights and octave factors, seed offsets (`seed + 59`, `+ 101`, `x 13`, ...), `arc(..., 0, 7)`,
  gradient stops 0 and 1, RGBA channel offsets (`x 4`, `+ 1`, `+ 2`), 255.
- **Floors that keep a size at least one whole pixel** (never binding on the board): `Math.max(1, ...)` around the
  tile size `T`, the tile blend `B` and the drawn sprite size (`drawnPx`).
- **One pixel on purpose**: `drawClassicObject`'s `px = 1 / cell` paints a Classic object through a one-pixel
  rectangle (so its terrain pass costs one pixel); it is not drawn.
- **Off-picture canvas bookkeeping in `renderShadow`**: `+ 2` padding of the shadow canvas and `far = 4 half + 1000`
  (the sprite is drawn far off the canvas so only its shadow lands). The shadow canvas is drawn centred on the
  sprite, so its padding does not move or resize the shadow.

## Tests

`tests/unit/sprite-pixel-scale.test.ts`:

- each former fixed size at k = 1 (cell 48) equals its old value and at k = 2 (cell 96) is twice it, and cells up to
  48 keep the k = 1 value: `terrainPx` (rim 7 / 14, noise step 8), `objectPx` (margin 12, glow inner 1),
  `shadowFloors` (offset 2, blur 1);
- the shadow floors bind at a small cell (16) with the old values, and every shadow at cell 96 is the cell-48 shadow
  doubled;
- `placedBounds` of a sprite object is the same in squares at 48 and 96;
- `drawGlow` creates its gradient with an inner radius of 1 px at 48 and 2 px at 96;
- pixels: a grass texture against a wall composited at 48 and at 96: the dark rim band has 4x the pixels at 96 (twice
  as wide, twice as long; about 3.1x with the fixed 7 / 14 px), and pixel (x, y) at 48 equals pixel (2x, 2y) at 96 on
  more than 97.5 % of the map (98 % now, 94.7 % before; the rest is the per-pixel feather jitter on the wall's edge).

k = 1 unchanged: the cell-48 composite of that scene hashed the same (SHA-256) before and after the change (checked
by hand, not committed as a pinned hash). The existing `sprite-painter.test.ts`, `sprite-loader-hires.test.ts`,
`lane4-e4-picks-glow.test.ts` and `combat-terrain-light.test.ts` pass unchanged.

Checks: eslint on the four changed source / test files, `pnpm typecheck:web`, vitest (`--maxWorkers=2`) on the files
above.
