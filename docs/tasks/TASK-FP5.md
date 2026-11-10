# TASK-FP5: the user's answers to FP1 / FP4 (path move before the roll, one undo, step Fear in F5 Manual)

Status: Review. Plan `.omc/plans/finish-in-progress.yaml`, tracer FP5, bead dcm-bxp.134. Builds on FP1
(`docs/tasks/TASK-FP1.md`) and FP4 (`docs/tasks/TASK-FP4.md`); answers their open questions (user, 2026-11-10).

## Q3: a path feature moves first, then rolls

Trample ("Mark a Stress to make an attack against all targets in the Construct's path when they move") and Rampaging Fury
("Move the Ogre to a point within Close range and deal 2d6+3 direct physical damage to all targets in their path") now
make the move, with its reactions (`pathMove`: areas, Hidden ending on sight, Hold the Line), before the attack is rolled
or the use is run (`adversaryAction`, convex/lib/adversaryActions.ts).

- Where: after the before-roll defence hold (`holdForPreRoll`; a held attack keeps its destination, so the replay moves)
  and before the roll. The scene, the instance (a reaction may write it: Hold the Line's Restrained), the work and the
  targets' sheets are read again after the move, so a PC who lost Hidden is attacked without Hidden's disadvantage, the
  C1 Manual "attacked while Hidden" note is not posted, and the commit no longer writes over what a reaction wrote.
- The targets stay the ones the path crossed (computed from the square it left); they are not checked for sight again
  from the new square, and the cover found before the move stands.
- A use that then waits for PCs' picks (`holdForAllyPicks`) has already moved; its held args now carry the path's
  targets (the held args have no destination, so the replay could not recompute them).

## Q2: the move's reactions join the use's undo group

`pathMove` passes the use's group to the reaction helpers; a GM's or player's drag (`combatTokens.move`) passes none and
keeps its behaviour (own groups, area and Hold the Line rows never undoable).

| Helper | Option | With the group |
| --- | --- | --- |
| `unhideAfterEnemyMove` (convex/lib/combatMovement.ts) | `options.groupId` | Hidden-ending rows (undoable, with the sheet before), the dim-light Finesse roll rows and its Difficulty request, the Manual notes join the use's group. |
| `areasAfterMove` (convex/lib/combatAreas.ts) | `options.groupId` | The area rows join and are undoable; an area's steps run through `runTriggeredUse` with `undoable`. An area ending because its caster left it (a PC's own move only) keeps a group of its own. |
| `rangeTriggersAfterMove` (convex/lib/combatAreas.ts) | `options.groupId` | Hold the Line rows join and are undoable; an `auto` use runs with `undoable`. |
| `runTriggeredUse` (convex/lib/combatAreas.ts) | `undoable` | Its public row carries the actor's sheet before and the instances before (`adversaryBefore`); its GM row and Manual-rule notes join the group. |

One undo of the use (`actionLog.undo`) then restores the token (the group's `serverMove`), Hidden (the oldest sheet
snapshot), the instances the reactions wrote (the oldest `adversaryBefore`) and marks every reaction row undone.

## Q5: F5 Manual drops the Fear inside a use's steps

`runOrThrow` (convex/lib/adversaryFeatures.ts) under `fearFeatures: "manual"` runs the use with the fixed Fear costs of
its `pay` steps and `optional` steps taken out (`withoutStepFear`; not a `paidBy` / `by` payer's, and a Fear amount read
at run time stays the runner's). Nothing is refused or skipped for want of Fear. Where such a step runs (a `pay` that went
through, a taken `optional`), a stand-in manual step records the amount; the stand-ins are removed from the plan and their
sum returned as `stepFear`. Clicked uses (`adversaryAction`'s `byHand`) and triggered uses (`noteTriggeredFear`) add it
to the "Spend N Fear by hand" note (`fearFeatureNote` / `fearByHandText`). Book is unchanged (`stepFear` 0).

The runner itself (src/lib/domain/adversary-effects/run.ts) is not changed: the stand-in rides through it as a manual
prompt.

## Q6: a triggered use's note joins the attack's group

`noteTriggeredFear` takes the caller's group: `adversaryAction` (reactions before the damage, automatic uses after the
roll), `afterHitTriggers`, `pcEscape` and `pcRollAdversaryUses` when its caller passes `groupId`. Undoing the attack
removes the note. A `pcRollAdversaryUses` call without a group keeps the old note (no group, never undoable).

## Outside FP5's `owns`

None. (FP1's `actionLog.undoEntry` change, read here, already declines the `serverMove` of an adversary use's group.)

## Tests

- `tests/convex/path-move-reactions.test.ts`: Trample at a Hidden PC on its path rolls one d20 (no disadvantage) and
  the unhide row sits in the use's group; C1 Manual posts no Hidden note; one undo restores Hidden and the token; the
  area, Hold the Line and Hidden rows join the use's group and go with its undo; a GM drag's Hold the Line row stays not
  undoable.
- `tests/convex/fear-features-manual-triggered.test.ts`: a clicked use's `pay` and `optional` step Fear (Book spends 2;
  Manual spends none at 0 Fear, the optional still runs, the note says 2); an opted-in reaction whose only Fear is a step
  (Book spends; Manual notes it in the attack's group); the triggered note in the attack's group and removed by its undo.

## Open questions

1. Targets of a path attack are not re-checked for line of sight from the square the move ends on. Should they be (a
   target behind a wall from the new square would then be refused, COMBAT_NO_LINE_OF_SIGHT, after the GM picked it)?
2. A pull the reactions make (Hold the Line's `pullIntoMelee`, through `forcedMove`) writes its own rows outside the use's
   group (only when the move was shortened); the token goes back with the use's `serverMove` anyway.
3. `optional` steps paid by each chooser (`by`) and `either` costs holding Fear keep their Fear in Manual (no printed
   adversary step has either today).
