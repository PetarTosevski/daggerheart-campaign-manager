# TASK AE-t4-core: Adversary feature effects, tier 4 core (18 adversaries, 82 features)

Plan `.omc/plans/combat-actions.yaml`, tracer AE-t4-core (depends on AA1). Book pages are printed pages; CB = Core Book.
The tier 4 core adversaries are on CB p.234-239.

## What landed

| File | What |
|------|------|
| `src/lib/srd/adversary-effects/t4-core.ts` | `T4_CORE_EFFECTS`: 82 entries, one per printed feature, each quoting its feature text; shared builders for Momentum, Relentless, Minion, Group Attack, Terrifying, Doombringer, Phase Change, Divine Flight, the flying Difficulty bonus, the "reduce it by NdM" armor and a standard countdown's tick |
| `tests/unit/adversary-effects/t4-core.test.ts` | 87 tests: the table matches the stat blocks exactly (a missing or extra feature fails); spotlight needs; every printed Fear cost is a Fear cost of the entry; every use runs through `run()`; each feature runs through `run()` with `queueRng` (the queue must be used up) and its costs, spotlight need, trigger (`triggeredUses`), targets and outcomes are checked |

User answers implemented: **Q15** every feature has an entry. **Q19** Fear costs are upfront costs (the runner asks
"Spend N Fear?" first); Dance of Death's "full damage if you spend a Fear" is a payment inside the option the GM picks;
Momentum, Terrifying and Unreal Form's Fear gain are automatic; printed reactions are one-tap prompts. **Q18** ranges
only narrow (no map: everything passes); "all targets within X" are the creatures the GM picks. **Q13** damage to PCs
comes out as `incoming` hits for the reaction window. No vocabulary type changed.

Rules used (quoted briefly): CB p.194 "For an adversary to use an action, they must have the spotlight. Passives and
reactions typically don't require the spotlight." CB p.193 "If an adversary's feature doesn't specify a Difficulty …,
it always uses the adversary's Difficulty." CB p.91 "Major damage … you mark 2 HP", "Minor damage … you mark 1 HP"
(adversaries alike, CB p.193). CB p.161 (AR7) one attack roll against every target. CB p.201 (AR9) Group Attack.
CB p.199 (AR10) Horde. CB p.162 a standard countdown "ticks down every time a player makes an action roll". CB p.163
"Countdown (1d6)" is a randomized start; a loop "resets to its starting value"; "each time a decreasing countdown
triggers, its starting value decreases by 1".

## Reading conventions

As in t1-core and t2-core, plus:

- **Actions** need the spotlight, except Group Attack (its Fear spotlights the Minions) and Cornered (it is the
  spotlight).
