# TASK AA2b: Adversary server follow-ups

Plan `.omc/plans/combat-actions.yaml`, tracer AA2b (depends on AA2, CA4b). Beads dcm-bxp.99.23, dcm-bxp.99.22, dcm-vv2,
dcm-yle. Closes the open items of `TASK-CA-AA2.md`, CA4b's Q4 and CE-valor's "For AA2". CB = Core Book, printed pages.
Status: Review.

## User answers implemented (2026-10-22, binding)

- "a hit that takes a PC to their last HP prompts that player's death move at once"
- "I Am Your Shield moves the attack's riders with the damage to the ally"
- "card damage to another PC opens the same incoming-hit prompt"
- "Onslaught's Major floor applies to any weapon-damage hit (plain attacks and cards attacking with the weapon's damage)"

## Acceptance and how it is met

| Acceptance | Where | Test |
|---|---|---|
| Last HP → death-move prompt | `resolveIncomingHit`: `deathMove` = the final sheet reached `hpMax` from below (hit marks plus riders); clears `characters.deathMoveSpent`, so `deathMoves.state.awaitingMove` turns true (the sheet's existing modal). Returned on `respond` (`deathMove`), `attack` / `useFeature` targets (`deathMove` when resolved at once) and `resolve`. | adversary-actions "a hit that marks the last HP…" |
| Riders follow I Am Your Shield | `Work.absorb` turns a hit PC's other marks from the action (conditions, effects, Hope, Stress, forced HP; also from later reactions / autos) into `riders` on the hit row; `applyRiders` puts them on whoever took the hit, unless the hit was avoided (`negated`). | "I Am Your Shield: Bite's Restrained moves…", the Bite test |
| PC attacker; card damage to another PC opens an incoming hit | `incomingHitPayloadValidator.attacker` widened to a union with `{kind: "pc", characterId, label, cardId, feature?}`; `cardRows.openCardHits` (called from `combatCards.resolveUse`, owns extended by the orchestrator) opens one hit per PC the plan's `pcDamage` steps name, in the card use's group; their `pcDamage` prompts are dropped. The attacker doesn't answer their own card's hit. | combat-cards "card damage to an ally…", "undoing a card use…" |
| Undo declines open hits of the group | `actionLog.undoEntry` → `declineGroupHits` (open `incomingHit` rows with the group's id). | "undoing an action with an open hit…", "Resolve now passes… undo declines…", combat-cards undo test |
| Per-instance `featureUses`; once-per-scene enforced, reset at scene end | `encounterAdversaries.featureUses?` `[{key, until, scene}]` (widen only). Runs read `instanceUses` (entries whose `scene` = the encounter's `startedAt`); `commit` writes the new ones. Ending the encounter ends the scene; a restart has a new `startedAt`. | "a once-per-scene feature…" |
| Onslaught on card attacks; CE-valor after-hit uses | `cardRunner.withOnslaught` (in `runCard`): a successful use whose steps roll `weapon` damage turns each Minor hit on an enemy into Major (+1 HP). After-hit: `window.afterHitUses` → Rise Up / Valor-Touched autos run in `resolveIncomingHit`; Unbreakable (and `wouldMakeDeathMove` self cards) offered: the row stays open with `payload.afterHit`, answered through `respond` (`card` / `pass`) or the GM's `resolve`. Bold Presence: `wouldGainCondition` fits a hit with condition riders; its `negateCondition` fold keeps them off. | combat-cards Onslaught; "Unbreakable…", "Rise Up…", "Bold Presence…"; unit adversary-actions-aa2b |
| AA1 runner problems | see below | unit adversary-effects-run-aa2b |

## Runner fixes (beads dcm-vv2, dcm-yle; AE notes)

| Problem | Fix |
|---|---|
| dcm-yle: My Turn's Fear read from `triggerAmount` spent without asking | `upfrontFear` passes `trigger.amount` / target count into the env; `run` refuses `confirmFear`. Server passes `args.trigger.amount`. |
| AE-t2-core 1 / dcm-vv2 7 / 9: prompt numbers without `triggerAmount`, `lastRoll`, target counts | `adversaryNumberEnv(…, extra)`; the prompt env reads the trigger amount, the latest `check` / damage roll before the step, and picked / hit / failed-save counts. |
| AE-t2-core 2: adversary-only steps inside a PC save lost their kind | New plan field `saves?: [{targetIds, step}]` (the save as written); the server adds "If Ash fails: Countdown Petrification: start at 4" prompts. |
| dcm-vv2 3: `passiveSummary` dropped advantage mods | New optional `advantage` / `disadvantageAgainst` lists; the server gives an attack one advantage for an `attack` / `any` advantage passive, and passes the GM's situations to the passives. |
| dcm-vv2 4: negative Horde plus "1d4+-1" | `plusText`: "1d4-1". |
| dcm-vv2 6: `passiveSummary` read `gmFear` 0 | new `gmFear` parameter; the server passes the Fear. |
| dcm-vv2 5: a defeated instance kept `defeated` after its HP was cleared | `selfAfter.defeated` = full HP, or still defeated with HP not cleared; `commit` follows it (also for allies). |
| dcm-vv2 8 / AA2 7: a forced Armor Slot from a later reaction run stayed on the sheet | `absorb` folds it into the open hit's `forcedArmor`. |
| dcm-vv2 10: a dice Attack Modifier rolled on every run | `attackDiceOnAttacks` context flag (the server sets it): rolled only for uses that attack. Off by default because the AE tables feed those dice on every run (turning it on everywhere broke 4 t4-core tests). |

Not fixed here (would change table outputs; reported, not edited):

- **dcm-vv2 1 / AA2 3: follow-up attack rolls without the Attack Modifier.** Adding ATK to a follow-up attack in a use
  without a main roll changes Battle Box's Randomized Tactics (t2-core, carries the +2 itself) and Cursed Merfolk's
  "Get Over Here!" (t3-hf: expected 13, would be 18). The entries carry ATK as a workaround; the fix needs the entries
  cleaned first (AE owners), then `rollModifier` for `attacks` in run.ts.
- **dcm-vv2 2: card run.ts damage cache / follow-up critical** are in `src/lib/domain/card-effects/run.ts` (not owned).

## API additions (additive; AA3 / AA4 / AA5)

- `adversaryActions.respond` result: `deathMove?`, `afterHit?`. A row with `afterHit` accepts only its character's
  `card` (one of `cardIds`) or `pass`; others NOT_A_RESPONDER. A death-move offer whose moment passed declines the row.
- `adversaryActions.resolve` on an after-hit row: closes it (passes the offer), returns the stored severity / hpMarked /
  deathMove.
- `adversaryActions.attack` / `useFeature` `targets[]`: `deathMove?`.
- `adversaryActions.pending` items: `afterHit?`, `deathMove?` (after-hit rows: no damage fields, `cardIds` = the offer),
  `originalTargetName?` (after a redirect: who was hit first, for "Tabby stepped in"); `cardIds` no longer lists a card
  the character already played in this window.
- `adversaryActions.windows` items: `instanceId` is now optional (absent for a PC attacker), new `attackerCharacterId?`,
  `afterHit?` (then `awaiting` = the hit PC). The handler returns one object shape with both fields optional.
- `incomingHits.ts`: `isPcAttacker`, `attackerInstanceId`, `applyRiders`, `respondAfterHit`, `hasAfterHit`;
  `OpenHitInput.riders?`; `HitResolution.ridersApplied / autos / afterHit`. `WindowResolution.conditionNegated`,
  `Fold negateCondition`, `WindowHit.conditionRiders?`, `afterHitUses`, `afterHitTriggerFits`.
- `cardRows.openCardHits`, `cardRunner.withOnslaught`, `dealsWeaponDamage`; `adversaryActions` lib `ridersOf`,
  `instanceUses`, `adversaryOnlyPrompts`.

## Public functions and roles

No wrapper, `need` or argument validator changed (the `respond` choice union is unchanged); the matrix entries and role
tests stand as in TASK-CA-AA2.md. `combatCards.useCard` / `sanction` unchanged in access.

## What a player receives (Q14, U1)

Unchanged: `pending` shows the hit PC only their own numbers; after-hit rows show no damage at all; a PC attacker's label
is the character's name. Riders and after-hit uses write public rows without numbers (the GM row has them).

## QUESTIONS

1. **Riders on an avoided hit**: riders don't land when the hit was negated (missed, damage negated or reflected). Should
   a rider still land when only the damage was negated (not the attack)?
2. **Session-limited adversary features** are recorded with the scene marker too, so they also reset when the encounter
   ends. Keep them across encounters of a session?
3. **Undo and limited uses**: undoing an action doesn't give back an instance's limited use (`adversaryBefore` has no
   `featureUses`; its validator is not AA2b's). Widen it?
4. **After-hit autos "from an attack"**: every incoming hit counts as from an attack (card damage to an ally included)
   for Rise Up's `fromAttack`. Confirm.
5. **A PC attacker answering their own card's hit**: excluded from the window (they can't I-Am-Your-Shield their own
   Wall of Flame). Confirm.
6. **Reflected damage to a PC attacker** (Arcane Reflection against a card) is a GM line ("mark it on their sheet").
