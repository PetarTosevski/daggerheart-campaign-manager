# TASK-SP-P2: Pure cut core

Status: Review. Plan: `.omc/plans/sprite-packs.yaml`, tracer P2 (wave 1, no dependencies).

## Rule (user decisions quoted from the plan)

- P2: "The user's 60 sheets are built into the app as the default packs ... processed offline into cut, trimmed, keyed-to-transparency, resized WebP sprites" and "GMs can ALSO upload their own sheets or single sprites per campaign ... cut and labelled in an upload screen".
- D9: "Uploaded sprites are cut in the browser (the same pure cut core as the offline script, on canvas ImageData)".
- D6: "The import (P4) also runs a seam-fix pass on each swatch (offset by half, cross-blend the seam) and reports tileability."
- D8: an extra cut sprite beyond a list becomes a numbered variant through `overrides.json` (P4). So the cutter returns every object it finds and flags the mismatch. It never forces a count.

## What works

`src/lib/sprite-packs/cut/` is pure TypeScript over `{ width, height, data: Uint8ClampedArray }` (RGBA, non-premultiplied). It has no Node or DOM imports and imports only its own siblings; a unit test enforces this.

| File | Does |
|---|---|
| `types.ts` | `RgbaImage`, `Box`, `SheetGrid`, `SHEET_GRIDS` (props 4x4, large 3x3), `CutFlag`, `SpriteCut`, `SheetCut`, `FringeScore` |
| `key.ts` | `magentaScore` (hue-based: magenta chroma over brightness, so JPEG noise and the drawn drop shadows on the background key out too); `keyMagenta` (soft alpha ramp between scores 0.30 and 0.55; a sheet with more than 2 % transparent pixels counts as already transparent and is left alone); `defringe` = 1 px alpha erosion, then despill (min(R, B) drops to G within 6 px of the background at 2048), then zero colour under alpha 0; `fringeScore` |
| `lines.ts` | `removeGridLines`: a pixel row is a line when more than half the sheet width is covered by vertical runs at most 12 px (at 2048) thick. Only those thin runs are cleared (so objects the line touches keep their pixels), then the leftover crossing squares |
| `cells.ts` | `labelComponents` (8-connected, alpha >= 128); `findCells`: specks are attached to a piece within 2 % or dropped. Then bands: row bands at empty rows, column bands per row band. When they match the grid exactly, every fragment in a band cell belongs to that object (uneven grids work). Otherwise connected components with nearest-merge: the closest pair merges first, only while the union fits in one grid cell and there are more groups than expected. Results are in reading order, with an owner map that also covers the soft edge pixels |
| `trim.ts` | `alphaBounds`, `crop` (pads outside the image with transparency), `trimToAlpha` (alpha bounds + `TRIM_MARGIN` 2 px) |
| `sheet.ts` | `cutSheet(img, { layout: "props" \| "large" \| {rows, cols} \| "single" })`: key, then lines, then defringe, then cells, then each object copied (only the pixels it owns) and trimmed. Returns `{ sprites, expected, method, flags, fringe }` |
| `terrain.ts` | `cutTerrain`: finds a flat frame of any colour from each edge (the white frame), finds the magenta cross (the column and row with the most bright magenta in the middle half), insets 0.6 % past the JPEG bleed and returns 4 centred squares in the order TL, TR, BL, BR. Flags: `no-cross`, `uneven-swatches`, `magenta-left`. `seamFix` cross-blends the swatch with itself shifted by half, along x then y (edges come from the shifted copy, the middle from the original, so it wraps seamlessly; the size is unchanged). `tileability` = inner neighbour difference / wrap-seam difference, capped at 1 |

Flags (`CutFlag`): `count-mismatch {found, expected}`, `touches-border {index}` (the object is kept), `lines-removed {rows, cols}`, `already-transparent`, `components-fallback`, `empty`. Fringe: `{ before, after }`, the mean magenta spill on edge pixels.

## Results on the user's 60 sheets (`/mnt/c/Users/Petar/sprite-sheets`, read only, not committed)

Every object sheet gives the expected count (16 / 9) and every terrain sheet gives 4 squares with no flag except as listed. The fringe after defringe is 0.000 on all 40 object sheets (0.037 to 0.241 before). Each sheet takes at most 534 ms at 2048 px (Node 24). Contact sheets were checked by eye.

- `components-fallback` (bands did not match, merge gave the right count): dungeon/props, forest/props, grassland-and-road/large (the standing-stone pair), tavern/large, temple/props, temple/large, volcanic/props.
- `touches-border` (kept): grassland-and-road/large #8 (stone wall), mushroom-cavern/large #7 (chasm), sewers/props #3 (pipe).
- grassland-and-road/large (1024 px): its drawn grid lines are dark magenta in the JPEG, so the key removes them. `lines-removed` covers grey or white lines (tested synthetically).
- snow-and-tundra/large (9 found) and mountain-and-cliffs/large (no border touch) differ from the plan's notes; the current sheets look regenerated.
- Terrain tileability before seamFix is 0.06 to 0.90; after it is 0.45 to 1.00 (tavern's planks are lowest, with some ghosting on planks and tiles, as D6 expects).

Known limit: soft glows and smoke drawn over magenta keep a pink aura beyond the 6 px despill band (swamp will-o'-wisp, dungeon candles, volcanic smoke, the bottom of dungeon/large's stairs). A wider "unmix" toward transparency was tried and dropped: purple objects (mushroom-cavern/props #1) lost their colour and opacity.

## Tests

`tests/unit/sprite-cut.test.ts` (22 tests) uses synthetic sheets from `tests/fixtures/sprite-sheets/synthetic.ts`. They are generated in memory, so no binary is committed and sharp is not used. It covers: the key scores; a clean 4x4 (order, exact trim sizes and boxes); JPEG-like ring and noise (no magenta left in any edge pixel); grey grid lines (flag and exact sizes); 10 objects for 9 names (`count-mismatch` 10/9, 10 cuts in order); an object flush with the border; an uneven 3x3; scattered bones plus a far-apart stone pair in one cell (one object, 8 fragments); an already-transparent purple sheet (left untouched); single sprite with a dropped speck; an empty sheet; a bad buffer; trim; a framed 2x2 terrain sheet (frame, cross, bleed inset, colours); a terrain sheet with no frame; no cross; seamFix and tileability; purity (imports).
