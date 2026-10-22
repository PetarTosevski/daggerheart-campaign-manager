# TASK AE-t2-hf: Adversary feature effects - tier 2 Hope & Fear

Plan `.omc/plans/combat-actions.yaml`, tracer AE-t2-hf (depends on AA1). Book pages are printed pages (HF = Hope & Fear,
CB = Core Book). The 42 tier 2 Hope & Fear adversaries are on HF p.70-80.

## What landed

| File | What |
|------|------|
| `src/lib/srd/adversary-effects/t2-hf.ts` | 138 entries, one per printed feature of the 42 adversaries. Each entry quotes its feature text in a comment. Shared shapes (Relentless, Minion, Group Attack, Momentum, Double Strike, Unleash the Beast, Berserker Rage, Pack Fury, Burrowing) are small builders. |
| `tests/unit/adversary-effects/t2-hf.test.ts` | 145 tests. Coverage: a missing or extra feature fails, ids are unique, every printed Fear cost is in its entry, passives and reactions never need the spotlight. Then every feature runs through `run()` with `queueRng(...).done()` (every die used), checking costs (Fear, adversary Stress / HP), the spotlight, the trigger (`matchesTrigger` with a matching and a non-matching event), targets and outcomes. Passives are also read through `passiveSummary` / `activePassives`. |

The vocabulary (`src/lib/domain/adversary-effects/types.ts`) is unchanged.

User answers implemented:
- **Q15** "Automate EVERY adversary feature": every feature has an entry; what the vocabulary can't express is a `manual`
  step listed below, with a bead.
- **Q13** the hit PC chooses armor: damage to PCs becomes `incoming` hits; riders on a hit (Toss, Armed and Dangerous)
  are `modifyDamage` folds on the open hit, not second hits.
- **Q18 (a)** no range restrictions without a map: `allyWithin` requirements hold when the map can't say (Flanking
  Maneuver, Spiritual Sacrifice); targets are what the GM picks.
- **Q19 (a)** Fear only on the GM's tap: Fear costs are upfront costs (the runner asks first) or `optional` steps (default
  No: Tentacle Rays' chosen beam, Tongue Attack's Devour); "you gain a Fear" with no choice is `auto` (Momentum,
  Terrifying, Last Grasp's Hope trigger). "Any number of Fear / Stress" is a `choose` whose option is the tap (Fear Eater,
  Colony).

## Conventions

- Printed actions: `action`, `needsSpotlight: true` (CB p.194). Printed reactions: `reaction` (one-tap prompt, default
  No), `needsSpotlight: false`. Printed passives with a trigger and no choice: `auto`; with "you can": `reaction`.
- Three printed actions are worded as triggers ("When the X succeeds on a standard attack, you can spend a Fear"): Grapple,
  Dream Petal Poison and Hammer Smash. They are `reaction` uses offered on their trigger without needing the spotlight
  again (see QUESTIONS 1). The Doppelhound's conjure (inside a passive) is an action that needs no spotlight (QUESTIONS 2).
- A PC's reaction roll is a `save` against the adversary's own Difficulty (CB p.193: no number printed); the runner makes
  it a `pcSave` prompt and the server applies `onFail` / `onSuccess` per PC. One damage roll serves every PC (CB p.104).
- "The target" of a reaction: trigger `subject` (the PC hit, the PC who rolled, the PC who marked HP) or `source` (the
  attacker). Untracked conditions are tags with `duration: "manual"` and `endsWhen` in the book's words.

## Features and readings

