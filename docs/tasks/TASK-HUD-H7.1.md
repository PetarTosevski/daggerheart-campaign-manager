# TASK-HUD-H7.1: tablet layouts (player and GM at 1024)

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 8, tracer H7.1 (boards PlayerTablet, GMTablet; HANDOFF "Layout ·
Tablet"). Briefs: "Common rules", "Wave 8", "User answers 2026-11-01". Parent bead dcm-bxp.99.32 (no own bead). Mode:
add; CSS only, everything under `.hud-root` (switch on).

## What landed

| File | What |
|---|---|
| `src/components/combat-map/hud/responsive/tablet.css` (new) | The tablet's positions, `@media (min-width: 761px) and (max-width: 1180px)`, every rule from `.hud-root` so it wins over the parts' own CSS by specificity (it loads first, from shell.css). |
| `src/components/combat-map/hud/shell.css` | `@import "./responsive/tablet.css"`; header comment; the toasts host fix (dcm-bxp.99.32.29, below). The existing ≤ 1180 / ≤ 760 blocks stay as they were, so the phone (H7.2) starts from the same base. |
| `tests/e2e/hud-tablet.spec.ts` (new) | Player and GM at 1024 × 768 + the desktop toast check (below). |
| `tests/e2e/visual/HUD-H7.1.spec.ts` (new) | Every PlayerTablet / GMTablet Preview state and the sheet open (`E2E_VISUAL=1`). |

### Tablet layout (the boards' `.tab` rules → the app)

- **Banners** (`.tab .bn`): 108 px wide every 114 px from x = 12; 186 px tall, yours 206; 42 px portrait, 13.5 px name,
  10 px class, 8 × 6 pips, 36 px seal at −12. The rod follows (`--hbn-step` / `--hbn-w`).
- **Title and toolbar** (`.tab .title`, `.tr`, `.gtools`): the scene region at x = 484, y = 14 (it was centred over the
  banners); the toolbar wraps from x = 484 to the day / time disc. Its buttons are 44 px tall (board: 32), End scene too.
- **Map**: full bleed, Fit-zoomed (see QUESTIONS 1). The map's own toolbar (Names, − / % / +, Fit; the boards have none)
  leaves the centre-top: a column bottom-left for players (where the hidden feed was), a row right of the GM's column
  for the GM; the map's name and LIVE hide (the title shows them); 44 px buttons.
- **Feed hidden** (`.tab .me`), and the GM's **Resolutions** too (`.tab .gr`; QUESTIONS 2).
- **GM column** (`.tab .gq`): 280 px from x = 12, from under the seals (y = 236) to the bottom; the queue shrinks to what
  the spotlight panel leaves and scrolls. Hidden while the GM picks targets (`.tab.st-adversary .gq`).
- **Hand** (`.tab .bot`): from x = 300 to right 264 (clear of the app's floating Lorekeeper button, dcm-bxp.99.32.31);
  from 150 while a sheet is open (the GM's from 300, right of its column).
- **Sheet open**: hud.css's tokens already gave 340 px, −60 px / .92 and edge 16 (H2.2); the Fear banner moves to right
  356 and the title row hides (H2.2). New: the GM's map toolbar hides with the title row (a PC's sheet brings that PC's
  hand up over its place).
- **Pop-ups**: result right 16 / bottom 228 / 392 wide (`.tab .res`); toasts right 24 / bottom 220, right 356 with a
  sheet (`.tab .blk`); "The GM has the spotlight" at x = 484, y = 172 (`.tab .gms` 116, moved under the toolbar's second
  row); "Reactions only…" x = 330 / bottom 196, 150 with a sheet (`.tab .gmh`, via `--hud-pop-note-left`); the death
  move 470 px (`.tab .dm`).
- **Areas** (dcm-bxp.99.32.28): under the Fear banner (top 232, right 16, 360 wide: at the board's 320 the form's rows spill out), not bottom right.
- **Touch targets ≥ 44 px** at tablet width: `.hud-btn` / `.hud-opt` / `.hud-tog` (ui.css only did this ≤ 1100),
  steppers, panel ✕, Fear − / +, Areas ✕ and Circle / Wall, the stat block's steppers / Use / Spotlight / Attack / roll
  segment, the picking panel's rows / ✕ / primary, the toast's Dismiss.

### The three layout follow-ups

- **dcm-bxp.99.32.29 (toasts) — fixed in shell.css.** The host sat in the hand region's flow above a box as tall as a
  raised card (`--hud-hand-room` 640 px), so toasts landed near the top of the map. From 761 px up the host is absolute
  in the hand region: desktop left 880 / bottom 262 / 330 wide as Main's `.blk` (690 with a sheet, the existing
  `--hud-pop-blk-left`, which nothing read before); tablet right 24 / bottom 220 (356 with a sheet). Phones keep the
  old flow (H7.2). No edit in `hud/toasts`.
- **dcm-bxp.99.32.28 (Areas covers tokens) — tablet decided, desktop unchanged; keep the bead open.** At tablet the
  panel hangs under the Fear banner, because bottom right is where the Lorekeeper button covers its last rows and Pick
  on map. Desktop keeps the board's bottom right (`hud-fear-confirm.spec.ts` asserts it). Any dock covers some map; the
  real fix for "a click on a token under it does nothing" is a collapsible panel (header-only until tapped) in
  `hud/areas/index.tsx` — not in H7.1's owns, no edit made.
- **dcm-bxp.99.32.22 (attack panel over Zoom out at 1440) — not fixed.** The panel's place is `pick/panel.tsx` (anchor
  beside the target), and lifting the map toolbar above the overlay would cover the panel's rows instead. At tablet the
  toolbar no longer sits mid-map, so it does not arise there. Fix stays with the panel's owner (H7.3 owns `hud/pick`).