- **Printed reactions** are `reaction` (one-tap, default No), also without "you can" (Phase Changes, Doombringer,
  Unreal Form's reduction, Volcanic Breath, Lava Splash). A plain Fear gain is `auto`.
- **Countdowns** have one use per part: `activate` (the printed trigger), `tick` (`pcRolls` action roll for a standard
  countdown, CB p.162; Apocalyptic Thrashing ticks on a roll with Fear as printed), and the effect when it triggers
  (a `situation` reaction, the GM's button).
- **Phase Change** ("replace them with X and immediately spotlight them"): `defeat` self, `summon` the next form
  (preselected), `spotlight` it.
- **"When the X takes damage, reduce it by NdM"** is `auto` on `onDamaged would` with a `reduceDamage` fold (as Heavily
  Armored in t2-core); Unreal Form is printed as a reaction, so its reduction is a one-tap prompt.
- **"Takes Minor / Major damage"** (exactly that severity) is `onMarkHp` with 1 / exactly 2 HP: an adversary marks 1 HP
  for Minor and 2 for Major (CB p.91, p.193); `onDamaged` can only say "at least".
- **"Attacks they make while spotlighted in this way deal half damage"** is t2-core's half-damage effect on the
  spotlit allies (`halfDamage`, until the spotlight moves on).

## Features and readings

| Adversary (p.) | Feature | Activation | Reading |
|---|---|---|---|
| Arch-Necromancer (234) | Dance of Death | action | 1 Stress; spotlight 1d4 allies; `choose`: half damage (effect on the allies) or full damage (`pay` 1 Fear) |
| | Beam of Decay | action | 2 Stress; everyone within Far: Strength reaction roll; fail 2d20+12 mag and +1 Fear each, success half; the 2+ HP rider manual |
| | Open the Gates of Death | action | 1 Fear; summon a Zombie Legion at Close, spotlight it |
| | Not Today, My Dears | reaction `onHpMarkedAtLeast 7` | requires 7+ HP marked; 1 Fear; teleport prompt; leaving the scene and the Instinct trace manual |
| | Your Life Is Mine | reaction ×2 + auto | `activate` at 6+ HP marked: countdown Loop 2d6; `tick` on action rolls; `drain` (button): 2d10+6 direct mag to one target in Close; the clearing manual |
| Fallen Shock Troop (234) | Minion (12) | passive | `minion 12` |
| | Aura of Doom | auto `onTargetMarksHp` | the subject loses a Hope |
| | Group Attack | action, no spotlight | 1 Fear; `groupAttack` within Close; 12 phy per Minion |
| Fallen Sorcerer (234) | Conflagration | action | 1 Fear; attack all within Close; hit 2d10+6 direct mag |
| | Nightmare Tableau | action | 1 Stress; one target in Far: Restrained and Vulnerable until an Instinct Roll |
| | Slippery | reaction `onDamaged` from an attack | teleport within Far (prompt) |
| | Shackles of Guilt | reaction ×2 + auto | `activate` first spotlight: Loop 2d6; `tick`; `regret` (button): everyone within Far Vulnerable (until a Presence or Strength Roll) and 1 Stress; the Hope on a failed break-free manual |
| Fallen Warlord: Realm-Breaker (235) | Relentless (2) | passive | `relentless 2` |
| | Firespite Plate Armor | auto `onDamaged would` | `reduceDamage 2d10` (fold) |
| | Tormenting Lash | action | 1 Stress; standard attack against all within Very Close; the 2 Armor Slots manual |
| | All-Consuming Rage | reaction ×3 + auto | `activate` first spotlight: countdown 8, looping; `tick`; `rage` (button): Presence reaction roll within Far, fail 2d6+10 direct mag, success half; Shock Troops per HP manual; a countdown prompt to reset one lower; `doom` (button at 0): defeat self, the PCs' "mark all HP and a death move" manual |
| | Doombringer | reaction `onTargetMarksHp` | every PC within Far of the target loses a Hope |
| | I Have Never Known Defeat (Phase Change) | reaction `onMarkHp` last | defeat; summon the Undefeated Champion; spotlight it |
| Fallen Warlord: Undefeated Champion (235) | Relentless (3) | passive | `relentless 3` |
| | Faltering Armor | auto `onDamaged would` | `reduceDamage 1d10` (fold) |
| | Shattering Strike | action | 1 Stress; standard attack against all within Very Close; Hope per HP marked manual |
| | Endless Legions | action | 1 Fear; targets = the PCs; summon Fallen Shock Troops at Far, count `targetCount picked × 2` |
| | Circle of Defilement | reaction ×2 + auto ×2 | `activate` first spotlight: countdown 1d8; `tick`; `circle` (button): everyone in the area Vulnerable until they leave; the lasting circle manual; `break` (auto on Severe damage while the circle is active): manual removal |
| | Momentum | auto `onHit` | +1 Fear |
| | Doombringer | reaction | as the Realm-Breaker |
| Hallowed Archer (236) | Punish the Guilty | auto `onHit` vs a Guilty target | `modifyDamage ×2` (fold) |
| | Divine Volley | action | 1 Stress; one standard attack roll against up to 3 targets in Far |
| Hallowed Soldier (236) | Minion (13) | passive | `minion 13` |
| | Divine Flight | action (needs spotlight) | requires "While flying"; 1 Fear; move up to Far (prompt) |
| | Group Attack | action, no spotlight | 10 phy per Minion |
| High Seraph (236) | Relentless (3), Divine Flight | | as above |
| | Judgment | action + auto `severe` | main: 1 Fear; tag Guilty until the Seraph is defeated; the Hope rider and one-at-a-time manual. `severe`: auto `onHit standard` vs Guilty: `minimumSeverity severe` (fold) |
| | God Rays | action | 1 Stress; up to 20 targets in Very Far: Presence reaction roll (disadvantage for Guilty, noted on the prompt); fail 4d6+12 mag, success half |
| | We Are One | action, once per scene | 1 Fear; spotlight every other adversary within Far; half-damage effect |
| Kraken (236) | Relentless (3) | passive | `relentless 3` |
| | Many Tentacles | action `attack` | requires ≤ 7 HP marked; standard attack against up to 2 targets in Close |
| | Grapple and Drown | action | attack Close; hit: pay 1 Stress → Restrained and Vulnerable (until a Strength Roll or Major+ damage); the Stress per action roll manual |
| | Boiling Blast | action | 1 Fear; any number in a line up to Far: Agility reaction roll, fail 4d6+9 phy; the armor Stress manual |
| | Momentum | auto | +1 Fear |
| Oracle of Doom (237) | Terrifying | auto `onHit` | every PC within Far loses a Hope; +1 Fear |
| | Walls Closing In | auto `pcRolls` failure within Very Far | the roller marks 1 Stress |
| | Pronounce Fate | action | 1 Fear; one target in Far: Knowledge reaction roll; fail lose 6 Hope (all) and 2d20+4 direct mag; success half and a Hope |
| | Summon Tormentors | action, once per session | 2 Fear; one PC; summon 2d4 Tier 2-or-below Minions at Close of them |
| | Ominous Knowledge | reaction `situation` | manual (narrative) |
| | Vengeful Fate | reaction `onMarkHp` from an attack within Very Close | 1 Stress; the attacker knocked back to Far, 2d10+4 phy |
| Outer Realms Abomination (237) | Chaotic Form | passive | nothing to apply: the printed ATK "+2d4" is rolled on each attack by the runner |
| | Disorienting Presence | auto `onDealDamage` to a PC | Instinct reaction roll; fail: tag Disoriented (`nextRoll`), +1 Fear; the disadvantage manual |
| | Reality Quake | action | 1 Fear; everyone within Far: Knowledge reaction roll; fail: tag Unstuck for the scene; the doubling manual |
| | Unreal Form | reaction + auto | `reduce`: `onDamaged would`, `reduceDamage 1d20`; `fear`: auto `onMarkHp` ≤ 1 from an attack, +1 Fear |
| Outer Realms Corruptor (237) | Will-Shattering Touch | auto `onDealDamage` to a PC | the PC loses a Hope |
| | Disgorge Reality Flotsam | action | 1 Stress; everyone within Close: Knowledge reaction roll, fail 2 Stress |
| Outer Realms Thrall (237) | Minion (13), Group Attack | | 11 phy per Minion |
| Perfected Zombie (239) | Terrifying | auto | as the Oracle |
| | Fearsome Presence | passive | manual reminder |
| | Perfect Strike | action | 1 Stress; standard attack against all within Very Close; hits Vulnerable until their next rest |
| | Skilled Opportunist | reaction `allyDealtDamage` | requires "the target is within Very Close range of the Zombie"; 1 Fear; `modifyDamage +4d12+15` (fold) |
| Volcanic Dragon: Ashen Tyrant (239) | Relentless (4) | passive | `relentless 4` |
| | Cornered | action, no spotlight | 1 Stress; spotlight itself (instead of a Fear) |
| | Injured Wings | passive | requires "While flying"; Difficulty +1, `flying` |
| | Ashes to Ashes | auto `pcRolls` failure within Close | the roller loses a Hope; +1 Fear; the no-Hope HP manual |
| | Desperate Rampage | action | 1 Stress; attack all within Close; hit 2d20+2 phy, knocked back (prompt), 1 Stress |
| | Ashen Cloud | action | 1 Fear; everyone within Far: tag "In the ash cloud" until the next adversary spotlight; disadvantage and the lasting cloud manual |
| | Apocalyptic Thrashing | action + auto ×2 + reaction | main: 1 Fear, countdown 1d12; `tick` on a PC roll with Fear; `thrash` (button): Strength reaction roll within Far, fail 2d10+10 phy and Restrained (until a Strength Roll), success half; `death-throes` (auto `onDefeated` while active): prompt to trigger now |
| Volcanic Dragon: Molten Scourge (238) | Relentless (3) | passive | `relentless 3` |
| | Cracked Scales | auto `onDamaged did` | `check` d6 × marked HP, any 4+: +1 Fear; further 4+ results manual |
| | Shattering Might | action | 1 Stress; attack Very Close; hit 4d8+1 phy, a Hope, knocked back to Close, clears 1 Stress |
| | Eruption | action | 1 Fear; everyone within Very Close: Agility reaction roll, fail 4d6+6 phy and knocked back; the lava area manual |
| | Volcanic Breath | reaction `onMarkHp` exactly 2 (Major) | d10 `check` 8+: everyone in front within Far: Agility reaction roll; fail 2d10+4 phy, 1d4 Stress, Vulnerable until they clear a Stress; success half and 1 Stress |
| | Lava Splash | reaction `onDamaged` Severe from an attack within Very Close | 2d10+4 direct phy to the attacker |
| | Ashen Vengeance (Phase Change) | reaction `onMarkHp` last | defeat; summon the Ashen Tyrant; spotlight it |
| Volcanic Dragon: Obsidian Predator (238) | Relentless (2) | passive | `relentless 2` |
| | Flying | passive | requires "While flying"; Difficulty +3, `flying` |
| | Obsidian Scales | passive | resistant to physical |
| | Avalanche Tail | action | 1 Stress; attack all within Close; hit 4d6+4 phy, knocked back to Far, Vulnerable until their next roll with Hope |
| | Dive-Bomb | action | requires "While flying"; 1 Stress; move to a point in Far; attack all within Very Close of it; hit 2d10+6 phy, 1 Stress, a Hope |
| | Erupting Rage (Phase Change) | reaction `onMarkHp` last | defeat; summon the Molten Scourge; spotlight it |
| Zombie Legion (239) | Horde (2d6+5) | passive | `horde 2d6+5` |
| | Unyielding | passive | resistant to physical |
| | Relentless (2) | passive | `relentless 2` |
| | Overwhelm | reaction `onMarkHp` exactly 1 (Minor) from a Melee attack | 1 Stress; standard attack with advantage against the attacker (Horde X applies) |

## Manual steps

Narrative (no rule to automate, not a gap): Not Today, My Dears' Instinct trace (p.234), Ominous Knowledge (p.237).

| Feature (p.) | Manual step | Why | Bead |
|---|---|---|---|
| Beam of Decay (234), Your Life Is Mine (234), All-Consuming Rage's Shock Troops (235), Shattering Strike (235) | 2 Stress and Vulnerable for 2+ HP; clear Stress or HP equal to the HP marked; a Shock Troop per HP marked; Hope equal to the HP marked | a PC marks HP only when the reaction window resolves; no gate or number on it | dcm-sos (reused) |
| Not Today, My Dears (234) | the Necromancer leaves the scene to recover | no outcome for an adversary fleeing the scene | dcm-icd (reused) |
| Shackles of Guilt (234), Judgment's Hope rider (236), Grapple and Drown (236), Disorienting Presence (237), Reality Quake (237) | a Hope on a failed break-free; no Hope on a result with Hope; a Stress per action roll; disadvantage on the next action roll; doubled Hope / Armor / HP / Stress | no lasting condition with a rider on the bearer's own rolls or actions | dcm-kti (reused) |
| Tormenting Lash (235), Boiling Blast (236) | 2 Armor Slots per use of armor; a Stress for marking an Armor Slot | no extra cost for using armor against a hit | dcm-s77 (reused, commented) |
| All-Consuming Rage's end (235) | all targets within Far mark all remaining HP and make a death move | no forced death move or "mark all HP" | dcm-702 (reused) |
| All-Consuming Rage (235) | the countdown resets one lower each time | no increasing / decreasing countdown | dcm-m5s (new) |
| Circle of Defilement (235), Ashen Cloud (239), Eruption (238) | the lasting circle, ash cloud and lava (creatures entering later, its disadvantage, 6 HP) | no lasting area hazard | dcm-wuu (reused) |
| Judgment (236) | "only one target at a time" | no exclusive flag on an adversary use | dcm-vkp (new) |
| Ashes to Ashes (239) | a HP when the PC can't lose a Hope | no gate on a PC target's Hope | dcm-5xi (reused) |
| Fearsome Presence (239) | PCs can't spend Hope on features against it | no modifier that bars PCs' Hope costs | dcm-zos (new) |
| Cracked Scales (238) | a Fear for each 4+ beyond the first | no number source counting dice at or above a value | dcm-tal (new) |

Readings that are automated but limited (the beads carry them): Unreal Form's Fear can't fire when the reduction leaves
0 HP marked (`onMarkHp` needs 1+; dcm-2gn, commented); Summon Tormentors' "once per day" is once per session (dcm-aym,
commented).

## Notes for AA2 / AA6 (runner behaviour found while testing; dcm-vv2, commented)

1. **Endless Legions' summon count resolves to 0.** Prompt numbers use `adversaryNumberEnv`, whose `targetCount` is 0.
   The entry (`targetCount picked × 2`, the targets being the PCs) is right; `run.ts` should pass the card plan's target
   counts into the prompt env. The test checks the entry's count source, not the resolved 0.
2. **A dice Attack Modifier is rolled on every run.** `run.ts` rolls the Abomination's "+2d4" before every use, also
   passives, reactions and saves without an attack roll; two d4s are used up and thrown away (the tests queue them).
3. **Folds on another creature's attack** (Firespite Plate Armor, Faltering Armor, Unreal Form, Punish the Guilty,
   Judgment's Severe, Skilled Opportunist) come out as `fold` steps; the server folds them into the attack in progress.
   Skilled Opportunist's subject is the ally's target; Punish the Guilty's and Judgment's subject is the hit PC.
4. **Situation-button uses** (countdown effects, Circle `break` and Apocalyptic Thrashing's `death-throes` with their
   "countdown active" requirement) need the GM's situation texts; the countdown state itself is AA2's.
5. **Phase Change** summons the next form by id (`fallen-warlord-undefeated-champion`, `volcanic-dragon-molten-scourge`,
   `volcanic-dragon-ashen-tyrant`); the old instance is marked defeated.

## QUESTIONS (rule readings for the user)

1. **Shattering Might** (CB p.238): "On a success, the target takes 4d8+1 physical damage, loses a Hope, and is knocked
   back to Close range. The Molten Scourge clears a Stress." I clear the Stress only on a success (otherwise the cost
   would never be paid). Or always?
