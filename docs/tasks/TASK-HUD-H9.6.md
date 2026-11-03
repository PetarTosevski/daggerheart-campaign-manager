# TASK-HUD-H9.6: design v2 at tablet and phone width, board shots, full e2e and build

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 10, tracer H9.6, batch C (boards GMTablet, PlayerTablet,
PlayerPhone). Briefs: `.omc/plans/combat-hud-briefs.md` "Wave 10"; delta `.omc/plans/combat-hud-v2-delta.md` (user
answers 2026-11-04 bind). Beads: dcm-h77e.8 (this tracer's notes), dcm-h77e.9 (leftover glass-button call sites). Mode:
replace. No server change, no codegen.

## What landed

### Tablet (761-1180 px; `responsive/tablet.css`)

- Dead rules gone: the map's own toolbar (`.cm-toolbar`, no longer drawn in the HUD since H9.0), the GM's 280 px
  queue column and its Resolutions rule (`.hud-r-left`, `.hud-q-col`; H9.2 moved the queue behind "Waiting on you"),
  the "column steps aside while picking" rule, End scene's 44 px fix in the title row (H9.3 moved End scene to the
  dock), Areas "under the Fear banner" (areas.css places it bottom right above the dock).
- The header now lists what each wave 10 part places itself (dock, Waiting on you, Log, Areas, spotlight disc, app
  bar) and what is left here.
- A player's title row stops left of the spotlight disc and its label (`max-width: 100vw - 484 - 256`).
- **The GM's dock beside a sheet or stat block** (GMTablet `.tab.sh-open .dock`, centred at x = 342): with Map tools
  and 44 px buttons it is wider than the 684 px the 340 px panel leaves, so it ran under "Waiting on you" and under
  the panel. It now wraps to two rows between "Waiting on you" (x = 12-112) and the panel.
- **Touch targets at tablet and phone width** (the block applies `max-width: 1180px`, so a GM on a phone gets them
  too): the day disc pop-over's **Day / Dim / Night** (30 → 44 px) and its ✕ (`.hud-pop-x`, 32 → 44 px) join the
  existing list.
- **Desktop 1181-1599 px**: Dice, Sheet and "Your character" ran from x = 690 into the spotlight disc's label (right
  300) at 1440 (the button ended 9 px from "SPOTLIGHT"). "Your character" shows its icon there as at tablet width (its
  text stays its accessible name) and the row stops left of the disc. At 1024 the icon-only button ends 12 px left of
  the label (checked by `hud-tablet.spec.ts`).

### Phone (≤ 760 px; `responsive/phone.css`, `phone/**`)

- **Player** (PlayerPhone): "Your character" and the map controls (Measure, Names, zoom) moved from under the strip on
  the right (where they covered the 44 px spotlight disc and its "Spotlight · Moss" pill) to the left, one per row,
  stopping 140 px short of the right edge. Dead `.cm-toolbar` rules gone; the tools' forced 32 px height, the Sheet
  button's 34 px, the tabs' 40 px and the 24 px handle are now 44 px.
- **Edge chips** (`phone/edges.tsx`): PlayerPhone moved the chip from top 150 to 226 to clear the disc. The chips sit
  at their target's height, so instead of a fixed top each edge has a ceiling: the right edge starts under the
  spotlight disc and its pill, the left edge under the tools (measured from the DOM in the same frame loop).
