# TASK-WH1: World map hex overlay matches the printed grid

Status: Review. Plan: `.omc/plans/world-hex.yaml`, tracer WH1. Bead: dcm-kggd.

## Bug (user, 2026-11-04)

On the World Map (Journey to Horizon hex crawl) the overlay hexes (the party's hex, the move target, the dashed
neighbour ring) were larger than the hexes printed on the map and sat off its grid
(`reference/bugs-world-hex-mismatch.png`). Scope addition (user, 2026-11-05): every marker on a hex-grid map, the
party included, is a hex of that grid sitting exactly on its printed hex at every zoom.

## Root cause

The overlay was drawn correctly in image pixels (an SVG with the art's own `viewBox`, so render scaling, pan and zoom
were never the problem), but every crawl started on a placeholder calibration, `{ originX: 0, originY: 0, size: 33,
flat }` ("to be adjusted by the GM"), while the art's printed hexes have a 24.6 px radius with hex (0, 0) centred at
(1.98, 6.05). The overlay was 34 % too large and drifted off the printed lines.

## Built-in maps

`src/lib/world/printed-grids.ts` (`PRINTED_HEX_GRIDS`, image pixels of the published art):

| Map | Grid |
| --- | --- |
| Journey to Horizon (3400 × 2228) | flat tops, `size` 24.612, `sizeY` 24.592, origin (1.98, 6.05) |
| the other nine | no printed grid (pictorial maps): no hex overlay, round markers as before |

Measured by fitting a hex lattice to the printed line darkness over the whole image (`sizeY`: the art is a hair
taller than regular hexes, ~1.8 px over the map's height), checked by eye at the four corners and the centre and by
six hexes measured one at a time from their own lines (`tests/unit/world/printed-grids.test.ts`, within 1.5 px).

## What changed

- `HexGrid.sizeY` (optional, widened in `hexCrawlSchema` and `hexGridValidator`): vertical radius; unset is `size`.
  `hexToPixel`, `pixelToHex`, `hexCorners`, `hexesCovering` use it; new `hexBox`, `scaleGrid`, `remapHex`, `sameGrid`.
- New crawls start on the printed grid (`initialHexCrawl`).
- Calibration is for uploaded maps only: `maps.calibrateHexGrid({ change })`, one intent per call (`originX`,
  `originY`, `size` (drops `sizeY`), `orientation`, or `printed` to go back to the printed grid). Over the frame's own
  art a field change answers INVALID. `removeMapImage` puts the printed grid back. `maps.setHexGrid` (whole grid) is
  kept for the existing tests and authz entry; the UI no longer calls it.
- Hex Crawl panel: "The grid" (show the whole grid; a "Use the map's printed grid" button when the stored grid differs);
  the calibration fields and "Set origin by clicking the map" only with an uploaded map.
- Hex markers (`src/lib/world/hex-tokens.ts`, `map-view.tsx`): on a map with a grid every marker and the party is a
  hex of the grid (same orientation, box in % of the map, so exact at every zoom), its colour clipped to the hex with
  the icon inside, a hex border (dashed when hidden), a gold hex outline when selected and a hex focus ring. Only the
  hex takes the pointer; on touch (`pointer: coarse`) an invisible 44 × 44 px target. Several markers in one hex
  share it as a flower of seven third-size hexes (the party in the centre); past seven, the rest stack on the centre
  under a "+n" count. Labels sit under the hex.

## Stored coordinates (migration)

The old default grid did not map 1:1 to printed hexes, so stored hex coordinates are remapped:
`convex/migrations/worldHex.ts` `printedGrid` (batched, one map per batch, idempotent). For a Horizon map over the
frame's own art whose grid is not the printed one: each hex row, the party hex and the last move become the printed
hex holding their old centre (old hexes are larger, so no two collide; on a collision they merge); markers and the
party marker move to that printed hex's centre; the grid becomes the printed one. Uploaded maps keep the GM's grid.
Not run here:

    npx convex run migrations/run:run '{fn: "migrations/worldHex:printedGrid", dryRun: true}'
    npx convex run migrations/run:run '{fn: "migrations/worldHex:printedGrid"}'

## Tests

- `tests/unit/world/printed-grids.test.ts`, `hex-tokens.test.ts`, `recalibrate.test.ts`.
- `tests/convex/world-hex.test.ts` (calibration intents, upload removal, migration incl. dry run and idempotence);
  `tests/convex/authz/maps.entries.ts` + `maps.test.ts` (matrix for `calibrateHexGrid`).
- `tests/e2e/world-hex.spec.ts`: marker boxes equal the printed hex boxes on screen at three zooms; screenshots of
  Horizon (close, closer, whole grid, focus ring, fitted) and of the nine maps without a grid.
