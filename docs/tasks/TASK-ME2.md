# TASK-ME2: Maps up to 64 x 64 squares

Status: Review, partly blocked. Plan: `.omc/plans/map-editor.yaml`, tracer ME2, bead dcm-5rhs.2 (epic dcm-5rhs).

## Request (user, 2026-11-13)

The largest Combat Map is 64 x 64 squares (it was 44 x 32). The smallest stays 12 x 10.

## What changed

- `convex/lib/combatMaps.ts`: `MAX_MAP_W` 44 -> 64, `MAX_MAP_H` 32 -> 64. `assertMapSize` accepts 12..64 x 10..64 whole squares; 65 either way is refused with `COMBAT_MAP_SIZE`.
- Every server cap derived from these follows by itself, with no edit:
  - per-layer tile reads, `Math.ceil(MAX_MAP_H / CELL_TILE_ROWS)` = 8 (was 4): `convex/combatMapEdit.ts` (`layerTiles`, `.take(16)`), `convex/combatMapStyle.ts` (thumbnail), `convex/lib/combatMovement.ts`;
  - all-layer tile reads, 4 layers x 8 = 32 (was 16): `convex/combatMaps.ts` (layout, clear, duplicate), `convex/combatMapGenerate.ts`, `convex/lib/combatVision.ts` (`loadScene`);
  - stroke caps, `MAX_MAP_W * MAX_MAP_H` = 4096 (was 1408): `combatMapEdit.paintCells` and `combatVision.paintFog`. That is under Convex's 8192-element array limit.
- Canvas budget (`src/lib/combat-map/render-scale.ts`, unchanged): a 64 x 64 map is 3072 x 3072 CSS px at 48 px a square, so the map canvas and the editor overlay step down to k = 1 (9.4 M pixels; at 1.5 it would be 21.2 M). A 64 x 48 map keeps 1.5 (15.9 M). A player's fog, padded by 24 squares on every side at 12 px a square, is 1344 px a side and keeps up to k = 3. The thumbnail is 256 x 256.

## Not done (outside ME2's `owns`)

With only ME2's files changed, no create path makes a map larger than 44 x 32 yet. These files still cap it:

1. `convex/combatMaps.ts:70` and `convex/combatMapGenerate.ts:102`: `sizeValidator` is the literal union small | medium | large. A "Huge 64 x 48" preset needs `huge` added to both, plus `MAP_SIZES.huge` (ME2-owned, left out until the validators accept it) and the dialog's `SIZES` and `image-upload.tsx`'s size type (both ME2-owned). The create dialog has no custom-size input, so custom sizes do not apply.
2. `src/lib/domain/combat-map/spec-constants.ts:63-66`: `MAP_W_MAX = 44` and `MAP_H_MAX = 32`. The generator's zod spec (`spec.ts` `layoutSchema`, `clean`) and `imageMapSize` (`map-view/grid.ts`, so `attachImage` and `setGrid`) clamp to these. They should import from, or equal, `convex/lib/combatMaps.ts`. Two tests assert the old clamp: `tests/convex/combat-maps.test.ts:436` and `:518` (`{ w: 44, h: 32 }`).
3. `src/lib/combat-map/fallback-layout.ts:72-73`: clamps to 12..44 and 10..32 (owned by ME3).
4. Copy and comments: `src/lib/errors/combatMap.ts:13` (the message "A map is 12 to 44 squares wide and 10 to 32 squares tall.", plus its doc comment), `convex/combatMaps.ts:593`, `map-view/grid.ts:18`, `spec.ts:89`, `convex/lib/combatMovement.ts:36` ("= 4" tiles, now 8), and `tests/convex/combat-map-edit.test.ts:197`.

## Phone app (`apps/mobile/src/features/combat-map/**`, read only)

Nothing hard-codes map sizes that would break at 64 x 64:

- `paint-layout.ts` `baseCell`: the base map is painted at `min(48, floor(2048 / max(w, h)))`, at least 16 px. 64 x 64 gets 32 px a square, 2048 x 2048, within the 4096 px texture limit.
- `fog-image.ts`: the fog margin is 2 squares, (64 + 4) x 12 = 816 px a side.
- `view-math.ts`: the zoom limits come from the fitted size, not from fixed bounds.
- The only stale text is a comment example (`fog-image.ts:10`, "a Large map: 44 x 31").

## Risk

Vision cost grows with area. A player's padded sample grid is (64 + 48) x 2 = 224 samples a side, 50 k samples, against 92 x 80 x 4 = 29 k at 44 x 32. Per TE4, time a 64 x 64 vision query on the local backend before relying on it.

## Tests

- `tests/convex/combat-maps-size.test.ts` (new):
  - the bounds: 64 x 64, 64 x 10 and 12 x 64 pass; 65, 11 x 10, 12 x 9, fractions and NaN fail with `COMBAT_MAP_SIZE`.
  - every tile of a 64 x 64 map, painted with one 4096-square texture stroke, a blocker column and a fog stroke (32 tiles), is returned by `combatMaps.get`, the thumbnail, `movementGrid` (a blocker in row 63 stops tokens), `loadScene` (all 4096 fog marks), `duplicate` (copies all 32) and `clearPaint`.
  - all five tests fail with the old height cap (32) and pass with 64.
- `tests/unit/render-scale.test.ts`: 64 x 64 steps down to 1, 64 x 48 keeps 1.5, padded fog keeps up to 3, and a sweep over map sizes, screens and zooms never passes `MAX_CANVAS_SIDE` or `MAX_CANVAS_PIXELS`.
