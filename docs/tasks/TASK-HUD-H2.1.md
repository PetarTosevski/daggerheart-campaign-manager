# TASK-HUD-H2.1: The sheet panel (own / view only / GM edit)

Status: Review. Plan: `.omc/plans/combat-hud.yaml`, tracer H2.1 (wave 3, batch B). Briefs: `.omc/plans/combat-hud-briefs.md`
("Wave 3 / H2.1", "User answers 2026-11-01": 2, 4a, 5a, 16a). Boards: Main 'D · Sheet at hand' (Moss own, Brannoc view
only), GMDesktop (Vex, GM edit), CmpTokens. Depends on HD2 (`combatHud.sheet`), H0 (`SidePanel`, primitives), H1.1
(banners), H1.3 (tokens call `toggleSheet`), H1.S (spotlight), H2.2 (make room). Beads: dcm-bxp.99.32.15 (fixed here).

## What landed

All of it renders only with the HUD switch on; the classic page and its drawer are untouched.

- `hud/sheet/index.tsx` `HudSheet`: reads `useHud().sheet`; a PC target mounts `SheetPanel`, an adversary is H5.2's.
- `hud/sheet/panel.tsx` `SheetPanel` on H0's `SidePanel`: a non-modal `<aside>` named "<name>’s sheet" (400 px, right
  0; tablet 340), Esc and ✕ close it, focus goes to its heading once the sheet has loaded and back to the opener (banner
  or token) on close; swapping to another sheet keeps focus where it is. Map, banners and tokens stay usable beside it.
  - Header: portrait (the banners' `Portrait`, from the same `combatHud.party` subscription), name, "Druid · Level 3",
    the badge: **Spotlight** (own sheet while that PC holds the spotlight, `combatSpotlight.state`), **View only**,
    **GM edit**. For the GM, the **Play for this character** switch is in the header (answer 5a; `usePlayFor`, the
    one server-stored switch the classic hand and drawer share).
  - Evasion / Armor / Level tiles (`StatTile`).
  - Trackers HP / Stress / Hope / Armor: pips (HP and Armor show what is left, Stress marked, Hope held, as the
    banners) and the number reading "n of 6 marked" (Hope "n of 6"; answer 2). Own and GM: − / + buttons ("Mark 1 Hit
    Point", "Clear 1 Stress", "Gain 1 Hope"...), each one `characters.adjustResource` intent with an optimistic update
    of `combatHud.sheet` and every cached `combatHud.party` (banners and token rings move at once).
  - The note: view "Only Brannoc’s player and the GM can use or change this sheet."; GM "You’re the GM: you can change
    any value on this sheet." (+ "Turn on Play for this character to use features and cards." while off).
  - Own sheet: **Hide my hand from other players** (`combatCards.setHandHidden`, optimistic on `handSharing`; answer
    16a). Disabled with a note while the GM's campaign switch keeps every hand hidden.
  - Features (`combatHud.sheet.features`): name, text, cost / limit / uses left / tokens or "Used · <reset>"; right:
    **Use** / **React** (own; GM "Use for Vex", disabled until Play for is on), the D5 Use of out-of-combat features
    (Get In & Get Out, Commune: classic `D5Use`), a locked cost pill in view mode, else the kind badge (`auto` reads
    "Passive", HD2 question 2). Use opens the classic `FeatureUse` flow inside the panel (until H3.3).
  - The classic drawer prompts (`DrawerPrompts`, Cannonball ally rolls) render inside the panel for own / GM (from
    `combatFeatures.drawer`; never queried in view mode, where it is refused for a hidden hand).
  - Damage thresholds (Minor 1 HP / Major n+ 2 HP / Severe n+ 3 HP), Experiences, Conditions & lasting effects
    (condition, source, until; effects with source, text, until; "None right now."). Own and GM: one switch per
    condition (`characters.toggleCondition`, optimistic on the sheet and the banners).
  - Loading: `role="status"` lines; the prompts and hand sharing sit in their own `PartBoundary`s.
- `hud/sheet/model.ts`: rights per mode, badge, tracker text / pips / step labels, the optimistic updaters, kind
  labels, feature notes, the read-only notes.
- `hud/sheet/sheet.css`: the boards' `.sheet` content styles on the `--hud-*` tokens.
- Banners: `hud/banners/classic-sheet.tsx` and its mount deleted, so a banner opens only the HUD panel; the
  `.hbn-sheet` rule and the dead `.hud-root.sh-open` reset removed from `banners.css`; `Portrait` exported (with
  `className` / `sizes`) for the panel.

## Board states matched

| Board state | Where |
|---|---|
| Main, Moss's sheet (own, Spotlight badge, steppers) | `hud-sheet.spec.ts` test 1; shot `main-own-moss-*.png` |
| Main, Brannoc's sheet (View only, note, locked cost, Reaction / Passive badges, no steppers) | test 1 (from a token click); shot `main-view-brannoc-*.png` |
| GMDesktop, Vex's sheet (GM edit, note, Use for Vex, Hidden with its until) | test 2; shot `gm-edit-vex-*.png` |
| HANDOFF "another banner or token swaps; the same one or ✕ closes" | tests 1 and 2, unit tests |
| Tablet 1024 (340 px panel) | shot `main-own-moss-1024.png` |

Shots: `E2E_VISUAL=1` `tests/e2e/visual/HUD-H2.1.spec.ts` → `test-results/visual/HUD-H2.1/`; board renders:
`reference/designs/combat-hud/preview/{Main,GMDesktop}.dc.html` (click a banner).

## Tests

- `tests/unit/hud/sheet-panel.test.tsx` (11): own (aside, no dialog, heading focus, badge, tiles, "n of 6 marked",
  stepper intents and the optimistic updater incl. Stress overflow into HP and the banner rows, hide my hand, Use opens
  the classic flow in the panel, prompts, disabled hand switch, loading), view only (nothing editable, no drawer or
  hand-sharing query, Esc → focus back), GM edit (switch in the header gates Use and prompts, trackers and conditions
  always), model.
- `tests/unit/hud/banners.test.tsx`: the classic-drawer mock and its test replaced by "a banner opens the sheet through
  HudProvider; no dialog, no classic drawer".
- `tests/e2e/hud-sheet.spec.ts` (2): player and GM, see above, axe with the panel open.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest `--maxWorkers=1 --testTimeout=120000`: focused `tests/unit/hud` 8 files / 94 tests pass (sheet-panel 11,
  banners 8); full suite 452 / 452 files, 10 228 tests pass, 1 expected fail.
- e2e (ports 3167 / 3446, servers started by hand, `E2E_REUSE_SERVERS=1`; host under load 5-10, earlier runs hit
  Convex "Function execution timed out (1s)" while seeding and sign-in timeouts): `hud-sheet` 2 / 2, `hud-banners` 1 / 1,
  `hud-make-room` 2 / 2, `hud-tokens` 2 / 2 (dcm-bxp.99.32.15 fixed: the GM test, which the modal drawer broke, passes;
  once on a retry after a seeding timeout), `hud-shell` 2 / 2 (on a rerun after seeding timeouts).
- Visual (`E2E_VISUAL=1`): `HUD-H2.1` 1 / 1 (7 shots), `HUD-H1.1` 1 / 1 (on a retry after a sign-in timeout).
- `node scripts/tracer-guard.mjs .omc/plans/combat-hud.yaml H2.1 rebuild HEAD`: run before the commit; the three spec
  edits below are the only files outside owns.
- Found while testing: H0's `.hud-panel` has `max-width: 100%`, and the panel region has no width, so the aside's own
  box was 0 px wide (content overflowing; Playwright and axe saw it hidden). `sheet.css` caps `.hud-panel.hsh` by
  `100vw` instead; H5.2's stat block will need the same (or H0's rule fixed: `ui/ui.css`, not in my owns).

## Deviations (out-of-owns edits)

Forced by deleting the classic bridge (acceptance line 5), which these specs opened:

- `tests/e2e/hud-banners.spec.ts`: the opened sheet is the panel (`getByRole("complementary", { name: "Moss’s sheet" })`)
  instead of `getByTestId("sheet-drawer")`; comments. Its steps (Mark 1 Hit Point ×2, Esc, focus back) are unchanged.
- `tests/e2e/hud-make-room.spec.ts`: `sheet-drawer` → `hud-sheet-trackers` / `hud-sheet`; a comment.
- `tests/e2e/visual/HUD-H1.1.spec.ts`: `sheet-drawer-trackers` → `hud-sheet-trackers`; comments.

## Beads

- dcm-bxp.99.32.15 (hud-tokens vs the classic modal drawer): fixed by design (the panel is not modal); left open for
  the orchestrator to close at merge.
- dcm-bxp.99.32.11: H2.2 fixed it; the dead `.hud-root.sh-open` reset is now removed here (close at merge, as H2.2 asks).

## Not moved (still in the classic drawer, reachable from the left Map tools / Your character drawer)

Class counters and held dice, the Martial Artist's stances, Beastform "Drop out", the Flying toggle, the "Full sheet"
link. None is on the boards' panel; a later tracer (or H3.3) can fold them in.

## QUESTIONS

1. Sheet pips: HP and Armor pips show what is left (as the banners and rings, answer 2), the numbers read marked. The
   board's sheet lights 4 HP pips for "4". Built: left, like the banners. Reversible in `pipsOn`.
2. Conditions are switchable on your own sheet too (the server allows the owner; the classic token card did). Answer
   5a names only the GM. Reversible: `sheetRights("own").edit` gates trackers and conditions together; split it to
   make conditions GM-only.
3. Own sheet badge when you do not hold the spotlight: none (the board shows only "Spotlight").
4. Lasting effects have no End button (HD2 gives `id` for one): not in the acceptance; no generic end-effect mutation
   is wired for the HUD yet.

## Merge-time actions

- None for Convex (no Convex change, no codegen).
- Close dcm-bxp.99.32.15 and dcm-bxp.99.32.11.
