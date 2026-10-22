# TASK AE-t1-core: Adversary feature effects, tier 1 core (52 adversaries, 140 features)

Plan `.omc/plans/combat-actions.yaml`, tracer AE-t1-core (depends on AA1). Book pages are printed pages; CB = Core Book.
The tier 1 adversaries are on CB p.210-219.

## What landed

| File | What |
|------|------|
| `src/lib/srd/adversary-effects/t1-core.ts` | `T1_CORE_EFFECTS`: 140 entries, one per printed feature, each quoting its feature text; shared builders for Momentum, Relentless, Minion, Group Attack, Horde, Slow, Swashbuckler, Acidic Form, Split |
| `tests/unit/adversary-effects/t1-core.test.ts` | 145 tests: the table matches the stat blocks exactly (a missing or extra feature fails); every use runs through `run()`; every printed Fear cost is a Fear cost of the entry; each feature runs through `run()` with `queueRng` (the queue must be used up) and its costs, spotlight need, trigger (`triggeredUses`), targets and outcomes are checked |

User answers implemented: **Q15** every feature has an entry. **Q19** Fear costs are upfront costs (the runner asks
"Spend N Fear?" first) or, when the text spends Fear after a hit ("On a success, spend a Fear to …"), an `optional` step
the GM taps; Momentum and Terrifying gain Fear automatically; printed reactions are one-tap prompts. **Q18** ranges are
narrowing only (no map: everything passes). **Q13** damage to PCs comes out as `incoming` hits for the reaction window;
forced Armor Slots ride on the hit. No vocabulary type changed.

Rules used (quoted briefly): CB p.194 "For an adversary to use an action, they must have the spotlight. Passives and
reactions typically don't require the spotlight." CB p.195 reactions: "you can choose to immediately use the reaction".
CB p.161 (AR7) "you make one attack roll and ask if it hits any of the targets" (every multi-target attack). CB p.201 (AR9)
Group Attack. CB p.199 (AR10) Horde. CB p.99 (AR11) reaction rolls; CB p.193 a feature with no printed Difficulty uses the
adversary's. CB p.107 "round up unless otherwise specified" (Magical Reflection's half). CB p.90 a cost that can't be paid
stops the effect (a `pay` step after the roll).

## Reading conventions

