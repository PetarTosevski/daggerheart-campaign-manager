# TASK-D9-C0: D9 foundation

Status: Review. Plan: `.omc/plans/d9-combat-map.yaml`, tracer C0 (wave 1, foundation, no dependencies). Bead: `dcm-bxp.32`.
Rules: R1–R12 and answers Q1–Q6 in the plan header (user, 2026-10-19).

## Goal
The combat map tables exist and are purged with their campaign, the error codes and the generation rate limit are wired, and
`/campaigns/<id>/combat-map` opens a board-look page (header, Fear, nav, left column and map area with stubs) for the GM and the
player view stub for players.

## Rules this tracer implements
- R2 "Maps: several per campaign; the GM marks one live" → `combatMaps.live` + index `by_campaign_live`; MAX_COMBAT_MAPS 30.
- Q5 "10 generations per user per hour (rate limit `combatMapGenerate`)" → `RATE_LIMITS.combatMapGenerate` in `convex/lib/functions.ts`.
- Data model of the plan header: every table, field and index below. Range circles and "names" stay per-viewer localStorage (no field).

No public Convex function is added (the first ones come with C3), so nothing is new for the authz matrix, and RETURNS_PENDING is unchanged.

## What was built
- **Tables** (`convex/tables/combatMaps.ts`, composed in `convex/schema.ts`; validators once in `convex/lib/validators/combatMaps.ts`, no `v.any()`):
  - `combatMaps` {campaignId, name, live, source blank|generated|image, w, h, base (terrain), plankV?, areas [≤60 typed area:
    terrain, shape rect|ellipse|poly|path|border, x?, y?, w?, h?, rx?, ry?, width?, points? ([x,y] pairs)], prompt?, seed,
    image? {fileId: files id, grid {cell, offsetX, offsetY}}, schemaVersion (1), updatedAt}; indexes `by_campaign_updated`
    [campaignId, updatedAt], `by_campaign_live` [campaignId, live]. The area shape follows the board's `CMAP.clean`, all fields
    optional, so C1's `clean()` output can be stored unchanged.
  - `combatMapObjects` {mapId, kind (22 board kinds incl. walltorch, campfire, hull, mast), x, y, r, rot, variant?, len?, span?,
    points?, sight? block|cover|none (absent = R7 default), lit? (lights; absent = lit)}; index `by_map`.
  - `combatMapCells` {mapId, layer terrain|block|fog, tile, cells}; index `by_map_layer_tile`. Encoding in `convex/lib/combatMaps.ts`:
    tiles of CELL_TILE_ROWS (8) rows, one character per square: "." unpainted; terrain codes "a".."n" in COMBAT_TERRAINS order;
    block "#"; fog "r" reveal / "h" hide.
  - `combatTokens` {campaignId, mapId, ref (pc {characterId} | adversary {adversaryId: encounterAdversaries} | custom {name, hp,
    hpMax, stress, stressMax, conditions (the tracker's list)}), side pc|enemy|ally|neutral, x, y, size, face (radians, 0 = east,
    clockwise), light none|torch|lantern|alistair, revealedTo [characters]}; index `by_map`.
  - `combatExplored` {mapId, characterId, bits, updatedAt}; index `by_map_character`. The bitmap encoding is C7's.
  - `files.kind` widened with `"combatMap"` (refId = the map id). Widen only; no existing value changes.
- **Caps and helpers** (`convex/lib/combatMaps.ts`): MAX_COMBAT_MAPS 30, MAX_COMBAT_TOKENS 80, MAX_COMBAT_OBJECTS 300,
  MAX_COMBAT_AREAS 60, MAX_AREA_POINTS 40, MAX_COMBAT_REVEALS (= MAX_CHARACTERS_PER_CAMPAIGN), grid 12..44 × 10..32 (`assertMapSize`,
  COMBAT_MAP_SIZE), size presets Small 22×15 / Medium 30×20 / Large 40×27, token size 1..3, name/prompt lengths, MAX_COMBAT_IMAGE_BYTES
  8 MB, COMBAT_MAP_SCHEMA_VERSION 1; loaders `loadCombatMap`, `liveCombatMap`, `loadCombatToken`, `loadCombatObject` (normalizeId,
  campaign-scoped, *_NOT_FOUND); `tokensOnMap` / `objectsOnMap` (index `.take(cap)`); `assertCanAddMap`, `assertCanAddTokens`,
  `assertCanAddObjects`, `assertAreaCount`; `deleteMapChildren(ctx, mapId, max)` (objects, cells, tokens, explored; for C3's delete
  and the purge).
- **Errors** (`src/lib/errors/combatMap.ts`, joined into `AppErrorCode` and `convex-errors`): COMBAT_MAP_NOT_FOUND, COMBAT_MAP_LIMIT,
  COMBAT_MAP_SIZE, COMBAT_TOKEN_NOT_FOUND, COMBAT_TOKEN_LIMIT, COMBAT_OBJECT_NOT_FOUND, COMBAT_OBJECT_LIMIT, COMBAT_AREA_LIMIT,
  COMBAT_NOT_YOUR_TOKEN, COMBAT_NO_CHARACTER, COMBAT_GENERATE_UNAVAILABLE, COMBAT_LAYOUT_INVALID, COMBAT_LIGHT_NOT_SEEN,
  COMBAT_MAP_CORRUPT.
- **Purge** (`convex/cleanup.ts`): a step reads the campaign's maps by `by_campaign_updated`, deletes each map's children through
  `deleteMapChildren` within the batch budget, then the map; the map image is a `files` row of the campaign and goes with the existing
  files step (blob included). schema-guard: `combatMaps`, `combatTokens` are CAMPAIGN_SCOPED; new MAP_SCOPED list
  (`combatMapObjects`, `combatMapCells`, `combatExplored`) with a test that each has `mapId`.
- **Page** (`src/app/(gm)/campaigns/[campaignId]/combat-map/`): `page.tsx`, `error.tsx`, `combat-map.css` (the board's classes and
  `--cm-*` tokens). Header: campaign name, H1 "Combat Map", header line slot, light pill slot, GM Fear pill (− / n / +, `fear.adjust`,
  GM only), preview picker slot. GM column: Maps card, Play / Edit switch, then Scene + Edit tools (Edit) or Combatants, selected token,
  Reveal, Vision & fog (Play, once a map exists). Player column: their view card and selected token, only once a map is live; before
  that the empty map area takes the whole width. Every slot is in its own error boundary; `<title>` "Combat Map · <campaign>".
  The nav entry already existed (`src/lib/campaign-sections.ts`: `combat-map`, not gmOnly); the static route replaces the `[section]`
  placeholder.
- **Slots** (`src/components/combat-map/slots.ts`): `CombatPageState` (campaignId, role, mode, map, selectedTokenId, previewCharacterId
  and their callbacks), `CombatMapSummary`, `CombatMapViewport` (cell, zoom, w, h, pad for Q1's fog padding, toSquares, showNames),
  `MapLayerProps`, and the props of each slot. Stubs: `maps/` (`useCurrentMap` → null, `MapsPanel`, `MapHeaderLine`, `MapBoard`
  with the board's empty states and `renderLayers`), `generate/` (`ScenePanel`), `editor/` (`EditorProvider`, `EditToolsPanel`,
  `EditorLayer`), `tokens/` (`TokensProvider`, `CombatantsPanel`, `TokenPanel`, `TokensLayer`), `vision/` (`VisionProvider`,
  `LightPill`, `PreviewPicker`, `VisionPanel`, `RevealPanel`, `VisionLayer`).
- **Visual tooling**: `scripts/board-shots.mjs combat:<region>` (gm-empty, map-list, gm-edit, gm-play, player-day, player-night;
  1440, 1024, 390; it walks the board's own story: party seeded, keyword-fallback map, party placed, player view by day and at night
  with a torch); `tests/e2e/visual/helpers.ts`: `D9_VIEWPORTS`, `openCombatMap`, `visual(page, tracer, viewports)`.

## Acceptance evidence
See the tracer report (test counts, e2e and visual runs). `tests/convex/cleanup.test.ts` seeds one row in each combat table plus a
combat map image and checks the purge leaves nothing, and a map with BATCH + 50 objects purges over several runs.
`tests/e2e/combat-map-shell.spec.ts`: GM nav, header, Fear ± , mode switch and empty map; a player's layout; no horizontal scroll at 390.

## Visual comparison
App: `test-results/visual/C0/gm-empty-{1440,1024,390}.png` (E2E_VISUAL=1; the GM with no map, so in Edit).
Board: `test-results/visual/board/combat-{gm-empty,map-list,gm-edit,gm-play,player-day,player-night}-{1440,1024,390}.png`.

| Region | Verdict |
|---|---|
| Header (campaign name, title, header line, Fear) | Matches the board's type and the Fear pill. Deviation: the art banner, wordmark, nav and Back link come from the shared campaign shell above the page, not from the page's own header. The light pill and "Player view ▾" are C8's slots and render nothing yet. |
| Left column (Maps, Play / Edit, Scene) | Matches the board's cards and segment; as on the board, a campaign with no map is in Edit with the Scene card. Card bodies are stubs until C3/C4. |
| Map area (empty state) | Matches the board's empty state copy and viewport frame; the toolbar's zoom controls and Names come with C3. |
| 390 px | Single column (the board has no phone layout): left column first, then the map; 44 px touch targets; no horizontal scroll. |

## QUESTIONS
1. No shared `<Loading>` component exists in `src/components` (the plan names one); slots use the codebase's inline
   `<p role="status" className="cm-muted">` pattern.
