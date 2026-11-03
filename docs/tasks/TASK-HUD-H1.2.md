# TASK-HUD-H1.2: Fear banner, day / time disc, title with Dice and Sheet, GM toolbar

Status: Review. Plan: `.omc/plans/combat-hud.yaml`, tracer H1.2 (wave 2). Briefs: `.omc/plans/combat-hud-briefs.md`
("Wave 2 / H1.2", user answers 6a, 9b, 12a). Boards: Main, GMDesktop, CmpTokens. Bead: dcm-bxp.99.32 (overhaul).
Depends on H0 (shell, primitives, HudProvider) and HD1 (`combatHud.scene`, `combatHud.party`).

## What landed

All of it renders only with the HUD switch on (H0's `hud/flag.ts`); the classic page is untouched.

- **Fear banner** (`hud/fear/index.tsx`, `banner.tsx`, `fear.css`; CmpTokens 'GM Fear · players' / 'GM Fear · GM',
  Main / GMDesktop top-right): the purple rod, the banner (150 × 262 px at right 24, top 8: flame, "GM FEAR", the
  number, 12 diamond pips through H0's `Pips` kind "fear" in the board's banner size) and, on the GM view only,
  − / + ("Spend a Fear" / "Gain a Fear"). Each click is one `fear.adjust` intent with a fresh idempotency key and an
  optimistic update of both Fear reads on the page (`combatHud.scene`, the banner's; `campaigns.fear`, the drawer's
  classic pill), never past 0 / 12; − is disabled at 0, + at 12. No confirm (answer 6a). A refusal shows under the tip
  in a live region. `role="group"` "GM Fear"; the pips are one image "5 of 12 Fear".
- **SPOTLIGHT slot** (`hud/fear/spotlight-slot.tsx`): `FearSpotlightSlot` renders nothing until H1.S is merged; the
  banner mounts it under the pips and − / + (Main 'GM's turn' `.fb-spot`). See merge-time actions.
- **Day / time disc** (`hud/scene/disc.tsx`, styles in `fear.css`; Main / GMDesktop `.sun`, CmpTokens 'Light'): hangs on
  a cord left of the banner (right 206 on the page), the disc coloured by the light (Day / Dim / Night as CmpTokens).
  With campaign time (Witherwild): "Day n" and the phase ("Afternoon"); its name adds the week and the light
  ("Week 1, Day 3, Afternoon, Day light"). GM with `scene.canOpenTimeArc`: a button (aria-expanded) that opens the
  existing `TimeArc` (dashboard's, reused unchanged; it holds End day and its Undo) in a non-modal pop-over under the
  disc; Escape / ✕ close it and focus returns to the disc. Players, and every frame without campaign time (GM too):
  read only, the light alone ("Dim") (answer 9b). The disc hides and the banner moves left of the panel while a sheet
  is open (`.sh-open`, HANDOFF "Layout").
- **Title** (`hud/scene/index.tsx`, `scene.css`; Main `.title`, GMDesktop `.gtitle`): at x = 690, y = 20, an `<h2>` with
  the map's name (the shell's sr-only `<h1>` stays the page heading) and the line "Live" / "Not live"; the GM's adds
  "· GM view · Session n" while a session is live (`sessionWrap.dashboard`, GM only). GMDesktop hides the title while
  a sheet is open.
- **Toolbar** at y = 84 (`role="group"`, "Your tools" / "GM tools"), ending with the shell's toolbar (Map tools, answer
  12a, and the classic switch; H0's contract kept):
  - Player (Main `.tr`): **Dice** (the app's `DiceBox` for their PC on the map, in a pop-over) and **Sheet** (toggles
    their own sheet in the HUD state, `toggleSheet({ kind: "pc" })`, aria-pressed; H2.1 draws the panel). Both hide
    when the player has no PC on the map.
  - GM (GMDesktop `.gtools`): **Day / Dim / Night** (`campaigns.setTimeOfDay` intent, optimistic on `combatHud.scene`
    and `campaigns.timeOfDay`; hidden unless `scene.canSetLight`, so never in a frame with campaign time), **Areas**
    (the existing `AreaTools` in a pop-over), **Fog** (the existing "Vision & fog" card, `VisionPanel`, in a pop-over),
    **Dice** (the dice box of the selected PC token, else a hint: QUESTIONS 1), **Player view** (`PreviewPicker`),
    **End scene** (`EndSceneButton`, its own confirm, until H5.3), **Map tools**.
  - One pop-over at a time (`hud/scene/pop.tsx` `ScenePop`: non-modal `role="dialog"`, focus in on open, Escape / ✕
    close, focus back to the button whose `aria-controls` names it).
- The map's own toolbar (name, LIVE, Areas, Names, zoom) moves from y = 128 to y = 236 (`scene.css`), under the toolbar's
  rows, since `map-view` is not H1.2's (it keeps its Names / zoom; its Areas button duplicates the HUD's until wave 9).
- Tablet (≤ 1180 px): the boards' `.tab` sizes for the banner (118 × 206) and disc (44 px), smaller title and buttons;
  title and toolbar hide while a sheet is open. Phone layout is H7.x's.

## Board states matched (shots)

`E2E_VISUAL=1 E2E_PORT=… E2E_CONVEX_PORT=… pnpm test:e2e tests/e2e/visual/HUD-H1.2.spec.ts` writes to
`test-results/visual/HUD-H1.2/`:

| Board state | Board render | Seed shot |
|---|---|---|
| Main top-right + title / Dice / Sheet (player) | `board-Main.png` | `player-1440.png`, `player-1024.png`, `player-dice-1440.png` |
| GMDesktop top-right + title / GM toolbar | `board-GMDesktop.png` | `gm-1440.png`, `gm-1024.png`, `gm-fog-1440.png` |
| CmpTokens 'GM Fear · players' / 'GM Fear · GM' | `board-CmpTokens-fear.png` | `player-fear-close.png`, `gm-fear-close.png` |
| CmpTokens 'Light' / GM disc → time arc (answer 9b) | `board-CmpTokens-light.png` | `gm-time-arc-1440.png` |

Differences from the boards, all from real data: the seed's day is Day 1 (Witherwild initial time) and its phase; the
board's sample "Session 6" shows only while a session is live; the GM toolbar has Map tools and the classic switch
after End scene (answer 12a / 11b), so it wraps to two rows at 1440. The HUD sits below the campaign header and nav (H0's interim, H0 QUESTIONS 1), so
the shots show the nav above the map and the rod's top edge under it.

## What moved out of the old column

Nothing was removed (mode add). The HUD now has its own Fear, light, Player view, End scene, Areas, fog and dice
controls; the drawer still holds the classic header tools and column until wave 9 (H8.2).

## Tests

- `tests/unit/hud/fear-scene.test.tsx` (17): Fear step bounds; disc lines / names; title line; Fear loading line;
  player banner (12 pips, 5 on, no buttons); GM − / + call `fear.adjust` with fresh keys and open no dialog; bounds
  disable; the optimistic update of both reads; player disc read only; GM disc opens the time arc (focus in, Escape,
  focus back); core frame disc read only for the GM; GM toolbar order and no Day / Dim / Night with campaign time;
  Day / Dim / Night intent + optimistic update in a core frame; Areas / Fog / Dice pop-overs one at a time; GM Dice
  for the selected PC; player Live line, Dice and Sheet (toggles the HUD sheet); no PC → no Dice / Sheet.
- `tests/e2e/hud-fear.spec.ts` (1, live two-browser): banner at right 24 and title at x = 690; player banner without
  buttons; GM + / − / − with no dialog, the player's banner follows live and the server holds 4; player disc read only;
  GM disc opens the time arc with End day, Escape returns focus; GM title and toolbar (no Day / Dim / Night in the
  Witherwild), Fog and Areas pop-overs; player Live line, Sheet, Dice box; axe (no serious / critical) with the time
  arc open, with the Areas pop-over open and on the player's HUD with the dice box.
- `tests/e2e/visual/HUD-H1.2.spec.ts` (2, `@visual`): the shots above.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest `--maxWorkers=1 --testTimeout=120000`, full suite: 444 / 444 files, 10135 tests passed (+1 expected fail).
- e2e on this worktree's ports: `hud-fear.spec.ts` and H0's `hud-shell.spec.ts` 3 / 3 passed; `visual/HUD-H1.2.spec.ts`
  (`E2E_VISUAL=1`) 2 / 2 passed. The first run failed axe `target-size` on the time arc's day icons: their `.tm-ic` size
  lives in the dashboard's `dashboard.css`, which the Combat Map did not load; `scene/disc.tsx` now imports it (every
  class in it is namespaced: `tm-*`, `fear-*`, `fz*`, `cd-hidden*`, `wither-*`).
- `node scripts/tracer-guard.mjs .omc/plans/combat-hud.yaml H1.2 rebuild HEAD`: OK.

## Beads

None done or filed. No data gaps: `combatHud.scene` / `party` (HD1) carry everything the banner, disc and title show.

## QUESTIONS

1. **The GM's Dice.** GMDesktop shows Dice in the GM toolbar, but the dice box rolls for a character. Built: the dice box
   of the PC token selected on the map, else "Select a PC token on the map to roll for them." Should the GM's Dice
   (a) roll for the selected PC (built), (b) be a plain GM roller (d20 / damage dice, no character), or (c) be left out?
2. **Days in a core campaign** (HD1's QUESTIONS 1, still open). Every frame counts days since lanes-2 CT, but HD1's
   `scene.day` / `canOpenTimeArc` exist only with campaign time, so in a core campaign the disc shows the light only and
   the GM sets it with Day / Dim / Night in the toolbar (as the acceptance says). Should the core disc also read
   "Week n · Day n" and open End day (`CampaignDay`) for the GM? That needs HD1's `scene.day` widened.
3. **Sheet before H2.1.** The player's Sheet button sets the HUD's sheet state (`sh-open`: the banner moves, the disc
   hides) but no panel draws until H2.1 merges; the classic Sheet button stays in the drawer meanwhile. OK as an
   interim (the switch is opt-in), or should Sheet open the classic sheet drawer until H2.1?

## Merge-time actions

- **SPOTLIGHT tag:** once H1.S is merged, make `hud/fear/spotlight-slot.tsx` return H1.S's Fear banner tag (its export
  from `hud/spotlight`, with `campaignId` and `gm`). No other file changes.
- No Convex files, schema, authz entries or codegen.
- Later tracers: H5.3 (owns `hud/fear/**`) adds `FearConfirm` beside the banner and will need its Areas panel and End
  scene confirm reached from the GM toolbar in `hud/scene/index.tsx` (not in H5.3's owns: add `hud/scene/**` to its
  owns or a HUD state flag). H7.x places the banner, disc and toolbar on the phone. `scene.css` moves the map's
  `.cm-toolbar` to y = 236; drop that rule when the map toolbar's buttons move into the HUD (wave 9).

## User answers 2026-11-02 (applied)

- **GM Dice: both** (QUESTIONS 1). The GM toolbar's Dice opens a plain GM roller (the dashboard's secret GM roll,
  `GmRollForm` from `party/dice/roll-feed.tsx`, now exported, with `showResult` for the last roll's dice and total).
  With a PC token selected, a "Roll as" switch offers "GM roll" (default) and "For <PC>" (that PC's dice box, the old
  behaviour). Tests: `fear-scene.test.tsx`, `hud-answers.spec.ts`.
