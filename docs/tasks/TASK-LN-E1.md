# TASK LN-E1: triggers, roll filters, rolls and the Hand

Plan `.omc/plans/lanes.yaml`, tracer E1 (label `w1-e1-triggers-rolls`). V widened the vocabulary (`docs/tasks/TASK-LN-V.md`);
E1 makes the server act on the E1 members. No SRD entry uses them yet (wave 5 switches the data), so
`tests/convex/lane-e1-triggers-rolls.test.ts` injects fixture entries named after the card or feature they stand in for.
Book pages are printed pages (CB = Core Book, HF = Hope & Fear).

Files: `convex/lib/combatActions.ts`, `convex/combatCards.ts`, `convex/lib/cardHand.ts`, `convex/lib/rolls.ts`,
`tests/convex/lane-e1-triggers-rolls.test.ts`, this file. `convex/rolls.ts` needed no change: its `actionRoll` /
`manualRoll` spread `dualityFields`, which gained `situations`.

## What the server does now

- **Host** (what a rider rides on) carries `slot`, `fromUse` (`{id, useId}`), `cardDomain` and `damage` (whether the move
  rolls damage). A weapon attack sets `slot` and `damage: true`; a card use (`combatCards.cardHost`) sets `fromUse`, its
  card's domain, `damage` from its steps, and counts a trait roll with `asWeapon` as a weapon.
- **`riderPhase`** reads the widened filters: `beforeYouRoll.weaponSlot` / `.weaponRange` (at most that range) /
  `.fromUse`; `whenYouAttack` needs an attack roll (`hostMatches("attack")`), `.weaponSlot`, `.fromUse`, and a feature
  that is its own weapon passes `weapon: true`; `afterYouRoll.fromUse` / `.cardDomain`; `whenYouDealDamage` and
  `whenTargetMarksHp` `.fromUse`; `afterAllyRolls` with `includeSelf` rides on the actor's own roll; `gmWouldGainFear`
  with `byYou` rides on the roll's result.
- **`resultHolds`** (via `rolls.rollResultHolds`): every `RollResult` on `whenYouAttack`, `afterYouRoll`, `afterAllyRolls`
  and `gmWouldGainFear`, plus `duality` (with Hope / with Fear) on top of the result. A critical is a success with Hope.
