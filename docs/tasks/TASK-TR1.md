# TASK-TR1: Tracker look (thresholds, player-style pips, Fear tokens, 3D dice)

Status: Review. Plan: `.omc/plans/adversary-art.yaml`, tracer TR1. Builds on the D8 A4 tracker (`docs/tasks/TASK-D8-A4.md`).

## Goal
User 2026-10-18, from a screenshot of a running encounter: "add thresholds on encounter tab, also change their hp & stress icons to match
the players, also make the fear slider use tokens" and "also add the 3d dice rolls here". The screenshot showed square HP boxes, round
Stress circles, a row of small purple Fear circles in the top bar, no thresholds on the cards and rolls without 3D dice.

## What changed (`src/components/adversaries/tracker/`)
- **Thresholds** (`instance-card.tsx`): beside Difficulty, "Thresholds 9 / 17" from the instance's stored `stats.major` / `stats.severe`
  (`data-testid="thresholds"`). A block with neither shows "Minion" for a Minion (CB p.201: any damage defeats one) and "none" otherwise;
  one missing value reads "none" ("9 / none"). Numbers in the board's heading font, labels muted (`--adv-*` tokens).
- **HP / Stress pips**: sheet-ui's `Pip` with kind `heart` (HP) and `diamond` (Stress), so the art and the marked / unmarked states are
  the player sheet's (`sheet-ui.css`, imported through the component). They stay buttons with the same names ("Mark Hit Point k of n",
  "Mark Stress k of n", `aria-pressed`). The sheet draws them for parchment (a dark-red heart, a slate diamond), so the tracker sets each
  track on a parchment strip (`--adv-parch`); on the dark card they would vanish. Hit area: 32 x 44 px (44 px wide would wrap a 7-HP track
  at 390, as A4 noted); hearts 26 x 24 and diamonds 18 x 18 inside it.
- **Fear tokens** (`top-bar.tsx`, `tracker.css`): 12 tokens of the dashboard's art, lit (`daaa0236….png`) up to the campaign's Fear and
  unlit (`735d085e….png`) after, with the same drop-shadow glow as `.fz-on` / `.fz-off` in `dashboard.css` (copied as `.trk-token-on` /
  `-off`; the dashboard stylesheet is route CSS and not imported). Read-only: "Spend Fear" stays the way to lower it. The count beside it
  and the label "GM Fear N of 12" are unchanged.
- **3D dice** (`selected-block.tsx`): Roll attack, Roll damage and Critical damage call `play3d` into a stage under the roll result
  (`data-testid="tracker-dice-stage"`) after the server answered, exactly like the dashboard's GM roll form: `canAnimate3d(settings)` (the
  per-device 3D toggle and reduced motion), falling back to `playRollSound()` when 3D does not show and sound is on. The text result shows
  at once; the dice animate beside it. The canvas stays until the next roll or until another instance is selected.

## Verification
- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 122 files, 1328 tests passed (encounter-damage.test.ts: 19, 2 new for
  thresholds incl. Minion / "none" and the heart / diamond pips).
- e2e (`tests/e2e/encounter-tracker.spec.ts`, swiftshader WebGL like `dice-3d.spec.ts`): 3 passed: 12 tokens with 3 lit, "Thresholds
  9 / 17", heart / diamond pips, the 3D canvas in the tracker's stage landing on the server's d20; 390 px no horizontal scroll and every
  button at least 44 px high; with reduced motion Roll damage shows no canvas.
- Visual (`tests/e2e/visual/A4.spec.ts`, `E2E_VISUAL=1`): passed; now also asserts 5 lit tokens and thresholds on a Bear and the Minion
  group. Shots in `test-results/visual/A4/`: `top-bar`, `card-fresh`, `card-damaged`, `card-defeated`, `minion-group`, `statblock`,
  `page`, each `-1440.png` and `-390.png`.