| Adversary (HF p.) | Feature | Activation | Reading |
|---|---|---|---|
| Banshee (70) | Specter | passive + action `phase` | Physical resistance; `phase`: a Stress, move up to Close through solid objects (prompt). |
| | Terrifying | auto `onHit any` | PCs within Close (picked) lose a Hope; the GM gains a Fear. |
| | Scare Tactic | action, 3/scene, 1 Fear | Teleport prompt (Very Far), one PC in Melee marks 1d4 Stress; a Hope lost when that overflowed into HP (`targetMarkedHp`, CB p.92). |
| | Wail of Despair | action, a Stress | All PCs within Close: Presence save; success 1d12+1 magic, failure double + knocked back to Close. |
| Basilisk (70) | Petrify | action, 1 Fear | Instinct save, one PC within Far: success a Stress; failure Petrified if already Stiff, else Stiff (until rest or the Basilisk is defeated). **Manual**: Stiff's Stress per action. |
| | CRONCH! | action, a Stress | Only against a Petrified PC: **manual** death move. |
| Berserker Alpha (70) | Pack Fury | auto `onAttack before` | **Manual**: +1 per ally within Very Close of the target. |
| | Bark at the Moon | action, 1/scene, 1 Fear | Allies within Close each clear a HP and a Stress. |
| | Berserker Rage | reaction `onMarkStress last, first scene` + passive | Tags itself "Berserker Rage" (scene); the passive gives +6 to its standard attack's damage while tagged. |
| Berserker Initiate (70) | Pack Fury | as the Alpha | **Manual**. |
| | Berserker Rage | as the Alpha | +4. |
| Centaur Warden (70) | Flanking Maneuver | passive, `allyWithin melee of target` | +2 attack. |
| | Eye of the Sage | action, a Stress | Standard attack with advantage. **Manual**: critical on 19. |
| | Trample | action, 1 Fear | Move prompt (Far, straight line); every target in the path: Agility save; success 1d6+2 phy, failure double + a Stress. |
| | Quick Volley | reaction `onAttack before standard`, uses `volley-1..3` | N Stress: the standard attack against up to N+1 targets, one roll (AR7). The GM's tap runs it in place of the standard attack. |
| Chicken-Foot Hut (71) | Fast | auto `onSpotlight` | Move prompt up to Far. |
| | Double Strike | action, a Stress | Two attack rolls (`followUp` with its own roll); hits on one PC merge into one hit. |
| | Pin | reaction `onHit standard`, a Stress | Target temporarily Restrained. **Manual** (Q9 movement): the Hut drags it. |
| Dire Pangolati (71) | Armor Eater | auto `onHit any` | **Manual**: the hit PC needs 2 Armor Slots to drop one severity step. |
| | Blade Spin | action, 1 Fear | All within Very Close: Agility save or 2d8 phy. |
| | Blade Fling | action, a Stress | Attack within Far, 2d6+10 phy. |
| | Keratin Scales | reaction `onMarkHp would, fromAttack`, a Stress | `reduceSeverity 1` on itself: an adversary marks 1/2/3 HP by severity, so one step lower is one HP fewer. |
| Doppelhound (71) | Blink Beast | uses `place` (auto combat start), `attacked` (auto), `dispel` (auto on a successful attack), `conjure` (1 Fear) | The duplicate is a "Duplicate" tag. **Manual**: placing it, the attacker's d6 (even / odd). |
| | Double Strike | as the Hut | |
| Dragon Knight (71) | High Ground | passive, situation "The target is below the Knight" | Advantage on attacks (`activePassives`; see AA1 note below). |
| | Leaping Strike | action, a Stress | Move prompt into Melee, standard attack + 1d12, forced Armor Slot without benefit (`forcedArmor` on the hit). |
| | Comeback | reaction `onMiss standard`, 1 Fear | Reroll the attack with advantage against the missed PC. |
| Elephant (72) | Trample | action, a Stress | Move prompt; every target in the path: Agility save or 2d10+3 phy. |
| | Toss | reaction `onHit standard`, 1 Fear | Move prompt (Close); +1d12 as a fold on the open hit. |
| Entombed Cat Beast (72) | Relentless (3) | passive | |
| | Bloody Strike | auto `pcMarksHp fromSelf, severe` | +1 HP on that PC. 3 HP is Severe (CB p.91, massive damage off). |
| | Screeching Caterwaul | action, a Stress + auto `rattled` | Presence save within Far; failure Rattled until they roll with Hope. `rattled` (onHit targetHas Rattled) clears it. **Manual**: roll damage twice, keep the better. |
| | I Alone | reaction `timing appears` | Defeat any picked allies, a Fear each. |
| | Vicious Reprisal | reaction `onDamaged fromAttack, attacker within Very Close`, a Stress | Standard attack against the attacker. |
| Entombed Elite Guard (72) | Battle Formation | auto `onAttacked targeted` | **Manual**: +1 Difficulty per ally within Very Close. |
| | Javelin | action | Attack within Very Far, 2d6+2 phy. |
| Entombed Empress (72) | Empty Husk | passive | Physical resistance. |
| | Missing Organs | auto, situation "The PCs find and destroy one of the six crystal containers" | Marks a HP on her. |
| | Grasping Chains | action, a Stress | Attack within Close: pull prompt, 2d8 phy, temporarily Restrained. |
| | Deathless Obedience | action, 3/scene, 1 Fear | Spotlight allies within Close (any number); the note says attacks on one target combine. |
| | Accursed Caress | reaction `onHit standard`, 1 Fear | Doom Countdown (1d6+1) started; ticks and endings in its note; its trigger text is the death move (manual). |
| | Final Transformation (Phase Change) | reaction `onMarkHp last` | Summon the Entombed Cat Beast, spotlight it. |
| Entombed Necropriest (73) | Invigorate | action, a Stress | Up to 3 allies: advantage on attack, `nextRoll`. |
| | Last Grasp | action, 1 Fear + auto `hope` (`pcHope spend`) | Restrained + tag "Last Grasp" until a successful Strength Roll; the GM gains a Fear when a PC with that tag spends Hope. |
| | Chill Touch | action, a Stress | Standard attack in Melee; on a hit 1d4 Stress, then a Fear if their Stress track is full. |
| Entombed Skin Beetles (73) | Horde (2d4+1) | passive | |
| | Omophagous | action, a HP + auto `infected` | The PC marks a Stress and is Infected; `infected` (pcRolls withFear): 6 direct phy to an Infected PC. |
| | Momentum | auto | |
| Entombed Stonemason (73) | Minion (5), Group Attack (5 phy) | | |
| | The Work Never Ends | reaction `onDefeated physical`, 1 Fear | Clears its marked HP and Stress. |
| Flock of Feather Fiends (74) | Horde (1d6+1) | passive | Magic damage once halved. |
| | Maddening Cacophony | action, a Stress | Instinct save within Very Close; failure: choose spend a Hope or Vulnerable (until they damage the Flock or it is defeated). |
| Fowlbear (74) | Relentless (2), Double Strike | | |
| | Dread Honk | action, 1 Fear | Presence save within Close; failure: a Stress, flee to Far, Vulnerable until it damages them; success: choose a Stress or flee. |
| Fungispunj Sporeling (74) | Minion (6), Group Attack (4 mag) | | |
| | Form Up | action, 1 Fear | Up to three Sporelings (itself included) are defeated; summon a Sporophore. |
| Fungispunj Sporophore (74) | Neurotoxic Spore Cloud | action, a Stress | Agility save within Close; failure Poisoned until they spend a Hope. **Manual**: the d6 before action rolls. |
| | Reanimator | action, 1 Fear + reaction `command` (`onSpotlight`) | Summon prompt for the corpse; `command` spotlights the corpses it controls. |
| | Colony | action, `choose` 1-5 | Pay N Stress, summon N Sporelings. |
| | Mind Meld | reaction `onMarkStress` | Clears the trigger's Stress off itself. **Manual**: allies mark it. |
| Gargoyle (75) | Unliving | passive | Magic resistance. |
| | Swooping Strike | action | Move prompt to a point within Far, standard attack on one target along the path. |
| | Petrifying Slash | reaction `onDealDamage toPc` | Strength save; failure: Vulnerable, or Restrained if already Vulnerable, or a **manual** death move if both. |
| Giant Octopus (75) | Relentless (3) | passive | |
| | Armed and Dangerous | uses `place` (auto appears: tokens set 8, d8) and `add` (reaction onHit standard) | The d8 is the instance's stat-block tokens; `add` folds the value into the hit, then the die drops by 1. |
| | Grapple | reaction `onHit standard`, 1 Fear | Tag Grappled (implies Restrained, Vulnerable) until a Strength or Finesse Roll. |
| | Crush | action, a Stress | 3d8 direct phy to a Grappled target only. |
| Gobstalker (75) | Relentless (3) | passive | |
| | Anti-Mystica-Halitosis | passive | A `silenced` aura on PCs and allies within Close (see QUESTIONS 3). |
| | Tentacle Rays | action, a Stress | Attack within Far; on a hit `choose` beam 1-8 (the d8 result), `optional` 1 Fear to pick freely. Beams: Beguile (tag, **manual** rider), Corrode (2d8 mag + forced Armor Slot; **manual** double), Doom (**manual**), Hypnosis (tag Deep Trance), Paralyze (Vulnerable + Restrained until 2 Stress), Sear (2d8 direct mag), Scare (tag, **manual** rider), Slow (Vulnerable + tag, **manual** rider). |
| | Leech Lick | reaction `onTargetMarksHp standard`, 1 Fear | Clears Stress equal to the HP the target marked (the trigger amount). |
| Guahalan Alebrujo (76) | The Beast Unleashed | passive | `attackDamage add gmFear` (see AA1 note). |
| | Guahalan Sacrifice | action, 1 Fear | Defeat a picked Minion; choose clear a HP or a Stress. |
| | Howl of the Guahala | action, a Stress | Presence save within Far; failure temporarily Panicked. **Manual**: the Stress on taking the spotlight. |
| | Rip & Tear | action, 1 Fear | Standard attack with advantage; on a success an optional Stress for one more attack with its own roll (2d10+4 mag + the Fear bonus written out). **Manual**: the chain after it. |
| | Brutal Spectacle | reaction `onDealDamage severe`, 1 Fear | Every target within Close (picked) marks a Stress. |
| Guahalan Fang Lord (76) | Pack Alpha | uses `gain` (auto onHit: a Pool token) and `spend` (reaction, situation "A Guahalan ally within Close range makes an attack") | Token spent, advantage fold on the picked ally. |
| | Unleash the Beast | action, 1 Fear + passive `form` | Tag "Bestial Form"; while tagged, + marked Stress to attack and damage (read live). **Manual**: Far move before acting. |
| | Call of the Guahala | action, 2 Fear | Spotlight the Guahalan Shifters within Close. |
| | Feral Form (Phase Change) | reaction `onMarkHp last` | Summon the Guahalan Alebrujo, spotlight it. |
| Guahalan Shifter (76) | Unleash the Beast | as the Fang Lord | |
| | Pack Attack | action, a Stress | Standard attack. **Manual**: + other Shifters near the target. |
| Guahalan Spirit Beast (76) | Minion (5), Ethereal Form (physical resistance), Group Attack (5 mag) | | |
| | Beast Bomb | reaction `onDefeated` | 5 magic to every creature within Melee (the server lists them). |
| Guahalan Spirit Singer (77) | Unleash the Beast | as the Fang Lord | |
| | Beast-Caller | action, 1 Fear | Summon 2d4 Spirit Beasts within Very Close, spotlight one. |
| | Rage of Spirits | action, a Stress | Spotlight the Spirit Beasts within Very Close (they move and attack; hits combine). |
| | Spiritual Sacrifice | reaction `onDamaged would`, `allyWithin veryClose` Spirit Beast, 1 Fear | Defeat the picked Spirit Beast; negate the damage. |
| Hill Titan (77) | Relentless (3) | passive | |
| | Gullible | passive, situation "A PC tries to trick or emotionally manipulate the Titan" | Advantage on action rolls for PCs (aura). |
| | Bug Swarm | passive | Vulnerable aura on PCs within Very Close. |
| | Mighty Swing | action, 1 Fear | Standard attack against all within Very Close, one roll. |
| | Momentum | auto | |
| Hive Walker (77) | Blood Honey | action | Every PC in the line: Agility save or 2d8 mag + temporarily Restrained. |
| | Bee-Ruption | reaction `onMarkHp` | Instinct save within Very Close; failure 1d8 direct phy per HP it has marked (`repeat`). **Manual**: Restrained targets fail automatically. |
| Jack-o'-Lantern (77) | Minion (4), Group Attack (6 phy) | | |
| | Spine-Chilling Cackle | reaction `pcRolls withFear within veryClose`, a Stress | A Fear. |
| Landshark (78) | Burrowing | uses `burrow`, `surface` (actions), passive `underground` | Tag Underground; while tagged resistant to both types and `cannotAttack`. Same values as CA2's conditional toggle. |
| | Thick-Skinned | reaction `onMarkHp would` | `convertMarks hp -> stress` fold. |
| | Rending Chomp | reaction `onHit within melee`, 1 Fear | Forced Armor Slot without benefit. |
| Landshark Behemoth (78) | Relentless (3) | passive | |
| | Deep Diver | as Burrowing | Immune to both while Underground. |
| | Steel-Skinned | auto `onDamaged would` | `reduceSeverity 1` on itself. |
| | Forceful Eruption | action | Clears Underground; Agility save within Very Close; failure Vulnerable until their next action roll (`nextRoll`) and a Fear each. |
| Ravenous Mockery (78) | Tongue Attack | action, a Stress | Attack a creature within Close: pull prompt, Restrained until a Strength Roll; optional 1 Fear: Devour's attack roll (`followUp`), Swallowed on a hit. |
| | Devour | action + auto `digest` (onSpotlight) + auto `disgorge` (onDamaged Major+) | Swallowed tag (implies Restrained); `digest`: Swallowed PCs mark a HP; `disgorge`: clears Swallowed and Restrained. |
| | Never Just One | action, 1 Fear | Summon a Ravenous Mockery, spotlight it. |
| Rust Eater (78) | Stifling Pheromones | auto `pcRolls action within veryClose` | That PC: Instinct save or a Stress. |
| | Rust Touch | auto `onAttacked succeeded, melee, weapon` | **Manual**: the metal weapon's die drops a step; optional step: it crumbled, clear a HP. |
| Scarecrow (79) | Made of Straw | passive + auto `fire` (onDamaged would) | Physical resistance. **Manual**: double fire damage. |
| | Terror Vision | action, 1 Fear | 2d8 mag to one PC within Very Close, Vulnerable until they roll with Hope. |
| Sprite (79) | Minion (5) | passive | |
| | Art of Invisibility | action, 1 Fear | Hidden until it attacks. |
| | Dream Petal Poison | reaction `onHit standard`, 1 Fear | Tag Sleepy until they take damage. **Manual**: the rider. |
| Stone Titan (79) | Relentless (3) | passive | |
| | Skillful Strike | reaction `onAttack before`, a Stress | `check` 1d6 >= 3: **manual** halved Evasion. |
| | Sunlight Sickness | reaction `timing appears` | Marks 1d4 Stress; an instance effect (scene) of + that much to attack and damage. The prompt lets the GM say whether it appeared above ground. |
| | Hammer Smash | reaction `onTargetMarksHp standard`, 1 Fear | Forced Armor Slot without benefit. |
| Triceratops (79) | Leathery Hide | reaction `onMarkHp would` | `convertMarks hp -> stress` (any number). |
| | Tail Swipe | action, a Stress | Up to 3 within Very Close: Agility save; failure 5d6 phy, success half. |
| | Bull Rush | action, a Stress | Move prompt into Melee, attack, 3d10 direct phy. |
| Tyrannosaurus (80) | Earth-Shaking Roar | action, 1 Fear | Presence save within Close; failure: choose lose a Hope or 1d4 Stress. |
| | Stomp | action, a Stress | Attack in Melee, 3d12 direct phy. |
| | Crushing Bite | reaction `onHit standard`, 1 Fear | The target marks an additional HP. |
| Urco (80) | Fearmonger | reaction `pcRolls action failure within veryClose` | A Fear; the GM confirms the failure was with Hope (no such narrowing; prompt instead of auto). |
| | Terror-Fueled | passive | + GM Fear to attack (`stat attack gmFear`) and damage. |
| | Fear Eater | action, `choose` | Stress options 1-3 (pay N Fear, clear N Stress); HP options 1-4 gated on no marked Stress. |
| | Baleful Gaze | reaction `onDamaged fromAttack`, 1 Fear | The attacker's thresholds -1 for the scene; effects stack. |
| Valdenhax (80) | To Me, My Pretties | action, 1/scene | `check` 2d4 (always passes) -> a Fear per Horde (`lastRoll`); summon prompt for Tier 2 Hordes at Far (see AA1 note: its count shows 0 today). |
| | Shadow Strangler | action, a Stress | Attack within Far: 1d4 Stress, as many Fear (`lastRoll`). |
| | Corpse Whisperer | action, 1 Fear | `choose` even / odd (the d6 result): even clears half the ally's marked HP (rounded down) + **manual** resurrection; odd clears a Stress. |
| | Vexing Word | reaction `pcRolls`, a Stress | `modifyRoll reroll all` fold on that PC; the note says not on a critical. |

