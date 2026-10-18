# TASK-D5-T8a: Hope features for all 13 classes and the features panel

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T8a (wave 2), on T0's contracts (`docs/tasks/TASK-D5-T0.md`).

## What works

- Registry (`src/lib/domain/class-features/index.ts`): one module per class in `classes/` (bard, druid, guardian, ranger, rogue, seraph, sorcerer, warrior, wizard, assassin, brawler, warlock, witch), each exporting its Hope feature at 3 Hope. `classFeaturesAvailable(classId, hopeAndFear)` hides Hope & Fear classes' features unless the campaign's option is on (server and UI). `CLASS_STATE_LABELS` names the generic `classState` counters. Shared helpers: `classes/shared.ts`.
- `convex/classFeatures.ts`:
  - `use` (keyedUserMutation, rate limit `roll`, `editable` = loadCharacter edit, `assertCanAct`): finds the feature by key (`findFeature`), checks the Hope & Fear option for the granting class, pays the cost (hope → `NOT_ENOUGH_HOPE`; stress, held die, once-per uses → `CLASS_FEATURE_RULE`), loads the target (`ally`: same campaign, not dead or away; `party`: every other active PC), loads the latest live roll of the ally (or of the user without one), runs the pure `use`, applies `fearDelta` (positive `gainFear`, negative `revertFear`), saves every changed sheet and logs one `feature` row per character (the user, each changed other, and the roll's owner when the roll changed), grouped when more than one. Returns `{ summary, roll }`.
  - `endEffect` and `gotHit` (owner or GM): end one effect / every `until: "hit"` effect (`expire(sheet, "hit")`, decision 8), logged and undoable; `CLASS_FEATURE_RULE` when nothing ends.
  - `lastRoll` (userQuery, campaign members): the character's latest live roll, for the Volatile Magic dice picker.
- UI (`src/components/party/features/`): the sheet's Features box shows the Hope feature (cost, text, "reminder" for assist features) with its Use button (ally picker, trait picker for Evolution, damage-dice picker for Volatile Magic), class actions from the registry (none yet; T8b/T8c), active effects with End, Got hit, conditions, held dice and `classState` counters. Disabled with a reason for dead, away or unconscious characters (decision 9) and below the Hope cost. Wrapped in an error boundary (CL1).

## Rules (re-checked against the books)

| Feature | Book | Automation |
|---|---|---|
| Make a Scene | CB 28 | assist |
| Evolution | CB 30 | assist: effect `until: "manual"`, +1 to the chosen trait, End button (plan note 11) |
| Frontline Tank | CB 36 | clears 2 Armor Slots; refused with none marked |
| Hold Them Off | CB 38 | assist |
| Rogue's Dodge | CB 42 | +2 Evasion, `until: "hit"`; the rogue's `onRest` hook removes it on any rest ("Otherwise, this bonus lasts until your next rest") |
| Life Support | CB 44 | ally clears 1 Hit Point (`applyResourceDelta`, also wakes an unconscious ally, CB 106); refused without an ally or marked HP |
| Volatile Magic | CB 46 | rerolls the chosen damage dice of the caster's latest damage roll |
| No Mercy | CB 48 | +1 attack, `until: "rest"` |
| Not This Time | CB 50 | assist |
| Deadly Determination | HF 8 | clears 2 Stress; refused with none marked |
| Square Up | HF 10 | assist |
| Patron's Boon | HF 14 | rerolls the caster's latest failed action or reaction roll with advantage (Duality Dice and advantage/disadvantage rerolled with one more advantage, cancelling one for one, CB 100); the failed action roll's Hope or Fear is taken back and the new roll's given |
| Witch's Charm | HF 16 | the ally's (or own) latest failed action roll becomes a success with Fear; with Hope the roller loses that Hope and the GM gains 1 Fear, with Fear nothing else (settled rule) |

A feature never stacks with itself: using it again replaces its effect.

## Tests

- `tests/unit/hope-features.test.ts`: registry, Hope & Fear gating, every Hope feature.
- `tests/convex/class-features.test.ts`: Hope below 3 refused; Life Support on another player's character logged on both in one group and undone; a player cannot use another player's character's feature (GM can; outsider NOT_FOUND, anonymous UNAUTHENTICATED); unconscious, wrong class, foreign target; Witch's Charm with Hope / with Fear and the H&F option; Volatile Magic; Got hit and End; lastRoll access.
- `tests/e2e/hope-features.spec.ts`: a Rogue spends 3 Hope on Rogue's Dodge, Evasion shows +2, Got hit removes it.
