# TASK-HUD-H1.1: party banners with the Hope seal

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 2, tracer H1.1 (boards Main, CmpTokens, GMDesktop). Briefs:
`.omc/plans/combat-hud-briefs.md` (Wave 2 / H1.1, user answers 2026-11-01). Depends on H0 (shell, primitives,
HudProvider) and HD1 (`combatHud.party`). Bead: dcm-bxp.99.32.

## What landed

All in `src/components/combat-map/hud/banners/` (renders only with the HUD switch on, inside H0's banners region):

- `index.tsx` `HudBanners` (H0's stub export and props kept): one `combatHud.party` subscription for the map on screen
  (`{ campaignId, mapId }`; skipped without a map), `role="status"` "Loading the party…" while `undefined`, nothing for
  an empty party. The caller's own banner first (Main: "You" at x = 24), the rest in map order. The list is
  `<ul aria-label="The party">`. The shell's PartBoundary wraps it (CL1).
- `banner.tsx` `Banner`: a real `<button>` (hard rule 4), accessible name `Open <name>'s sheet`, accessible
  description (`aria-describedby`, screen-reader text) `Moss, 2 of 6 Hit Points marked, 3 of 6 Stress marked, 1 of 3
  Armor Slots marked, Hope 1 of 6, Hidden` (+ "death move due" / "every Hit Point marked"). Content as on the board:
  portrait ring (next/image, CL10: design art optimised, uploads `unoptimized`; initial when none; teal ring, gold with
  glow for yours), name (Cinzel, gold for yours), class + the spotlight slot, HP / Stress / Armor pips (H0's `Pips`,
  each `role="img"` labelled "n of m … marked"), conditions under the pips with the board's icons (Hidden, Vulnerable,
  Restrained; a dot for others), and the Hope seal at the tip (H0's `Seal`, labelled "Hope n of m", grey at 0).
  - HP pips show HP left (answer 2); Armor pips show the slots left, as the boards draw them (Main's hit window
    "Armor 2 → 1" with Moss's banner showing 2 of 3 lit); Stress pips show Stress marked. Every text says marked.
  - Last Hit Point (`down`): `hbn-down` greys the portrait; the HP pips are all marked, so none is lit (CmpTokens
    'Last Hit Point').
  - Geometry (Main / CmpTokens CSS): 146 px wide, hung every 158 px from x = 24 (24, 182, 340, 498), top 8; yours
    270 px tall with the gold trim, allies 238 px; the rod from 12 px left of the first to 18 px past the last (650 px
    for four). Hover drops 4 px, the open character's banner drops 8 px and its trim lights (`hbn-open`,
    `data-open`); focus-visible lights the trim. Motion uses `--hud-t-banner` (0 under reduced motion).
  - Tablet (≤ 1180 px): 108 px wide every 116 px (HANDOFF "Tablet"); H7.x owns the tablet / phone layouts.
- `classic-sheet.tsx` `ClassicSheetBridge` (interim, until H2.1): a banner calls `useHud().toggleSheet({ kind: "pc" })`
  (same banner again closes, another swaps); while HudProvider has a PC sheet open, the classic `SheetDrawer` (modal
  `<dialog>`) shows it; ✕ / Esc / backdrop call `closeSheet`, and the native dialog returns focus to the banner. Kept
  mounted after the first open, like the page's drawer; the subject is derived during render, no effect.
- `icons.tsx`: the CmpTokens 'Icons' glyphs the banner uses. `banners.css`: the banner styles above, plus the
  `.hud-root.sh-open` guard (see "Data gaps / bugs found").
- Spotlight: `SpotlightSlot` in `index.tsx`, a stub that renders nothing, with the props of H1.S's in-progress
  `SpotlightBannerTag({ campaignId, characterId })`. The class line reads exactly "Druid" until H1.S lands.

## Board states matched (shots: `E2E_VISUAL=1 … pnpm test:e2e tests/e2e/visual/HUD-H1.1.spec.ts`)

Shots in `test-results/visual/HUD-H1.1/` on the e2e seed's real party (Moss Druid is the player's; Brannoc Warrior,
Vex Rogue, Oriel Seraph), set to the boards' numbers where the seed allows (Moss 2 HP / 3 Stress marked, Hope 1;
Brannoc Hope 3; Vex Hidden; Oriel every HP marked). Board renders for comparison: `preview/Main.dc.html` (1440 × 900,
crop 700 × 320 at 0, 0), `preview/CmpTokens.dc.html` ('Banners' row), `preview/GMDesktop.dc.html`.

| Board state | Shot | Matches |
|---|---|---|
| Main's row (You + 3 allies) / CmpTokens 'You', 'Ally' | `player-banners-1440.png`, `player-main-1440.png` | x 24 / 182 / 340 / 498, 270 / 238 px, gold trim and ring on yours, pips, seal |
| CmpTokens 'With a condition' | Vex in the same shots | "Hidden" with the eye-slash glyph under the pips |
| CmpTokens 'Last Hit Point' | Oriel in the same shots | portrait greyed, no HP pip lit |
| Open banner drops 8 px | `player-open-moss-1440.png` | Moss down 8 px, light trim; the classic drawer on the right until H2.1 |
| GMDesktop row | `gm-banners-1440.png`, `gm-main-1440.png` | same four banners, none gold (the GM owns no PC: `mine` is false) |
| Tablet look | `player-main-1024.png` | 108 px banners (H7.x refines; the H0 scene toolbar centred at 1024 overlaps the 4th banner) |

