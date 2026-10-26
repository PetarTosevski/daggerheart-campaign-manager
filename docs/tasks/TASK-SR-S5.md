# TASK-SR-S5: Dice box in the board's dice toolbar format

Status: Review. Plan: `.omc/plans/sheet-redesign.yaml`, tracer S5 (wave 2). Analysis: `.omc/autopilot/sheet-redesign-analysis.md` §5.

## What changed

- **Box (`src/components/party/dice/dice-box.tsx`):** a `SheetBox` named "Dice" with the board's layout:
  - **Toolbar** (one wrapping row): "🎲 Dice" heading, the `Roll type` radiogroup as a dk-tabs-style segmented control (Action · Reaction · Damage), then the fields of the mode:
    - Action / Reaction: Trait ("Agility +0"), Mod, Difficulty, the board's Adv / Dis `− Normal +` stepper and the gold-to-purple "Roll Hope & Fear" pill.
    - Damage: Damage source (plus Dice count and Die for "Other dice"), Mod, a "Critical hit?" toggle and the wine "⚔ Roll damage" pill.
    - At the right: a "3D dice: on/off" pill, a speaker toggle (named "Dice sound") and "GM Fear N" (from `campaigns.get`).
  - **Roll options** (`<details>`, open by default): board chips around real checkboxes for Experiences (1 Hope each), Attack roll, Ikonis attack, Features, Enter physical dice; the Help dice stepper; the physical dice fields; the Tag Team launcher and panel.
  - **Result row:** "The dice are rolling…" while the server or the 3D dice work, then the `Last roll` region: die tiles (54 px gold Hope and purple Fear dice, ringed when they decided the roll; smaller tiles for advantage, help, extra and damage dice), a 30 px total, the coloured outcome ("Success with Hope", "With Fear" without a Difficulty, "Critical success", "Damage"), the roll's label and parts ("Presence +2 action roll vs 12 (9 + 1 + 2)") and an italic consequence line from `dualityEffects`. Roll prompts stay inside it. An "Earlier" list keeps the previous five rolls of this visit.
- **Parts (`parts.tsx`):** new `AdvantageStepper`, `DiceTiles` and `BoardDiceToggles`; `CountStepper` is restyled. `DiceFaces`, `DiceSettingsToggles` and `rollHeadline` are unchanged, so the dashboard roll feed (`roll-feed.tsx`) looks the same.
- **Tag Team (`tag-team.tsx`):** board classes (`sh-pill`, `sh-lbl`, `dc-in`) and die tiles; behaviour unchanged.
- **Styles:** `dice.css` (`dc-*`), imported by dice-box.tsx. At ≤ 640 px the toolbar stacks (segmented control and Trait full width, Mod | Difficulty, stepper, full-width pill) and every control is at least 44 px.

## Rules kept

- Advantage and disadvantage are one net value. `advantagePlan` depends only on advantage − disadvantage (and help), so sending `max(0, ±net)` gives the same dice as before. The limit is still 6.
- Every roll option is kept: roll types, damage sources, custom dice, critical, modifier limit, Experiences and their Hope check, attack and Ikonis attack, help dice, features (auto ones shown as "(always)"), physical dice, Tag Team, and the 3D and sound settings.

## Frozen names kept

- region "Dice" (exact), region "Last roll", testid `last-roll`, list "Dice" of the dice with the same item names ("Hope d12: 7"), group "Physical dice", labels "Trait", "Difficulty", "Damage source", "Enter physical dice", "3D dice", and the feature option labels.
- The roll pills are still the button named "Roll" (exact), as the S6-owned class-features specs require. The rest of the visible text ("Hope & Fear", "⚔", "damage") is `aria-hidden`.
- New: group "Advantage or disadvantage" with buttons "More advantage" / "More disadvantage" (tests/e2e/dice-3d.spec.ts updated), list "Earlier", checkbox "Dice sound".

## Deviations (deliberate)

- **No Experience select in the toolbar:** per the acceptance, Experiences are chips under Roll options (several can be used at once, 1 Hope each).
- **No divider and no damage field next to the action fields:** the app keeps Action / Reaction / Damage as modes, so the toolbar shows one mode's fields and one roll pill. A divider left alone at the end of a wrapped line looked broken, so it was dropped.
- **Roll options open by default:** the class-features specs (not S5's) check feature options and "Enter physical dice" without opening anything first.
- **No damage reroll picking:** the app has no reroll mechanic; the damage dice are plain tiles.
- **"Earlier"** lists only this visit's rolls (client state). The persisted history is the dashboard feed.

## Visual comparison

`E2E_VISUAL=1 E2E_PORT=<port> E2E_CONVEX_PORT=<port> pnpm test:e2e tests/e2e/visual/S5.spec.ts` → `test-results/visual/S5/{dice,dice-rolled,dice-damage}-{1440,390}.png`. Board: `node scripts/board-shots.mjs dice` (idle) and `board-dice-section-1440.png` in the analysis's screenshot folder (after a roll).

| Region | Verdict |
|---|---|
| dice idle 1440 | Same toolbar look: Cinzel labels, 40 px paper fields, Adv / Dis stepper, gradient pill, 3D pill, speaker and GM Fear at the right. The segmented control is extra (app modes). The right-hand cluster wraps onto a second line, as on the board. |
| dice rolled 1440 | Gold and purple tiles with the deciding ring, 30 px total, coloured uppercase outcome, label line and italic line, "Earlier" at the right: matches the board. |
| dice 390 | Stacked, no horizontal scroll; Mod and Difficulty share a row; full-width roll pill; chips wrap. |
| dice damage | Wine "⚔ Roll damage" pill and a damage tile with its die size. |

## Verification

See the S5 report: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and e2e dice, dice-3d, class-features, class-features-hf and visual S5.