- **`rollTargetHolds`**: `against.enemy`, `against.within` (from the actor's token), `against.creature` (`tagged`,
  `hexed` from the instance's tags / conditions) and `afterYouRoll.noDamageRoll`, on the weapon attack's main target and
  on a card's first target; `inArea` and the other creature keys are the player's to confirm (Q13) and hold.
- **Automatic uses**: `autoRiders` includes the loadout cards' `auto` uses (it had features only), so a card's automatic
  use rides on weapon attacks and on card rolls. A card use with an automatic rider now runs through `cardWithRiders`
  (which keeps a choice's dice like `runKept`).
- **Allies' automatic uses** (`allyAutoRuns`): after a weapon attack's damage, every other PC on the map whose loadout
  card or held feature has an `auto` `afterAllyRolls` use that fits (range to the roller, roll filter, result, Hope /
  Fear, target) runs it as their own use against the targets hit; their sheet row joins the attack's group (undo).
- **Plain rolls** (`rolls.duality`, i.e. `actionRoll` / `manualRoll`): the held features' and loadout cards' `auto`
  `afterYouRoll` uses that touch only the actor run on the roll (`plainRollAutos`), in the roll's row. Success / failure
  results need a Difficulty.
- **Live card-effect mods** (`rolls.liveMods`): passive uses' `mods` of loadout cards and held features, and the
  `effect` steps behind the sheet's effects (by owner id and label). Read for `weaponTrait`, `extraTargets` and a
  situational `advantage`.
- **Duality die bonus**: `withDieBonus` (one die's result + n, total and outcome read again); a before-roll rider's
  `modifyRoll` `dieBonus` fold is applied to the attack roll with its Hope / Stress / Fear.
- **Recall** (`cardHand.recallReductions`, in `moveCardFor`): `whenYouRecall` uses with a `loadout` `reduceRecallCost`
  step lower the Recall Cost (an `auto` always; a `rider` when passed in `recallRiders`), through the runner (limit).
- **Swap** (`combatCards.useCard` `swapWith`): a plan's `loadout` `swapWithVault` step moves the card to the vault and the
  named vault card into the loadout without its Recall Cost.

## Beads

| Bead | State | How |
|---|---|---|
| dcm-0gi Eclipse, ally succeeds with Hope vs an adversary | done (weapon attacks) | `afterAllyRolls` `includeSelf` on the own roll; `allyAutoRuns` for allies; `result`, `against.enemy` read. An ally's card roll does not run allies' autos yet (only weapon attacks). |
| dcm-1o3 Dread-Touched, succeed with Fear | done (weapon attacks) | `gmWouldGainFear` `byYou` + `result` is a rider phase; its `negate` folds to `preventFear` and the roll's Fear is not gained. Card rolls: not yet (the runner adds its own Fear). |
| dcm-3ft Adjust Reality, after any roll | partly | `afterAllyRolls.roll` (`any` too) is read for automatic uses. Adjust Reality is a reaction by another player: needs a request kind (follow-up dcm-cfpv). |
| dcm-3ou Ill Omen, bonus on the Fear Die | partly | `withDieBonus` + `dieBonus` fold on the attack. Nothing dispatches adversary `pcRolls` uses on a PC's roll (E7 follow-up dcm-of7v). |
| dcm-5dg Versatile Fighter | done (server) | Live `weaponTrait` mod: the attack rolls the trait the player sends (or the mod's fixed trait). Attack bar picker: E4 follow-up dcm-jkhp. |
| dcm-5z3 Courage, fail with Fear | done | `duality` filter in `resultHolds`; plain rolls run `afterYouRoll` autos (`plainRollAutos`); attacks run them as auto riders. |
| dcm-733 Patron's Mantle, advantage to intimidate | done (server) | `dualityFields.situations`; a live `advantage` mod with a marked `situation` adds an advantage die. Dice dialog check boxes: follow-up dcm-cfpv. |
| dcm-7zb Lead by Example | not | Instance effects store no mods (validators/encounters.ts); E2 owns `attackedRider` (dcm-9gw). Follow-up dcm-kso9. |
| dcm-86z Encore, the trigger's damage type | not | The trigger is a Hand reaction with a `triggerAmount` choice: needs a choice in `cardChoices.ts` (E3) and `trigger.damageType` in `cardRunner.ts` (E4). Follow-up dcm-aw16. |
| dcm-94h Twilight Toll | done | `against.creature` (tagged) and `noDamageRoll` (Host `damage`) on riders and after-roll offers. |
| dcm-a9n Favor / Diminish My Foes | done | `successWithHope` on `afterYouRoll` riders and autos (`resultHolds`). Favor as a reaction on a plain roll is still a drawer use. |
| dcm-ab5 Ignition, primary weapon only | done | `whenYouAttack.weaponSlot` / `beforeYouRoll.weaponSlot` against Host `slot`. |
| dcm-bn1 Fangs is an attack; Feed narrowed to Fangs | partly | `fromUse` on every roll trigger; `whenYouAttack` needs an attack roll. Feature uses with a roll run no riders at all (featureRunner, E8): follow-up dcm-1kvg. |
| dcm-bxp.99.19.1 Perfect Recall | done (server) | `recallReductions` in `moveCardFor` (`auto` always; `rider` via `recallRiders`). `characters.moveCard` and the Hand don't pass riders yet: follow-up dcm-cfpv. |
| dcm-f0m Cinder Grasp's On Fire | not | A `bearerRider` on an adversary's action: E2's Poisoned engine with E7's action hook. Follow-up dcm-0wj1. |
| dcm-g6t Forest Sprites | partly | `afterAllyRolls.roll` / `.against` read for automatic uses; Forest Sprites is a reaction (+3 to the ally's roll) by another player: follow-up dcm-cfpv. |
| dcm-gvr Elemental Breath / Long Tongue | partly | `isWeaponRoll` / `hostMatches`: `asWeapon` is a weapon attack for every filter, and card hosts set it. The entries are feature uses (no riders yet): dcm-1kvg. |
| dcm-iu4 Tactician, when you Help | not | `whenHelping` needs the helpers' identity on the roll (the args carry a count) and an ally prompt: follow-up dcm-cfpv. |
| dcm-jog Backhanded Guidance | partly | As dcm-3ou (`withDieBonus`); the GM's reaction on a PC's roll: dcm-of7v. |
| dcm-nhr Ethereal Visage | done (riders / autos) | `successWithHope` holds; a reaction that doesn't change the roll stays a drawer use. |
| dcm-p1r Codex-Touched | done (server) | `swapWith` on `useCard` runs `swapWithVault`. Hand dialog: follow-up dcm-aw16. |
| dcm-y3e Parallela | done (server) | Live `extraTargets` raises `checkTargets`' bound; the effect ends after the attack (`endedByAttack`, also any effect ending on `bearerAttacks`). Attack bar: dcm-jkhp. |
| dcm-z1a Fane of the Wilds | done | Host `cardDomain`; loadout cards' autos ride on card rolls (`cardAutos`). |

## Follow-up beads filed

- dcm-aw16 (lane:w1-e3-steps-saves): Hand dialog `swapWith`; Encore's trigger damage type (cardChoices + cardRunner).
- dcm-jkhp (lane:w1-e4-targeting-areas): Attack bar trait picker (weaponTrait) and extra targets (Parallela).
- dcm-of7v (lane:w1-e7-adversary-engine): adversary `pcRolls` uses on PC rolls, applying `withDieBonus`.
- dcm-0wj1 (lane:w1-e2-damage-window): On Fire's `bearerRider` `acts` with Poisoned's engine.
- dcm-1kvg (lane:w1-e8-session-features-rests): feature uses with a roll take riders / autos (Fangs, Feed, Breath).
- dcm-kso9 (lane:w1-e2-damage-window): Lead by Example's `attackedRider` attacker steps (instance mods).
- dcm-cfpv (lane-followup, no wave-4 owner): `characters.moveCard` `recallRiders`; dice dialog situations; ally roll
  reactions and Help identity.

## QUESTIONS

1. **A duality-die bonus and criticals** (dcm-3ou, dcm-jog). HF p.87 Backhanded Guidance: "add 1d6 to the result of their
   Fear Die"; HF p.95 Ill Omen: "their Fear Die gains a bonus equal to the amount of Fear you have". `withDieBonus`
   compares the dice after the bonus, so a bonus that makes the two results equal reads as a critical success, and one
   that lifts the Fear Die above the Hope Die makes the roll with Fear. Is a matched result after a bonus a critical?
2. **Lead by Example** (CB p.342): "The next PC to make an attack against that adversary can clear a Stress or gain a
   Hope." Does the caster's own next attack count (V's QUESTIONS 2)? Not built here (dcm-kso9).
3. **Plain-roll automatic uses' Fear**: `plainRollAutos` only applies a Fear gain a use makes; a use that would take Fear
   from the GM on a plain roll is ignored (none exists yet).
