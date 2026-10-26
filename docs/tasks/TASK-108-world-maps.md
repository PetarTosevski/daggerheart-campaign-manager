# TASK-108 — D6: World maps

- **Status:** Implemented, pending review and e2e run (2026-10-17)
- **Phase:** D6 of `docs/design-port-roadmap.md`
- **bd:** `dcm-bxp.6`
- **Board:** `World` (`reference/designs/project/World.dc.html`); dashboard Locations panel from `CampaignHub`
- **Decisions:** `docs/decisions-d3-d11.md` (travel speeds are the user's house rule, GM-editable; Horizon's hex crawl wins where it conflicts; custom campaigns upload a map + width in km; players see non-hidden tokens only), `.omc/autopilot/frame-trackers-spec.md` §10 (Horizon map model, Q13: use the board's Horizon map with in-app calibration)

## Delivered

- **Pure rules**
  - `src/lib/domain/travel`: the board's speeds (`MSPD` for Measure, `PMAP` for the trail and token distances, flat 20/40/60/80 km/day paces, Cautious ×0.75 / Forced march ×1.33) and its formulas (`route` → `trailLeg`, `analyse` → `analyseRoute`, `fmtR`, `mFmtT`, `mFmtD`, scale bar), with GM overrides (`TravelRules`).
  - `src/lib/world/terrain.ts`: the 128 × 98 grid, the board's Witherwild suggested terrain (64 × 49, doubled), brushes, round-brush painting, run-merged SVG paths.
  - `src/lib/world/hex.ts`: axial hex math (flat/pointy), pixel ↔ hex, neighbours, distance, grid covering, player-visible hex set.
  - `src/lib/world/map-state.ts`: extended with `options.trail`, `options.rules`, `hexCrawl`, size bounds, `playerMapView` (hidden tokens removed, notes blanked, crawl filtered).
  - `src/lib/world/token-types.ts`: the board's 12 token types (colours, icons), custom markers and renamed labels.
- **Convex** (`convex/maps.ts`, `convex/lib/maps.ts`, table `mapUploads`): `get` (role-filtered), `locations` (dashboard), GM-only mutations: `addToken`, `moveParty`, `addCustomType`, `moveToHex` (keyed, `withIdempotency`, campaign scope); set-style `updateToken`, `removeToken`, `clearTrail`, `setTerrain` (or reset to suggested), `setOptions`, `setTravelRules`, `renameType`, `setHexGrid`, `updateHex`, `placePartyHex`, `setCrawlDay`; map image `mapImageUploadUrl` / `attachMapImage` / `removeMapImage`.
- **UI** (`/campaigns/<id>/world`): palette (drag or pick-then-click, rename ✎, custom markers), map with pan (drag, right-drag), wheel zoom anchored on the cursor, two-finger pinch, zoom buttons, Fit, keyboard (arrows pan the focused map; F, P, M, T, H, V, + / −, 0; while painting 1–7, [ ], Ctrl+Z), tokens as keyboard-reachable buttons (arrow keys nudge), token editor (name, notes, type, hidden, location, from-the-party, distances, send party, delete), party banner with a 12-position trail, terrain overlay and painting with undo, Measure (straight line, waypoints, freehand; method, pace, hours/day, km/mi; terrain breakdown; move party along route), Speeds dialog (house rule), Player view preview, full screen, scale bar. Responsive at 390 px (map first, then editor, then palette). Reduced motion stops the party pulse.
- **Custom campaigns / map replacement:** GM uploads an image (≤ 8 MB, checked server-side) with its width in km; the file is recorded for the campaign (can't be claimed twice or borrowed), the previous upload is deleted, the URL is resolved server-side only for the campaign's own file. Published frames can optionally replace their map and go back to the frame's art.
- **Journey to Horizon:** hex overlay over the board's Horizon map with GM calibration (origin px, size px, orientation; set origin by clicking), Hex Crawl panel (day counter, party hex, last move — GM only), per-hex terrain rating / habitat / region / point of interest (hidden or not) / explored, place the party (no travel) and move to an adjacent hex (days from `travelDays`, encounter roll from `encounterRoll` with d4/d6/d8, day advances, hex explored, party marker moves to the hex centre). Players see explored hexes, the party hex and its neighbours (server-filtered), non-hidden POIs there, and the day. Painted terrain, pace and Measure are hidden; tokens snap to hex centres.
- **Dashboard:** Locations panel lists `location` markers (players never get hidden ones), each opening the map focused on the marker (`?focus=<id>`).

## Notes

- Player privacy: token `notes` are GM notes (the board shows them only in the GM column), so players receive them blank.
- The board's "Move party along route" kept up to 24 trail points; the trail is capped at 12 (user decision), and the route's via points are thinned to at most 11.
- The board's `fmtR` (trail and token distances) always shows km and an 8-hour day; kept as ported. Measure honours units and hours/day.
- A rejected upload is deleted and the reason returned (`{ ok: false }`) rather than thrown, so the deletion isn't rolled back.

## Deferred (beads)

- `dcm-bxp.17` Horizon: region generation tables, region encounters, sanctuaries (always visible) and Echo locations, Locate Soul Echoes, Collect Echo link, rest limits, Endurance.
- `dcm-bxp.18` Age of Umbra pyres linked to World map tokens (optional).

## Checks (2026-10-17)

| Command | Result |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `npx tsc -p convex` | Pass |
| `pnpm vitest run tests/unit tests/convex` | 56 files, 467 tests passed (new: `world-travel`, `world-terrain`, `world-hex`, `convex/maps`) |
| `node scripts/convex-e2e.mjs dev --once --typecheck=enable` | Pushed (mapUploads indexes added) |
| `tests/e2e/world.spec.ts` | Written, not run here (shared port 3000) |
