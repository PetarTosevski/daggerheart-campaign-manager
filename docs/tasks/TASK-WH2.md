# TASK-WH2: A hex marker no longer swallows the hex click

Status: Review. Plan: `.omc/plans/world-hex.yaml`, tracer WH2. Bead: dcm-kggd.

## Bug (user, 2026-11-06)

On Journey to Horizon the GM clicked a hex holding a marker (a Dungeon): the click hit the marker, which opened only
its editor, and the hex panel with "Travel here" never appeared. Since WH1 a marker covers its whole hex, so the hex
under it could not be clicked at all.

## Interaction

`pickMarker(id, onGrid)` in `src/lib/world/hex-tokens.ts` routes a click, tap or Enter on a marker (a drag still
moves it):

| Map | Marker | Party |
| --- | --- | --- |
| hex grid (Horizon) | selects the hex under it **and** the marker: the Hex Crawl panel (Travel here, the hex's data) and the marker's editor show together | selects the party's hex |
| no grid | selects the marker (as before) | nothing (as before) |

Keyboard: each marker and the party are focusable buttons; Enter does the same as a click, and the hex panel's
controls (Move the party here, Place the party here) follow in the side panel. Players' view is unchanged: players have
no hex selection or marker editor (`editable` only).
