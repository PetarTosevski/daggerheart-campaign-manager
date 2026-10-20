# TASK-D9-C4: Claude lays out a map from the GM's description

Status: Review. Plan: `.omc/plans/d9-combat-map.yaml`, tracer C4 (wave 3; depends on C3). Bead: `dcm-bxp.32`.

## Goal
The GM describes a battlefield, picks a size and gets a layout from Claude (or the keyword fallback), can ask for
another version, and the map is drawn and saved.

## Rules this tracer implements
- **R2** "Maps: several per campaign ... Generated layouts can be edited by hand AND regenerated." → `generate` replaces
  a map's layout as often as the GM likes; "＋ Generate new map" keeps the current map and makes another.
- **Q5** "10 generations per user per hour (rate limit `combatMapGenerate`)." → `generate` uses the wrapper's
  `rateLimit: "combatMapGenerate"` (C0's limit); the 11th call in an hour is RATE_LIMITED.
- Bead note (user, 2026-10-18): "generation option (a) — Claude lays out a grid from the GM's description (no image
  model)." → the Messages API returns the board's JSON layout; the C2 painter draws it.

No book page is cited by this tracer.

## Public functions (`convex/combatMapGenerate.ts`)

| Function | Wrapper | Args | Returns |
|---|---|---|---|
| `generate` | `userAction`, rate limit `combatMapGenerate`; GM via the internal `context` query (`campaignAccess(..., "owner")`, the photo import's pattern: outsider NOT_FOUND, player FORBIDDEN) | `campaignId`, `mapId: string`, `prompt: string` (trimmed, 1..1000, else INVALID), `size: small\|medium\|large`, `another?: boolean` | `{ mapId, saved: boolean, drawnBy: "claude"\|"keywords", claude: "ok"\|"unavailable"\|"failed", reason?: string }` |
| `stop` | `gmMutation` | `campaignId`, `mapId: string` | null |

Internal: `context` (query: the GM check and the map's `updatedAt`) and `save` (mutation: re-checks the GM, writes the
layout). Pure exports used by the tests: `scenePrompt(desc, w, h, variation?)` and `toLayout(raw, w, h, seed)`.

Errors: INVALID (description), COMBAT_MAP_NOT_FOUND (bad id, another campaign's map), COMBAT_MAP_SIZE,
COMBAT_AREA_LIMIT, COMBAT_OBJECT_LIMIT (cannot happen after `clean()`, kept as guards), COMBAT_GENERATE_UNAVAILABLE
(the keyword layout itself unusable; cannot happen today), RATE_LIMITED, and the wrappers' UNAUTHENTICATED /
NOT_FOUND / FORBIDDEN. All C0's or common codes.

## How a generation runs
1. `context`: GM check and the map's `updatedAt` (one `runQuery`, CF8).
2. Size from the board's presets (Small 22×15, Medium 30×20, Large 40×27); a fresh seed `1..9999` per call.
3. With `ANTHROPIC_API_KEY`: one Messages API call (no retry) as convex/photoImport.ts does (`x-api-key`,
   `anthropic-version: 2023-06-01`, `ANTHROPIC_MODEL` or photoImport's `DEFAULT_MODEL`, `max_tokens` 16000,
   2-minute timeout) with the board's `scenePrompt` word for word; "Another version" adds the board's line
   `(Variation #<seed>: make a different layout from before.)`. The reply's text is parsed from its first `{` to its
   last `}`; the key never leaves the server.
4. `toLayout`: the reply with `w`/`h` forced to the chosen size, through C1's `clean()` and `mapSpecSchema`; fewer
   than 3 areas plus objects is unusable (the board's rule). On any failure (network, timeout, HTTP status, cut-off
   reply, no JSON, unusable layout) or without the key, C2's `generateFallbackLayout(desc, { seed, w, h })` goes
   through the same `toLayout`.
5. `save` (one `runMutation`): drops the result (returns false) when the map is gone or its `updatedAt` changed since
   step 1. Otherwise it deletes the map's image file (an uploaded map that is regenerated), objects, painted cells of
   every layer (terrain, sight blockers, fog marks) and explored areas; inserts the new objects (≤ 300); patches
   `source: "generated"`, `w`, `h`, `base`, `plankV`, `areas` (≤ 60), `prompt`, `seed`, `updatedAt`; a blank map still
   named "Map N" takes the layout's title (the board's rule); tokens stay and move onto the new edge when the map got
   smaller.
6. **Stop**: the client stops waiting and calls `stop`, which bumps the map's `updatedAt`, so step 5 drops the late
   result (the board: "Stop ... ignores the late result"). The same fence drops a generation overtaken by another one.

## Client (`src/components/combat-map/generate/`)
`ScenePanel` (slot export, props unchanged): the board's Scene card.
- "Describe the battlefield" textarea (board placeholder; per-map draft, showing the map's saved `prompt` from
  `combatMaps.get` otherwise), Size Small / Medium / Large (`aria-pressed`; default the map's preset size, else Medium).
- Buttons: no map or a blank map → "✦ Generate map" (no map: C3's `create` makes one first and the page shows it, as
  the board's `newMap()` does); a generated map → "✦ Regenerate map", "↻ Another version" and "＋ Generate new map";
  an uploaded image → "＋ Generate new map" only.
- While running: `role="status"` spinner "Drawing the battlefield…" with Stop. Message line (`role="status"`), board
  copy: "Drawn by Claude from your description." / "Claude couldn’t draw this one (<reason>), so it was drawn from
  keywords instead." / "Drawn from keywords in your description. (Claude isn’t set up on this server; with an API key
  it draws the scene itself.)" / "Describe the scene first: where the fight happens and what is there."
- "🖼 Use my own map image": C3's `MapImageButton` (fills a blank map on screen, otherwise makes a new map).
- `generate.css`: the card's rows, the message box (board colours), 44 px buttons under 600 px.

## Acceptance evidence
- `tests/convex/combat-map-generate.test.ts`: 16 tests. Access for anonymous / outsider / player / GM on `generate` and
  `stop` (no fetch before the access check passes); Claude's layout saved with the board's prompt, the default model,
  the API key header, unknown kinds dropped, sight and variant kept, the title as the name; `ANTHROPIC_MODEL` and the
  variation line; no key → keywords, fetch never called, Large = 40×27; fallback after HTTP 529, a non-JSON reply, a
  cut-off reply, a near-empty layout and a network error, each with its reason; regenerating keeps a token (moved
  from 28,18 to 20,13 on a Small map) and clears explored rows, terrain / block / fog cells and the old objects; an
  uploaded image's file and blob are deleted; a result after Stop is dropped and the map stays blank; empty / too long
  description INVALID, foreign or bad map id COMBAT_MAP_NOT_FOUND; 10 per hour then RATE_LIMITED; `toLayout` sizing and
  refusals. fetch is stubbed in every test.
- `pnpm vitest run --maxWorkers=4`: 134 files, 1519 tests pass. `pnpm lint` (zero warnings) and `pnpm typecheck` clean.
- `tests/e2e/combat-map-generate.spec.ts`: 2 tests pass (keyword fallback, no API key on the e2e backend): an empty
  description shows the hint and makes no map; Small → 22 × 15 "Generated"; Another version at Large → 40 × 27 with the
  keywords message; reload keeps the layout, the description and the Large size; Generate new map makes a second map;
  a blank map is filled by Generate (still one map). `tests/e2e/combat-map-shell.spec.ts` (C0) still passes.

## Visual comparison
App (E2E_VISUAL=1, `tests/e2e/visual/C4.spec.ts`): `test-results/visual/C4/{gm-empty,scene-empty,gm-edit,scene-generated}-{1440,1024,390}.png`.
Board: `test-results/visual/board/combat-{gm-empty,gm-edit}-{1440,1024,390}.png` (`node scripts/board-shots.mjs combat:gm-empty combat:gm-edit`).

| Region | Verdict |
|---|---|
| Scene card, no map (gm-empty) | Matches: heading, label, placeholder, Size row with Medium pressed, the gold "✦ Generate map" pill, "🖼 Use my own map image". |
| Scene card after a generation (gm-edit) | Matches the board's order and look (Regenerate pill, Another version, message box, image button). Adds "＋ Generate new map" next to Another version (the plan's "Generate new map"). The message's parenthetical differs (no claude.ai here). |
| Spinner + Stop | Not shot (the keyword layout returns too fast to catch); markup and classes are the board's (`cm-spin`, status line, small Stop button). |
| 390 px | Single column, no horizontal scroll, buttons wrap; action buttons 44 px high. |

## Deliberate deviations
- Size is what the Size buttons show: the board's silent keyword size override ("small", "huge" in the description)
  is not ported, so the pressed button is always the size you get.
- The no-key message names this server instead of claude.ai.
- An uploaded image is never replaced from the Scene card (the board's Regenerate would replace it); "＋ Generate new
  map" makes a new map instead. Regenerating an image map is still possible through the API (its file is deleted).
- "Use my own map image" fills a blank map or makes a new one; it never replaces a generated map (the maps list's
  per-row "Image" button does that).
- The structured JSON-schema output mode is not used (the board's prompt asks for one JSON object; the reply is parsed
  from its first `{` to its last `}`), because the layout's shapes have shape-dependent optional fields.

## Needed outside this tracer's files
- **Page (C0, `src/app/(gm)/campaigns/[campaignId]/combat-map/page.tsx`)**: once the first map exists the page leaves
  Edit (its `mode` state is "play"; with no map it only forces Edit), so the Scene card unmounts right after the first
  generation starts and its message line is lost (the layout is still saved). The board switches to Edit on a new map.
  Proposed fix:
  ```diff
  -            <ScenePanel campaignId={campaignId} map={map} onMapCreated={(id) => onSelectMap(id)} />
  +            <ScenePanel
  +              campaignId={campaignId}
  +              map={map}
  +              onMapCreated={(id) => {
  +                onSelectMap(id);
  +                onMode("edit");
  +              }}
  +            />
  ```
  The e2e specs click "✎ Edit map" after the first generation until then; that click stays harmless after the fix.
