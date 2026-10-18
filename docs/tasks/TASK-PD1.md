# TASK-PD1: Pace by travel method and terrain, with a travel-speed legend

Status: Review. Plan: `.omc/plans/travel-pace.yaml`, tracer PD1. Bead: `dcm-bxp.33`. Builds on D6 (`docs/tasks/TASK-108-world-maps.md`).

## Goal
Bug `dcm-bxp.33`: the World map's header "Pace" offered "On foot · by terrain", "Mounted · by terrain" and four flat speeds named
after an old terrain set ("Hard going · 20 km/day", "Wilds on foot · 40", "Road on foot · 60", "Mounted · 80") that ignored the GM's
Travel rules. User 2026-10-18, option (a): "A is fine, however the party needs to know the travel speed on all terrain types, maybe a
legend".

## What changed
- **Pace = travel method** (`src/lib/domain/travel`): the header "Pace" offers the five travel methods (`METHOD_LABELS`, each
  "· by terrain"); the flat speeds are gone. A "March pace" select beside it sets Cautious / Normal / Forced march (the same
  `options.pace` the Measure tool uses). `trailLeg` / `trailTotal` take a method and a pace: each step goes at
  `terrainSpeed(rules, method, pace, code)`, the method's km/day on the painted terrain times the pace factor; unpainted or unknown
  ground counts as Wilds; Impassable still adds no time and marks the leg blocked.
- **One speed table**: `TravelRules` is `speeds` (per method) plus the two pace factors. The board's separate foot/mount trail table
  (`PMAP`, `rules.trail`) is folded in: `travelRulesSchema` no longer lists it, so stored rules that still carry it parse and drop it
  (zod strips unknown keys) and no write keeps it; `travelRulesValidator` accepts it optionally from older clients and ignores it. The
  Travel rules dialog lists one row per method (no "Measure ·" / "Trail ·" rows) and says the one table drives Measure, the party
  trail and token distances; its column names are the painted terrain's names (`TERRAIN_NAMES`).
- **Stored options, widen → migrate → narrow**: `options.trail` in `mapStateSchema` accepts the methods and the legacy `"20"`–`"80"`
  and reads them through `trailMethod` (flat paces → `foot`, `"80"` → `mount`). `setOptions` takes a method (a legacy value from an
  older client is stored as its method). `maps.get` returns only methods. `migrations/mapTrailMode:rewriteTrailMode` (batched,
  idempotent, version 1 and 2 rows) rewrites stored flat paces and removes `options.rules.trail`:
  `npx convex run migrations/run:run '{fn: "migrations/mapTrailMode:rewriteTrailMode"}'`. **Narrow step (later):** after it has run
  on every deployment, narrow `options.trail` to `z.enum(TRAVEL_METHODS)`, drop `trail` from `travelRulesValidator` and the legacy
  values from `trailOptionValidator`.
- **Travel speeds legend** (`world/travel-legend.tsx`, `world.css` `.w-legend*`): under the header on every non-Horizon map, for the
  GM and players. It names the method and pace ("Boat · Forced march ×1.33 · km/day") and lists Road, Wilds, Deep wilds, Marshland,
  Mountains, Water with their `TERRAIN_COLOURS` swatch and km/day after the pace factor, plus "Impassable · can't cross" and "Unpainted
  ground counts as Wilds". It follows the method, pace and the GM's table live (it reads the map query). While measuring it shows
  the Measure tool's method, otherwise the header's. Collapsible ("Travel speeds" button, `aria-expanded`); the GM gets "Edit
  speeds…", which opens the Travel rules. It replaces the old overlay legend (which quoted the trail table's on-foot speeds).
- The orchestrator's eye-icon Hide / Show tokens button is unchanged.

## Verification
See the tracer report for counts. Unit (`tests/unit/world-travel.test.ts`): method speeds, pace, unpainted = Wilds, legacy-mode
mapping. Convex (`tests/convex/maps.test.ts`): `setOptions` with a method and a legacy value, rules with an old trail table, and the
migration (version 1 and 2 rows, untouched current rows, reads identical before and after, idempotent on reset). E2E
(`tests/e2e/world.spec.ts`): pace options, pick Boat → Water 100 km/day, Cautious → 75, GM edits Boat / Water to 90 → legend follows,
collapse; players see the legend without "Edit speeds…". Visual: `tests/e2e/visual/PD1.spec.ts` at 1440 and 390 (no horizontal
scroll), shots in `test-results/visual/PD1/`.

## Questions
- The party trail and token distances now follow Cautious / Forced march too (they ignored the pace before), so they match the legend.
- GM-customised `rules.trail` speeds (if any campaign changed them) are dropped, not merged into `speeds`; the defaults differed only
  on Water (trail 20 vs. 8 km/day on foot and mounted), so on-foot trails across water now take longer.
