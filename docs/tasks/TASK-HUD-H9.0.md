# TASK-HUD-H9.0: shell and GM bottom dock

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 10, tracer H9.0, batch A (boards GMDesktop, GMTablet,
CmpTokensDesign). Briefs: `.omc/plans/combat-hud-briefs.md` "Wave 10"; delta `.omc/plans/combat-hud-v2-delta.md`
(user answers 2026-11-04 bind: Q4a, Q9b). Mode: replace. No server change, no codegen.

## What landed

- **The GM's bottom dock** (`hud/dock/`, GMDesktop / GMTablet `.dock`): `role="toolbar"` named **"Map controls"**
  (Q4a puts a "Map tools" button in the dock, so the drawer button keeps the name "Map tools"). Groups:
  **Map tools** (Q4a: opens today's drawer, which keeps "Players can see each other's cards") |
  **Select** (pressed by default), **Measure**, **Areas**, **Fog**, **Names** |
  **Zoom out**, the **%** (aria "Fit the map to the screen", `data-testid="combat-zoom"`), **Zoom in** |
  **Dice**, **Player view**, **Log** | **End scene**. Centred, bottom 16; icon over a 10.5 px label; pressed = gold.
  Icons only at tablet width (≤ 1180 px, bottom 12) and while a sheet is open (centred at x = 640 desktop, 342 tablet);
  the labels stay for screen readers. Buttons are 44 px (the board's 34 px zoom buttons and 42 px tablet height grow
  to the app's 44 px touch-target rule).
- **Reused parts, not forks:** Dice opens `HudDice` (the GM roller, "For <PC>" with a PC token selected) and Fog
  opens `VisionPanel`, each in `ScenePop` above the dock; Player view is the existing `PreviewPicker` (menu opens
  upward; icon only in icon mode); End scene is `HudEndScene` ("End the scene?"); Map tools is `MapToolsButton`
  (`variant="dock"`).
- **`hud/panels.ts`**: one GM panel at a time (`queue | log | areas | spotlight | dice | fog | playerView | endScene`),
  `openPanel` / `closePanel` / `togglePanel` / `usePanel`; Escape closes the open one and returns focus to its
  opener (`usePanelEscape`, mounted by the dock; a panel that handles Escape itself wins). "areas" is mirrored into
  `hud/areas/open.ts` until H9.2 moves the Areas panel onto the store. Player view and End scene keep their own open
  state (their components own it); pressing them closes any other dock panel.
- **`map-view/controls.ts`**: a small external store (zoom, Fit, Names, the pointer tool, area tools). `MapBoard`
  publishes its zoom and zoom / fit actions (layout effect, released on unmount); the dock and the player's controls
  drive it. Names keeps the per-viewer localStorage key `dh.combat.names` (and the N key).
- **`MapBoard` `chrome: "full" | "none"`** (default full: Edit mode, the adversary tracker's map pane and every other
  use unchanged). `none` draws no `.cm-toolbar`, no classic area tools, and keeps the hint for screen readers only.
- **Measure (Q9b)** (`map-view/measure.tsx`): with Measure on, a drag from one square to another draws a dashed line
  and "7 squares · Far" from the app's range model (`tokenDistance` / `bandOf`, CB p.103 Defined Ranges, a diagonal
  step = 1 square). GM and players, each on their own screen; nothing saved or sent. The layer covers the stage while
  on (no pan, no token drag); Select (or Measure again for a player) turns it off.
- **Players** have no dock: their title row now holds "Your character" plus a compact **Map controls** toolbar
  (Measure, Names, Zoom out, %, Zoom in), which replaces the classic toolbar they used before.
- **Shell** (`hud/shell.tsx`, `shell.css`): `MapBoard chrome="none"`; the GM spotlight panel mounts and
  `useSpotlightInColumn` use are gone (H9.1's disc goes in the fear region); new regions **waiting** (GM queue,
  bottom-left; also classed `hud-r-left` so the tablet / phone placement holds until H9.2 / H9.6), **dock** (bottom
  centre) and **log** (bottom-right: `HudResolutions` while Log is pressed); the player keeps **left** (feed). The
  `.hud-map .cm-toolbar` float rules and the dead `.hud-toolbar` rule are gone; the HUD root is
  `calc(100dvh - var(--app-bar-h, 0px))` for H9.A's bar. Regions: GM 9, player 7.

## Interim until batch B merges

- The GM's title row (H9.3's `hud/scene`) still has Day / Dim / Night, Areas, Fog, Dice, Player view and End scene
  beside the dock. Specs that find those names page-wide may match two buttons until H9.3 lands.
