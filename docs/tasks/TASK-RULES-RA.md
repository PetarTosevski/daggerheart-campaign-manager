# TASK-RULES-RA: PC action-roll aftermath (S1 spotlight to the GM, R3 Hope and Fear from rolls)

Plan `.omc/plans/rule-switches.yaml`, tracer RA (epic dcm-jh6d part A; bead dcm-bxp.99.32.4). Builds on RS0
(`docs/tasks/TASK-RULES-RS0.md`): modes read through `ruleMode`, Manual notes written through `postRuleNote`.

## Rules and modes

| Rule | Book passage | Book mode | Manual mode |
|---|---|---|---|
| S1 `spotlightToGm` | CB p.100: "The player characters pass the spotlight between themselves, making moves until someone fails a roll or rolls with Fear"; CB p.149: "Rolls with Fear on an action roll. / Fails an action roll." | A failure or a roll with Fear moves the spotlight to the GM (`moveToGm`, reason `rollWithFear` when with Fear, else `failedRoll`, `rollBy` the roller). A critical always succeeds and never moves it. | Nothing moves. GM note "Mira rolled with Fear: take the spotlight?" / "Mira failed: take the spotlight?". |
| R3 `hopeFearFromRolls` | CB p.90 (a roll with Hope: the player gains a Hope); CB p.154: "Whenever a PC rolls with Fear, you gain a Fear." | Unchanged. | User answer Q2 b (2026-11-05): both stop. The roller's Hope on a roll with Hope does not rise (the player adds it on the sheet); the GM's Fear on a roll with Fear does not rise (no `fearDelta` on the row) and the GM gets "Mira rolled with Fear: gain 1 Fear?" (a Tag Team: "Mira and Theo rolled with Fear: gain 2 Fear?", one Fear per PC, CB p.97). |

Interpretations (each reversible):

- S1 applies only while an encounter runs (combat-hud H1.S default, `.omc/plans/overnight-questions.md` 2026-11-02:
  "moveToGm fires only during a running encounter, not on every action roll"). Both modes: no move and no note outside
  a fight.
- S1 Manual posts no note while the GM already holds the spotlight (nothing to take).
- R3 Manual keeps a critical's Hope and cleared Stress: that is R2 "Matching dice = critical" (CB p.90, Book-only:
  "you gain a Hope and clear a Stress"), not R3. Reaction rolls give nothing in either mode (CB p.99).
- "Success" for an attack (weapon, card, feature) is the engine's: it hit any target (CB p.96). A roll without a
  Difficulty counts as a success (`actionOutcome`).

## Code

- `src/lib/domain/dice/index.ts`: `dualityEffects(kind, outcome, mode = "book")`; `HopeFearMode`.
- `convex/lib/rollAftermath.ts`: `hopeFearModeOf(campaign)`, `fearWithheldBy(mode, kind, outcome, pcs?)`,
  `planPcActionRoll` (reads, writes nothing), `applyPcActionRoll` (the move, then the notes), `afterPcActionRoll` (both,
  for a path whose rows already share a `groupId`).
- Paths that call it, once per PC action roll (bead dcm-bxp.99.32.4's list):
  - `convex/lib/rolls.ts` `duality` (`rolls.actionRoll`, `rolls.manualRoll`); `resolveDuality` reads the R3 mode and
    returns it (`hopeFear`) to the paths built on it.
  - `convex/rolls.ts` `tagTeamApply`: once, with the chosen roll, in the Tag Team's group.
  - `convex/lib/combatActions.ts` `resolveAttack` (weapon attacks; the held after-roll path resolves through it too).
  - `convex/lib/combatMovement.ts` `rollCloak` (DA18's Finesse roll at the end of a move).
  - `convex/combatCards.ts` (card uses) and `convex/lib/featureRunner.ts` `resolveFeatureUse` (feature uses, an ally's
    Cannonball roll through `featurePrompts.allyRoll`): S1 only, see "Not done".
  - Reaction rolls and GM rolls never call it.

## Groups and undo

- A note joins the roll's `groupId`: undoing the roll undoes the note (`postRuleNote` marks it undoable).
- A plain `actionRoll` row had no group. It now gets one only when a note is due (`planPcActionRoll` first), so a Book
  roll's row is unchanged.
- Notes carry no `characterId`: a note on the character would be its latest live row, which the Slayer choice
  (`rolls.slayerRoll`), the Tag Team checks and `latestLiveRow` read.
- `convex/rolls.ts` `tagTeamGroup` skips `rule` rows (and reads up to 8), and `slayerRoll` accepts a grouped plain roll
  (one non-note row) as well as a Tag Team's four.
- Undo does not put the spotlight back: bead dcm-bxp.99.32.10.

## Not done (outside this tracer's files)

1. **R3 on card and feature rolls.** The card engine (`src/lib/domain/card-effects/run.ts`, `rollOnce`) computes the
   roll's Hope and Fear itself (`dualityEffects` without a mode) and spends the roll's Hope before later costs (R8).
   Until its context carries the R3 mode (`dualityEffects(kind, outcome, context.hopeFear)`, set by `buildRun` in
   `convex/lib/cardRunner.ts`), card and feature rolls keep Book Hope and Fear in an R3-Manual campaign, and post no R3
   note. S1 works on them.
2. **`convex/countdownRolls.ts` `groupOf` / `countedRow`** (tracer RK's file) read a roll's group as a Tag Team: a
   plain roll that got a group for its notes, or a Tag Team with notes, no longer counts as a counted row
   (`countedRows`, `applyToCountdowns`) until `groupOf` skips `kind: "rule"` rows and a one-row group counts as a plain
   roll.

## Tests

- `tests/unit/rules/roll-aftermath.test.ts`: `dualityEffects` per mode and outcome; the helpers.
- `tests/convex/rules-roll-aftermath.test.ts`: per path (plain roll, Tag Team, weapon attack, card, feature, Cloaked
  move), Book and Manual of S1 and R3: the spotlight row, the Fear, the Hope, the notes' text, visibility and group,
  undo taking the notes back, no move outside an encounter, on a reaction roll, or a critical.