- `useSpotlightInColumn` deleted (`phone/media.ts`, `phone/index.tsx`): nothing used it after H9.1.
- **Sheet toggle** (`phone/sheet.tsx`) → `hudButtonClass("tool")`.
- **The GM at 390** (answer 13a; no board draws it). Decision for the empty scene region: the GM boards (GMDesktop,
  GMTablet) show the scene pill (name + Live chip) and the phone has no app bar, so the region shows the same pill,
  smaller (17 px), under the scaled banners (top 150) and left of the Fear banner. Layout:
  - top: banners at 55 % on the left, the Fear banner at its tablet size on the right with − / + at 44 px, the
    spotlight disc and the day disc side by side under the Fear banner (the disc's beam hidden); before, the spotlight
    disc (right 208) hung over the banners;
  - the spotlight popover and the day disc's pop-over are the phone's width (the popover was off screen at right 120);
  - bottom: the folded queue sheet, the dock above it on two rows of icons (it overflowed the 390 px sideways and sat
    under the sheet's heading); the open sheet covers the dock; Log and Areas open full width above the dock.
  - Dead `.hud-scene-gm .hud-tr`, `.cm-toolbar` and `.hud-spot-gm` rules gone.

### Glass buttons (dcm-h77e.9)

- `hud/tools/index.tsx`: the Map tools / Your character drawer button → `hudButtonClass("tool")`; `tools/tools.css`
  drops `.hud-glass-btn`'s glass background (the role draws it; the rule keeps `pointer-events`).
- `hud/phone/sheet.tsx`: Sheet → `"tool"`.
- `responsive/phone.css`, `areas/areas.css`: the forced 32 px heights go (`.hud-areas .hud-btn`), so the buttons take
  the design's 44 px.
- `hud/areas/index.tsx`: Remove (it deletes the area) → `"danger"`.
- `hud/dock/dock.css`: End scene's flag was a `::before`, which the arcane glass button uses for its hover fill
  (absolute, `scaleY(0)`), so the flag never showed, and at ≤ 900 px (label hidden) End scene was an empty red outline.
  The flag is now `::after` with `order: -1`.

### Wave 10 fallout the full e2e suite found (fixed)

- **The GM's hand under the dock.** With a PC's sheet open the GM sees that PC's hand at the bottom; the dock (z 70)
  covered its Roll options / Hide cards (axe `target-size` in hud-gm-playfor, hud-sheet, hud-tokens,
  combat-cannonball, combat-adversary) and a raised card's Use (combat-cards: "Zoom out … intercepts pointer
  events"). Now, as GMDesktop `.fanside` (margin-bottom 98), the GM's fan-side buttons sit 98 px up (128 px above the
  two-row tablet dock), and a hovered or focused card lifts the hand region above the dock (`shell.css`).
- **Fog's pop-over over the middle of the map.** The dock's pop-overs are centred above it, so Fog's brush panel
  covered the squares the GM paints (combat-vision: the click at square 14,10 hit the panel). Fog's pop-over now sits
  at the screen's left edge above "Waiting on you" (x = 16; tablet 12, also beside a sheet; phone the dock's left end).
- `hud-death.spec.ts`: the GM's death confirm is a card in the queue, behind "Waiting on you" since H9.2 (H9.2 listed
  the other queue specs, not this one); the spec opens it first.
- `hud-dock.spec.ts`: the tablet dock beside a sheet is centred on x = 402 (was 342, off the left edge).
- `visual/HUD-H7.2.spec.ts`: the phone picker's footer Cancel (H7.3), not the header's ✕ (it timed out).

## Out-of-owns edits (minimal, listed for the orchestrator)

| File | Why |
|---|---|
| `src/components/combat-map/hud/shell.css` (H9.0) | The dead `.hud-scene-gm .hud-tr` selectors (bead note); the GM's hand vs the dock (fan side 98 px up, a hovered card above the dock). |
| `src/components/combat-map/hud/tools/index.tsx`, `tools/tools.css` (H9.0) | dcm-h77e.9: Map tools → `"tool"`, no glass background. |
| `src/components/combat-map/hud/areas/index.tsx`, `areas/areas.css` (H9.2) | dcm-h77e.9: Remove → `"danger"`; no forced 32 px height. |
| `src/components/combat-map/hud/dock/dock.css` (H9.0) | End scene's flag icon hidden by the glass button's `::before`; Fog's pop-over at the left edge. |
| `tests/e2e/hud-death.spec.ts` (H4.3) | Opens "Waiting on you" before the death confirm (H9.2 fallout). |
| `tests/e2e/hud-dock.spec.ts` (H9.0) | The tablet dock beside a sheet centres on x = 402 (test title updated). |

## Specs (owns)

