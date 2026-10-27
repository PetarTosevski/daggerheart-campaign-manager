# TASK-HL-HL1: Hills terrain on the World map

Status: Review. Plan: `.omc/plans/hills.yaml`, tracer HL1. Bead: `dcm-bxp.138`. Builds on PD1 (`docs/tasks/TASK-PD1.md`).

## Goal
User 2026-10-27: "add a hills option that's orange, keep it 20km (same as deep wilds)".

## What changed
- **Terrain code `k` (Hills)** (`src/lib/world/terrain.ts`): label "Hills", colour `#f07a1e` (orange; Road is amber `#e0a93a`,
  Mountains red `#d0453a`), brush colour `#b85a14`, placed after Deep wilds in `BRUSHES` (key 4, so Wetlands, Mountains, Water and
  Impassable move to keys 5-8; the key handler, hints and `terrainPaths` follow). The map overlay draws it orange. Grid validation
  (`mapStateSchema.terrain` regex) and `paintCells` (`TERRAIN_CODES`) accept `k`; existing grids are unchanged.
- **SpeedTerrain `hills`** (`src/lib/domain/travel`): `DEFAULT_TRAVEL_RULES` hills equals deep for every method (foot 20, mount 30,
  wagon 12, boat 15, fly 120). Measure (`analyseRoute`, `per.k`), the party trail and token distances (`trailLeg`) read it through
  `tableSpeed`. The boat overland warning counts Hills.
- **Widen only**: `hills` is optional in the speed table type, in `travelRulesSchema` (zod) and in `travelRulesValidator`. Stored
  campaign rules without it read as that method's `deep` value (`tableSpeed`); no migration. The Edit speeds dialog and the legend
  show a Hills row; editing a cell writes the Hills value explicitly.

## Verification
Unit: `tests/unit/world-travel.test.ts` (defaults, missing value reads as deep, Measure and trail), `tests/unit/world-terrain.test.ts`
(code, name, colours, brush order, grid validation). Convex: `tests/convex/maps.test.ts` (`setTravelRules` saves hills and accepts a
table without it). E2E: `tests/e2e/world.spec.ts` (legend Hills row 20 km/day, eight rows).

## Scope addition (user 2026-10-27): Plains, Road recoloured
- **Plains** (code `p`, yellow `#e8d13a`, brush `#a8962a`, after Wilds in the brushes, so keys run 1-9): `SpeedTerrain` `plains`, defaults
  foot 50, mount 70, wagon 40, boat 25, fly 120 km/day. Widen only like Hills: optional in the type, zod schema and validator; a
  missing stored value reads as the method's default (`tableSpeed(table, terrain, method)`). Grid validation accepts `p`.
- **Road** is now stone grey (terrain `#b9b2a4`, brush `#8f897c`, map overlay grey) so Road, Plains (yellow) and Hills (orange) differ.
