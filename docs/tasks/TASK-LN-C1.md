# TASK LN-C1: Cloaked in dim light makes a Finesse roll (DA18)

Plan `.omc/plans/lanes.yaml`, tracer C1, which runs tracer DA18 of `.omc/plans/drawer-answers.yaml` (bead
dcm-bxp.99.19.53 item (4)). dcm-bxp.99.19.52 (a condition's source on the sheet) is not done here: it is tracer C2.

Status: Review (implemented and tested on branch `lane-c1`).

## Built

- `convex/lib/combatMovement.ts`
  - `enemySight(scene, enemy, at)` returns `"clear" | "dim" | "none"`: the DA3 light check, now reading a dim square
    (level 1) as `"dim"` (the token is read as revealed to the enemy's own view so `tokenVisibility` reports dim).
    `enemySees` (clear only) and `inSightOfAdversary` keep their DA3 meaning and call shape.
  - `enemySightOf(scene, at, hidden)`: over the revealed enemies with a clear line, `clear` when any sees the rogue in
    clear light, else the list of those that see it in dim light.
  - `enemyStates` (replaces `unseeingEnemies`): the hidden / defeated set plus each seeing adversary token's Difficulty
    (`difficultyOf` from convex/lib/cardRunner.ts: stat block plus effects, as an attack reads it).
  - `uncloakAfterMove`: clear light -> Cloaked ends (unchanged DA3 row); dim only -> `cloakRoll`; darkness -> nothing.
    Vanishing Act's Cloaked is checked before either and is never touched.
  - `cloakRoll`: ONE Finesse action roll (`resolveDuality`, server dice, no Experience / options) against the HIGHEST
    Difficulty among the adversaries seeing the rogue dimly. Hope / Stress (critical) to the rogue, Fear to the GM
    (`gainFear`), armed countdowns tick (`tickArmedCountdowns`), as `rolls.duality` does. Success keeps Cloaked, failure
    ends it in the same sheet save.
  - Rows, one group: a public `roll` row ("<name> ends a move in dim light in sight of an adversary: Finesse action
    roll 14, success with Hope; stays Cloaked") whose roll record keeps the outcome but has no `difficulty` (U1: players
    never see the number), with `before`, `fearDelta`, `hopeGained`; and a GM row naming the Difficulty and the
    adversary. Undo reverts the roll, its Hope / Fear and the Cloaked change; as a dice row, a player's undo is limited
    to `PLAYER_DICE_UNDO_MS` (no rerolling by undo).
- `convex/combatTokens.ts`: `move`'s doc comment only.
- `tests/convex/cloaked-move.test.ts`: DA18 block (dice forced): success with Hope keeps Cloaked, Hope +1, public row
  without the Difficulty, GM row with it; two dim seers (10 and 18) -> rolled against 18, failure with Fear ends Cloaked
  and adds Fear, undo restores both; a clear seer ends it with no roll; a Hidden dim seer -> no roll; Vanishing Act ->
  no roll. The DA3 tests still pass unchanged.

## Decisions

- "The enemies that have that line" read as the revealed enemies with a clear line that see the rogue in dim light
  (an enemy in line whose view of the square is dark does not count).
- Day and the dim time phases stay "full vision" (R8), so their squares are clear and Cloaked ends outright there; dim
  light means a night square lit at level 1 (R9 / R10).
- The public roll record drops `difficulty` but keeps the outcome (success / failure): the player learns the result,
  not the number.

## Rules quoted

- CB p.42 (Rogue, Cloaked): "After you make an attack or end a move within line of sight of an adversary, you are no
  longer Cloaked."
- CB p.42 (Nightwalker, Vanishing Act): "You remain Cloaked in this way until you roll with Fear or until your next
  rest."
- User 2026-10-30 (dcm-bxp.99.19.53 notes): "when a Cloaked rogue ends a move on a DIM-light square in a revealed
  enemy's clear line, the rogue makes ONE Finesse action roll (Hope/Fear apply as usual) against the HIGHEST Difficulty
  among the enemies that have that line. Success keeps Cloaked; failure ends it (public, undoable row). Clear light
  still ends it outright; darkness keeps it."

## Not built

- Class-feature prompts after the roll (`afterDualityRoll`, e.g. Strange Patterns) are not returned: `move` has no
  prompt channel.
- No after-roll hold (spending Hope to change the roll) and no player choice of Experience or advantage: the roll is
  automatic on the move.

## QUESTIONS (built as stated; please confirm)

1. **Enemy without a Difficulty.** A custom token or an enemy-side PC / companion has no Difficulty. Such a seer is left
   out; when it is the only dim seer, no roll is made and Cloaked stays (as before DA18). Should it end Cloaked, or roll
   against some number?
2. **Rogue who can't act** (unconscious, dead, away; e.g. the GM drags the token): no roll, Cloaked stays. OK?
3. **Dim time phases** (dusk / dawn, R8 "full vision") count as clear light, so Cloaked ends outright there, not by a
   roll. OK, or should a dim phase also ask for the roll?

## Follow-ups

- None new. dcm-bxp.99.19.52 (condition source; replace `cloakedByVanishingAct`) stays with tracer C2.
