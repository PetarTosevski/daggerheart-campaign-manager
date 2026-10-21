# TASK CE-blade: Card effects - Blade

Plan `.omc/plans/combat-actions.yaml`, tracer CE-blade (depends on CA1). Book pages are printed pages (CB = Core Book).
The Blade cards are on CB p.329 (Get Back Up, Not Good Enough, Whirlwind) and CB p.330 (the rest).

## What landed

| File | What |
|------|------|
| `src/lib/srd/card-effects/blade.ts` | 20 entries: every Blade card classified combat (17) or passive (3). A Soldier's Bond is out of combat and has none. Each entry quotes its card text in a comment. |
| `tests/unit/card-effects/blade.test.ts` | 47 tests: the table matches the classification exactly (a missing or extra id fails), every quote is present, every use runs through `run()`, and each card runs with fixed dice (`queueRng(...).done()` checks that every die was used) against costs, limits, rolls, targets and outcomes. Riders that change a damage roll are also folded into a weapon attack to check the result (Not Good Enough, Versatile Fighter, Battle Monster, Onslaught). |

The vocabulary (`src/lib/domain/card-effects/types.ts`) is unchanged.

User answers implemented: **U3** (every combat-usable Blade card has an entry), **Q3** (limits stored as `card:<id>` with
`until` rest / longRest), **Q4** (no Blade card has an "on a success" limit; Reaper's Strike is spent on use), **Q9**
(Scramble's move is a prompt; temporary effects with an untracked end are `duration: "manual"` with `endsWhen`;
choices are `choose` steps; leftovers are `manual` steps with the card's words).

## Cards and readings

| Lv | Card | Activation | Reading |
|---:|------|-----------|---------|
| 1 | Get Back Up | reaction `whenYouWouldTakeDamage` severe | Stress cost; `reduceSeverity 1` folded in before the HP is marked. |
| 1 | Not Good Enough | rider `afterYouRoll damage` | `modifyDamage reroll atMost 2`: every 1 and 2 is rerolled once, the new result stands. |
| 1 | Whirlwind | **action** (classified rider) | The weapon attack against one enemy within Very Close; on a success an optional Hope (the roll's own Hope can pay, CB p.90) runs a `followUp` with the same roll against every other enemy within Very Close; hit ones take the same damage roll (CB p.104), halved, rounded up (CB p.107). See Q1. |
| 2 | Reckless | rider `beforeYouRoll attack` | Stress for advantage (`modifyRoll advantage`). |
| 3 | Scramble | reaction `whenYouWouldTakeDamage` from melee, once per rest | `negate attack` + a move prompt "Move safely out of Melee range of the enemy". |
| 3 | Versatile Fighter | two riders | `trait`: **manual** (gap). `max-die`: Stress, `modifyDamage maxDice 1` (the runner maxes the lowest die, the player's best pick). |
| 4 | Deadly Focus | action, once per rest, one enemy | Sheet effect `+1 proficiency`, `duration manual`, ends "you attack another creature, you defeat the target, or the battle ends"; the target gets the tag `Focused` so the table sees it; `exclusive`. |
| 4 | Fortified Armor | passive, requires armor worn | `+2 majorThreshold`, `+2 severeThreshold`. |
| 5 | Champion's Edge | rider `whenYouAttack critical` | Choice 1..3 Hope, paid; `choose` (count = Hope spent, distinct): clear a HP, clear an Armor Slot, the target marks 1 HP. |
| 5 | Vitality | passive | **manual** (gap; a level-up pick the sheet applies). |
| 6 | Battle-Hardened | reaction `wouldMakeDeathMove` self, once per long rest | Hope cost; `negate deathMove` + clear 1 HP. |
| 6 | Rage Up | rider `beforeYouRoll attack` | Choice 1..2 ("twice per attack"), that many Stress; `modifyDamage add 2 x Strength x Stress marked`. |
| 7 | Blade-Touched | passive, 4+ Blade cards in the loadout | `+2 attack`, `+4 severeThreshold`. |
| 7 | Glancing Blow | reaction `whenYouAttack failure, weapon` | Stress; weapon damage with half Proficiency (rounded up, CB p.107) to the failed attack's targets, no new roll. |
| 8 | Battle Cry | action, once per long rest, situation "You're charging into danger" | Every ally (not you) clears 1 Stress, gains 1 Hope and gets the effect "advantage on attack", `duration manual` until "you or an ally rolls a failure with Fear". "Who can hear you" is range `unlimited`; the server lists the allies. |
| 8 | Frenzy | action, once per long rest | Sheet effect "Frenzied": `noArmorSlots`, `+10 damage`, `+8 severeThreshold`, `duration manual` until "there are no more adversaries within sight". |
| 9 | Gore and Glory | riders `critical` (`whenYouAttack critical, weapon`) and `defeat` (`whenEnemyDefeated byYou`) | Each: `choose` one of gain a Hope / clear a Stress. |
| 9 | Reaper's Strike | action, once per long rest | Hope cost; one attack roll against every enemy in weapon range (CB p.104); the player sees hit or miss (U1) and picks one hit target (`picked`); it marks 5 HP (`markHp`, no damage roll or thresholds). |
| 10 | Battle Monster | rider `whenYouAttack success` | 4 Stress (refused without 4 free slots); `modifyDamage replaceWithHp` = HP you have marked, read before the Stress or damage. |
| 10 | Onslaught | `floor`: auto `whenYouAttack success, weapon`; `reaction`: `whenAllyTakesDamage` with the source within weapon range | Floor: `modifyDamage minimumSeverity major`. Reaction: situation "The attack doesn't include you", Stress, the attacker makes a Reaction Roll (15) (server d20, Q7); on a failure it marks 1 HP. |

## Manual steps

| Card | Step | Reason | Bead |
|------|------|--------|------|
| Versatile Fighter (CB p.330) | "You can use a different character trait for an equipped weapon, rather than the trait the weapon calls for." | `RollSpec attack` always rolls the weapon's own trait; no `RollChange` or `Mod` sets the trait of weapon attacks. | dcm-5dg |
| Vitality (CB p.330) | "permanently gain two of the following benefits: one Stress slot, one Hit Point slot, +2 bonus to your damage thresholds. Then place this card in your vault permanently." | `ModStat` has no Hit Point or Stress slot maximum, and the pick happens when you take the card (level-up), not on the map. | dcm-u6z |

## Notes for CA4 (server) and the Hand

- **Riders without targets**: rider steps with `to: "targets"` (Not Good Enough, Versatile Fighter, Rage Up, Champion's
  Edge, Battle Monster, Onslaught's floor) need the attack's targets in `context.targets`, or the runner emits nothing.
- **Reaper's Strike**: when `picked` is missing the step is skipped silently (no prompt). The server must show the hit
  targets (from `plan.hits`), ask for one, and re-run with the same dice; it must refuse a picked target the roll missed.
- **Onslaught floor** is `auto`: it should apply to every successful weapon attack without a prompt.

## QUESTIONS

1. **Whirlwind as an action.** CB p.329: "When you make a successful attack against a target within Very Close range,
   you can spend a Hope to use the attack against all other targets within Very Close range." It is written as its own
   attack on the Hand (attack, then the optional Hope), not as a toggle on the plain attack, because the extra targets
   must be compared against the same roll inside one use. Is that acceptable, or should it be a toggle on the weapon
   attack (which needs CA4 to run the rider with the attack's roll)?
2. **Not Good Enough: every 1 and 2.** CB p.329: "you can reroll any 1s or 2s." The runner rerolls all of them once and
   keeps the new results. Confirm (the player can't keep some 1s or reroll twice).
3. **Glancing Blow on weapon attacks only.** CB p.330: "When you fail an attack, you can mark a Stress to deal weapon
   damage using half your Proficiency." Read as a failed weapon attack, damage to that attack's targets. Should a failed
   spell attack also trigger it?
4. **Battle Cry's range.** CB p.330: "All allies who can hear you each clear a Stress and gain a Hope." No range is
   checked (the server lists every ally; the player removes those out of earshot). And "while you're charging into
   danger" is a check box the player confirms. Confirm both.
5. **Rage Up with a negative Strength.** CB p.330: "a bonus to your damage roll equal to twice your Strength." With
   Strength -1 the entry gives -2 per Stress. Should it be at least 0?
6. **Battle Monster's count.** CB p.330: "a number of Hit Points equal to the number of Hit Points you currently have
   marked". Read before the 4 Stress are marked, so Stress that overflows into HP doesn't count (the cost needs 4 free
   Stress slots anyway). Confirm.
7. **Onslaught's "doesn't include you".** CB p.330: "when a creature within your weapon's range deals damage to an ally
   with an attack that doesn't include you". No trigger field says the attack left you out, so it is a check box the
   player confirms. Fine, or should the reaction window simply not offer it when you were also a target?
8. **Champion's Edge "additional Hit Point".** CB p.330: "The target must mark an additional Hit Point." Read as 1 HP on
   top of the attack's damage (`markHp 1`), even when the damage marked none. Confirm.