- `tests/e2e/hud-tablet.spec.ts` (v2): PlayerTablet: the map controls under the title row and both rows left of the
  spotlight disc; the disc hides with a sheet open (the map's own toolbar checks are gone). GMTablet: title at 484,
  "Waiting on you" at 12 / 12, the dock centred at bottom 12 with hidden labels, no `.cm-toolbar`, touch targets
  (dock, Fear − / +, spotlight disc, queue), Areas at right 12 / bottom 74 / 360 px, the dock between "Waiting on
  you" and the stat block; axe. New: a core campaign's day-disc pop-over (Day / Dim / Night, ✕) at 44 px at 1024 and
  390, inside the screen.
- `tests/e2e/hud-phone.spec.ts`: the player's tools on the left clear of the disc, edge chips below the disc (right) and
  the tools (left), 44 px tools / sheet / tabs, no sideways scroll. The GM at 390: the title and Live under the banners
  and left of Fear, both discs under the Fear banner, the dock above the folded sheet inside the screen, 44 px dock /
  Fear / disc / handle, the spotlight popover inside the screen.
- `tests/e2e/visual/HUD-H7.1.spec.ts`: the "GM tools" group → the dock; Requests opens "Waiting on you" first.
- `tests/e2e/visual/HUD-H9.6.spec.ts` (new, `E2E_VISUAL=1`): the shots below.
- `visual/HUD-H7.2.spec.ts`: the footer Cancel at phone width. `hud-phone-sheets.spec.ts`: no change needed.

## Board shots

`test-results/visual/HUD-H9.6/` (also copied to `C:\Users\Petar\Downloads\dcm-screens\h9-6\`):

| Board render | Seed shot |
|---|---|
| `board-GMTablet-calm.png` | `gm-tablet-calm.png` |
| `board-GMTablet-requests.png` | `gm-tablet-requests.png` (queue open above "Waiting on you") |
| `board-GMTablet-adversary-acting.png` | `gm-tablet-adversary-acting.png` |
| `board-GMTablet-spend-fear.png` | `gm-tablet-spend-fear.png` |
| `board-GMTablet-areas.png` | `gm-tablet-areas.png` |
| `board-GMTablet-log.png` | `gm-tablet-log.png` |
| `board-GMTablet-end-scene.png` | `gm-tablet-end-scene.png` |
| `board-GMTablet.png` (sheet: click a banner) | `gm-tablet-sheet-open.png` (dock on two rows between "Waiting on you" and the panel) |
| — | `gm-tablet-spotlight.png`, `gm-tablet-day-disc.png` |
| `board-PlayerTablet.png` | `player-tablet-default.png`, `player-tablet-sheet-open.png` |
| `board-PlayerTablet-picking-a-target.png` | `player-tablet-picking.png` |
| `board-PlayerTablet-gms-turn.png` | `player-tablet-gm-turn.png` |
| `board-PlayerTablet-youre-hit.png` | `player-tablet-youre-hit.png` |
| `board-PlayerTablet-card-result.png`, `-last-hit-point.png`, `-cant-afford.png` | (H7.1's shots) |
| `board-PlayerPhone.png` (Picking, Hand tab, You're hit, Sheet) | `player-phone-picking-edge-chips.png`, `player-phone-hand-tab.png`, `player-phone-youre-hit.png` (an adversary holds the spotlight: purple disc), `player-phone-sheet-full-screen.png`, `player-phone-main.png` |
| — (no GM phone board) | `gm-phone-main.png`, `gm-phone-queue-open.png`, `gm-phone-spotlight.png`, `gm-phone-day-disc.png`, `gm-phone-log.png`, `gm-phone-areas.png` |
| Whole pages | `page-gm-1440.png`, `page-gm-1024.png`, `page-gm-390.png`, `page-player-1440.png`, `page-player-1024.png`, `page-player-390.png` (the 390 pages include the phone's art header; fixed bottom sheets show at the viewport's bottom) |

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm test` (vitest): 492 files, 10696 passed, 1 expected fail.
- Full e2e (`E2E_PORT=3721 E2E_CONVEX_PORT=3821`, servers started by hand, `E2E_REUSE_SERVERS=1`, `--workers=2`):
  389 passed, 17 failed, 1 skipped (18 min). After the fixes above, `--last-failed --workers=1`: 14 passed, 2 failed
  (combat-vision: Fog's pop-over, fixed after; hud-attack-pick: a chip click intercepted by a ring, passed on its own
  rerun: load flake). The renamed hud-dock test and the fixed specs then passed together: combat-vision, hud-dock (3),
  hud-tablet (4), hud-phone (2), hud-attack-pick: 12 passed. Load flakes that passed on rerun with no change for them:
  lorekeeper-chat (cap notices), notes-flow (mention chips), hud-attack-pick (3).
- `E2E_VISUAL=1`: HUD-H9.6 (5), HUD-H7.1 (2), HUD-H7.2 pass.
- `pnpm build`: passes.
