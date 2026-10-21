# TASK-F4-F4: Sprite cutter strips a magenta outer frame for GM uploads; texture picks stay stable when a setting gains variants

Status: Review. Plan: `.omc/plans/followups-4.yaml`, tracer F4 (no dependencies). Beads: dcm-bxp.116, dcm-bxp.115
(the two P11Z follow-ups; see docs/tasks/TASK-SP-P11Z.md, "Magenta outer frame on terrain sheets" and "Textures").

## What changed

| File | Change |
|---|---|
| `src/lib/sprite-packs/cut/terrain.ts` | `cutTerrain` first measures a plain magenta outer frame (`magentaFrame`: lines whose middle 60 % is at least half gap magenta, up to 20 % of the short side; the rule of the script's `stripMagentaFrame`), cuts the rest out and runs the old cut on it (`cutInsideFrame`); `inner` and the swatch boxes are moved back onto the input sheet. A sheet without a magenta frame takes the old path unchanged |
| `src/lib/sprite-packs/mapping.ts` | the P11Z doc's suggestion: `texturePool` splits a terrain's textures into `base` (primary-sheet textures: the setting's, else common's) and `gained` (extra-sheet ones: the setting's when it has any texture of that terrain, else common's). `textureCandidates` = base then gained. `pickTexture` takes the old hash over base (exactly the pre-extras pick) and a second hash (`...|gained`) over base + gained to decide whether the block shows that pick or a gained variant |
| `tests/unit/sprite-cut.test.ts` | a plain magenta frame (with and without a white frame inside) cuts the same swatches as the unframed sheet, boxes moved by the frame; on a JPEG-noised framed sheet `cutTerrain` gives the same swatch images as `stripMagentaFrame` then `cutTerrain` |
| `tests/unit/sprite-mapping.test.ts` (new) | over every (setting, terrain) and 120 blocks: a block showing a primary texture shows its pre-extras pick (computed in the test from the catalog with its own FNV-1a); pools without gained variants pick exactly as before; forest grass keeps about base / (base + gained) of its picks; grassland dirt keeps common's packed dirt first and gains ploughed soil; forest water uses its extra-sheet texture; every pick is a candidate |
| `tests/unit/sprite-catalog.test.ts` | one pin, the one the P11Z doc names: `[gained, fromCommon]` goes from `[70, 11]` to `[78, 3]` (owns widened by the orchestrator) |

## Effect on existing Sprites maps

- A block keeps its old texture with probability base / (base + gained) and otherwise shows a new variant; a pool with
  no gained variants picks exactly as before batch 2.
- The 8 pairs that fell back to common before batch 2 (grassland, tavern and snow dirt; crypt, temple and sewers path;
  ruins grass; mushroom-cavern stone) keep common's primary textures and gain the setting's batch-2 one, so they count
  as "gained" now (70 + 8 = 78). The 3 pairs with no primary texture anywhere (forest water, town water, coast swamp)
  use the setting's batch-2 texture only (3).
- The painter's noise mix (`sprite-fallback.ts`, `resolve.ts` `terrainTextures`) reads `textureCandidates`; it now
  gets common's primary textures in those 8 pools as well. `terrainTextures` already added common's candidates after
  the setting's, so its set is unchanged; `sprite-fallback.ts` picks one area texture by hash over the candidate list,
  so its pick can move for those 8 pools. Not F4's files; no test pins them.

## Script and browser cut the same swatches

The script (`scripts/sprite-packs/lib/pipeline.ts`) still calls `stripMagentaFrame` before `cutTerrain`. On the
stripped image `cutTerrain` finds no magenta frame (stripping stops at the first line below half magenta) and runs
`cutInsideFrame` on the same pixels the browser crops, so the swatch images are byte-identical (test above). Only a
frame deeper than 20 % of the short side would be stripped a second time inside `cutTerrain` in the script.

## Acceptance evidence

- `pnpm lint`, `pnpm typecheck` clean.
- vitest (`--maxWorkers=4 --testTimeout=60000`): 217 files, 5285 passed (1 expected fail).
- The new cut tests fail on the old `terrain.ts` (2 of 24) and the new mapping tests on the old `mapping.ts` (2 of 5).
- `pnpm tracer:guard .omc/plans/followups-4.yaml F4` passes.
