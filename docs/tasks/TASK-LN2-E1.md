# TASK LN2-E1: triggers, rolls, the Hand and moveCard (round 2)

Plan `.omc/plans/lanes-2.yaml`, wave 8, tracer E1 (label `w1-e1-triggers-rolls`, branch `lane2-e1`). Round 1:
`docs/tasks/TASK-LN-E1.md`; bead split: `docs/tasks/TASK-LN-V2.md`. No types.ts or `src/lib/srd/**` edits: the SRD
data switches are wave 9. Tests: `tests/convex/lane-e1-round2.test.ts` (fixture entries named after the cards), and
`tests/convex/lane-e1-triggers-rolls.test.ts` (the die-bonus expectation follows the user's answer).

Files: `convex/lib/combatActions.ts`, `convex/combatCards.ts`, `convex/lib/cardHand.ts`, `convex/lib/rolls.ts`,
`convex/characters.ts`, the two test files, this file.

## What landed

- **Duality die bonus** (user answer 2026-10-31; dcm-jog, dcm-3ou): `withDieBonuses` adds every bonus to its die, retotals,
  and never makes a critical (a roll that was a critical stays one); otherwise Hope vs Fear is decided after the bonus and
  a tie is WITH FEAR. The attack applies all `dieBonus` folds at once. Dispatch of adversary `pcRolls` uses on a PC's
  roll stays E7's (dcm-of7v).
- **Trigger range, reach, host range** (dcm-76l5 (1)(2), dcm-x7p, dcm-ssf, dcm-ofy): `dealDamageHolds` checks
  `whenYouDealDamage.within` / `.toEnemy` against the first hit creature that fits; that creature is the rider's
  `triggerSubject` in both its parts. `RollChange reach` folds into `Folds.reach`; `addRange` gives `weapon` and
  `hostRange` added targets the weapon's range widened by the reach (`widenRange`, at most Very Far).
- **Auto riders pick "all" creatures** (dcm-umti): `autoPicked` fills an automatic use's `picked` step with count `all`
  from the map (side, range, `excludeSubject`; enemies seen with line of sight and in a running encounter; allies = other
  PC tokens). Other counts are still the player's.
- **Host dice on riders** (dcm-n0dv): `RiderEnv.hostDice` (set after the roll, on attacks and card rolls) becomes the rider
  run's `context.hostRoll`, so a `dualityDie` number reads the host roll's Hope / Fear Die (Midnight-Touched).
- **Recall riders through the Hand** (dcm-cfpv (1), dcm-bxp.99.19.1): `characters.moveCard` takes
  `recallRiders: string[]` (optional; `<featureId|cardId>` or `<id>:<useId>`) and passes it to `moveCardFor`.
  `combatCards.hand` returns `recallRiders` (editor only, omitted when empty): the `rider` uses with a `whenYouRecall`
  trigger and a `reduceRecallCost` step on the loadout's cards and held features, with `ready` and `amount`
  (`cardHand.recallRiderOptions`). The Hand UI button is not built (UI files not owned; see follow-ups).
- **Effect ends from PC rolls** (dcm-wn7; covers the engine side of dcm-ffk, dcm-3ea, dcm-0ey, dcm-cwh, dcm-utu):
  - plain rolls (`rolls.duality` via `rollEndsOnSheet`): the roller's condition markers and effects that end on the roll
    (trait, `attack: "other"` for a roll marked attack), in the roll's row; the summary names them ("X ends");
  - weapon attacks (`endsFromAttack`): the attacker's effects ending on the roll (`weapon` slot, trait,
    `targetsCreature`), caster-side instance modifiers its token made (`endForCasterOnInstances`; Timejammer),
    `damageTaken` on each hit instance (Slumber), `damageDealt` on the attacker with the worst severity, and
    `endOnDefeat` on the attacker for each instance the attack defeated (Marked for Death). Undo: touched instances are
    snapshotted with their effects on the GM row; caster-side ones not otherwise in the group are added to it;
  - card rolls (`combatCards.resolveUse`): the actor's effects ending on the card's roll (`cardEndRoll`: spellcast,
    weapon / other attack, trait, targetsCreature) and caster-side instance modifiers, logged in the use's group.
- **Rider facts** (dcm-aeg, part): `creatureFacts(instance, scene, token)` adds `distance` (squares from the attacker) and
  `nearestAlly` (squares from the creature to the nearest PC / ally token other than the attacker) for feature riders
  and after-roll offers (Kick / Tusks, Sneak Attack); after-roll offers also get `weapons.attacking` (Surrounded).

