# TASK-HUD-H2.2: Make room (the map shifts and scales for the sheet, overlays move, switching between sheets)

Status: Review. Plan: `.omc/plans/combat-hud.yaml`, tracer H2.2 (wave 3, batch A). Briefs: `.omc/plans/combat-hud-briefs.md`
("Wave 3 / H2.2", "Make-room transform vs pointer maths"). Boards: Main, GMDesktop (`.sh-open` rules), CmpTokensDesign
'Motion'; HANDOFF "Layout". Beads: dcm-bxp.99.32 (overhaul), dcm-bxp.99.32.11 (the `.sh-open` clash, fixed here).
Depends on H0 (shell, HudProvider), H1.1 / H1.2 / H1.S (the parts that move).

## What landed

All of it renders only with the HUD switch on; the classic page is untouched.

- **Root classes renamed (dcm-bxp.99.32.11)** (`hud/state.tsx` `hudRootClasses`): the boards' `sh-open sh-<Name>` are
  now `hud-sh-open hud-sh-<id>` (and `pk-open` / `tl-open` are `hud-pk-open` / `hud-tl-open`), so the HUD root never
  picks up the party sheet's global `.sh-open` pill-button style (`party/sheet-ui/sheet-ui.css`). The prefix-only rename
  keeps `hud-tokens.spec.ts`'s `sh-<id>` class check passing unchanged. banners.css's `.hud-root.sh-open` reset is now
  dead and left for H2.1 to remove (as ordered).