## Manual steps, reasons, beads

| Feature (HF p.) | Manual step | Reason | Bead |
|---|---|---|---|
| Basilisk Petrify (70); Sporophore Neurotoxic Spore Cloud (74); Alebrujo Howl (76); Sprite Dream Petal Poison (79); Gobstalker Beguile / Scare / Slow (75) | the condition's rider on the bearer's actions, rolls or spotlight | no lasting condition with a rider on the bearer | dcm-kti (reused) |
| Basilisk CRONCH! (70), Gargoyle Petrifying Slash (75), Gobstalker Doom (75), Empress Accursed Caress trigger (72) | death move; "mark all HP, less Hope spent" | no forced death move / mark-all-HP outcome | dcm-702 (new) |
| Berserker Pack Fury (70), Elite Guard Battle Formation (72), Shifter Pack Attack (76) | +1 per ally near the target / itself | no number source that counts creatures | dcm-ttz (reused) |
| Centaur Warden Eye of the Sage (70) | critical on 19 | no widened critical range | dcm-mhn (new) |
| Dire Pangolati Armor Eater (71) | 2 Armor Slots per severity step | no armor-cost modifier | dcm-s77 (new) |
| Doppelhound Blink Beast (71) | placing the duplicate, the attacker's d6 | no second position; no parity test | dcm-v27 (new), dcm-27j (reused) |
| Valdenhax Corpse Whisperer (80), Gobstalker Tentacle Rays (75) | the d6 parity / d8 table is a GM `choose`; the resurrection | no parity / multi-outcome check; no revive step | dcm-27j, dcm-145 (reused) |
| Cat Beast Screeching Caterwaul (72) | roll damage twice, keep the better vs Rattled | no damage advantage keyed to an imposed condition | dcm-51s (reused) |
| Gobstalker Corrode (75) | double damage if no Armor Slot can be marked | no fallback when a slot can't be marked | dcm-18i (reused) |
| Stone Titan Skillful Strike (79) | the target's Evasion halved | no attack modifier keyed to the target | dcm-xyw (reused) |
| Scarecrow Made of Straw (79) | double fire damage | no fire keyword | dcm-dv6 (new) |
| Rust Eater Rust Touch (78) | weapon die drops a step / crumbles | no equipment step | dcm-0gh (reused) |
| Alebrujo Rip & Tear (76) | attacks after the first extra one | no repeat-until-miss | dcm-7az (new) |
| Hive Walker Bee-Ruption (77) | Restrained targets fail automatically | no per-condition auto-fail on a save | dcm-fev (new) |
| Sporophore Mind Meld (74) | allies mark the Stress, distributed | no step moving marks onto allies; no "would mark Stress" | dcm-63j (new), dcm-2gn (reused) |
| Urco Fearmonger (80), Valdenhax Vexing Word (80), Fang Lord Pack Alpha (76) | GM confirms "with Hope" / "not a critical"; situation trigger for an ally's attack | missing trigger narrowings | dcm-2gn (reused) |
| Hut Pin (71), Unleash the Beast's Far move (76-77), movement in Trample, Toss, Swooping Strike, Leaping Strike, Bull Rush, Grasping Chains, Tongue Attack, Dread Honk | movement | movement prompts by design (Q9) | none |

