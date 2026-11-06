# TASK-RULES-RA2: R3 on card and feature rolls; S1 on every PC action roll

Plan `.omc/plans/rule-switches.yaml`, tracer RA2 (bead dcm-jh6d.67). Follows RA (`docs/tasks/TASK-RULES-RA.md`).

## User answers 2026-11-06

1. R3 Manual keeps a critical's Hope and Stress clear (CB p.90); only the ordinary +1 Hope / +1 Fear stop. RA already
   did this (`dualityEffects`); RA2 tests it on card and feature rolls too.
2. S1 fires on every PC action roll, not only while an encounter runs. `planPcActionRoll` no longer reads the running
   encounter. The spotlight row (`combatSpotlight`) is per campaign and needs no encounter, so `moveToGm` works as is:
   Book moves it to the GM outside a fight, Manual posts the note. Still nothing while the GM already holds it.
3. Card and feature rolls follow R3. `RunContext.hopeFear` (src/lib/domain/card-effects/run.ts) carries the mode into
   `rollOnce`'s `dualityEffects`; `buildRun` (convex/lib/cardRunner.ts) sets it from the campaign, so every card and
   feature use built there (useCard, useFeature, featurePrompts, ally picks, areas) follows it. In Manual a later Hope
   cost (R8, Bolt Beacon) needs Hope the PC already holds; no Hope, the cost goes unpaid as for a roll with Fear.

## The R3 note on card and feature uses

`PcActionRoll.fearWithheld` unset now means: one Fear for an action roll with Fear in an R3-Manual campaign. The card
path (`convex/combatCards.ts`, not RA2's file) and the feature path (`featureRunner.resolveFeatureUse`) pass none, so they
get "Ash rolled with Fear: gain 1 Fear?" in the use's group; undoing the use takes it back.

## Not done

- A follow-up's own roll (Double Swipe's second attack) also gains nothing in Manual, but posts no R3 note and sets off
  no S1: `afterPcActionRoll` runs once, for the use's main roll.
- `convex/combatCards.ts` still says "R3 stays Book here" in a comment (not RA2's file).
