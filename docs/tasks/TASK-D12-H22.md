# TASK-D12-H22: Accessibility and tablet pass - combat map, sprite packs, sessions and notes

Plan `.omc/plans/d12-hardening.yaml`, tracer H22 (wave 3, depends on H1 and H4). Bar from the user's answers of
2026-10-21 (Q6, Q7): zero serious or critical axe findings (WCAG 2.0/2.1/2.2 A and AA tags) on every page and
dialog, as the GM and as the player where the player can open it; at 768x1024 and 1024x768 no sideways scroll, the
campaign menu and the page's main action visible, primary controls at least 44 px. Moderate and minor findings are
listed, not fixed.

## Spec: tests/e2e/a11y-play.spec.ts (7 tests)

One `gmAndPlayer` table (characterA "Liriel" belongs to the player). Seeded through the GM's client: 'Old road'
(30x20, live) and 'Cellar'; the party token, a Bandit, a wall with a door, a wall torch; the clock advanced to night
(Moonrise), so the vision panel shows lights, doors and the carried-light picker. Each test scans every state and
fails once at the end with the full list (the H21 `scanner()` pattern).

| Test | Scanned (role) |
|---|---|
| combat map, GM | Play in Classic with Vision & fog and the Doors card; a token selected (token card, Light and reveal); the fog brush on; the "Player view" menu open; previewing Liriel's view (fog canvas); Play in Sprites; Edit in Sprites and in Classic (Scene, Edit by hand); the Terrain and Objects tools (GM) |
| combat map, player | the board with the door switch and the wall torch, Your view with "Light you carry"; torch on and own token selected (player) |
| sprite packs | empty; one pack (GM); the player is sent back to the Combat Map |
| sessions | the hub with no session (GM and player); Prep with two scenes, hooks and the session encounter; Play live with the spotlight, log and the hub's Encounter card (GM); the player's view while a session is live; the End dialog; Wrap with a recap; the milestone confirm (GM); the player's read-only played session |
| notes | the whole page (shell included) as the GM; the page view, the sharing dialog and the "Shared by GM" tab as the player |
| tablet 768x1024, 1024x768 | combat map GM Play and Edit, combat map player, packs, sessions GM (list and Play) and player, notes GM and player: `expectFitsViewport`, "Campaign sections" nav visible, main controls in view by vertical scrolling only, 44 px targets, full-page screenshot |

Notes reuse: N9's `notes-a11y.spec.ts` already scans every Notes view as the GM inside `.bj-root` and drives it by
keyboard, so this spec adds only the whole page as the GM, the player rows and the tablet rows (analysis section 5).

No `exclude`: the map, fog and thumbnail canvases are scanned with the rest and raise nothing (the board is
labelled and every token, door and light is a DOM button), so no canvas needed excluding.

44 px controls per route: combat map GM the Map mode switch, every button in Campaign maps, Combatants and Vision &
fog, the Map style switch, the GM Fear steppers, Player view, Zoom in / Zoom out / Fit, the Edit tool buttons; player
every button in Your view plus the zoom controls; sessions "+ New session", the stage tabs and the session list
items (GM and player); notes the Sharing chip and "Tear out page" (GM and player).

Screenshots: `test-results/visual/D12-H22/<route>-<w>x<h>.png` (18 files: combat-gm-play, combat-gm-edit,
combat-player, packs, sessions-gm, sessions-gm-play, sessions-player, notes-gm, notes-player; no pixel diffs).

## Findings fixed

