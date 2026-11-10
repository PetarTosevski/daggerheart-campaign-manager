# TASK-RULES-WF: rule switches wave 3, GM Fear costs, Hordes, out of range (F4, F5, D7, M4) and adversary follow-ups

Status: Review. Rule switches wave 3, tracer WF (epic dcm-jh6d part A, bead dcm-bxp.134; adversary follow-ups of
dcm-y3mf). Inputs: `.omc/plans/rule-switches-wave3-questions.md` ("User answers (2026-11-09)", binding: Q6 a, Q7 a, Q8 a,
Q12 a, Q14 a, Q15 b), `docs/tasks/TASK-RULES-W3S0.md` (modes, M4 migration), `docs/tasks/TASK-RULES-WD.md`
(`isUntargetableUnconscious`), `docs/tasks/TASK-RULES-WR.md` (R7's `planHelp` / `payHelpers`), and the user's notes of
2026-11-10 (path destination pick, R7 on cards, Stress cost with a full track stays refused). Same meanings as waves 1-2:
Manual = the app stops doing it and posts a GM-only note (`postRuleNote`) in the action's undo group.

`adversaryExperienceFear`, `fearFeatures`, `hordes` and `outOfRange` are in `WIRED_RULES`
(`src/components/config/sections/rules/model.ts`, their own block).

## Deploy note (M4)

`migrations/outOfRange:copyTableSetting` must be **rerun with `reset: true` on dev and on prod at the deploy that ships
WF** (it mirrors `tableSettings.outOfRange` into `ruleModes.outOfRange`; from WF on nothing reads the table setting and
the At the table control is gone, so a GM's choice made since the first run would otherwise be lost):

```bash
npx convex run migrations/run:run '{fn: "migrations/outOfRange:copyTableSetting", reset: true}'          # dev
npx convex run --prod migrations/run:run '{fn: "migrations/outOfRange:copyTableSetting", reset: true}'   # prod, before the WF deploy goes live
```

Rerun it before any GM changes M4 in House rules on that deployment (a rerun overwrites `ruleModes.outOfRange` from the
old table setting).

## What each piece does

| Rule | Book | Manual |
|---|---|---|
| F4 `adversaryExperienceFear` (CB p.154) | An Experience asks 1 Fear (`confirmFear`), NOT_ENOUGH_FEAR past the pool (unchanged). | The Experience adds its value; no Fear asked, refused or spent. GM note "Mosquitoes used Camouflage (+2): Spend 1 Fear by hand"; the action's GM row says "(spend 1 Fear by hand)". The map stat block's Experience options show "Spend 1 Fear by hand" with no Fear pill. |
| F5 `fearFeatures` (CB p.154) | Upfront Fear costs asked and spent (unchanged); environments FEAR_EMPTY. | Adversaries: the use's upfront Fear costs are dropped (`withoutFearCosts`: a `fear` cost goes, an `either` keeps its options without their Fear); GM note "Rat used Group Attack: Spend 1 Fear by hand"; `featureAsk.fear.feature` is 0. Triggered / automatic uses run through `rangesFlag` and take no Fear either (no note there). Environments: `environmentActions.spendFear` spends nothing (`spent: 0`) and posts "Defiler (Abandoned Grove): Spend 1 Fear by hand" (no group: it changed nothing); the button reads "Use (1 Fear by hand)" and is never disabled for Fear. |
| D7 `hordes` (CB p.199) | Horde (X) swaps in at half HP (unchanged). | The standard attack keeps its printed damage; GM note "Mosquitoes: Horde at half HP: it deals 1d4+1 instead?" (only when the swap would apply). |
| M4 `outOfRange` (CB p.103) | "Ask the GM": a sanction request, as before. `refuse`: a player's out-of-range attack / card / feature is COMBAT_TARGET_OUT_OF_RANGE (the GM acting keeps the sanction), as the old table setting did. | Nothing waits: the attack (`combatActions.attack`, rider targets waived) or the card / feature use (`buildRun` clears `outOfRange`) resolves now; GM note "Mira attacked Far out of range" / "Mira used Deft Maneuvers on Far out of range" in its group. |
| C4 `unconscious`, "can't be targeted by an attack" (CB p.106, Q8 a) | An adversary attack (or a feature aimed at PCs, `targets.side: "enemy"`) naming an unconscious PC is COMBAT_TARGET_INVALID ("Ash is unconscious and can't be targeted by an attack."), before anything is rolled or paid; unconscious PCs are left out of the server's auto-filled "all targets within range" list, of a path line's targets, and of the map stat block's "in front" pre-pick. | Lets it through. |
| W3 Tier 3 Dark-Hearted (HF p.177, Journey to Horizon) | Once 5 Tier 3 boxes are marked and the Doom Track is Book or Every N sessions (`darkHeartedActive`), the GM's attack and attack-feature pickers on the map stat block offer "Dark-Hearted: advantage (1 Fear)". `adversaryActions.attack` / `useFeature` take `darkHearted: true`: one more advantage die and 1 Fear, asked with the others (`confirmFear.darkHearted`), GM row "Dark-Hearted: advantage (1 Fear)". INVALID before Tier 3 or outside the frame. New GM query `adversaryActions.darkHearted`. | Doom Track Manual: not offered. |
| S3 (Q15 b) | The map stat block shows "Spotlight 2/1: spotlit again this GM turn" (the tracker card's `spotlightStatus`, Relentless included) when the count is over the limit. A warning only. | — |

### Path features: the destination pick (user 2026-11-10)

For an adversary feature with `targets.area: "path"` and a `move` step of itself (`pathMoveRange`: Rampaging Fury,
Trample, …), `featureAsk.pathMove` names the move's range. On the map stat block, Use first opens the HUD square picker
(`pickArea`, within that range of the token). The squares the token slides over in a straight line (`pathSquares`) give
the pre-picked creatures (`crossedBy`; PCs, and other adversaries for `side: "any"`; unconscious PCs left out in C4
Book). Side `enemy` (Trample): the purple picker opens with them picked ("Everyone in the Construct's path: change the
picks if needed"); side `any` or a feature that needs choices (Rampaging Fury, a reaction): the choices dialog opens with
them as the targets. `useFeature` takes `destination {x, y}`: INVALID for a feature with no such move, COMBAT_TARGET_INVALID
off the map or out of range; with no `targets` the server fills the line itself; the token is moved there (patched,
facing the way it went) when the use resolves, and the GM row says "Ogre moved to (14, 10)". "In front" targeting is
unchanged (the GM unpicks). A Stress cost with a full track stays refused (user confirmed).

### R7 on card and feature rolls (user 2026-11-10)

`cardRollValidator.helpers` (character ids). `buildRun` runs `planHelp` (Book: helpers 1 Hope each, NOT_ENOUGH_HOPE /
DICE_RULE before anything is written, the bare counter refused; Manual: the counter) and keeps the plan on
`BuiltRun.help`; `resolveUse` (cards) and `resolveFeatureUse` (features) pay it with `payHelpers` in the use's group (undo
refunds; Manual: the GM's note). A sanction replays the stored roll's `helpers`. The HUD hand's roll options show "Helped by"
chips (Book; `helperCandidates`, max 3) instead of the "Help dice" counter.

## Code

- Domain: `src/lib/domain/adversary-effects/run.ts` (`fearFeatures`, `experienceFear`, `hordes` on the run context,
  `withoutFearCosts`, `upfrontFear` reads F5), `src/lib/domain/adversary-actions/rule-notes.ts` (`fearByHandText`,
  `hordeNote`, `outOfRangeNote`, `unconsciousTargetText`), `src/lib/domain/adversary-actions/path-targets.ts` (new),
  `src/lib/domain/card-effects/rule-notes.ts` (`UseRuleNote` gains `outOfRange`).
- Server: `convex/lib/adversaryActions.ts` (F4 / F5 / D7 / C4 / Dark-Hearted / destination; `rangesFlag` spreads the
  Manual flags; `darkHeartedActive`), `convex/lib/adversaryFeatures.ts` (`featureAsk` F5, `pathMove`),
  `convex/adversaryActions.ts` (args `darkHearted`, `destination`; `confirmFear.darkHearted`, `featureAsk.pathMove`
  widened; query `darkHearted`), `convex/lib/validators/combatRequests.ts` (`heldAttackValidator` widened with
  `darkHearted`, `destination`), `convex/environmentActions.ts` (F5), `convex/combatActions.ts` (`refusesOutOfRange` reads
  M4, `passesOutOfRange`), `convex/lib/combatActions.ts` (`AttackRequest.outOfRangeNote`), `convex/lib/cardRunner.ts`
  (M4 Manual, R7), `convex/lib/cardChoices.ts`, `convex/combatCards.ts`, `convex/lib/featureRunner.ts` (R7 pay),
  `convex/campaignSettings.ts` (no `outOfRange` change any more).
- UI: `src/components/combat-map/hud/statblock/{panel,attack,model}.tsx/ts`, `src/components/adversaries/environments/feature-actions.tsx`,
  `src/components/config/sections/table/index.tsx` (row removed), `src/components/combat-map/hud/hand/{body,parts}.tsx`,
  `src/components/combat-map/actions/{hand/model.ts,roll-controls/index.tsx}`, `src/components/config/sections/rules/model.ts`.

## Follow-ups (not done here)

1. **M4 narrow, step 2**: remove `outOfRange` from `storedTableSettingsValidator` (`convex/lib/validators/campaigns.ts`),
   `TableSettings` / `TABLE_SETTING_DEFAULTS` / `OUT_OF_RANGE_CHOICES` (`src/lib/config/campaign-settings.ts`), the
   `outOfRangeValidator` export and the old comments in `src/lib/errors/{config,refusals}.ts`, once the migration has run
   on prod (and a cleanup migration has unset the stored field). Tests still reading it: `tests/convex/config-foundation.test.ts`,
   `tests/unit/config-defaults.test.ts`, `tests/convex/migrations-out-of-range.test.ts`.
2. The classic Encounter tab's attack / feature panels (`src/components/adversaries/tracker/actions/**`) don't offer
   Dark-Hearted, the F4 Manual Experience wording or the path destination pick (the server takes them; only the map stat
   block sends them).
3. The path move patches the token only: the move reactions of `combatTokens.move` (areas entered, Hidden / Cloaked ends,
   `pcMoves` triggers, Hold the Line) don't run for it, and undoing the use doesn't move the token back (as a GM drag).
4. F5 Manual on triggered / automatic Fear-cost uses spends nothing but posts no note.
5. R7 on a feature from the pick-feature panel: the server takes `roll.helpers`, but that panel has no Help control.

## Tests

- `tests/convex/rules-wf.test.ts`: F5 Book / Manual (note, undo, featureAsk, environment), F4 Book / Manual, D7 Manual at
  and below half HP and Book, C4 Book refusal (nothing written) / Manual, Dark-Hearted (off outside the frame and under 5
  boxes, INVALID; Tier 3: confirm, 2 dice, 1 Fear; Doom Track Manual off).
- `tests/convex/out-of-range-refuse.test.ts`: M4 via `ruleSettings.set`; Manual attack and card resolve with the note; R7 on
  cards (Book helper pays and undo refunds, counter / no-Hope refusals before writes, feature too; Manual note).
- `tests/convex/adversary-area-features.test.ts`: `pathMove`, destination moves the Ogre and targets the line, the GM's list
  wins, out-of-range / off-map / no-move refusals.
- `tests/unit/adversary-actions/path-targets.test.ts`, `tests/unit/rules-wf.test.ts`: the pure helpers.
- Updated: `tests/convex/campaign-settings.test.ts`, `tests/unit/config/table.test.tsx`, `tests/e2e/config-table.spec.ts`
  (no Out-of-range row), `tests/unit/config/rule-switches.test.tsx` (the four rows wired), `tests/convex/rules-defined-ranges.test.ts`,
  `tests/convex/rules-pc-conflict.test.ts` (M4 set in House rules), `tests/convex/combat-cards.test.ts` (Help counter under
  R7 Manual), `tests/convex/authz/adversary-actions.entries.ts` (`darkHearted`).
