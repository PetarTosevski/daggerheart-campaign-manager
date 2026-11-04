# TASK-HUD-H7.2: the phone shell (player and GM)

Plan `.omc/plans/combat-hud.yaml`, wave 8, tracer H7.2 (boards PlayerPhone, GMTablet; HANDOFF "Phone (390)"; answer
13a). Bead dcm-bxp.99.32 (parent; not closed). Mode: add. With the HUD switch off nothing changes. No server change.

## What landed

At 760 px and below (`PHONE_QUERY`, the classic page's bottom-sheet breakpoint), `usePhoneHud()` (a
`useSyncExternalStore` on the media query, no effect) switches the shell:

- **Player: `hud/phone/index.tsx` (`HudPhone`)** replaces the desktop banners, title / toolbar, Fear, feed and hand
  regions. Each part sits in its own `PartBoundary`.
  - **The mini banner strip** (`strip.tsx`, PlayerPhone `.mparty`): top 0, 104 px. One small banner per PC from
    `combatHud.party` (yours first and gold): portrait, name, HP-left and Stress-marked bars, the Hope seal at the tip.
    Each is a real `<button>` named "Open <name>'s sheet", with the desktop banner's summary as its description
    (hard rule 4). Then Fear as a purple banner, read only (`role="img"`, "GM Fear 5"; answer 6a).
  - **The bottom sheet** (`sheet.tsx`, PlayerPhone `.bs` / `.mres` / `.tabs`): a grab handle, the resource line
    (HP, Stress, Armor as "n/max" marked and Hope as value/max; each `aria-label` reads "2 of 6 Hit Points marked",
    answer 2), **Sheet** (your sheet, `aria-pressed`), and the tabs Hand / Attack / Dice / Feed (WAI-ARIA tabs with
    arrow keys). Every tab reuses an existing part:
    - Hand: `HudHand` (H2.3) with the vault, Roll options and Hide cards; phone.css lays the fan out as one scrolling
      row of 140 px cards (PlayerPhone `.hscroll`), nothing sunk or rotated; the side buttons become a 44 px row.
    - Attack: H3.2's `useAttackPicker`: "Weapon attack" opens the picking panel (disabled with the picker's reason),
      plus a button per forced attack waiting on you.
    - Dice: `HudDice`, the app's dice box as the classic map mounts it.
    - Feed: H4.3's "Just now".
    The open tab again, or the handle, folds the sheet to its resource line and tabs. It starts folded (QUESTIONS 1).
    It steps aside (`display: none`) while a pick session (`hud-pk-open`), the hit window, a result or the death move
    holds the bottom of the screen (H7.3 turns those into bottom sheets).
  - **Edge chips** (`edges.tsx`, PlayerPhone `.edge`): during a pick session every listed creature whose ring is off
    the visible map (panned away, under the strip, or behind a bottom sheet) gets a chip on the nearest side edge at
    its height: "Sniper · Very Far · GM →" (amber), "Bandit · can’t see →" (salmon), "Lieutenant · Far ←" (gold).
    The chips read the rings' boxes from H3.0's DOM contract (`[data-testid="hud-pick-ring"][data-token]`) once per
    frame while a session is open, through a small external store, and re-render only when a chip moves; chips on one
    edge stack without overlap. They only point; the panel's rows and the rings pick. No numbers (hard rule 2).
  - **The toolbar** (Map tools, the classic switch) sits under the strip, right; the map's own toolbar (Names, zoom,
    Fit) under the strip, left, on one row (the map's name hides: the phone has no title on the board).
  - **Toasts** (H6.1's host) above the bottom sheet.
  - **The sheet, full screen** (PlayerPhone 'Sheet, full screen'): `--hud-sheet-w: 100vw`, no make-room shift, a
    44 px close. The strip, toolbar, chips and bottom sheet turn `visibility: hidden` under it (the keyboard cannot
    reach them). An ally's mini banner opens their sheet the same way.
- **GM: the tablet layout with the queue as a bottom sheet (answer 13a).** `PhoneQueueSheet` (`queue.tsx`) wraps the
  shell's left column (the request queue with Resolutions, then the spotlight panel) and, at phone width for the GM
  only, turns it into a bottom sheet: folded (default) it shows "Waiting on you" with its count under a handle
  ("Show the requests"); unfolded it shows the cards, Resolutions and the spotlight panel, scrolling inside. Wider
  than a phone, or for a player, it renders the column unchanged. phone.css fits the rest of the tablet layout to 390:
  the banners hang at 55 % (still real buttons, ~60 × 130 px), the Fear banner stays on the right with its disc under
  it, the GM's tools wrap under the banners (the title hides), the map's toolbar sits above the sheet, and the GM's
  sheet / stat block are full screen too.
- The pure pieces are in `hud/phone/model.ts` (`miniBars`, `resourceItems`, `edgePlace`, `stackChips`, `edgeText`,
  `edgeTone`).

## Board states matched (shots: `test-results/visual/HUD-H7.2/`, `E2E_VISUAL=1`)

| Board state | Shot | Spec |
| --- | --- | --- |
| PlayerPhone, the sheet folded (map reachable) | `player-main.png`, `player-sheet-folded.png` | `hud-phone.spec.ts` |
| PlayerPhone 'Hand tab' (390 × 844) | `player-hand-tab.png` | `hud-phone.spec.ts` |
| Attack / Dice / Feed tabs | `player-attack-tab.png`, `player-dice-tab.png`, `player-feed-tab.png` | `hud-phone.spec.ts` |
| PlayerPhone 'Sheet, full screen' | `player-sheet-full-screen.png` | `hud-phone.spec.ts` |
| PlayerPhone 'Picking a target' edge chips (zoomed in) | `player-picking-edge-chips.png` | `hud-phone.spec.ts` |
| GM at 390: tablet layout, queue folded / open | `gm-queue-folded.png`, `gm-queue-open.png` | `hud-phone.spec.ts` |

Board render to compare: `reference/designs/combat-hud/preview/PlayerPhone.dc.html` (1800 × 940, four frames) and
`GMTablet.dc.html`. Sample content (Moss / Brannoc / Vex / Oriel, Fear 5, "Sniper · Very Far · GM →") comes from the
e2e seed's real data. The picker as a bottom sheet ('Picking a target') and 'You're hit' are H7.3's.

## Out-of-owns edits (minimal; for the orchestrator)

- `src/components/combat-map/hud/shell.tsx` (the mount): `usePhoneHud()`; a player at phone width gets
  `<Region name="phone"><HudPhone /></Region>` in place of the banners, scene and Fear regions, and no feed or hand
  region; the shell's toolbar (Map tools, switch) is built once and passed to both; the left column is wrapped in
  `PhoneQueueSheet` (a pass-through except for the GM at phone width); the root gets `hud-ph-on` for the player phone.
  Desktop and tablet render exactly as before.
- `tests/unit/hud/phone.test.ts` (new): unit tests of `hud/phone/model.ts`.

`shell.css` is untouched (H7.1's this wave); every phone rule is in `responsive/phone.css`, imported by `hud/phone`.

## Merge notes (H7.1, H7.3)

- H7.1's tablet rules (`responsive/tablet.css`) will also apply at 390 if they are `max-width: 1180px` queries. The
  GM's phone fit in phone.css is scoped to `@media (max-width: 760px)` and `.hud-root[data-role="gm"]`; rerun
  `hud-phone.spec.ts` after merging H7.1 and drop any of these rules H7.1 makes redundant.
- H7.3's bottom sheets: the phone sheet already steps aside for `.hud-pk-open` and for `.hud-hit`, `.hud-res`,
  `.hud-death-sheet` in the pop region, and the edge chips treat the picking panel as a cover when it touches the
  bottom edge. The rings' band labels draw over the (still anchored) picking panel at 390 today; H7.3's sheet should
  sit above the map layers.

## QUESTIONS (defaults taken, reversible)

1. **The bottom sheet starts folded** (resource line + tabs, ~190 px), not on the Hand tab as the 'Hand tab' frame
   shows. Open, the hand covers the lower 60 % of the screen and with it your token at the default zoom, so the map
   and the action ring stay reachable until a tab is tapped. Start open instead?
2. **Edge chips only point.** The board does not say what tapping one does; the rows in the picking panel already
   pick. Should a tap pan the map to the creature, or pick it?
3. **GM at 390.** "Tablet layout" cannot fit four 108 px banners and the Fear banner in 390 px, so the banners hang at
   55 %, the title hides and the GM's tools wrap under the banners. The spotlight panel joins the queue's bottom sheet
   (under Resolutions). The GM's sheet / stat block are full screen as the player's. Keep, or another arrangement?
4. **The day / time disc and the spotlight tag** are not on the player's strip (the board has neither). The spotlight
   card still shows in the pop region. Add them?
5. **The action ring's Cast** raises the hand through the DOM (`raiseHand`, H3.4). On the phone the hand lives in the
   Hand tab, so Cast does nothing while the sheet is folded or on another tab. Follow-up dcm-bxp.99.32.20 (a
   `raiseHand()` export from hud/hand) should open the Hand tab on the phone too.

## Tests

- `tests/unit/hud/phone.test.ts`: bars, the resource line (answer 2 wording, no Armor without a score), chip
  placement (on screen → none, sides, arrows, clamping), stacking, chip words and tones.
- `tests/e2e/hud-phone.spec.ts` (390 × 844):
  - Player: the strip (4 PC buttons, yours first, Fear read only, 390 × 104), no desktop banners / hand / Fear
    regions; the folded sheet with the resource labels and tabs, axe; Hand opens a row of 140 px cards inside the
    sheet with Roll options, axe; arrow keys, Attack / Dice / Feed, fold and unfold; Sheet full screen (0, 390 wide,
    44 px close, strip and sheet hidden), axe; an ally's banner opens their sheet, Esc closes; Use Vicious Entangle
    hides the sheet, zoomed in the Sniper's chip reads "<Sniper> · Very Far · GM →", axe; Cancel brings the sheet back.
  - GM: no phone strip, the tablet banners; the queue sheet full width on the bottom edge, folded with the heading
    and count, axe; unfolded with Resolutions, axe.
- `tests/e2e/visual/HUD-H7.2.spec.ts`: the shots above.

## Checks

- **`pnpm lint`**: clean.
- **`pnpm typecheck`**: clean.
- **vitest** (`--maxWorkers=2 --testTimeout=120000`): 477 files, 10587 passed, 1 expected fail.
- **`tests/e2e/hud-phone.spec.ts`**: 2 / 2 passed, with axe at 390 for the player (folded, Hand tab, full-screen
  sheet, picking) and for the GM (queue folded and open).
- **`tests/e2e/visual/HUD-H7.2.spec.ts`** (`E2E_VISUAL=1`): passed; shots in `test-results/visual/HUD-H7.2/`.
- **Every desktop `hud-*.spec.ts`**: 36 / 37 passed. `hud-result.spec.ts` 'a cast card's result' (1440) fails twice
  the same way: the damage line reads "1d8+9 → n physical" against the spec's `/^1d8\+1( \+8 critical)?/`. H7.2
  renders nothing different at 1440, and the failure is about the damage formula, not the layout. Filed
  **dcm-bxp.99.32.33**. The same file's 390 px attack-result test passes with the phone shell.
- `node scripts/tracer-guard.mjs .omc/plans/combat-hud.yaml H7.2 rebuild HEAD`: flags `shell.tsx` and
  `tests/unit/hud/phone.test.ts` (listed above).

## User answers 2026-11-02 (applied)

- **Edge chips pan** (QUESTIONS: chips only point). A tap on a chip pans the map so the target sits in the middle
  of the visible map (above the bottom sheet, under the strip) by scrolling the map viewport, the same scroll pan the
  map's drag uses (`panTo` in phone/edges.tsx); the player then taps its ring to pick. The chip is a button whose name
  is its text. `hud-phone.spec.ts` taps the Sniper's chip and checks its ring comes into view.