| Finding | Where | Fix |
|---|---|---|
| color-contrast [serious]: "Start session" (`.ss-live-btn.ss-live-start`, white on `--ss-live` #4f9e72 = 3.2:1), on Prep, Wrap and the start confirm | `sessions.css`, `sessions/live/live.css` | new token `--ss-live-btn` #40815d (4.65:1, the same green as H21's `--enc-start`); the live dot and borders keep `--ss-live` |
| 44 px: the combat map's `.cm-btn` / `.cm-sm` (30-36 px), the Play / Edit switch (38 px), the brush size and Off buttons (28-40 px wide) | `combat-map.css` | the phone block's touch rules moved to `@media (max-width: 1100px), (pointer: coarse)`, plus `min-width: 44px` on `.cm-btn` there |
| 44 px on tablets for the rest of the combat map | `vision.css` (`.cm-vis-light`), `maps.css` (`.cm-maprow-name`), `packs.css` (inputs, checks), `editor.css` (`.cm-linkbtn`), `map-view.css` (grid inputs), `tokens.css` (HP/Stress pips, custom-token inputs) | the same move from the 760 px block to the tablet query |
| 44 px on tablets in Sessions | `sessions.css` (`.ss-ghost`, stage tabs, `.ss-x`, `.ss-step`), `play.css` (`.ss-log-x`), `wrap.css` (`.sw-link`) | moved from the 720/899 px blocks to the tablet query |
| 44 px on tablets in Notes | `notes.css` (threads, ghost buttons, chips, Shared tabs, ＋), `index-column.css` (page buttons; the board's 28 px ＋ now only at `(min-width: 1101px) and (pointer: fine)`), `bin.css` (Restore) | moved to the tablet query |

Desktop keeps the boards' sizes everywhere (the queries start at 1100 px or a coarse pointer). One exception kept on
purpose: the Notes row bullet and row icons (`.bj-bul`, `.bj-ib`) grow to 44 px only at `(max-width: 720px),
(pointer: coarse)`, together with the row wrap in `entries.css`. At 44 px on a mouse tablet they squeezed the entry
text into a column three words wide (seen in the first 768 px screenshot). They are row tools, not the page's
primary controls.

Nothing needed changing for sideways scroll: every route fits both sizes.

## Findings listed, not fixed

- Moderate and minor axe findings: none on any scanned page, dialog or state (no annotations in the JSON report).
- Nothing for H20 in `src/components/brand/**` or `ui/**`.
- At 768x1024 the GM's tool column is 300 px and the board gets the rest (about 420 px), so a 30x20 map fits at
  about 28 %; zoom and drag still work and the controls are 44 px. The board is also much taller than a wide map
  needs, which leaves empty space above and below the map (screenshot `combat-gm-play-768x1024.png`). That is a
  layout choice for a design pass, not a defect.
- At 768 px the campaign nav wraps to two rows (as H20 and H21 saw), which pushes each page down; the main controls
  stay reachable by vertical scrolling.

## Verification

Backend (`scripts/convex-e2e.mjs`, E2E_CONVEX_PORT 3394) and `scripts/e2e-next.mjs` (E2E_PORT 3141, `.next-e2e-3141`)
started by hand, Playwright with `E2E_REUSE_SERVERS=1`:

- `tests/e2e/a11y-play.spec.ts`: 7 passed (56 s), then 7 passed again after the last CSS change (31 s).
- Related specs (combat-*, sprite-*, session*, notes-*, live-combat, live-sessions, live-notes): 90 passed, 2 failed
  (15.1 min), neither from this change:
  - `sessions-hub.spec.ts` "the nav reads Dashboard · … · Notes" fails on `rebuild` as well: the nav now ends with
    Lorekeeper (D13), which the spec's list predates. The spec is outside H22's owns; follow-up for its owner.
  - `sprite-packs-shell.spec.ts` "the GM opens Sprite packs…": `toHaveTitle` saw the root title once under load; the
    spec passed 3 of 3 on a rerun.
- `pnpm lint`, `pnpm typecheck` clean; `pnpm test --maxWorkers=4 --testTimeout=60000`: 222 files, 5425 passed,
  1 expected fail, 1 skipped.
- `pnpm tracer:guard .omc/plans/d12-hardening.yaml H22` passes.