Differences from the boards, on purpose: sample art and numbers are the seed's (Oriel's 7 HP and the allies' Armor
come from their sheets); "Spotlight" after the class appears only once H1.S is merged; the boards' CmpTokens 'Last Hit
Point' draws Oriel's pips as marked (pre-answer-2), the HUD shows HP left (none). The board writes the label with a
typographic apostrophe ("Moss’s"); the acceptance's `Open <name>'s sheet` (straight) is used.

## What moved out of the old column

Nothing: the classic column (in H0's drawer) keeps every tracker and the Sheet button. The banners add a second way to
open the sheet.

## Tests

- `tests/unit/hud/banners.test.tsx` (8): loading line / no map / empty party; one button per PC, yours first, order
  and `--hbn-i` positions, rod count; HP-left pips with marked labels and description (answer 2), Stress / Armor pips,
  the seal; conditions, Last Hit Point (`hbn-down`, no HP pip, "death move due"); seal grey at 0 and the empty spotlight
  slot ("Druid" exactly); opening through HudProvider into the (mocked) classic drawer: swap, same again closes, ✕
  closes; the GM's row; `bannerSummary`.
- `tests/e2e/hud-banners.spec.ts` (1, live two-browser): the player's row at 1440 × 900 (x 24 / 182 / 340 / 498, width
  146, heights 270 / 238, top 8, yours first and gold), the GM's four banners with none gold, axe on both, the banner
  opens the drawer and drops 8 px (and the HUD keeps its frame), axe with it open; player → GM: the player marks 2 HP in
  the drawer and the GM's Moss banner says "2 of n Hit Points marked" with 2 fewer pips lit; Esc closes and focus
  returns to the banner; GM → player: Brannoc gains a Hope and turns Vulnerable, the player's banner seal and text
  follow.
- `tests/e2e/visual/HUD-H1.1.spec.ts` (@visual): the shots above.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean. `node scripts/tracer-guard.mjs .omc/plans/combat-hud.yaml H1.1 rebuild
  HEAD`: OK.
- vitest: `tests/unit/hud/banners.test.tsx` 8 / 8; full suite `--maxWorkers=1 --testTimeout=120000`: 446 / 446 files,
  10158 passed + 1 expected fail.
- e2e (ports 3193 / 3498): `hud-banners.spec.ts` and `visual/HUD-H1.1.spec.ts` pass.

## Beads

- Filed **dcm-bxp.99.32.11** (bug, `lane:own-plan`): `hudRootClasses()` puts `sh-open` on `.hud-root`, and
  `party/sheet-ui/sheet-ui.css` styles a global `.sh-open` as a green pill button (border-radius 999px, inline-flex):
  the first sheet opened from a banner turned the whole HUD into a circle. `banners.css` guards it
  (`.hud-root.sh-open` reset); the fix belongs in `hud/state.tsx` / `shell.css` (rename the root classes) or
  `sheet-ui.css` (scope the button), after which the guard goes.
- None closed.

## Data gaps found

None for the banners: `combatHud.party` carries everything the board shows.

## QUESTIONS

1. Armor pips. The boards light the slots left (Main's hit window "Armor 2 → 1", Moss's banner 2 of 3 lit); answer 2
   only speaks of HP. Built: Armor pips show slots left like HP, text says marked ("1 of 3 Armor Slots marked").
   Should the Armor pips (a) show slots left (built, as the boards), or (b) show slots marked, like Stress?
2. Banner menu for the GM's spotlight hand-back. H1.S's acceptance says "the GM hands back from a banner's menu or the
   Fear banner", and its in-progress `SpotlightHandBack` says "H1.1: the banner menu's hand-back button". H1.1's
   acceptance has no menu: a banner is one button that opens the sheet. Built: no menu. Should the GM's banner
   (a) stay one button (hand-back from the Fear banner / H1.S's menu only; built), or (b) get a small menu button
   beside it ("Give Moss the spotlight") in a later tracer?
3. Players opening an ally's banner before H2.1 / HD2: the classic drawer's `combatFeatures.drawer` refuses other
   players' characters unless hands are shared, so the drawer shows its error line. Accepted as interim (H2.1 brings
   the view-only sheet, answer 4a)?

## Merge-time actions

- No Convex, schema or authz change; no codegen.
- After H1.S merges: in `hud/banners/index.tsx` replace the `SpotlightSlot` stub with H1.S's banner tag
  (`import { SpotlightBannerTag } from "../spotlight"`, same props `{ campaignId, characterId }`), and extend the unit
  test's "empty spotlight slot" case to the tag's states. If H1.S renames the export, adapt the import only.
- H2.1 (sheet panel) must remove `hud/banners/classic-sheet.tsx` and its mount in `index.tsx` when `HudSheet` reads
  `useHud().sheet`, else both open. H2.1 does not own `banners/**`: add the two edits to H2.1's owns or do them at its
  merge.
- When dcm-bxp.99.32.11 is fixed, drop the `.hud-root.sh-open` guard from `banners.css`.
- H1.3 also labels PC tokens `Open <name>'s sheet`; the banner specs scope to the `The party` list, so they stay unique.