- **Make room** (`hud/shell.css`, end of the file), keyed on `.hud-sh-open`, values from the `--hud-*` tokens in
  `hud.css` (H0):
  - the map's viewport (`.hud-map .cm-vp`) transitions `translateX(-125px) scale(.94)` from its top-left corner over
    350 ms ease-out (`--hud-t-map`, `--hud-ease-out`); tablet (≤ 1180 px) −60 px / .92 (the tokens' tablet values). The
    viewport is transformed, not the stage inside it, so the scroll container, the map's own toolbar and the hint stay
    put; the ResizeObserver Fit does not fire (a transform is not a resize).
  - the Fear banner and its rod move left by the panel's width (right 24 → 424; tablet 356) and the day / time disc
    fades out, then turns `visibility: hidden` so the GM's disc button leaves the tab order.
  - the hand region starts at left 330 (tablet 150) and ends left of the panel (right = panel + 24); the hand's centre
    goes from x ≈ 873 to ≈ 673 (board 680).
  - pop-ups: the pop region's right edge moves to the panel; the spotlight's reactions note goes 820 → 560 (Main
    `.gmh`) and the "GM has the spotlight" card narrows to 330 (Main `.gms`). New root variables `--hud-pop-res-left`
    (820 → 592, Main `.res`), `--hud-pop-blk-left` (880 → 690, Main `.blk`) and `--hud-pop-note-left` (820 → 560) are
    the contract for the result / blocked / note pop-ups the later tracers build.
  - GMDesktop: the title and the GM tools hide (`.gtitle` / `.gtools`), hidden for keyboard too; an open pop-over
    (Areas, Fog, Dice) stays. Tablet: the whole title row hides for everyone (Main `.tab.sh-open .title, .tr`).
  - the map's own toolbar (H0 / H1.2 float it at x = 690) is capped to end left of the panel.
  - Motion: every move is a transition on the `--hud-t-*` tokens, which `hud.css` zeroes under
    `prefers-reduced-motion` (plus its `transition: none !important`); nothing animates there.
- **Switching sheets** was H0's `toggleSheet` (same target closes, another swaps); tokens (H1.3) and banners (H1.1) call
  it. H2.2 adds no new opener; the ✕ close button is H2.1's panel (`closeSheet`).
- **Pointer maths stays exact under the transform** (out of owns, see Deviations):
  - `map-view/map-board.tsx`: `toSquares` goes through a new exported `stageToSquares(stage, step, pad, x, y)`, which
    multiplies `step` by the stage's on-screen width over its layout width (`getBoundingClientRect().width /
    offsetWidth`), i.e. any ancestor scale. Area picking, the vision and editor layers and every HUD layer use it.
    Without a transform the ratio is 1 (and jsdom's 0 offsetWidth falls back to `step`), so nothing changes there.
  - `tokens/tokens-layer.tsx`: the token drag measured its delta with `/ zoom`; it now divides by `screenScale(el,
    zoom)`, the tokens layer's on-screen width over its layout width (zoom times the make-room scale), measured once at
    pointer down. The turn knob uses an angle (scale-free) and needed nothing.
  - Not fixed (follow-up bead): `use-map-zoom.ts`'s Ctrl + scroll zoom anchor and the pan drag use client pixels as
    stage pixels, so while the sheet is open a wheel zoom drifts by ~6 % of the cursor's offset and panning runs 6 %
    fast (dcm-bxp.99.32.14). Neither moves a token or picks a square.

## Board states matched

| Board state | What the spec checks |
|---|---|
| GMDesktop, stat block open (`.sh-open`) | viewport `matrix(0.94, 0, 0, 0.94, -125, 0)`, Fear banner right 424, disc / title / GM tools hidden, hand left 330, pop region right 400 |
| Main, sheet open (player, reduced motion) | same shift at once (0 s transitions), disc hidden, title kept, root keeps its frame (no pill) |
| HANDOFF "another banner or token swaps; the same one closes" | Lieutenant → Sniper swaps `hud-sh-<id>`, Sniper again closes, map back to `none` |
| CmpTokensDesign 'Motion' | `transition-duration` 0.35 s on the viewport, 0 s under reduced motion |

Screenshots are attached to the e2e run (`gm-stat-block-open`, `player-sheet-open` in the Playwright report). No
`tests/e2e/visual/HUD-H2.2.spec.ts` (not in owns); the board's own Preview of `.sh-open` has no sheet panel yet to
compare against until H2.1, whose visual spec should shoot the open-sheet states.

## Tests

- `tests/unit/hud/make-room.test.tsx` (8): the root classes carry `hud-` and never `sh-open`; swap / close; `toSquares`
  without a transform, with fog padding, under −125 px / .94 (near and far squares) and under tablet −60 / .92 at zoom
  1.2; the drag scale (zoom × make-room scale) and its fallback; the make-room CSS keys on `.hud-sh-open` only, with the
  board's transform, origin, 350 ms, Fear shift, hand 330, disc hide; reduced motion zeroes them.
- `tests/e2e/hud-make-room.spec.ts` (2): the GM (stat block from a token: make room, drag 2 × 1 squares with the sheet
  open lands exactly, an area pick at square (17, 4) on the shifted map draws the area there, swap, close, drag again
  without the sheet; axe) and a player under reduced motion (banner → sheet; no pill style on the root, shift at once,
  Esc closes; axe).
- `tests/unit/hud/h0-state.test.tsx`: three expectations follow the rename (out of owns, forced by the rename).

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean for every H2.2 file; `rebuild` itself fails typecheck (and so the e2e
  `next build`): `convex/schema.ts` does not compose `combatSpotlightTables` (H1.S's merge commit lists it but did not
  include it), so `convex/lib/spotlight.ts`, `convex/combatSpotlight.ts` and `tests/convex/hud-spotlight.test.ts` do
  not type-check. To run e2e, the tracer composed the table locally (uncommitted); see Merge-time actions.
- vitest: focused `tests/unit/hud` 7 files / 83 tests pass (make-room 8 included); the full suite (with that local schema
  patch) 448 / 450 files, 10 201 tests pass; the 2 failures are `cleanup.test.ts` / `schema-guard.test.ts`, which
  flag the locally composed table's missing purge / retention entries, and pass again without the patch.
- e2e (ports 3120 / 3352, machine under load 10+): `hud-make-room` 2 / 2 (the player test passed on a retry after a
  sign-in timeout), `hud-banners`, `hud-fear`, `hud-spotlight`, `hud-shell` (2 / 2 on retry, earlier runs hit Convex
  "function timed out" under load) pass. `hud-tokens` fails both tests for a reason outside H2.2 (dcm-bxp.99.32.15):
  a PC token click opens H1.1's classic modal drawer and the spec then acts on the inert map. Its class check (line 92)
  needed the rename (Deviations).

## Deviations (out-of-owns edits)

- `src/components/combat-map/map-view/map-board.tsx` (in `reads`): `stageToSquares`, see above. The acceptance asks
  for `toSquares` and area picking to stay exact; `AreaPickLayer` receives MapBoard's own viewport (not the layers'),
  so it cannot be corrected from the shell.
- `src/components/combat-map/tokens/tokens-layer.tsx`: `screenScale` for the drag delta. The acceptance asks for exact
  drags; the drag divides by `zoom` inside this file.
- `tests/unit/hud/h0-state.test.tsx`: three class strings.
- `tests/e2e/hud-tokens.spec.ts` line 92: `sh-open sh-<id>` → `hud-sh-open hud-sh-<id>` (its other class checks match the
  prefixed names unchanged).
- The make-room rules for the Fear banner, disc, title and spotlight note live in `shell.css` under `.hud-sh-open`
  instead of renaming the `.sh-open` selectors inside `fear/fear.css`, `scene/scene.css` and `spotlight/spotlight.css`
  (not in owns). Those old selectors no longer match anything; the cleanup bead below removes them.

## Beads

- Fixed here: dcm-bxp.99.32.11 (not closed: the orchestrator closes it at merge).
- Filed: dcm-bxp.99.32.15 (hud-tokens.spec vs the classic modal drawer, fails on `rebuild` independent of H2.2),
  dcm-bxp.99.32.13 (remove the dead `.sh-open` selectors in fear.css / scene.css / spotlight.css),
  dcm-bxp.99.32.14 (Ctrl + scroll zoom anchor and pan drift ~6 % while a sheet is open).

## QUESTIONS

1. The default hand region is H0's left 330 / right 24 (centre x ≈ 873 at 1440), not the board's left 700 / width 700
   (centre 1050). H2.2 left the default alone (H2.3 builds the hand in parallel against it) and only set the open-sheet
   position (left 330, right panel + 24, centre ≈ 673 vs the board's 680). Default kept; H2.3 / the orchestrator decide.
2. GMDesktop hides the GM tools (Map tools, Areas, Fog, Dice, Player view, End scene, the HUD switch) while a sheet is
   open. Followed the board; the GM closes the stat block (same token, or H2.1's ✕) to reach them. Reversible: drop the
   `.hud-scene-gm .hud-tr` selector in shell.css.

## Merge-time actions

- No Convex change, no codegen of H2.2's own. But `rebuild` needs `combatSpotlightTables` composed into
  `convex/schema.ts` (with the campaign purge step and retention decision H1.S's merge describes) and
  `convex/_generated` regenerated, or typecheck and every e2e build fail.
- H2.1: drop the `.hud-root.sh-open` reset in `banners/banners.css` (already planned) and close dcm-bxp.99.32.11.
