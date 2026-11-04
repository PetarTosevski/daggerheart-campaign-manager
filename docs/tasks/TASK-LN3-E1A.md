# TASK-LN3-E1A: card and feature use paths (lanes-2 wave 9, tracer E1.3a)

Branch `lane3-e1a`, lane `w1-e1-triggers-rolls`. Tests: `tests/convex/lane3-e1a-use-paths.test.ts`.

## What landed

- **`afterUse` (convex/combatCards.ts)**: one after-step for a resolved card or feature use, in its undo group:
  `applyUseEnds` for the use's plan and for each rider run's plan (`endEffect` / `replace` steps, effects and areas whose
  tokens are gone), `endSpellCast` when the source is a spell (Through Your Eyes, Veil of Night: `castsSpell`), the
  `targetDefeated` effects of every party sheet on the instances the use defeated (`endDefeatedOnParty`, Marked for
  Death, HF p.8), an ordinary Cloaked after an attack use (`isAttackUse` + `uncloakAfterAttack`, CB p.42 / p.99), one
  public row naming the areas that ended, then the plan's map areas (`placeAreasFromPlan`). A wall without two squares or
  a `point` area without a square is left for the table ("place … on the map by hand"). `useCard` and its sanction call it
  (`afterCardUse`); `useFeature` and its sanction call it (`afterFeatureUse`).
- **`useCard` args**: optional `point: {x, y}` and `points: {x, y}[]` (at most `MAX_AREA_COUNT`); `useFeature` gains
  `points` beside its `point`.
- **Riders on a feature's roll** (dcm-1kvg, dcm-3s6e): `cardWithRiders` is now a generic `runWithRiders` over any
  `UsePick` with a `build(sheet, folds)` callback; `rollHost`, `autoUsesOn`, `foldSteps`, `makesDamageRoll` are exported.
  `useFeature` takes `riders` and `riseToTheChallenge`; sent riders, automatic uses that fit (Wolf Form's +1d10 on Fangs)
  and default-on riders run around the feature's action roll (`pickFeature({... transform: foldSteps})` rebuilds it).
  The public row's `before` is the sheet before the riders' costs (one undo returns them); after-roll riders' sheet
  changes go on top of what `resolveFeatureUse` wrote (`riderDelta`). The before-roll riders' costs are saved before the
  resolver runs (it writes only what the use itself changes).
- **dcm-ef77**: `useFeature` passes `heldDicePicks` (`splitFeatureChoices`) to `pickFeature`.
- **Shared grants on card rolls** (dcm-79v1 card half): the effects a card's roll ends go through `endSharedGrants`: the
  other party sheets' copies end in the same group (Bird's-Eye View, CB p.33).
- **Cloaked**: `characters.toggleCondition` turning a condition off uses `withoutCondition` (drops the source marker,
  dcm-bxp.99.19.68); turning Unconscious on drops Cloaked. `deathMoves`: Avoid Death and leaving play drop Cloaked in the
  death row (dcm-bxp.99.19.63; undo puts it back).
- **Hand recall riders** (dcm-ego9): the vault shows a check box per ready recall rider ("Perfect Recall: -1 Recall
  Cost"); the recall sends the checked ids as `moveCard.recallRiders`.

## Beads

- dcm-m48i: closable (card paths call `applyUseEnds`, `endSpellCast`, `placeAreasFromPlan`). The auto / trigger uses
  outside combatCards (Avatar of Terror's upkeep in combatActions / dread) are not E1.3a's files: see follow-ups.
- dcm-9nlr: closable (`endAfterUse` was renamed `applyUseEnds` in E6 round 2; useCard runs it and takes `point` / `points`).
- dcm-76l5: closable ((1) and (2) landed in wave 8, (3) here).
- dcm-1kvg, dcm-3s6e: closable for the engine (riders and automatic uses on a feature's roll). Left: the drawer's rider
  options for a feature roll (combat-ui) and riders replayed on a GM-approved feature use (the feature sanction payload has
  no `riders`; follow-up for E2's validator).
- dcm-bn1, dcm-gvr: closable with them (Fangs `attack: true`, Elemental Breath / Long Tongue `asWeapon: true` reach
  attack riders through `rollHost`).
- dcm-ef77: closable.
- dcm-ego9: closable.
- dcm-bxp.99.19.67, .68, .63: closable.
- dcm-uwg1: card half done (defeat ends on every party sheet from card damage). The attack-path half is E1.3b's.
- dcm-79v1: card half partly done: `endSharedGrants` runs on a card's roll. `endGrantedBenefit` is not called: no roll
  path records which effect's benefit it used (no SRD entry uses `benefitGranted` yet). Left with the roll half (E1.3b).

## Follow-ups

- dcm-0x2g, sanction point replay (E2.3 widened `sanctionAction.point` for card and feature): once E2.3 is merged, `useCard` /
  `useFeature` store `point` in the sanction payload and their `sanction` handlers pass it to `afterCardUse` /
  `afterFeatureUse` (both already take it). Small; E1 lane.
- dcm-mcgj, feature sanction payload `riders` (validators/combatRequests.ts, E2's): until then an approved out-of-range feature use
  runs only its automatic and default-on riders.
- dcm-aiwg, feature drawer: offer rider options for a feature roll (combat-ui).

## R1 / dcm-ky8b reminders that can go after this merge (wave 10, S lanes)

- Confusing Aura (arcana.ts ~565), Time Lock (codex.ts ~522), Avatar of Terror (dread.ts; dcm-ky8b): card `endEffect` on
  self now runs.
- Flight (arcana.ts ~255) and Invisibility (grace.ts; dcm-ky8b): `tokensGone` now runs from card uses.
- Veil of Night / Through Your Eyes: `castsSpell` ends now run from card casts; Veil of Night's area places on `point`.
- Breaking Blow and Rune Ward are not E1.3a's (dcm-yd5h, dcm-a9c).

## Data switches ready for wave 10

- arcana.ts: drop the R1 reminders on Confusing Aura and Flight.
- codex.ts: drop the R1 reminder on Time Lock.
- dread.ts: Avatar of Terror needs no reminder (dcm-ky8b part).
- grace.ts: Invisibility needs no reminder (dcm-ky8b part).
- Card area steps with `centre: "point"` now place from `useCard` when the Hand sends `point` (the Hand's point picking is
  AO's / combat-ui).

## QUESTIONS

1. **What counts as an attack for Cloaked.** CB p.42: "After you make an attack ... you are no longer Cloaked"; CB p.99:
   "When you make an action roll with the intent to harm an adversary, you're making an attack roll". Built: a card or
   feature use is an attack when its roll is a weapon attack, a trait roll marked `attack` / `asWeapon`, or when it rolls
   damage with an enemy target (a Spellcast attack). A spell that only debuffs an enemy (no damage) keeps Cloaked. Agreed?
2. **Unconscious by hand.** Toggling Unconscious on in the token card drops Cloaked (user 2026-10-30 answer read as any
   way of becoming unconscious). Agreed?

## Merge-time actions

- Authz: `combatCards.useCard` gained optional `point`, `points`; `combatFeatures.useFeature` gained optional `points`,
  `riders`, `riseToTheChallenge`. No new public function; the existing entries stay valid (all args optional).
- Regenerate `convex/_generated`.
