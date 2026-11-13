# TASK-ME3: Stable ids for combat map areas

Plan `.omc/plans/map-editor.yaml`, wave 1, tracer ME3; bead dcm-5rhs.3 (epic dcm-5rhs, Combat Map editor v1). Mode:
widen and migrate (rule 7, CD4/CD5). The narrow step is a follow-up, below.

## What landed

- **Widen.** `combatAreaValidator` (`convex/lib/validators/combatMaps.ts`) gains `id: v.optional(v.string())`. Every
  query that returns areas (`combatMaps.get`, `combatMaps.list`) uses this validator, so ids reach the website and the
  phone with no other change.
- **Id scheme.** `"a"` + a decimal counter: `a1`, `a2`, ... Unique within one map, never across maps. Readers treat an
  id as an opaque string. `withAreaIds(areas)` (`src/lib/combat-map/fallback-layout.ts`) is the one place that hands
  them out:
  - it keeps every non-empty id that no earlier area in the list holds;
  - every other area (no id, `""`, or a duplicate) gets `a<n>`, with n counting up from one more than the highest
    `a<n>` counter on the map (`a0` and `a01` are not counters). So an id is not reused while an area with a higher
    counter remains;
  - it is pure and returns the same object for an area whose id it keeps.
  Later editors (ME10) number the areas they add with it.
- **Writers.** `combatMapGenerate.save` stores `withAreaIds(layout.areas)`. That covers every generator path: Claude's
  Classic layout, Claude's Sprites layout, the keyword fallback and the Sprites fallback (C1's `clean()` drops unknown
  keys, so ids are set at save, after cleaning). `generateFallbackLayout` also numbers its own areas (`a1`.. in order),
  and it now caps them at `MAX_AREAS` from `spec-constants` instead of a literal 60. `combatMaps.create` and the image
  upload write `areas: []`, and `duplicate` copies areas with their ids.
- **Migrate.** `convex/migrations/combatMapAreaIds.ts` exports `fillAreaIds` (`migrations.define` on `combatMaps`,
  batch size 50). It patches only `areas` and only when an id changes, and leaves `updatedAt` alone, so a generation
  that is running still saves. It is idempotent. You run it through the existing runner (`convex/migrations/run.ts`), so
  there is nothing to register:

  ```sh
  npx convex run migrations/run:run '{fn: "migrations/combatMapAreaIds:fillAreaIds", dryRun: true}'
  npx convex run migrations/run:run '{fn: "migrations/combatMapAreaIds:fillAreaIds"}'
  npx convex run --component migrations lib:getStatus '{names: ["migrations/combatMapAreaIds:fillAreaIds"]}'
  ```

  Add `--prod` for production. Run it on dev and on prod after this tracer is deployed.

## Tests

- `tests/convex/combat-map-areas-migration.test.ts`:
  - old maps get `a1..`;
  - set ids stay;
  - duplicates and empty ids get counters above the map's highest;
  - `updatedAt` does not change;
  - a dry run commits nothing;
  - `oneBatchOnly` with batch size 2 stops part-way and a rerun resumes;
  - `reset: true` changes nothing;
  - `combatMapGenerate.save` writes ids.
- `tests/unit/fallback-layout-area-ids.test.ts`: `withAreaIds` rules, and every keyword scene numbers its areas `a1..`.

## Not done here (orchestrator)

- **Caps 60 → 150 areas, 40 → 64 points.** The caps live in files outside ME3's `owns`, so this tracer does not change
  them:
  - `convex/lib/combatMaps.ts`: `MAX_COMBAT_AREAS = 60`, `MAX_AREA_POINTS = 40`. ME2 owns this file.
  - `src/lib/domain/combat-map/spec-constants.ts`: `MAX_AREAS = 60`, `MAX_POINTS = 40`. C1's `clean()` and
    `mapSpecSchema` cut areas and points with these, and `fallback-layout.ts` now follows `MAX_AREAS`. `MAX_POINTS` also
    caps object `points` (hull).
  - `tests/unit/combat-map-spec.test.ts` ("caps areas at 60, objects at 300 and points at 40") and the
    `areas.length <= 60` check in `tests/unit/combat-map-painter.test.ts` (`expectValidLayout`) assert the old caps.
  - The comments in `convex/combatMapGenerate.ts` (`MAX_TOKENS`: "Room for 90 objects and 60 areas") and
    `spec.ts` (`clean` doc: "60 areas, 300 objects, 40 points") name the old numbers. `convex/lib/spriteSources.ts`
    derives `MAX_MAP_SPRITE_REFS` from `MAX_COMBAT_AREAS`, so it grows by 90 on its own.

## Narrow follow-up (file as a bead; do only after the migration has run on every deployment)

1. On dev and on prod, run `fillAreaIds` (commands above) until `getStatus` shows `isDone: true, state: "success"`.
   Then check that no stored area lacks an id: for example, rerun with `reset: true, dryRun: true` and confirm the
   batch reports nothing to change. Or run a one-off internal query that pages `combatMaps` and counts areas without
   an `id`, and expect 0.
2. In `convex/lib/validators/combatMaps.ts`, change `id: v.optional(v.string())` to `id: v.string()` in
   `combatAreaValidator`, and drop "Optional until ..." from its comment. Push the schema first: `npx convex deploy
   --dry-run` must pass on prod (CD4).
3. Code that builds areas without ids then fails typecheck. Fix each place:
   - `convex/combatMapGenerate.ts`: `layoutValidator.areas` would require ids from `toLayout` and `cleanSpriteLayout`.
     Keep `layoutValidator` on an id-optional copy of the area validator (`combatAreaValidator.extend` is not available,
     so spread the fields: `v.object({ ...combatAreaFields, id: v.optional(v.string()) })`, exporting the fields
     object from the validators module), or assign ids in `toLayout` / `cleanSpriteLayout` before the call. `save`
     keeps `withAreaIds`.
   - `tests/convex/*` fixtures that insert `combatMaps` rows with areas (`combat-maps.test.ts` around line 502,
     `combat-map-areas-migration.test.ts` `rect()` without id) add ids or call `withAreaIds`.
4. Then `LayoutArea.id` in `src/lib/combat-map/fallback-layout.ts` can become required too (`finish` always sets it).
5. Keep `convex/migrations/combatMapAreaIds.ts` (it is a no-op once run). Delete it in a later sweep, with its test.

## Phone app and web painters: extra `id` field check (read-only)

Nothing compares areas field by field or validates them strictly, so the extra key breaks nothing:

- The painters (`src/lib/combat-map/raster.ts`, `sprites/painter.ts`, `sprites/terrain.ts`, `domain/combat-map/vision.ts`,
  `movement.ts`) read named fields only.
- `src/components/combat-map/map-view/map-canvas.tsx:202,244`, `maps/thumbnail.tsx:72` and
  `apps/mobile/src/features/combat-map/paint-layout.ts:44` put `layout.areas` in a `JSON.stringify` repaint key. After
  the migration, each map's key changes once, so it repaints once. No loop: ids are stable.
- C1's `areaSchema` / `mapSpecSchema` (`src/lib/domain/combat-map/spec.ts`) is a plain `z.object`, not strict. It is
  only used in `toLayout` on cleaned specs, and `clean()` builds areas from named fields, so it drops `id`. That is why
  ids are set at save.
- `apps/mobile/src` reads `layout.areas` only through `paint-layout.ts` and the shared painters. No zod, no equality,
  no hand-written area type.