## AA1 runner notes (bead dcm-vv2, commented)

1. A `followUp` damage roll with the same expression reuses the first roll: Double Strike (x3) and Rip & Tear write the
   second attack's damage out as dice (exact for these stat blocks; Rip & Tear adds The Beast Unleashed's Fear itself).
   A followUp's critical still reads the first roll.
2. `passiveSummary` resolves `gmFear` as 0, so The Beast Unleashed and Terror-Fueled add nothing until AA2 passes the
   GM's Fear into the passives.
3. `passiveSummary` drops `advantage` mods (High Ground, Gullible's aura is kept as an aura); AA2 must read
   `activePassives` for advantage.
4. Prompt numbers are resolved without `lastRoll`: To Me, My Pretties' summon count shows 0 (the Fear gain is right).
5. A forced Armor Slot from a separate reaction run (Rending Chomp, Hammer Smash) stays in `creatures[].after`; AA2
   should fold it into the open hit's `forcedArmor`.
6. Clearing the HP of a defeated instance keeps `self.after.defeated` true (The Work Never Ends).

## QUESTIONS (rule readings for the user)

1. **Triggered features printed as actions.** Grapple (HF p.75): "When the Octopus succeeds on a standard attack, you can
   spend a Fear to have the Octopus Grapple the target." Same shape: Dream Petal Poison (HF p.79), Hammer Smash (HF p.79).
   Read as offered right after the hit, without spending another spotlight. Should they instead need a fresh spotlight
   (a second GM move)?
2. **Doppelhound's conjure.** Blink Beast (HF p.71): "the duplicate is dispelled until you spend a Fear to conjure it
   again." Read as a Fear-feature use any time (no spotlight needed). Or only when the Doppelhound is spotlighted?
3. **Anti-Mystica-Halitosis** (HF p.75): "An attack, an ability, or a spell that deals magic damage or creates a magic
   effect fails automatically if used within Close range of the Gobstalker." Read as Silenced for PCs and its allies within
   Close. Does it also stop the Gobstalker's own Tentacle Rays (magic beams) when the target is within Close? And is
   "used within Close" the user's position, the target's, or either?
4. **Bloody Strike** (HF p.72): "A PC who marks 3 or more HP from an attack made by the Cat Beast must mark an additional
   HP." Read as Severe damage after armor (3 HP). With Crushing-Bite-style extra HP from other features in the same attack,
   should those count toward the 3?
5. **Steel-Skinned** (HF p.78): "All damage dealt to the Behemoth is reduced by one threshold." Read as Severe -> Major ->
   Minor -> none. Does Minor become none (like a PC's Armor Slot, CB p.114), or does it stay Minor?
6. **Sunlight Sickness** (HF p.79): "The Titan gains a bonus to their attack and damage rolls equal to the number of Stress
   marked." Read as the 1d4 just marked, for the rest of the scene. Or the Titan's current marked Stress, changing as it
   marks more (like Unleash the Beast)?
7. **Fearmonger** (HF p.80): "When a PC within Very Close range fails with Hope, you gain a Fear." Only action rolls, or
   reaction rolls too? (Reaction rolls have no Hope / Fear, CB p.99, so action rolls only is the reading.)
8. **Chill Touch** (HF p.73): "If the target marks their last Stress from this attack, you gain a Fear." Read as "their
   Stress track is full after the attack". If the PC was already full and marks a HP instead (CB p.92), should the Fear
   still come?
9. **Keratin Scales / Thick-Skinned / Leathery Hide** (HF p.71, 78, 79) work on HP the adversary "would mark". Read as
   folds on the incoming damage before it is marked (one HP fewer; HP marked as Stress). Can Leathery Hide's "any number of
   Stress" exceed the Triceratops' free Stress slots (overflowing back to HP, CB p.92)?
10. **Quick Volley** (HF p.70): "mark any number of Stress to target an equal number of additional creatures within
    range." Read as one attack roll against all targets (CB p.161). Correct?