- **Actions** are `action` uses that need the spotlight, except features that bring the spotlight themselves (Group
  Attack, Rally Guards, On My Signal's volley).
- **Printed reactions** are `reaction` (one-tap, default No). A plain Fear gain (Momentum, Terrifying) is `auto` (Q19).
- **Passives with a trigger** ("Targets who mark HP from …", "When the X marks HP from physical damage …") are `auto`.
- **Passives that replace the standard attack's damage or targets** under a condition are an extra `action` use with id
  `attack`, which the GM picks instead of the standard attack: Pack Tactics (both), From Above, Backstab, Unseen Strike,
  Flailing Limbs, Ramp Up.
- **"On a success, mark a Stress to …"** is a `pay` step after the roll (unpaid: the rest stops). **"Mark a Stress to …"**
  at the start is an upfront cost.
- **Saves against PCs** are `save` steps: the runner returns one `pcSave` prompt per PC; an NPC in the area rolls a d20.
- **Durations**: "until they break free / clear an HP / …" is `manual` with the words in `endsWhen`; "temporarily" is
  `temporary`; "until the scene ends" `scene`; "until their next rest" `rest`.
- **Targets of triggered uses**: the creature the trigger happened to is the trigger `subject` (the PC hit, the PC who
  rolled); the creature that caused it is the `source` (the attacker).

## Features and readings

| Adversary (p.) | Feature | Activation | Reading |
|---|---|---|---|
| Acid Burrower (210) | Relentless (3) | passive | `relentless 3` |
| | Earth Eruption | action | 1 Stress; every creature within Very Close: Agility reaction roll vs its Difficulty, fail: Vulnerable until they next act |
| | Spit Acid | action | attack all in front within Close; hit: 2d6 phy, forced Armor Slot (no benefit); no-slot rider manual |
| | Acid Bath | reaction `onDamaged` Severe | 1d10 phy to every creature within Close; the blood pool manual |
| Archer Guard (212) | Hobbling Shot | action | attack Far; hit: pay 1 Stress → 1d12+3 phy; Agility disadvantage if HP marked: manual |
| Bear (210) | Overwhelming Force | auto `onTargetMarksHp` standard | knock the subject back to Very Close (prompt) |
| | Bite | action | 1 Stress; attack Melee; hit: 3d4+10 phy, Restrained (manual end) |
| | Momentum | auto `onHit` | GM gains 1 Fear |
| Bladed Guard (212) | Shield Wall | auto `pcMoves` into Very Close | Agility Roll vs the Guard's Difficulty (prompt); fail: can't move in (manual); the line bonus manual |
| | Detain | action | attack Very Close; hit: pay 1 Stress → Restrained (manual end) |
| Brawny Zombie (219) | Slow | auto `onSpotlight` ×2 | `prepare` (no token): add a token, can't act (manual); `act` (token): clear it |
| | Rend Asunder | action | standard attack with advantage, Very Close; hit on a Restrained target: standard damage, direct |
| | Rip and Tear | reaction `onHit` standard | 1 Stress; subject Restrained `temporary`, marks 2 Stress |
| Cave Ogre (210) | Ramp Up | passive + action `attack` | `spotlightCostsFear`; `attack`: standard attack against all within Very Close |
| | Bone Breaker | passive | `directAttacks` |
| | Hail of Boulders | action | 1 Stress; attack all in front within Far; hit: 1d10+2 phy; +1 Fear when 2+ hit (`calc` on the hit count) |
| | Rampaging Fury | reaction `onMarkHp` ≥ 2 | move within Close (prompt); 2d6+3 direct phy to everyone in the path |
| Construct (210) | Relentless (2) | passive | `relentless 2` |
| | Weak Structure | auto `onMarkHp` physical | marks 1 more HP |
| | Trample | action | 1 Stress; move (prompt); attack all in the path; hit: 1d8 phy |
| | Overload | reaction `onAttack` beforeDamage | 1 Stress; `modifyDamage +10` (fold on the attack); spotlight itself again |
| | Death Quake | reaction `onMarkHp` last | attack with advantage, all within Very Close; hit: 1d12+2 mag |
| Courtier (211) | Mockery | action | 1 Stress; one target within Close: Presence reaction roll (14), fail: 2 Stress, Vulnerable until scene end |
| | Scapegoat | action | 1 Fear; one PC; the story effect manual |
| Deeproot Defender (211) | Ground Slam | action | all within Very Close: knocked back to Far (prompt), 1 Stress each |
| | Grab and Drag | action | attack Close; hit: optional 1 Fear → pull into Melee (prompt), 1d6+2 phy, Restrained until the Defender takes Severe damage |
| Dire Wolf (211) | Pack Tactics | action `attack` | requires another Dire Wolf within Melee of the target (`allyWithin`); hit: 1d6+5 phy and +1 Fear |
| | Hobbling Strike | action | 1 Stress; attack Melee; hit: 3d4+10 direct phy, Vulnerable until they clear an HP |
| Giant Mosquitoes (211) | Horde (1d4+1) | passive | `horde 1d4+1` |
| | Flying | passive | requires "While flying"; Difficulty +2, `flying` flag |
| | Bloodsucker | reaction `onTargetMarksHp` | 1 Stress; the subject marks 1 more HP |
| Giant Rat (211) | Minion (3) | passive | `minion 3` |
| | Group Attack | action, no spotlight | 1 Fear; one target (no range); `groupAttack` within Close; Minions move in (prompt); hit: 1 phy per Minion |
| Giant Scorpion (211) | Double Strike | action | 1 Stress; one standard attack roll against up to 2 targets in Melee |
| | Venomous Stinger | action | attack Very Close; hit: optional 1 Fear → 1d4+4 phy, tag Poisoned until a rest (or Knowledge 16); the d6 rider manual |
| | Momentum | auto `onHit` | +1 Fear |
| Glass Snake (212) | Armor-Shredding Shards | auto `onAttacked` succeeded, Melee | the attacker marks 1 Armor Slot; no-slot rider manual |
| | Spinning Serpent | action | 1 Stress; attack all within Very Close; hit: 1d6+1 phy |
| | Spitter | action + auto `spit` | main: 1 Fear, a stat-block token marks the die in play, spotlight itself again. `spit` (`onSpotlight`, needs the token): roll a d6; 5+: everyone in front within Far makes an Agility reaction roll, fail 1d4 phy |
| Green Ooze (215) | Slow | auto ×2 | as the Brawny Zombie |
| | Acidic Form | auto `onHit` | the subject marks 1 Armor Slot (no benefit); no-slot rider manual |
| | Envelop | action | standard attack Melee; hit: standard damage, 2 Stress, tag Enveloped until the Ooze takes Severe damage; per-roll Stress manual |
| | Split | reaction `onHpMarkedAtLeast 3` | requires 3+ HP marked; 1 Fear; the Ooze leaves (`defeat`), summon 2 Tiny Green Oozes, spotlight both |
| Harrier (212) | Maintain Distance | reaction `onAttack` after standard | move within Far (prompt) |
| | Fall Back | reaction `onAttacked` targeted, Melee | 1 Stress; move (prompt); attack the source; hit: 1d10+2 phy |
| Head Guard (212) | Rally Guards | action, no spotlight | 2 Fear; spotlight itself and 2d4 allies within Far |
| | On My Signal | reaction `onSpotlight` first + auto `tick` + action `signal` | main: start Countdown (5); `tick` (`pcRolls` attack): tick 1; `signal`: spotlight the Archer Guards within Far, the volley manual |
| | Momentum | auto `onHit` | +1 Fear |
| Jagged Knife Bandit (213) | Climber | passive | a reminder (manual text); no rule to apply |
| | From Above | action `attack` | requires "The Bandit attacks from above the target"; hit: 1d10+1 phy |
| Jagged Knife Hexer (213) | Curse | action + reaction `hex` | main: tag Cursed `temporary`. `hex` (`pcRolls` with Hope): 1 Stress; on a Cursed subject `modifyRoll swapDuality` (the roll is with Fear) |
| | Chaotic Flux | action | attack up to 3 within Very Close; hit: pay 1 Stress → 2d6+3 mag |
| Jagged Knife Kneebreaker (213) | I've Got 'Em | passive | manual |
| | Hold Them Down | action | attack Melee; hit: no damage, Restrained and Vulnerable (manual end) |
| Jagged Knife Lackey (213) | Minion (3), Group Attack | | as the Giant Rat; 2 phy per Minion |
| Jagged Knife Lieutenant (213) | Tactician | action | 1 Stress; spotlight 2 allies within Close |
| | More Where That Came From | action | summon 3 Jagged Knife Lackeys at Far |
| | Coup de Grace | action | 1 Fear; attack Close; hit on a Vulnerable target: 2d6+12 phy and 1 Stress |
| | Momentum | auto `onHit` | +1 Fear |
| Jagged Knife Shadow (214) | Backstab | action `attack` | requires "The attack has advantage"; roll with advantage; hit: 1d6+6 phy |
| | Cloaked | action | self Hidden and an effect "Cloaked" (advantage on attacks) until after its next attack |
| Jagged Knife Sniper (214) | Unseen Strike | action `attack` | requires Hidden; hit: 1d10+4 phy |
| Merchant (214) | Preferential Treatment | auto `discount` + auto `markup` | Presence Roll against it: success → manual discount; failure → tag "Out of Favor" and manual (pay more, disadvantage) |
| | The Runaround | auto `pcRolls` Presence ≤ 14 vs it | the subject marks 1 Stress |
| Minor Chaos Elemental (214) | Arcane Form | passive | resistant to magic |
| | Sickening Flux | action | 1 HP; all within Close mark 1 Stress, Vulnerable until a rest (or they clear an HP) |
| | Remake Reality | action | 1 Fear; 2d6+3 direct mag to all within Very Close |
| | Magical Reflection | reaction `onDamaged` from an attack within Close | half the damage (rounded up) back to the source, magic |
| | Momentum | auto `onHit` | +1 Fear |
| Minor Demon (215) | Relentless (2) | passive | `relentless 2` |
| | All Must Fall | auto `pcRolls` failure with Fear within Close | the subject loses a Hope |
| | Hellfire | action | 1 Fear; all within Far: Agility reaction roll, fail 1d20+3 mag, success half (one roll, R9) |
| | Reaper | reaction `onAttack` beforeDamage | 1 Stress; `modifyDamage +` its marked HP (fold) |
| | Momentum | auto `onHit` | +1 Fear |
| Minor Fire Elemental (214) | Relentless (2) | passive | `relentless 2` |
| | Scorched Earth | action | 1 Stress; around a point within Far (Very Close radius): Agility reaction roll, fail 2d8 mag, success half |
| | Explosion | action | 1 Fear; attack all within Close; hit: 1d8 mag, knocked back to Far |
| | Consume Kindling | reaction `situation`, 3 per scene | choose: clear 1 HP or 1 Stress |
| | Momentum | auto `onHit` | +1 Fear |
| Minor Treant (215) | Minion (5), Group Attack | | 4 phy per Minion |
| Patchwork Zombie Hulk (219) | Destructible | auto `onDamaged` Major+ | marks 1 more HP |
| | Flailing Limbs | action `attack` | standard attack against all within Very Close |
| | Another for the Pile | action | requires "within Very Close range of a corpse"; clear 1 HP and 1 Stress |
| | Tormented Screams | action | 1 Stress; all PCs within Far: Presence reaction roll (13), fail: lose a Hope and +1 Fear each, success: 1 Stress |
| Petty Noble (216) | My Land, My Rules | passive | requires "on their land"; `disadvantageAgainst presence`; manual text |
| | Guards, Seize Them! | action, once per scene | 1 Stress; summon 1d4 Bladed Guards at Far |
| | Exile | action | 1 Fear; tag Exiled on the PC; the social disadvantage manual |
| Pirate Captain (216) | Swashbuckler | auto `onMarkHp` ≤ 2 from a Melee attack | the source marks 1 Stress |
| | Reinforcements | action, once per scene | 1 Stress; summon a Pirate Raiders Horde at Far |
| | No Quarter | action | requires "three or more Pirates within Melee"; 1 Fear; Presence reaction roll, fail 1d4+1 Stress, success 1 |
| | Momentum | auto `onHit` | +1 Fear |
| Pirate Raiders (216) | Horde (1d4+1), Swashbuckler | | as above |
| Pirate Tough (216) | Swashbuckler | | as above |
| | Clear the Decks | action | attack Very Close; hit: pay 1 Stress → move into Melee (prompt), 3d4 phy, knocked back to Close |
| Red Ooze (216) | Creeping Fire | passive | manual |
| | Ignite | action | attack Very Close; hit: 1d8 mag, tag Ignited until a Finesse Roll (14); per-roll damage manual |
| | Split | reaction | as the Green Ooze; 2 Tiny Red Oozes |
| Rotted Zombie (219) | Minion (3), Group Attack | | 2 phy per Minion |
| Sellsword (217) | Minion (4), Group Attack | | 3 phy per Minion |
| Shambling Zombie (219) | Too Many to Handle | passive | requires "another Zombie within Close"; `conditionAura` Vulnerable on creatures within Melee |
| | Horrifying | auto `onTargetMarksHp` | the subject marks 1 Stress |
| Skeleton Archer (217) | Opportunist | reaction `onAttack` beforeDamage | requires "two or more adversaries within Very Close of the target"; `modifyDamage ×2` (fold) |
| | Deadly Shot | action | attack Far; hit on a Vulnerable target: pay 1 Stress → 3d4+8 phy |
| Skeleton Dredge (217) | Minion (4), Group Attack | | 1 phy per Minion |
| Skeleton Knight (217) | Terrifying | auto `onHit` | every PC within Close loses a Hope; +1 Fear |
| | Cut to the Bone | action | 1 Stress; attack all within Very Close; hit: 1d8+2 phy and 1 Stress |
| | Dig Two Graves | reaction `onDefeated` | attack Very Close; hit: 1d4+8 phy, loses 1d4 Hope |
| Skeleton Warrior (217) | Only Bones | passive | resistant to physical |
| | Won't Stay Dead | reaction `onDefeated` | requires "other adversaries on the battlefield"; spotlight itself; d6: 6 → clear all marked HP and a manual "re-forms" |
| Spellblade (217) | Arcane Steel | passive | nothing to apply: the printed damage "phy/mag" is already both |
| | Suppressing Blast | action | 1 Stress; a group within Far: Agility reaction roll, fail 1d8+2 mag; the Fear per marked HP manual |
| | Move as a Unit | action | 2 Fear; spotlight up to 5 allies within Far |
| | Momentum | auto `onHit` | +1 Fear |
| Swarm of Rats (218) | Horde (1d4+1) | passive | `horde 1d4+1` |
| | In Your Face | passive | `conditionAura` tag "In Your Face" on PCs in Melee; the disadvantage manual |
| Sylvan Soldier (218) | Pack Tactics | action `attack` | requires another Sylvan Soldier within Melee of the target; hit: 1d8+5 phy |
| | Forest Control | action | 1 Fear; one creature within Close: Agility reaction roll (15), fail 1d10 phy |
| | Blend In | reaction `onHit` | 1 Stress; self Hidden until its next attack or an Instinct Roll (14) |
| Tangle Bramble (218) | Minion (4), Group Attack | | 2 phy per Minion |
| | Drain and Multiply | reaction `onTargetMarksHp` | requires "three or more Minions within Close"; summon a Tangle Bramble Swarm; HP and removal manual |
| Tangle Bramble Swarm (218) | Horde (1d4+2) | passive | `horde 1d4+2` |
| | Crush | action | requires "the target has 3+ bramble tokens"; 1 Stress; 2d6+8 direct phy |
| | Encumber | reaction `onHit` | tag "Bramble tokens" and Restrained on the subject; tokens, Vulnerable at 3+, removal manual |
| Tiny Green Ooze (215) | Acidic Form | auto `onHit` | as the Green Ooze |
| Tiny Red Ooze (216) | Burning | reaction `onDamaged` from Melee | 1d6 direct mag to the source |
| Weaponmaster (218) | Goading Strike | action | standard attack Very Close; hit: standard damage, pay 1 Stress → tag Taunted; the disadvantage manual |
| | Adrenaline Burst | action, once per scene | 1 Fear; clear 2 HP and 2 Stress |
| | Momentum | auto `onHit` | +1 Fear |
| Young Dryad (218) | Voice of the Forest | action | 1 Stress; spotlight 1d4 allies; an effect `halfDamage` (until their next hit) on those allies, as printed |
| | Thorny Cage | action | 1 Fear; Restrained until a Strength Roll; the Stress for acting against the cage manual |
| | Momentum | auto `onHit` | +1 Fear |
| Zombie Pack (219) | Horde (1d4+2) | passive | `horde 1d4+2` |
| | Overwhelm | reaction `onMarkHp` from a Melee attack | 1 Stress; standard attack against the source (Horde X applies) |

## Manual steps

Narrative (no rule to automate, not a gap): Scapegoat (p.211), Climber (p.213), Preferential Treatment's discount (p.214).

| Feature (p.) | Manual step | Why | Bead |
|---|---|---|---|
| Spit Acid (210), Acidic Form ×2 (215, 216), Armor-Shredding Shards (212) | "If they can't mark an Armor Slot, they must mark an additional HP (and you gain a Fear)" | no branch on a full Armor track | dcm-18i |
| Hobbling Shot (212), Suppressing Blast (217) | the Agility disadvantage / the Fear for each target who marked HP | a PC marks HP only when the window resolves; no gate for it | dcm-sos |
| Venomous Stinger (211), Envelop (215), Ignite (216), Goading Strike (218), Thorny Cage (218), Exile (216), Preferential Treatment's markup (214) | the rider on the bearer's own rolls (d6 / Stress / 1d4 damage / disadvantage) | no condition rider on the bearer's rolls | dcm-kti |
| Acid Bath (210), Creeping Fire (216) | the blood pool's 1d6; the Ooze's movement limit | no lasting area or movement limit | dcm-wuu |
| Encumber (218); Crush's requirement (218) | bramble tokens, Vulnerable at 3+, removal and spawns | no tokens on a PC | dcm-xp0 |
| I've Got 'Em (213), In Your Face (218), Shield Wall (212) | double damage from other adversaries; disadvantage against others; the line's Difficulty bonus | no modifier on others' attacks against or by a third party | dcm-346 |
| On My Signal (212) | the Archer Guards' volley and combined damage | no combined attack of several adversaries | dcm-1ch |
| Won't Stay Dead (217), Drain and Multiply (218) | the Warrior re-forms; the Horde's HP equals the Minions combined | no "un-defeat" or HP-from-count summon | dcm-145 |

Approximations (automated, but a reading the user may want to confirm; see QUESTIONS): My Land, My Rules as
`disadvantageAgainst presence`; Too Many to Handle as a Vulnerable aura; Curse's "with Fear instead" as a Hope/Fear swap.

## For AA2 and AA6

- Triggered uses need the trigger's creatures: `subject` = the PC hit / who rolled / who moved / who marked HP; `source` =
  the attacker. `trigger.amount` = the damage dealt (Magical Reflection).
- Variant attacks (`useId: "attack"`) are offered next to the standard attack when their requirement holds; `allyWithin`
  answers Pack Tactics with a map, and holds without one (Q18).
- `fold` steps of `onAttack beforeDamage` reactions (Overload +10, Reaper + marked HP, Opportunist ×2) change the damage of
  the attack in progress, before its incoming hit is built.
- Spitter and Slow keep their state in the instance's stat-block `tokens`.

## QUESTIONS (rule readings for the user)

1. **Group Attack and the spotlight** (CB p.201: "Spend a Fear to choose a target and spotlight all Giant Rats within Close
   range of them"). I read the Fear as bringing the spotlight, so Group Attack needs no spotlight of its own (otherwise a
   second spotlight would cost another Fear). AA0's example entry has `needsSpotlight: true`. Which?
2. **Spitter** (CB p.212): "Spend a Fear to introduce a d6 Spitter Die. … The Snake can take the spotlight a second time
   this GM turn." Is the second spotlight part of introducing the die (my reading, once), or every turn the die is in play?
3. **Voice of the Forest** (CB p.218): "Mark a Stress to spotlight 1d4 allies within range of a target they can attack
   without moving. On a success, their attacks deal half damage." Read as printed: the spotlighted allies' next successful
   attack deals half damage. Is "half damage" intended (a weaker swarm attack), or should it read differently?
4. **Magical Reflection** (CB p.214): "deal an amount of damage to the attacker equal to half the damage they dealt." The
   type isn't printed; I use magic (the Elemental is arcane). Half of the damage before or after its magic resistance? The
   entry halves whatever AA2 passes as `trigger.amount` (I suggest: after resistance, the damage it actually took).
5. **Too Many to Handle** (CB p.219): "all attacks against that creature have advantage" read as Vulnerable on creatures in
   the Zombie's Melee range (CB p.102: Vulnerable means "all rolls against them have advantage"), which also covers
   non-attack rolls. OK, or keep it manual?
6. **My Land, My Rules** (CB p.216): "All social actions made against the Noble … have disadvantage." I approximate social
   actions as Presence Rolls. OK?
7. **Curse** (CB p.213): "make the roll be with Fear instead" is a Hope/Fear die swap (the total is unchanged, the roll
   becomes with Fear). OK?
8. **Overwhelming Force and Horrifying** fire after the reaction window (`onTargetMarksHp`), so the knock-back / Stress
   happens once the PC actually marked HP. Hobbling Shot can't do the same (see dcm-sos). OK as an order?
9. **Tactician** (CB p.213, printed as an action): "When you spotlight the Lieutenant, mark a Stress to also spotlight two
   allies". Modeled as an action that needs the Lieutenant's spotlight. Should using it also count as the Lieutenant's
   action for that spotlight, or is it free on top of an attack?
