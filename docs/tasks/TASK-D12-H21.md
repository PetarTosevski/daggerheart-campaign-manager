# TASK-D12-H21: Accessibility and tablet pass - party, sheet, codex, world and adversaries

Plan `.omc/plans/d12-hardening.yaml`, tracer H21 (wave 3, depends on H1 and H4). Bar from the user's answers of
2026-10-21 (Q6, Q7): zero serious or critical axe findings (WCAG 2.2 AA tags) on every page and dialog, as the GM and
as the player where the player can open it; at 768x1024 and 1024x768 no sideways scroll, the campaign menu and the
page's main action visible, primary controls at least 44 px. Moderate and minor findings are listed, not fixed.

## Spec: tests/e2e/a11y-party.spec.ts

One `gmAndPlayer` table per worker (characterA belongs to the player), plus through the GM's client: a known Codex
character "Mira Thornwake" with one revealed image, an encounter "Den of the bear" with one bear, and
`levelUp.partyLevelUp` so both roles get the level-up ribbon. Each test scans every state and fails once at the end
with the full list of findings, so one run shows all of them.

| Test | Scanned (role) |
|---|---|
| GM: roster and wizard | roster; all nine wizard steps (step 1 empty and with a class, then 2-9 filled) (GM) |
| GM: sheet, dice, level-up | Character Sheet, Story & Advancement, Domains; the dice box after a roll; the roster with a level-up pending; the level-up ribbon on Experiences and on the tier boxes (GM) |
| player: sheet, dice, level-up | roster; the wizard's "one active character" block; the three sheet pages; the dice box after a roll; the level-up ribbon (player) |
| Codex | entry detail and the image lightbox (GM and player); the GM's player-view preview |
| World | map; a marker selected; the route panel; the Travel speeds dialog (GM); the map with the GM's marker (player) |
| Adversaries | catalogue; encounter builder; the tracker running; environment (GM); the "Only the GM" refusal (player) |
| tablet 768x1024, 1024x768 | roster, wizard, sheet (player), codex (GM and player), world (GM and player), adversaries: `expectFitsViewport`, "Campaign sections" nav visible, the main action in view after scrolling down only, main action and the listed controls at least 44 px, full-page screenshot |

Excluded with a reason: `[data-testid="dice-3d"]`, the WebGL dice canvas (no DOM to check; its values are in the
Last roll list).

Main action / 44 px controls per route: roster "Party levels up"; wizard "Next: …" / "Create character"; sheet the
dice "Roll" button plus the sheet tabs; codex "+ New character" plus every entry button (player: the entry button);
world "Measure" plus Zoom in/out, Fit, Terrain, Player view; adversaries the Encounters tab plus every view tab.

Screenshots: `test-results/visual/D12-H21/<route>-<w>x<h>.png` (16 files, no pixel diffs).

## Findings fixed (all serious)

| Rule | Where | Fix |
|---|---|---|
| color-contrast | Sheet and level-up labels (`.sh-lbl`, `--sheet-label` #8a6d4a, 3.77:1 on #efe3c8) | `--sheet-label` and its fallbacks to #6d563a (5.4:1) in `sheet.css`, `sheet-ui.css`, `level-up.css`, `level-up-ribbon.css`, `dice.css`, `features.css`, `lunar.css` |
| color-contrast | Wizard labels and legends `.wz-lbl` (#8a6d4a), hints `.wz-hint` and the "(optional…)" note (#8a6d3b) | #6d563a / #6e572f |
| color-contrast | Wizard traits: values already used (`.wz-mod.full`, opacity .4, 2.2:1) and the assigned pool chips (`.wz-pool.used`, #b9a27a, 1.9:1) | opacity .72 (hover .9); #70624a, still dashed and struck through |
| color-contrast | Wizard domain cards: the Choose button on Blade/Valor colours (#f6ead2 on #c45a14, 3.7:1), and the whole card at opacity .5 once two are chosen | button background is the domain colour mixed 75% with black (passes on all ten domains); a full card dims only its header and art, its text stays readable, its button is disabled |
| color-contrast | Locked advancement tiers (opacity .6, the wine intro 3.4:1) and the "No advancements yet" pill (#8a6d3b, 3.2:1) | locked tier opacity .8; pill text #5a4526 |
| color-contrast | Dice outcome "with Hope" (#9a6b10, 4.3:1) and "critical" (#8a6a00, 4.0:1 on the paper) | #855d0d / #7d6000 |
| color-contrast | Encounter "▶ Start encounter" pill (white on #4f9e72, 3.2:1) | `--enc-start` #40815d |
| nested-interactive | Codex image tile: a `div role="button"` holding the GM's Reveal / main picture / delete buttons | the tile is a plain container; a transparent `<button class="cx-thumb-open">` covers it and the tools sit above it as siblings; the focus ring moved to the tile via `:has()` |
| target-size | Roster "Assign … to" select squeezed to 18 px wide on the card | its label keeps `min-w-[10rem]`, so it wraps to its own row |

Tablet fixes (44 px): the dice box controls (Roll, steppers, chips, toggles, segment options) and the world map
toolbar (`.zbtn`) grow from 40 to 44 px under `@media (max-width:1100px),(pointer:coarse)`; desktop keeps the boards'
40 px. Nothing needed changing for sideways scroll: all routes fit both sizes.

## Findings listed, not fixed

- Moderate and minor axe findings (WCAG tags): none on any scanned page or dialog.
- dcm-o95 (`--faint` contrast, H20): not hit on these pages.
- Nothing for H20 in `src/components/brand/**` or `ui/**`.
- At 768 px the campaign nav wraps to two rows and the sheet's level-up ribbon pushes the sheet down; the main
  actions stay reachable by scrolling down only (screenshots for review).

## Verification

Backend and `scripts/e2e-next.mjs` started by hand on E2E_PORT 3156 / E2E_CONVEX_PORT 3424, `E2E_REUSE_SERVERS=1`:

- `playwright test tests/e2e/a11y-party.spec.ts`: 8 passed (1.1 min), then 8 passed again (1.5 min).
- party-roster, character-sheet, character-wizard, level-up, dice, dice-3d, codex, world, adversaries,
  encounter-tracker, encounter-builder, live-party, live-world: 35 passed (3.3 min).
- `pnpm lint`, `pnpm typecheck`, `pnpm test --maxWorkers=4 --testTimeout=60000` pass;
  `pnpm tracer:guard .omc/plans/d12-hardening.yaml H21` passes.
