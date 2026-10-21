# TASK-F5-F6: Glowing terrain gives very dim light around its own squares

Status: Done. Plan: `.omc/plans/followups-5.yaml`, tracer F6 (no dependencies). Bead: dcm-bxp.91 (left open for the
orchestrator).

## The rule (user answer, 2026-10-21)

> Glowing terrain gives off light like other faint-glow objects - very dim light only around its own squares.

Each glowing square is a faint-glow light at its centre: `TERRAIN_GLOW_REACH = FAINT_GLOW_REACH` = clear to 1 square
(Melee), dim to 3 squares (Very Close), with the engine's usual half-square slack. So a token on a glowing square or
on the next square is shown at night; the dim band beyond hides tokens unless the GM revealed them (R10), the same
as a candle. Terrain has no switch: a glowing square is always lit. By day and in the dim phases nothing changes.

## Which terrain glows

- **Classic:** `GLOWING_TERRAINS = {"lava"}` (`src/lib/domain/combat-map/light.ts`, `terrainGlows`).
- **Sprites:** textures with light `"faintglow"` in the catalog (`glowTex` in `catalog/types.ts`), chosen from their
  names. "Glowing", "molten", "red-hot", ember, luminous and crystal floors glow; cooled or dark rock does not:

| Key | Texture | Terrain class |
|---|---|---|
| `volcanic/glowing-lava` | glowing lava | lava |
| `volcanic/red-hot-cracked-ground` | red-hot cracked ground | lava |
| `mushroom-cavern/glowing-moss-floor` | glowing moss floor | cave |
| `mushroom-cavern/violet-glowing-moss` | violet glowing moss | cave |
| `mushroom-cavern/crystal-studded-floor` | crystal-studded floor | cave |

  Left dark, on purpose: `cave/crystal-flecked-rock` (flecks of crystal in grey rock, not a glowing floor), volcanic
  `cooled ropy lava`, `obsidian glass`, `black volcanic rock`, `cracked basalt`, `sulphur crust`, `ash ground`,
  mushroom-cavern `wet obsidian`, `spore-dust ground`, `fungal carpet`, `dark cave floor`, `black underground water`
  (the catalog has no glowing water). An uploaded texture glows when its row's light is not `none`.

On a Sprites map a square glows when the texture drawn there glows, decided at the square's centre the way the
sprite painter picks it: a texture cell, else the texture of the area that painted the square, else the mix of the
square's terrain class in the setting (the variant the noise mask draws at the centre), else the Classic terrain
(lava in a setting without lava textures still glows). So a lava square hand-textured with black volcanic rock gives
no light, and a glowing-moss cell on a stone floor does.

## Code

| File | Change |
|---|---|
| `src/lib/domain/combat-map/light.ts` | `GLOWING_TERRAINS`, `TERRAIN_GLOW_REACH`, `terrainGlows` |
| `src/lib/domain/combat-map/vision.ts` | `VisionMapInput.glow?` (square keys; replaces the terrain rule when given); `PreparedMap.glow?` (per-sample level, computed once in `prepareMap`); `computeSample` reads it at night; area hit tests factored into `areaHit` (same maths) |
| `src/lib/sprite-packs/catalog/types.ts`, `volcanic.ts`, `mushroom-cavern.ts` | `TextureSpec.light?`, `glowTex`; the five textures above |
| `src/lib/combat-map/sprites/terrain.ts` | `glowingSquares(spec, paint, textures, setting, uploaded)` (pure, server and browser); `TexturePlan.glow?` (glowing texture URLs); `compositeTextures` lifts glowing texture pixels (x 1.16 + 10, by coverage) |
| `src/lib/combat-map/painter.ts` | `PreparedMap.glow?` (per fine cell, 1 on lava fading over 3/4 square); `paintTerrain` warms those pixels |
| `convex/lib/combatVision.ts` | `loadScene`: a Sprites map (not an image) passes `glow: spriteGlow(...)` (texture cells, area textures, `paintSetting`, uploaded rows incl. textures via `mapSpriteRefs`); a Classic map leaves lava to the engine |

`glow` is computed per sample once per map preparation: for each sample near a glowing square, the clear band is
walked first and stops at the first glowing square with a sight line to it, then the dim band; a glowing square's
own samples are clear without a sight line. A viewer then only reads one byte per sample, after its own sight line.

## Unchanged behaviour

- A map with no glowing terrain: `prepareMap` returns the same object as before (no `glow` key, test pins the keys
  and `toEqual` with `glow: []`); vision runs the old code path; both painters produce identical pixels (no glow
  field, no glowing texture URL). `combat-map-vision.test.ts`, `combat-map-vision-traits.test.ts`,
  `combat-map-painter.test.ts` and `sprite-painter.test.ts` pass unchanged.
- `sprite-catalog.test.ts` (owned) now lists the five textures in the faint-glow list and pins that every other
  texture gives none; red-hot cracked ground is `light: "faintglow"`.

## Speed (C1 budget)

`tests/unit/combat-terrain-light.test.ts`: 44 x 32, 300 objects (12 of them torches), a lava ellipse 24 x 16 plus a
3-wide lava river (over 1,000 lit samples), one viewer with a torch at night, median of 9: prepare 8.6 ms, one
viewer 3.5 ms, together 12.2 ms (budget 50 ms), measured with the machine lightly loaded. The first per-square
version took 49 ms to prepare; walking per sample fixed it. With many worktrees running (load average about 55 on
16 cores) the same medians stretched to 50-130 ms prepare and 25-48 ms per viewer, so the test asserts the best of 9
runs: one viewer < 50 ms, prepare plus viewer < 100 ms (the glow is prepared once per query, shared by all viewers).

## Painters at night

The painters have no time-of-day input (map-canvas passes none and is not F6's file), so the glow is drawn always:
a subtle warm lift on Classic lava fading 3/4 square into its neighbours, and a lift of the texture's own colours on
glowing textures. At night the fog shows them because vision now lights those squares. If the user wants the
painted glow only at night, the map canvas would pass a flag (e.g. `PaintOptions.glow`) from the scene's light level.

## Tests

`tests/unit/combat-terrain-light.test.ts` (19): the rule; night visibility on, next to and beyond a lava pool, R10
reveal; day and dim unchanged; walls stop the glow and the viewer's own sight line still counts; painted lava and
grass painted over lava; `glow` list replaces the terrain rule, image maps; no-glow maps prepare as before; speed;
Sprites `glowingSquares` (volcanic lava, Classic fallback, texture cells, area textures and hand-painted squares,
mixed cave pool deterministic, uploaded textures, feeding vision); Classic painter lift and halo, far pixels
identical; sprite painter plan and brighter glowing pixels.