## Board states matched

Shots: `E2E_VISUAL=1 E2E_PORT=… E2E_CONVEX_PORT=… pnpm exec playwright test tests/e2e/visual/HUD-H7.1.spec.ts` →
`test-results/visual/HUD-H7.1/`. Board renders: `reference/designs/combat-hud/preview/{PlayerTablet,GMTablet}.dc.html` at
1024 × 768 (each Preview button; a banner for the sheet).

| Board state | Shot |
|---|---|
| PlayerTablet (default) | `player-default.png` |
| PlayerTablet, a banner (sheet open) | `player-sheet-open.png` |
| Picking a target | `player-picking.png` |
| Card result | `player-card-result.png` |
| Can't afford | `player-cant-afford.png` (toast beside the fan) |
| GM's turn | `player-gm-turn.png` |
| You're hit | `player-youre-hit.png` |
| Last Hit Point | `player-last-hit-point.png` |
| GMTablet Requests | `gm-requests.png` |
| GMTablet, a banner (GM edit sheet) | `gm-sheet-open.png` |
| Adversary acting | `gm-adversary-acting.png` |
| Spend Fear | `gm-spend-fear.png` |
| Areas | `gm-areas.png` |
| End scene | `gm-end-scene.png` |

Deviations from the boards: the toolbar's buttons are 44 px (touch rule) and wrap to two or three rows (the seed has
interim buttons: Your character / Map tools, Back to the classic view), so the GM's-turn card sits at y = 172; the
picking panel stays 292 px and the hit window 320 px (boards 262 / 290): `pick/panel.tsx` (`PANEL_W`) and `hit/spot.ts`
(`HIT_W`) place them by those widths, so a narrower box would sit off its anchor; the map's own toolbar has no board
counterpart; Areas under the Fear banner (above).

## What moved out of the old column

Nothing (CSS only).

## Tests