2. **Beam of Decay** (CB p.234): "Targets who fail take 2d20+12 magic damage and you gain a Fear." Read as a Fear for
   each target who fails (as Tormented Screams in t1-core). Or one Fear for the beam?
3. **Unreal Form** (CB p.237) is printed as a reaction: "When the Abomination takes damage, reduce it by 1d20." Offered
   as a one-tap prompt (default No, Q19) like every printed reaction. Should the reduction be automatic (like the
   passive Firespite Plate Armor)?
4. **Dance of Death** (CB p.234): "deal half damage, or full damage if you spend a Fear." The GM picks half or full when
   using it; full pays the Fear then. If the GM has no Fear the payment fails and the allies keep full damage, so AA2
   should only offer "full" with a Fear in the pool. OK?
5. **Pronounce Fate** (CB p.237): "they lose all Hope" is a loss of 6 (the Hope maximum, CB p.90), clamped at 0. OK?
6. **Summon Tormentors** (CB p.237): "Once per day" is once per session. OK, or should the GM reset it by hand?
7. **Volcanic Breath / Overwhelm** (CB p.238, p.239): "takes Major damage" / "takes Minor damage" read as exactly that
   severity (2 HP / 1 HP marked), so Severe damage doesn't trigger them. OK?
8. **Standard countdown ticks** (CB p.162): Your Life Is Mine, Shackles of Guilt, All-Consuming Rage and Circle of
   Defilement print no advancement, so they tick on every PC action roll. OK?
9. **Divine Flight** (CB p.236): "spend a Fear to move up to Far range instead of Close range before taking an action"
   is a button during the adversary's spotlight (needs it). OK?
10. **Skilled Opportunist** (CB p.239): "When another adversary deals damage to a target within Very Close range of the
    Zombie" is offered on every ally's damage once the GM confirms the target is near the Zombie (the trigger can't
    measure that range). OK?
