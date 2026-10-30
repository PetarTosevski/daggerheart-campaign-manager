# TASK DA0: vocabulary and pure engine for the drawer answers

Plan `.omc/plans/drawer-answers.yaml`, tracer DA0 (bead dcm-bxp.99.19). Foundation of wave 1: the card vocabulary
(`src/lib/domain/card-effects/types.ts`, widen only) and the pure runner (`card-effects/run.ts`) carry what the user's
answers of 2026-10-29 / 2026-10-30 need. The server and the reaction window are later tracers (DA8, DA9, DA11, DA12,
DA13). Book pages are printed pages (CB = Core Book, HF = Hope & Fear).

## What was built

| Answer | Vocabulary (types.ts) | Runner (run.ts) | Consumer |
|---|---|---|---|
| Grappling's Restrain ends when the stance drops (dcm-bxp.99.19.10). HF p.12: "When you drop out of a stance, you lose any ongoing benefits it provides." | `EndEvent` `"stanceDrops"` | travels on the plan's condition / effect step as `endsOn` | DA11 (`stanceDrop.ts`), stances.ts entry |
| Stable replaces the Armor Slot (dcm-bxp.99.19.9). HF p.12: "You can spend a Focus instead of an Armor Slot to reduce damage." CB p.114: "Each time your character takes damage, you can only mark 1 Armor Slot" | `reduceSeverity.insteadOfArmorSlot`, `convertMarks.insteadOfArmorSlot` | the fold step keeps the flag | DA8 window: never more than one step with the slot, no slot marked, no armor needed |
| Dark Aegis cancels the damage to zero (dcm-bxp.99.19.13). HF p.14: "Once per long rest when you would take damage, you can spend a Favor instead of marking Hit Points." | `negate` `what: "damage"` + `ignoreOnHitHp` | fold; `foldsFromPlan` already reads it as `negateDamage` (severity none, taken 0) | DA8: on-hit "mark HP" ignored, conditions still apply |
| Draining Bane's clear is ticked by default (dcm-bxp.99.19.15). HF p.14: "you can clear a Stress." | `optional.defaultOn` | runs when `context.optionals` omits it; skipped only when `context.optionalsOff` names it | DA8 (entry + prompt) |
| Unshakable automated (dcm-bxp.99.19.50 (1)). CB p.59: "When you would mark a Stress, roll a d6. On a result of 6, don't mark it." | `negate` `what: "stress"` | fold | entry changed here (ancestry-core.ts): auto on `wouldMarkStress`, d6 check (logged as the plan's check step), on a 6 `negate` stress; no manual line. DA11 rolls each Stress |
| Warden's Protection rolls 1d4 first (dcm-d95, dcm-bxp.99.19.36). CB p.31: "Once per long rest, spend 2 Hope to clear 2 Hit Points on 1d4 allies within Close range." | `TargetCount` `upTo.rolledFirst` | `rollTargetCount(use, actor, rng)` rolls it for the server; `context.rolledTargetCount` is then the maximum and the runner rolls nothing; `rolledFirst` without a count refuses (`targets`) | DA12 (store the roll, set `rolledFirst` on the entry) |
| The form attack is an attack (dcm-bxp.99.19.6 (5)). CB p.33 Rampage: "before you make an attack roll, you can mark a Stress to gain a +1 bonus to your Proficiency for that attack." | `RollSpec` trait `attack?: boolean` | `rollMatches("attack")` holds for it (`weaponAttack` does not: no weapon) | DA9 |
| Charge: roll first, the server moves the token (dcm-bxp.99.19.16). CB p.59: "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with one or more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range." | `move.mode` `"intoMelee"` | a `move` prompt with `server: true` and `anchorId` (the use's first target, else the picked creature, else the trigger source with `relativeTo: "triggerSource"`), only when the step's gates hold | DA12 (entry + movement) |
| Cannonball rolled by the ally (dcm-bxp.99.19.21). CB p.33: "the ally makes an attack roll using Agility or Strength (their choice) against a target within Close range. On a success, the adversary takes d12+2 physical damage using the thrower's Proficiency." | `CardUse.rolledBy` (`RolledBy`: `who: "ally"`, `proficiency: "actor" \| "roller"`, the roller's `targets`) | actor's run (no `context.roller`): requirements, limit, costs, then an `allyRoll` prompt to the picked ally (`amount` = the actor's Proficiency when `proficiency: "actor"`), no roll, no steps. Roller's run (`context.roller`): no cost or limit again, the roll uses the roller's traits, its Hope / critical Stress clear are plan steps for the roller (not the actor), targets follow `rolledBy.targets`, damage reads the Proficiency `proficiency` names | DA13 |
| Favor unset reads as 3 (SD4 follow-up). HF p.14: "You start with 3 Favor." | none | `feature-effects/run.ts` `actorExtras` gives an unset `classState.favor` as `favorOf` (3) when the sheet's class or multiclass is warlock; other classes still get no Favor | the server's actor (featureRunner, combatActions, adversaryHits) |

No step kind was added: `STEP_KINDS` is CA0 + SD0 as before and the drift check holds. Every CE-*, AE-*, FE-* and engine
test passes unchanged except the Unshakable test in `tests/unit/feature-effects/ancestry-core.test.ts`, which this
tracer owns and which now checks the cancel (fold) and that no manual line is left.

PlanStep `prompt` was widened (`prompt: "allyRoll"`, `server`, `anchorId`): consumers that switch on `prompt` fall back
to their default branch for `allyRoll` (cardRows ignores it; adversaryActions shows it as a choice) until DA13 wires it.

## Tests

- `tests/unit/feature-effects/engine/drawer-answers.test.ts`: one block per answer, with fixed dice.
- `tests/unit/card-effects/types-widen.test.ts`: the DA0 pieces type-check and the step kinds are unchanged.
- `tests/unit/feature-effects/ancestry-core.test.ts`: Unshakable as above.

## QUESTIONS

1. **Cannonball: whose Proficiency?** CB p.33: "On a success, the adversary takes d12+2 physical damage using the
   thrower's Proficiency." The thrower is the ally who throws the druid ("allow an ally to throw or launch you"), so the
   book reads as the ALLY's Proficiency, while the plan (DA0 acceptance) says "with the actor's Proficiency". Built:
   `rolledBy.proficiency` is a required field with both values; the test entry uses `"actor"` as the plan says. DA13 sets
   the real entry and asks the user (its acceptance already flags this).
2. **Favor 3 for non-warlocks?** D5's `favorOf` reads any unset Favor as 3 regardless of class. Built: only a warlock
   (class or multiclass) reads 3, so other classes' plans carry no Favor (an unset Favor elsewhere stays absent, as
   before). Change if the user wants every sheet to read 3.
3. **Charge's anchor.** CB p.59 says "into Melee range with one or more targets"; the plan says "into Melee of a picked
   target". Built: the anchor is the use's first target. Which square the server picks is DA12's (flagged there).
