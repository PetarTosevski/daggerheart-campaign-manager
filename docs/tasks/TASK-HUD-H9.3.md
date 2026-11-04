# TASK-HUD-H9.3: GM top centre is the scene title + Live; the light is set from the day disc

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 10, tracer H9.3, batch B (boards GMDesktop, GMTablet, Main).
Briefs: `.omc/plans/combat-hud-briefs.md` "Wave 10"; delta `.omc/plans/combat-hud-v2-delta.md` (user answers
2026-11-04 bind: Q6a). Mode: replace. No server change, no codegen.

## What landed

- **GM top centre** (`hud/scene/index.tsx`, GMDesktop / GMTablet `.scn .sc-t`): the map's name (Cinzel 26 px, tablet
  20 px) and a **Live chip** (`data-testid="hud-live"`: green dot + "LIVE"; "Not live" without the dot; "No live map
  yet" before a map is shown). Nothing else: "GM view · Session n" and every title-row button are gone (Day / Dim /
  Night, Areas, Fog, Dice, Player view, End scene). Those were duplicates of H9.0's dock. The GM scene no longer
  queries `sessionWrap.dashboard` or `combatHud.party`. The pill sits at top 16 (tablet 12) via `margin-top: -2px` on
  the 18 / 14 px region. It fades while a sheet is open (shell.css, unchanged).
- **Player title row** (Main `.title` / `.tr`): the title and "Live" line are unchanged. The row holds Dice, Sheet and
  "Your character", and the **map controls** (Measure, Names, zoom; H9.0) now always take a second row of their own
  (a zero-height break, ordered with CSS) instead of wrapping where they fall. On desktop, the title and the row fade
  (opacity, then `visibility: hidden`) while a sheet is open, as Main `.root:not(.tab).sh-open .title, .tr` does;
  shell.css already did this at tablet width.
- **Q6a, the light from the day disc** (`hud/scene/disc.tsx`): where `scene.canSetLight` (edit access, no campaign
  time), the disc's pop-over shows **Day / Dim / Night** (`LightSeg`, the same optimistic `campaigns.setTimeOfDay`
  intent) above the calendar. Core: "Campaign day" with "Week n · Day n", End day and Undo, as before. In a frame
  with campaign time the time arc has no switch, because the clock sets the light. An editor who can set the light
  but not end the day (`canEndDay` false) still gets a disc button ("…: set the light") with the switch and a
  read-only calendar. Unchanged: the disc reads "Week X · Day X" + light, the dashboard's day card cycle (Day → Dim →
  Night, click to advance) and End day (straight to the next day).
- Button roles (Arcane Glass, 6d1d2929): the player's Dice and Sheet are `hudButtonClass("tool")`. End scene and the
  modal's "End the scene" are `"danger"`; its "Keep playing" is `"cancel"`. The forced 32 to 38 px heights and the modal's
  solid Yes background are gone, so the buttons use the design's 44 px. At tablet width, "Your character" shows only
  its icon (the text stays its accessible name), so Dice, Sheet and it fit on one row left of the discs.
- Dead CSS removed from scene.css: the `.hud-tr` End scene and Player view rules, the stale `.sh-open` rules and the
  `.hud-map .cm-toolbar { top: 236px }` rule (H9.0 dropped the map's own toolbar).
- `hud/scene/dice.tsx`, `end.tsx` and `pop.tsx` keep the exports H9.0's dock imports.

## Specs

- Unit `tests/unit/hud/fear-scene.test.tsx` (owns added by the orchestrator, a254265d): the GM's title is the name +
  chip only (no buttons, no groups, no queries fired); "Not live" has no dot; the disc pop-over has Day / Dim / Night
  above the calendar (core) and sets the light optimistically; the time arc has none; editor-only gets the switch and
  a read-only calendar. The GM's Dice tests now render `HudDice` directly (the dock opens it). The player's row keeps
  its break.
- e2e `hud-fear.spec.ts`: the GM pill at top 16, no title-row buttons and no "GM tools" group, each of Areas / Fog /
  Dice / End scene exists once (the dock's), axe at 1440 × 900 and 1024 × 768 (the pill at x = 484). The player's map
  controls sit below Sheet, and the title and row hide with a sheet open.
- `lane-m-time-of-day.spec.ts`: the GM sets Day from the disc pop-over; the player's disc and pill follow live, and
  End day is still below. `core-calendar.spec.ts`: the switch is in the pop-over with Dim pressed.
- `live-combat.spec.ts`, `combat-end-scene.spec.ts`, `visual/HUD-H1.2.spec.ts`: the "GM tools" group → the dock
  (`toolbar` "Map controls").
- New `visual/HUD-H9.3.spec.ts` (`E2E_VISUAL=1`): board `.scn` renders, the GM top at 1440 / 1024, the player's title
  row and the core day-disc pop-over.
- `combat-light-uploaded.spec.ts`: no change needed.

## Outside owns, left to their owners (orchestrator agreed)

- `combat-vision.spec.ts:168,171,204` (H9.5; the orchestrator fixes it at merge) and H9.2's `hud-answers.spec.ts:110`,
  `hud-fear-confirm.spec.ts:36` and `hud-make-room.spec.ts:51,66,116` use the "GM tools" group. Use
  `getByRole("toolbar", { name: "Map controls" })`. In hud-make-room, the GM's hidden title is now just
  `hud-title`.
- `responsive/phone.css` `.hud-scene-gm .hud-tr` (H9.6): dead now. Note that the GM's phone `.hud-title` is
  `display: none`, so the GM phone scene shows nothing.
- `shell.css`'s `.hud-scene-gm .hud-tr` rules (H9.0) are dead but harmless.

## Checks

See the hand-off report (lint, typecheck, vitest `tests/unit/hud`, e2e on ports 3713 / 3813).
