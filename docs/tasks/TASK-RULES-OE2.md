# TASK-RULES-OE2: dim light on every PC action roll; "breathes underwater"; the environment on card and feature attacks

Plan `.omc/plans/rule-switches.yaml`, tracer OE2 (bead dcm-bxp.134). Builds on OE (docs/tasks/TASK-RULES-OE.md). User
answers 2026-11-06 on dcm-bxp.134 (OE's Questions 1 and 2): "dim-light variants affect EVERY PC action roll with a
Difficulty (not only ranged attacks); Underwater: a per-token 'breathes underwater' mark skips the breath countdown and
Stress for that PC".

## The books

CB p.104: "Darkness can also make certain actions more challenging. The GM should reflect this by raising the Difficulty
of action rolls or imposing disadvantage on rolls made by the PCs."

CB p.168: "Attack rolls underwater have disadvantage unless it makes sense for a character to easily fight underwater
… For any creatures that can't breathe underwater, you can use a countdown to create tension about how long they can hold
their breath."

## M3 `darkness` on every PC action roll with a Difficulty

In the campaign's dim light (`campaignLight`; on a map the scene's light, which is the same) the variant applies to:

| Roll | Has a Difficulty when | What is added |
|---|---|---|
| Dice box (`rolls.actionRoll`, `rolls.manualRoll` kind action) | the roller set one | the disadvantage die and / or +N to the roll's Difficulty; the row names it ("dim light: disadvantage", "dim light: +2 Difficulty") |
| Tag Team (`rolls.tagTeam`) | the initiator set one | both PCs' rolls, named on each row |
| Weapon attack (`combatActions.attack`) | always (the targets') | as OE, now Melee too (no "ranged" condition) |
| Card and feature uses (`buildRun` → `RunContext.darkness`) | a fixed or GM Difficulty, or the targets' Difficulty / Evasion | each such action roll of the use (follow-up rolls too); a shared follow-up reads its roll's raise |

Never: reaction rolls, rolls without a Difficulty, adversary rolls, GM rolls. Book (badge only) and Manual (nothing) are
unchanged. A manual (typed-in) roll types the extra disadvantage die after its own advantage dice, as with a bearer's
disadvantage. The variant badges now read "Dim light: action rolls with disadvantage", "Dim light: action rolls +N
Difficulty", "Dim light: action rolls with disadvantage, +N Difficulty"; Book keeps `DIM_PHASE_BADGE`.

## Underwater on card and feature attacks

A card or feature use whose roll is an attack (as `buildRun`'s `attackRoll`: kind `attack`, or an action roll against the
targets' Difficulty) on the Underwater live map gets one disadvantage die unless the actor's token fights underwater
(same as `attackEnvironment` for weapons). A non-attack card roll gets none.

## "Breathes underwater"

- `combatTokens.breathesUnderwater?` (widened; absent = false), set by `combatScenes.setBreathesUnderwater` (keyed GM
  mutation; MECHANIC_DISABLED while the rule is off; COMBAT_TOKEN_NOT_FOUND for another campaign's token; INVALID for a
  token that is not a PC's).
- A marked PC's action rolls do not tick the breath countdown and never mark the out-of-breath Stress
  (`planBreath` in convex/lib/rollAftermath.ts treats the PC as off the map). In a Tag Team the other PC still breathes.
- The GM sets it from the HUD Water pop-over ("Breathes underwater" list of PCs) and from the token panel (Underwater
  row: "Fights underwater" for any token, "Breathes underwater" for a PC). `combatScenes.environment.creatures` carries
  `pc` and `breathesUnderwater`.

## Code

- `src/lib/domain/combat-map/light.ts`: `darknessEdge(light, mode, raise)` (the `ranged` parameter is gone),
  `darknessLabels`, `NO_DARKNESS_EDGE`, new badge texts.
- `convex/lib/rolls.ts`: `darknessOnRoll`, `withDarkness`; `duality` applies them. `convex/rolls.ts`: Tag Team.
- `convex/lib/combatActions.ts`: `attackEnvironment(scene, modes)` (no `host`).
- `src/lib/domain/card-effects/run.ts`: `RunContext.darkness`, applied in `rollOnce` and shared follow-ups.
- `convex/lib/cardRunner.ts`: `buildRun` sets `darkness` and the Underwater attack disadvantage (feature uses go through
  it too).
- `convex/combatScenes.ts`, `convex/tables/combatMaps.ts`, `convex/lib/rollAftermath.ts`, the HUD pop-over and the token
  panel.

## Not done (outside OE2's files)

1. **Card / feature roll lines** do not name "dim light: …" / "underwater: disadvantage" (the summary is built by
   `rollText` in convex/lib/cardRows.ts); the dice show the die and the Difficulty shows the raise.
2. **The Cloaked roll** (`convex/lib/combatMovement.ts`, `resolveDuality(cloakRollArgs(…))`) does not take the variant;
   it could call `darknessOnRoll` / `withDarkness` from convex/lib/rolls.ts.
3. **Classic view badge text** comes from `darknessBadge` already (vision/header.tsx, panels.tsx), so it follows.
4. **docs/data-model.md**: document `combatTokens.breathesUnderwater`.

## Tests

`tests/convex/rules-environment.test.ts` (OE2 blocks): dice box per mode (die, raised Difficulty, labels; none without a
Difficulty, for a reaction, in Book, by day), Tag Team, card and feature attacks (die, raised target Difficulty), a card
roll against the GM's Difficulty, Underwater on card and feature attacks (and none for a non-attack roll, none when
fighting underwater), `setBreathesUnderwater` refusals and the GM list, a marked PC's roll ticking nothing and marking no
Stress at 0. `tests/convex/authz/rules-underwater.entries.ts`: `setBreathesUnderwater` (GM).