- `tests/e2e/hud-tablet.spec.ts` (3):
  - PlayerTablet: banner boxes (x 12, 108 wide, step 114, 206 / 186 tall), title x 484, feed hidden, map toolbar bottom
    left; touch targets (banners, toolbar, map toolbar, toast Dismiss, action ring, picking panel, sheet); no sideways
    scroll; axe (default, toast, picking, sheet); toast right 24 / bottom 220, then 356 with the sheet; sheet 340 px at
    right 0, map `matrix(0.92, 0, 0, 0.92, -60, 0)`, Fear −340, title and tools hidden, hand left 150.
  - GMTablet: column x 12 / 280 wide / below y 236, Resolutions hidden, title x 484, map toolbar x 308 / bottom 16; touch
    targets (GM tools, map toolbar, queue, Fear − / +, Areas, stat block, purple picking panel); Areas top 232 / right 16
    / 360 wide; axe (default, Areas, stat block); stat block 340 px, map shifted, title and map toolbar hidden; the
    column hides while the GM picks and comes back on Esc.
  - Main 1440 × 900: the toast at left 880 / bottom 262 / 330 wide (dcm-bxp.99.32.29); axe.
- `tests/e2e/visual/HUD-H7.1.spec.ts` (2, `E2E_VISUAL=1`).

### Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest (CSS only, no unit file): full suite `--maxWorkers=2 --testTimeout=120000`: 476 files, 10578 passed + 1
  expected fail.
- e2e, ports 3151 / 3414. While iterating against `next dev` (`E2E_REUSE_SERVERS=1`): all `tests/e2e/hud-*.spec.ts`
  at desktop (with hud-tablet): 39 / 40, the one failure a Convex 1 s timeout in hud-tablet GM (passed alone, and
  `--repeat-each=2` 6 / 6). Against the production build (Playwright's own servers): `hud-tablet` 3 / 3,
  `visual/HUD-H7.1` 2 / 2, `hud-make-room` 2 / 2, `hud-blocked` 2 / 2, `hud-fear-confirm` 2 / 2 (first run: hud-tablet
  player and hud-make-room GM hit Convex 1 s timeouts under host load 11-14, "The map failed to load"; rerun 5 / 5).
- `node scripts/tracer-guard.mjs .omc/plans/combat-hud.yaml H7.1 rebuild HEAD`: OK, owned files only.

## Beads

- Filed **dcm-bxp.99.32.31** (P2 bug): the app's floating "Ask the Lorekeeper" button covers HUD controls bottom right
  (stat block Spotlight / Attack, Areas, the hand's side buttons); H7.1 works around it at tablet.
- Filed **dcm-bxp.99.32.32** (P3 bug): the hit window's footer overflows its 320 px card when the primary reads "Mark
  Armor · take no damage" ("Take 1 HP" clipped; `player-youre-hit.png`).
- dcm-bxp.99.32.29: fixed here (orchestrator closes). dcm-bxp.99.32.28: tablet placement decided, the token-under-panel
  fix (collapsible panel) still open. dcm-bxp.99.32.22: not fixed (pick panel's owner).
- Noted, not filed: `scene/scene.css` still has two `.hud-root.sh-open` rules from before H2.2's rename to
  `hud-sh-open` (dead; shell.css does the job).

## Notes for H7.2 (phone) and the merge

- tablet.css applies only from 761 px; the parts' own ≤ 1180 blocks still cascade to phones as before. The GM at phone
  width (answer 13a, "tablet layout") gets none of tablet.css: H7.2 decides whether to widen its range or copy.
- The toasts host is absolute only from 761 px; on phones it stays in the hand's flow (H7.2 places it).
- No Convex change, no codegen, no schema, no authz entry.

## QUESTIONS (safest reversible defaults taken)

1. **39 px per square.** HANDOFF: "the map is 39 px per square" at tablet (48 at desktop). The app's square size is the
   Fit zoom (`useMapZoom`: the map, or the player's explored area, fitted to the viewport), not a fixed size: the seed's
   30 × 20 map fits at 71 % (34 px) for the GM and 59 % for the player. Built: unchanged (Fit), the zoom buttons stay.
   Alternative: a fixed tablet zoom of 39 / 48 (map-view, not H7.1's owns).
2. **Resolutions on the GM tablet.** GMTablet hides `.gr` (Resolutions with Undo). Built: hidden as the board, so Undo of
   a resolution is not on the HUD at tablet width. Alternative: keep it under the queue (drop one selector in
   tablet.css).
3. **The map's own toolbar.** No board has it. Built: a column bottom-left (players), a row beside the GM's column (GM),
   hidden for the GM while a sheet is open. Alternative: move zoom into the HUD toolbar (H1.2's).
