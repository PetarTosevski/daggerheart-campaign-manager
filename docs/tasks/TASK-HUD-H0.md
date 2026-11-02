# TASK-HUD-H0: Combat HUD foundation (switch, shell, tokens, primitives, Map tools drawer, e2e seed)

Status: Review. Plan: `.omc/plans/combat-hud.yaml`, tracer H0 (wave 1). Briefs: `.omc/plans/combat-hud-briefs.md`.
Design: `reference/designs/combat-hud/` (HANDOFF.md; boards CmpTokensDesign, Main, GMDesktop). Bead: dcm-bxp.99.32.

## What landed

- **Opt-in switch** (`hud/flag.ts`, answer 11b): `useHudEnabled()` reads localStorage key `dcm:combat-hud` ("1" = on)
  through `useSyncExternalStore` (server snapshot = off, so hydration matches and no effect writes state). `?hud=1` /
  `?hud=0` override the stored value for that page view. `setHudEnabled()` (event handlers only) stores the choice,
  drops a `?hud=` override from the URL (`history.replaceState`) and notifies this tab; other tabs follow through the
  `storage` event.
- **Toggle on both views** (`hud/tools` `HudSwitchButton`): "Try the new combat HUD" in the classic header (after the
  header tools, styled `cm-btn cm-sm`), "Back to the classic view" in the HUD toolbar.
- **page.tsx**: `CombatBody` computes the page state once, then renders the HUD shell when the switch is on and the
  mode is Play; otherwise today's page, unchanged apart from the toggle button. Edit mode keeps the two-column layout
  (answer 12a), also with the switch on. The page state, `useCurrentMap` and the classic Sheet drawer stay in the same
  component across the switch. The header tools moved into a `HeaderTools` component that the classic header and the
  HUD drawer share (a new `placement: "drawer"` for the Sheet button).
- **Shell** (`hud/shell.tsx`, `shell.css`): a viewport-tall, full-width `MapBoard` (same classic layers via the page's
  `Layers`, plus the HUD map layers `HudPickLayer` and `HudActionRing`), an overlay with seven regions
  (`data-hud-region`: banners, scene, fear, left, hand, pop, panel) at the desktop board's positions, every part in its
  own `PartBoundary` (CL1). GM-only parts (queue, Areas, stat block) mount only for the GM. A screen-reader-only
  `<h1>Combat Map</h1>` keeps the page heading.
- **Stub regions** (`hud/<area>/index.tsx`, render nothing; each names the tracer that fills it): banners (H1.1), fear
  (H1.2), scene (H1.2; until then it shows only the toolbar the shell hands it: Map tools + the switch), spotlight
  (H1.S), sheet (H2.1), statblock (H5.2), hand (H2.3), pick + pick layer (H3.0), action-ring layer (H3.4), result
  (H4.1), hit (H4.2), death + feed (H4.3), queue (H5.1), areas (H5.3), toasts (H6.1). Props: `HudPartProps
  ({ state: CombatPageState })` or `HudLayerProps (= MapLayerProps)`, both in `state.tsx`.
- **Map tools drawer** (`hud/tools`): `MapToolsButton` (aria-expanded / aria-controls) and `HudTools`, a left
  `SidePanel`. GM ("Map tools"): the header tools (light, session chip, Fear, map style, player view, Sheet) then the
  whole classic GM column (Maps, packs, Play / Edit, Combatants, token card, adversary controls, Reveal, Vision,
  Resolutions). Player ("Your character"): Sheet and light, then their classic column (incoming hit, combat actions,
  their view, token card). Esc / ✕ close it and focus returns to the button.
- **Tokens** (`hud/hud.css`): CmpTokensDesign colours as `--hud-*` (reusing `--cm-*` where equal), type roles on the
  app's next/font variables (`--font-cinzel`, `--font-plex`, `--font-garamond`), radii, motion durations, layout sizes
  (sheet 400 / 340 px, make-room shift and scale), keyframes; every animation and transition off under
  `prefers-reduced-motion`.
