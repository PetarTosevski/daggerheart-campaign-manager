# TASK-SP-P3: Vision reads sprite traits (C1 extension)

Status: Done. Plan: `.omc/plans/sprite-packs.yaml`, tracer P3 (wave 1, no dependencies). Bead: dcm-bxp.56.
Decisions implemented: D2, D3, D4 (footprints), E5, answered Q1 = (b).

## Goal
The vision engine takes optional per-object traits (sight default, light, footprint and size) so sprite objects block sight, give
cover or light exactly as their manifest says, including long rectangular footprints, while maps without traits give identical
results.

## Decisions quoted
- **D3** "Sight for a sprite object = the GM's per-object override (existing `sight` field, R7) ?? the sprite's manifest default ??
  the Classic kind's R7 default."
- **D4** "props are 1 x 1 square; large objects 2 x 2, except long items 2 x 1 ... An object's `r` scales its sprite (default
  r = max(w, h) / 2); `rot` rotates it."
- **Q1 = (b)** "a new 'faint glow' map-light reach for things that only glow ...: FAINT_GLOW_REACH = clear to 1 square (Melee), dim
  to 3 squares (Very Close), one named constant in src/lib/domain/combat-map/light.ts next to MAP_LIGHT_REACH (tunable) ...
  Faint-glow lights are switchable like other map lights and follow R9-R11 (dim hides tokens at night)."
- Cross-tracer naming (orchestrator, 2026-10-21): the light flag union is `"none" | "faintglow" | "torch" | "campfire"`.

## API (all exported from `src/lib/domain/combat-map`)
- `traits.ts` (new): `type LightTrait = "none" | "faintglow" | "torch" | "campfire"`, `LIGHT_TRAITS`,
  `type FootprintShape = "circle" | "rect"`, `type VisionTraits = { sight: SightMode; light: LightTrait; footprint: FootprintShape;
  w: number; h: number }`, `defaultTraitRadius(traits) = max(w, h) / 2`.
- `vision.ts`: `VisionObject` gains `rot?: number | null` (radians, as stored) and `traits?: VisionTraits | null`.
- `sight.ts`: `SightSubject` gains `traits?: { sight?: SightMode | null } | null`; `sightOf` = override ?? traits.sight ?? R7.
- `light.ts`: `FAINT_GLOW_REACH = [1, 3]`; `MAP_LIGHT_REACH` gains the key `faintglow` (= FAINT_GLOW_REACH); new
  `type LightSubject`, `mapLightReach(object): LightReach | null` (trait when present, `"none"` = no light even on a Classic light
  kind; else the kind), `givesLight(object)`; `isLit(object)` = `givesLight(object) && lit !== false`.

## Engine changes
`prepareMap`: a lit object's reach comes from `mapLightReach`. A sight-blocking object with `traits.footprint === "rect"` blocks
every sample whose centre lies in the rectangle of `w x h` squares centred on (x, y), scaled by `r / (max(w, h) / 2)` when `r` is
set, rotated by `rot`. Circle footprints keep `blockRadiusFactor(kind)`; with traits and no `r` the radius is `max(w, h) / 2`
(D4). Objects without traits run exactly the old code path (E5).

## Tests
`tests/unit/combat-map-vision-traits.test.ts` (20 tests): faint glow constant and its clear / dim bands at night, dim hides unless
revealed (R10), switchable (`lit: false`); sight precedence; sprite tree blocks, sprite pool does not (even on a blocking
fallback), cover never blocks, override beats manifest both ways; rect footprint exact sample count, rotated wall section blocks
along its length only, diagonal, `r` scaling, non-blocking rect, circle defaults equal Classic; `mapLightReach` precedence, brazier
sprite = Classic torch at four distances, campfire sprite, candle with light none lights nothing; traits equal to Classic give an
identical grid and light list (E5); speed with 300 sprite objects (rect rotated, faint glows) on 44 x 32: median day 1.00 ms,
night 1.07 ms (budget 50 ms). `combat-map-vision.test.ts` (34) and `combat-map-spec.test.ts` (17) pass unchanged.

## Outside this tracer (for P0 / P1 / P5 / P9)
- P0's stored `spritePackSprites.light` validator and P1's catalog light flag must include `"faintglow"`.
- The server's `toggleLight` (`convex/combatVision.ts`) and the client's `isSwitchableLight` (`edit-model.ts`) still check the
  Classic kind only; for faint-glow sprites on a non-light Classic kind they must call `givesLight(objectWithTraits)` once objects
  carry resolved traits (P5 wires traits into `convex/lib/combatVision.ts`).