## Beads

| Bead | State | Note |
|---|---|---|
| dcm-jog, dcm-3ou | done (E1 half) | user answer applied; `pcRolls` dispatch is E7 (dcm-of7v) |
| dcm-76l5 | partly | (1) and (2) done; (3) area placement from `useCard` waits for dcm-9nlr |
| dcm-x7p, dcm-ssf, dcm-ofy | done (engine) | data: wave 9 (druid-sorcerer.ts, dread.ts) |
| dcm-umti | done | |
| dcm-n0dv | done | |
| dcm-cfpv | partly | (1) server + Hand query done, Hand button not; (2) dice-dialog situation boxes and (3) ally roll reactions / Help identity not |
| dcm-bxp.99.19.1 | done (server) | UI button: follow-up |
| dcm-wn7 | partly | (1)-(4) on the roller / attacker and instances done; party sheets (caster-side `endForCasterOnSheets`, another PC's Marked for Death on defeat) not |
| dcm-ffk, dcm-3ea, dcm-0ey, dcm-cwh, dcm-utu | done (E1 half via dcm-wn7) | dcm-3ea's upgrade options are E6 (dcm-i2tv); data wave 9 |
| dcm-aeg | partly | feature riders and after-roll offers; card riders' facts (cardRunner) and `weapons.attacking` on feature riders (featureRunner `extraFacts` is `target`/`subject` only) and target `areas` not |
| dcm-wut, dcm-85u, dcm-9l4 | partly | through dcm-aeg |
| dcm-9nlr | not | `endAfterUse` is E6 round 2's, being built in parallel (not on `rebuild` yet) |
| dcm-c09o, dcm-yea, dcm-cdz, dcm-dv6, dcm-2gn | not | PC attacks reading adversary passives and emitting the widened adversary events; next round |
| dcm-gtmp, dcm-raa | not | 'would force HP' on the PC's own attacks |
| dcm-mm0f, dcm-kti | not | bearer riders on a PC's rolls |
| dcm-yd5h | not | needs E7's instance mod store (validators/encounters.ts) first |
| dcm-3s6e, dcm-bn1, dcm-gvr | not | riders on a feature's roll (generalise `cardWithRiders`) |
| dcm-1o3, dcm-0gi | not this round | card-roll halves |
| dcm-3ft, dcm-g6t, dcm-iu4, dcm-733 | not | ally reaction request kind / dice dialog (dcm-cfpv (2)(3)) |
| dcm-5dg, dcm-y3e, dcm-p1r, dcm-7zb, dcm-86z, dcm-f0m | unchanged | UI / other lanes as round 1 |

## Follow-ups

- dcm-ego9 (lane-followup): Hand UI, a "Perfect Recall" check box on a recall from `hand.recallRiders`, sending
  `moveCard.recallRiders`.
- dcm-576v (lane:w1-e8-session-features-rests): dcm-aeg remainder, `featureRunner.pickFeature` `extraFacts` to accept
  `weapons`, and cardRunner's rider facts (distance / nearestAlly / areas).
- dcm-uwg1 (lane:w1-e1-triggers-rolls): dcm-wn7 remainder, caster-side ends on party sheets and other PCs' defeat ends
  inside the attack's group; defeat ends from card damage.

## Data switches ready for wave 9

- `druid-sorcerer.ts`: Manipulate Magic (`reach`, `hostRange`), Elemental Incarnation Water (`within: melee`,
  auto `picked` count `all` with `excludeSubject`).
- `dread.ts`: Dark Army (`whenYouDealDamage.within`), Spectral Mist (`endsOn: actionRoll`).
- `grace.ts` / Midnight-Touched riders reading `dualityDie` now get the host dice.
- Perfect Recall stays a rider (user answer) and now runs from `moveCard`.

## Merge-time actions

- `characters.moveCard` args gained `recallRiders: v.optional(v.array(v.string()))` and `combatCards.hand` returns
  `recallRiders` optionally: no new public function; the authz entries stay valid (no new entry needed). Regenerate
  `convex/_generated`.

## QUESTIONS

1. **Plain-roll attacks and ends** (dcm-wn7): a dice-dialog roll marked "attack" is read as `attack: "other"` (not a
   weapon attack), so a `weaponAttack` / `weapon: "primary"` end (Menacing Reach, HF p.15: "a successful attack with that
   weapon") only fires from the map's weapon attack. Simplest reading; confirm.