- **Primitives** (`hud/ui/**`, barrel `hud/ui/index.ts`, CSS `ui.css` with `hud-` prefixed board classes): `Popup`
  (icon, title, sub, body, footer with one primary; tones player / gm / red / wait; non-modal `role="dialog"`), `Tag`
  (play / no / used / limit / cost), `CostPill` (Hope / Stress / Fear / HP / Armor, spelled out for screen readers),
  `Pips` (caller decides what "on" means and the label, per answer 2), `Seal` (greys at 0), `Stepper` (±1 intents,
  bounds), `Toggle` (role switch), `ChoiceRow` (radio / checkbox), `TwoTapButton` (second tap fires; blur / Esc
  disarm; no timers), `BandLabel` (picked / in / out / los), `StatTile`, `WaitingDots`, `SidePanel` (non-modal
  `<aside>`, focus in on open and back to the opener on close, Esc), `PartBoundary`, `hudButtonClass`.
- **HudProvider** (`hud/state.tsx`): `sheet` (`{ kind: "pc", characterId } | { kind: "adversary", tokenId } | null`) with
  `toggleSheet` (same target closes, another swaps) and `closeSheet`; the pick session slot `pick` (`{ id,
  anchorTokenId }`) with `setPick`; the drawer `toolsOpen`; `hudRootClasses()` gives `sh-open sh-<id>`, `pk-open`,
  `tl-open` on `.hud-root`.
- **e2e seed** (`tests/e2e/hud/helpers.ts`): `enableHud(page, on?)`, `combatMapUrl()`, `hudScene(browser, { hud })`:
  `gmAndPlayer` with the player's Moss (Druid, Vicious Entangle (Far) + Unleash Chaos in hand), the GM's Brannoc
  (Warrior), Vex (Rogue), Oriel (Seraph); a running encounter with the Jagged Knife Lieutenant (Leader), two Bandits and
  the Sniper (Ranged); a live 30 × 20 map, everyone placed facing east, and a sight-blocker wall at x = 18, y 2-8 that
  hides one Bandit from Moss. Returns ids and token names (`pcs`, `enemies.{lieutenant, bandit, hiddenBandit, sniper}`,
  `farCardId`).

## Board states matched

H0 ships the frame only; no board element is drawn yet. Shots (from `tests/e2e/hud-shell.spec.ts`, real seed):
`test-results/visual/HUD-H0/gm-hud-1440.png` (HUD on, empty regions, toolbar at x = 690),
`gm-tools-1440.png` (Map tools drawer open), `player-hud-1440.png`. Board renders for comparison: Main / GMDesktop
at 1440 × 900 (the regions sit where the boards put banners, title, Fear, left column, hand and sheet).

Interim choices (later tracers replace them):
- The HUD is viewport-tall below the campaign shell's header and nav (the page scrolls to it); the boards have no
  app chrome. Full screen / hiding the nav is not specified: left for H7.x / the user.
- The map's own toolbar (name, LIVE, Areas, Names, zoom) floats under the title at x = 690, y = 128 in a glass box
  until H1.2's toolbar takes its buttons.
- The map-view hint line under the viewport still shows (map-view is not H0's).

## What moved out of the old column

Nothing moved: with the switch on, the whole classic column and header tools sit in the drawer, unchanged.

## Tests

- `tests/unit/hud/h0-ui.test.tsx` (19): every primitive's states, intents, a11y names, SidePanel focus in / back and
  Esc, PartBoundary.
- `tests/unit/hud/h0-state.test.tsx` (11): switch default / server off / stored / `?hud=` override / toggle drops the
  override / storage event; HudProvider sheet open-swap-close, pick slot, root classes; drawer focus and Esc; switch
  button labels.
- `tests/e2e/hud-shell.spec.ts` (2, passed): GM classic → on (7 regions, full width, Lieutenant visible) → Map tools
  drawer (Maps, Map mode, Combatants, GM Fear; Esc returns focus) → Edit keeps the classic layout → Play brings the
  HUD back → reload keeps it → off survives a reload; player HUD (hidden Bandit absent, Lieutenant visible), "Your
  character" drawer with the Attack card and no GM Fear, `?hud=0` / `?hud=1` overrides, toggle drops the override; axe
  (no serious / critical) on classic, HUD and open drawers.
- Classic specs untouched; the switch is off by default.

## Beads

None done or filed (H0 is pure client scaffolding; no data gaps found).

## QUESTIONS

1. Should the HUD hide the campaign header and nav (true full screen, as on the boards), or stay below them?
   (a) stay below, page scrolls (built) (b) hide them while the HUD is on, with a way back (c) a full-screen button.

## Merge-time actions

- None: no Convex files, no schema, no authz entries, no codegen needed.
- Later HUD tracers: keep the stub export names and props; `HudScene` must keep rendering the `toolbar` prop (Map
  tools + the switch) until H8.1 removes the switch.