- At 1440 × 900 the always-open queue + Resolutions column (bottom-left, 330 px) runs under the dock's left end; H9.2
  closes it behind "Waiting on you". A player's map controls wrap under Dice / Sheet / Your character in the title row.
- `HudQueue` still includes Resolutions, so Log shows them a second time until H9.2 moves them out.
- The GM can't move the spotlight from the HUD until H9.1's disc lands (the panel is unmounted, as the acceptance asks).

## Specs (owns)

- New: `tests/e2e/hud-dock.spec.ts` (every dock button keyboard only, one panel at a time, Escape and focus return,
  axe at 1440 × 900 and 1024 × 768, icon-only at tablet and with a sheet open, 44 px targets, Measure for GM and
  player), `tests/e2e/visual/HUD-H9.0.spec.ts`, `tests/unit/hud/dock.test.tsx`, `tests/unit/hud/panels.test.ts`.
- Updated: `hud-shell.spec.ts` (GM regions 9, no `.cm-toolbar`, Map tools in the dock), `a11y-play.spec.ts` (Player
  view and zoom from the dock / player controls), `area-overlay.spec.ts` (Areas from the dock),
  `combat-movement.spec.ts` (the zoom read page-wide), `combat-maps.spec.ts` (the player reads the map's name from
  the HUD title, not the gone toolbar). `combat-tokens.spec.ts` and `combat-map-flow.spec.ts` needed no change.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. vitest (full): 484 files, 10608 passed, 1 expected fail.
- e2e (`E2E_PORT=3681 E2E_CONVEX_PORT=3781`, `--workers=1`): hud-dock (3), hud-shell (2), a11y-play (7),
  area-overlay, combat-movement (3), combat-maps (3), combat-tokens, combat-map-flow (2) pass. combat-map-flow 1440
  (drawer "New map" click detached under load) and combat-maps "empty state" (sign-in) passed on `--last-failed`.
- Shots: `test-results/visual/HUD-H9.0/` (gm-dock-1440, gm-dock-1024, gm-dice-1440, gm-log-1440, gm-sheet-1440,
  gm-measure-1440, player-measure-1440, player-1024); `visual/HUD-H9.0.spec.ts` adds the board renders with
  `E2E_VISUAL=1`.

## Specs outside owns that the merge breaks (their owners fix them)

- `combat-vision.spec.ts:120-121` (H9.5; the orchestrator fixes it at merge): the player's Fit is now
  `player.getByRole("toolbar", { name: "Map controls" }).getByRole("button", { name: "Fit the map to the screen" })`
  and the zoom `player.getByTestId("combat-zoom")` (no longer inside region "Battle map"). Names:
  `…getByRole("toolbar", { name: "Map controls" }).getByRole("button", { name: "Names" })` (`aria-pressed`).
- `hud-spotlight.spec.ts:75-80` (H9.1), `hud-queue.spec.ts:101-103` (H9.2), `hud-tablet.spec.ts:82,183` (H9.6):
  they locate `.hud-map .cm-toolbar` or the GM spotlight panel.

## Merge-time actions

- None on the server. The dock imports `hud/scene/{dice,end,pop}.tsx` and `vision` `PreviewPicker` / `VisionPanel`;
  H9.3 keeps those exports.
