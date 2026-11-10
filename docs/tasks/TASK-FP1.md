# TASK-FP1: a path feature's move runs the drag's reactions and undoes with the use

Status: Review. Plan `.omc/plans/finish-in-progress.yaml`, tracer FP1, bead dcm-bxp.134.3 (follow-up 3 of
`docs/tasks/TASK-RULES-WF.md`: "The path move patches the token only").

## What changed

A path feature's destination move (Rampaging Fury, Trample: `useFeature` with `destination`) used to patch the token
and nothing else. `pathMove` in `convex/lib/adversaryActions.ts` now runs what the GM's drag of the token runs in
`combatTokens.move` (as the GM: nothing is refused), calling the same exported helpers:

| Reaction | Helper | For an adversary's move |
| --- | --- | --- |
| An area's hold, movement limits | `moveRules` (convex/lib/combatAreas.ts) | Broken limits become GM lines on the use's GM row ("Ogre's move broke …"), as a GM drag's warnings. |
| Hidden ends | `unhideAfterEnemyMove` (convex/lib/combatMovement.ts) | CB p.102: a PC the adversary now sees in clear light loses Hidden; dim light asks the Finesse roll; Manual posts the GM note. |
| Cloaked | (same helper) | CB p.42: "while Cloaked you remain unseen if you are stationary when an adversary moves to where they would normally see you": nothing ends. |
| Areas entered, passed through, crossed, left | `areasAfterMove` (convex/lib/combatAreas.ts) | Public feed rows and the area's `onEnter` / `onCross` steps; the GM row names them ("Ogre entered Rune Circle"). |
| Hold the Line (enemy moves within range) | `rangeTriggersAfterMove` (convex/lib/combatAreas.ts) | The holder's public feed row. |

Not run, because they react to a PC token's move only: `pcMoves` features (Shield Wall: "A creature who tries to move
within Very Close range of the Guard", read by `moveRules` for a PC mover), Cloaked ending on the mover's own move
(`uncloakAfterMove`), the caster's own areas (`endAreasOnCasterEvent`), carried tokens. Walls do not stop the move (a GM
drag goes through them too).

Undo: the move opens a `serverMove` request in the use's actionLog group (the mechanism Charge uses, DA12), with the
square and facing the token left. Undoing the use (`actionLog.undo`) puts the token back and declines the row
(`declineGroupOffers`). The token's next path move resolves its older open row (an older use's undo is stale then
anyway: the instance changed).

## Outside FP1's `owns` (minimal, with reasons)

- `convex/lib/validators/combatRequests.ts`: `serverMovePayloadValidator.characterId` widened to optional (an
  adversary's move has no character). Widen only; no stored row changes.
- `convex/lib/combatRequests.ts`: `openServerMove` supersedes per character, or per token when there is no character.
- `convex/lib/actionLog.ts`: `undoEntry` runs `declineGroupOffers` for a group with `adversary` rows too (it ran for
  `combat` rows only, so an adversary use's `serverMove` was never put back).

## Open questions

1. The reactions keep their own feed rows and undo groups, as after a GM drag (the helpers make their own groups).
   Undoing the use moves the token back but does not bring back a Hidden the move ended; the GM undoes that row too.
   Should the reaction rows join the use's group? That needs a `groupId` option on `unhideAfterEnemyMove`,
   `areasAfterMove` and `rangeTriggersAfterMove`.
2. The plan's acceptance names "Cloaked ending" and "a pcMoves trigger". By the book neither fires on an adversary's
   move (CB p.42 Cloaked; `pcMoves` is a PC's move), so the tests assert Cloaked stays and test the enemy-move trigger
   (Hold the Line) and Hidden ending instead.
3. The reactions run when the use resolves, after the attack is rolled (where the move was already written). A Hidden
   PC in the path is therefore attacked while still Hidden. Should the move (and its reactions) come before the roll?

## Tests

`tests/convex/path-move-reactions.test.ts`: area entry (row and GM line), Hidden ends, Cloaked stays, Hold the Line,
no reaction out of reach, undo puts the token back and declines the row, a newer move supersedes the older row, a refused
destination opens nothing.
