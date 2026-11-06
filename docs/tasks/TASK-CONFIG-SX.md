# TASK-CONFIG-SX: the old entry points are shortcuts to the same settings

Plan `.omc/plans/config.yaml`, tracer SX (bead dcm-jh6d.32). User answer Q10 (b), 2026-11-04: nothing is removed; the
three old entry points stay as shortcuts to the settings Part A built. Client and e2e only.

## What changed

- **Players button** (`campaign-shell.tsx`): the art header's Players button (GM) calls `openSettings("players")`, so it
  opens the Campaign settings slide-over at `?settings=players`, the one Players UI (U3's roster, join link, email
  invites). The Combat Map app bar's `onPlayers` gets the same callback.
- **`players-dialog.tsx` deleted**: nothing imports it any more (U3 moved its parts into
  `src/components/config/sections/players/`). The section shows "Make a link" when a campaign has no join code; the old
  dialog created the code from an effect, which rule 13 forbids.
- **Campaign Rules panel** (`frame-rules-panel.tsx`): still writes `campaigns.setOption`, now with the same optimistic
  update on `campaigns.get` as Settings › House rules, so both show the same value at once. A glass "All house rules"
  button opens the settings at `?settings=rules`.
- **Combat Map cards switch**: unchanged; it writes `setPlayersSeeHands`, the same field as Settings › At the table
  (`tests/e2e/config-table.spec.ts`).
- **Hero Start Session** (`campaign-shell.tsx`): after `sessions.start` resolves, the click handler goes where "A new
  session opens on" says, through JO1's `sessionOpensOnHref` (Combat Map: `/campaigns/<id>/combat-map`; Journal: the
  session's Log & recap as before). An already-running session (no `sessionId`) opens the Journal as before. Navigation
  happens in the handler, never from an effect (rule 13).

## Tests

- `tests/e2e/players.spec.ts`: the Players button opens the settings at Players. Join code, email invites and the live
  roster are read from the section.
- `tests/e2e/live-config.spec.ts`: GM on the dashboard, player on the Combat Map, in two browsers. The GM opens the
  settings with the Players button, turns off Fear and hand sharing, and the player's map shows "?" and the
  private-cards line with no reload; both come back when the GM turns them on. The dashboard's Campaign Rules checkbox
  and House rules switch show the same field. "Opens on Combat Map" makes the hero's Start Session go to the map.
- `tests/e2e/a11y-config.spec.ts`: axe on each settings section (GM) and on Preferences (GM and player), at 1440x900
  and 820x1180.
- `tests/e2e/config/helpers.ts` gains `openPlayers`, `closeCampaignSettings` and `gmJoinCode`. The 35 specs that read
  the old dialog's `join-code` now call `gmJoinCode(page)`, which returns the same `ABCD-EFGH` code.
