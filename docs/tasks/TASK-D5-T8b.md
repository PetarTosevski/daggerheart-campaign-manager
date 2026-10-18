# TASK-D5-T8b: Class features for the nine Core Book classes

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T8b (wave 3), on T0's hook contract (`src/lib/domain/class-features/types.ts`), T8a's registry and dispatcher (`convex/classFeatures.ts`), T1's dice (`convex/rolls.ts`) and T5's sessions (`convex/sessions.ts`).

Only the nine class files changed. The dispatcher, the dice box and the sessions pick the features up through the hooks: `classActions` (features panel, `classFeatures.use`), `rollOptions` (dice box), `afterDualityRoll` (prompts after an action roll), `onSessionStart` and `onSessionEnd`. Held dice, feature uses and effects expire through `expire()` (session end, rests).

## Features (re-checked against the Core Book)

| Feature | Book | How it works |
|---|---|---|
| Rally | CB 28 | Class action, target `party`, once per session (`featureUses` rally, until session). The Bard and every other active PC (status `active`, so not away or dead) get a held Rally Die (d6, d8 from level 5) until session end. Undo reverts every sheet in the group. |
| Rally Die spend | CB 28 | Every Core class module offers the sheet's Rally Dice as dice-box options (`rally:<dieId>`, `heldDie`) on action, reaction and damage rolls, and the class action "Rally Die: clear Stress" (rolls the first held die and clears that much Stress). On a multiclass only one module offers the dice. Session end clears unspent dice (`until: "session"`). |
| Beastform | CB 30 | Class action, costs 1 Stress, `assist`. `params.choice` = a Beastform id of the Druid's tier or lower adds its Evasion and trait bonus as an effect (`until: "manual"`, End = drop out); without one the effect is a reminder. |
| Wildtouch | CB 30 | Text only. |
| Unstoppable | CB 36 | Class action, once per long rest: `classState.unstoppable` = 1 of d4 (d6 from level 5); clears Restrained and Vulnerable. Its value is an auto damage option. "Unstoppable: dealt Hit Points" raises it by 1 after a damage roll that deals 1 or more Hit Points (the book's rule: one step per such roll); past its maximum it is removed. "End Unstoppable" (scene end) and session end remove it. |
| Ranger's Focus | CB 38 | Class action, 1 Hope, pressed after the attack: a successful latest action roll sets `classState.focus` (`params.choice` names the target, default "the target"); on a failure the Hope is still spent. "Focus reroll" ends the Focus and rerolls the Duality Dice of a failed latest action roll, taking back the old roll's Hope or Fear and giving the new one's. "End Focus" clears it. |
| Cloaked | CB 42 | Class action toggling the `cloaked` condition (replaces `hidden`). |
| Sneak Attack | CB 42 | Damage option `+tier d6` (tier by level), ticked by the player when Cloaked or an ally is in Melee range. |
| Prayer Dice | CB 44 | `onSessionStart`: d4s equal to the subclass's Spellcast trait (the multiclass's subclass for a multiclass Seraph), none at 0 or less, rolled on receipt, held until session end. Spend (`params.dieIndexes` by order, default the first die): "gain Hope" for the Seraph or an ally (target `party`, `params.targetId` optional), "reduce damage" (assist reminder for the damage calculator), "add to your roll" (adds to the Seraph's latest roll; success or failure is recomputed, Hope/Fear stay). |
| Channel Raw Power | CB 46 | Class action, once per long rest, `params.choice` = `hope:<cardId>` or `damage:<cardId>`: the loadout card goes to the vault; Hope equal to its level, or an effect `channel-raw-power-<2×level>` (until the scene ends) that the dice box offers as a damage option. End it after the spell's roll. |
| Combat Training | CB 48 | Auto damage option `+level`. |
| Attack of Opportunity | CB 48 | Assist class action: the reminder, then a reaction roll in the dice box. |
| Strange Patterns | CB 50 | Class action sets `classState.strangeNumber` (`params.amount`, 1-12); changeable after a long rest (`featureUses` mark until long rest). `afterDualityRoll` prompts once when either Duality Die of an action roll shows the number, also when both do (decision 6). "Strange Patterns: benefit" (`params.choice` hope or stress; default Hope, or Stress at full Hope) checks the latest roll and marks it claimed (a hidden `featureUses` entry keyed by that roll), so one benefit per roll. |

## Tests

- `tests/unit/class-features-core.test.ts` (21): every feature above.
- `tests/convex/class-features-core.test.ts` (5): Rally reaches every active non-away PC once per session, another PC spends the die on an action roll, session end clears unspent dice; undoing Rally reverts both sheets; Prayer Dice at session start (none at trait 0) and undo; Strange Patterns prompt after a matching manual roll, one benefit, undo; Unstoppable once per long rest and its die on damage.
- `tests/e2e/class-features.spec.ts`: a Bard rallies, a Warrior spends the Rally Die in the dice box, ending the session clears the Bard's unspent die.

## Known gaps (outside this tracer's files)

- The features panel sends parameters only for the Hope features it knows (ally, Evolution trait, Volatile Magic dice). Strange Patterns' number, Channel Raw Power's card, Beastform's form, Ranger's Focus target name, Prayer Dice selection and ally, and prompt answers need generic inputs in `src/components/party/features/panel.tsx` and clickable prompt choices in the dice box.
- A Rally Die held by a Hope & Fear class (Assassin, Brawler, Warlock, Witch) is offered only if T8c's modules call `rallyDieOptions` and list `rallyDieStress` from `classes/bard.ts`; a generic held-dice pass in `hooks.ts` would remove the per-class wiring.
- Strange Patterns prompts follow action rolls only: `rolls.ts` calls `afterDualityRoll` for action rolls.
- Combat Training now adds the level to every Warrior damage roll, so `tests/convex/rolls.test.ts` ("weapon damage rolls Proficiency-many dice", a level-1 Warrior) expects one more: `2 * sides + 1 + 2 + flat + 1`.
