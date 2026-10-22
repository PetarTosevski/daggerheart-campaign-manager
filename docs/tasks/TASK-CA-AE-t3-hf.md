# TASK AE-t3-hf: Adversary feature effects - tier 3 Hope & Fear

Plan `.omc/plans/combat-actions.yaml`, tracer AE-t3-hf (depends on AA1). Book pages are printed pages (HF = Hope & Fear,
CB = Core Book). The 32 tier 3 Hope & Fear adversaries are on HF p.81-89.

## What landed

| File | What |
|------|------|
| `src/lib/srd/adversary-effects/t3-hf.ts` | 135 entries, one per printed feature of the 32 adversaries. Each entry quotes its feature text in a comment. Shared shapes are small builders: Relentless, Momentum, Terrifying, Double Strike / Double Claw, Specter, "any number of Stress", Swallowed (digest, disgorge), release on Major damage, the Aegis Die. |
| `tests/unit/adversary-effects/t3-hf.test.ts` | 141 tests. Coverage: a missing or extra feature fails, ids are unique, every printed Fear cost is in its entry (Intimidating excepted, see below), passives and reactions never need the spotlight. Then every feature runs through `run()` with `queueRng(...).done()` (every die used), checking costs (Fear, adversary Stress / HP), the spotlight, the trigger (`matchesTrigger` with a matching and a non-matching event), targets and outcomes. Passives are read through `passiveSummary` / `activePassives`. |

The vocabulary (`src/lib/domain/adversary-effects/types.ts`) is unchanged.

User answers implemented:
- **Q15** "Automate EVERY adversary feature": every feature has an entry; what the vocabulary can't express is a `manual`
  step listed below, with a bead.
- **Q13** the hit PC chooses armor: damage to PCs becomes `incoming` hits; riders on a hit (Piercing Bite, Celestial
  Lance, Slash and Burn) are folds on the open hit, not second hits.
- **Q18 (a)** no range restrictions without a map: `allyWithin` (Gang Up) holds when the map can't say; targets are what
  the GM picks; area shapes ("in front", "between", "on the line") are the GM's pick.
- **Q19 (a)** Fear only on the GM's tap: Fear costs are upfront costs (the runner asks first) or an `optional` step
  (default No: Get Over Here's second attack). "Any number of Fear / Stress" is a `choose` whose option is the tap (Force
  Salvo, Blazing Heart, Swell Ranks, Healing Touch) or one use per amount when the amount also sets the targets
  (Fireball). Fear gains with no choice are `auto` (Momentum, Terrifying, Spooky, Slash and Burn's Fear).

## Conventions

- Printed actions: `action`, `needsSpotlight: true` (CB p.194). Printed reactions: `reaction` (one-tap prompt, default
  No), `needsSpotlight: false`. Printed passives with a trigger and no choice: `auto`; with a choice: `reaction`.
- A PC's reaction roll is a `save`; with no printed Difficulty it uses the adversary's (CB p.193). The runner makes it a
  `pcSave` prompt and the server applies `onFail` / `onSuccess` per PC. One damage roll serves every PC.
- "The target" of a reaction: trigger `subject` (the PC hit / who rolled / who moved) or `source` (the attacker).
- Untracked conditions are tags with `duration: "manual"` and `endsWhen` in the book's words. State an adversary carries
  (Too Cute, Unhorsed, Masterwork Armor, Nest Warden, Hellwing, Smoldering Egg, Protective Aura) is a tag on the
  instance; the features that depend on it `require` the tag.
- Stat-block tokens: Counterspell's tokens (Archmage), Skull Splitter's token (Fire Titan), the Duplicate Countdown die
  (Fiend Revealed). The Archmage's Aegis Die is a tag ("Aegis Die 6" … "Aegis Die 1") because Counterspell owns its tokens.

## Features and readings

| Adversary (HF p.) | Feature | Activation | Reading |
|---|---|---|---|
| Archmage (81) | Relentless (3) | passive | |
| | Orbiting Aegis | `place` (auto appears), `ward-1..6` (auto onAttacked succeeded), `study-1..6` (auto pcRolls Knowledge success + situation) | The die face is a tag. `ward-N`: d6 <= N ticks it down and negates the damage (fold). `study-N`: the GM picks success (-1) or success with Hope (-2). |
| | Force Salvo | action, `choose` 1-12 Fear | Pay N Fear, roll Nd4 (`check`, its total is the bolts). **Manual**: placing the bolts (one HP each, at most three per creature). |
| | Fireball | action, uses `fireball-1..8` | N Stress, up to N PCs within Far: Agility save (own Difficulty) or 4d10 magic. |
| | Counterspell | reaction `pcRolls spellcast success`, 1 Fear + 1 per token | The Archmage rolls a d20 (a `save` on itself) against the trigger's amount (the Spellcast total); success: `modifyRoll fail` fold on the PC and a token. Not on a critical: a note (dcm-2gn). |
| Catrin (81) | Attracted to Wealth | passive, situation | Advantage on Presence aura for PCs carrying gold who roll to influence it. |
| | The Weight of Opulence | action, 1 Fear | Instinct save. **Manual**: a Hope per bag of gold, Stress when out of Hope. |
| | Expensive Failure | reaction `pcRolls action failure within melee`, a Stress | **Manual**: steals a handful of gold. |
| Chimera (81) | Rending Jaws | auto `onHit any` | **Manual**: 2 Armor Slots per severity step. |
| | Double Claw | action, a Stress | Two attack rolls (`followUp` with its own roll); hits on one PC merge. |
| | Breath of Fire | action, 1 Fear | Up to 3 PCs: Agility save (20); fail 3d12 magic; success `choose` an Armor Slot (no benefit) or a Stress. |
| | Serpent Strike | reaction `onAttacked targeted within close`, a Stress | Attack the attacker first: 4d4+10 phy, Poisoned (until rest). **Manual**: the d6 before action rolls. |
| Crimson Lepus (82) | Relentless (3) | passive | |
| | "Awww..." | `appear`, `attacked` (Instinct save (20) for the attacker; failure negates the attack), `hurt` (onDamaged), `attacks` (onAttack before) | Too Cute tag on the Lepus. |
| | Terrifying | auto `onHit any` | Picked PCs within Close lose a Hope; the GM gains a Fear. |
| | Leaping Jugular Strike | action, 1 Fear | Leap prompt; 3d20 direct phy. **Manual**: Vulnerable if they mark HP. |
| | Evasive | reaction `onDamaged would` | d6 >= 4: the GM says if already halved: halve fold, or negate. |
| | "Run Away!" | reaction `pcHope none within veryFar` | Presence save; failure: flee prompt and a "Fled" tag until they spend a Hope. |
| Cryptimoth (82) | Terrifying | auto | As the Lepus. |
| | Psychic Screech | action, 2 Fear | All within Far: reaction roll (16) read as Instinct (QUESTIONS 1); fail 3d8 direct magic + Vulnerable until rest; success `choose` a Stress or half. |
| | Shadow Swarm | action, 1 Fear | **Manual**: the swarm area. |
| | Paranoia Glare | action, 1 Fear | Paranoid tag. **Manual**: its rule. |
| Cursed Merfolk (82) | Fish-Tailed | auto situation `leave` / `return` | Vulnerable on itself while out of the water (GM buttons). |
| | Gang Up | passive, `allyWithin melee of target` | +2 attack. |
| | "Get Over Here!" | reaction `onHit standard beyond melee`, a Stress | Pull prompt; `optional` 1 Fear: a follow-up attack with advantage (+3 ATK on the roll). |
| Deep Dweller (83) | Psychic Blast | action, 1 Fear | Up to 3: Instinct or Knowledge save; success a Stress; fail 3d10+4 direct magic + Vulnerable until spotlighted. |
| | Brain Drain | action, a Stress | Only a Vulnerable PC: 1d4 Stress; it clears as many HP (`lastRoll`). |
| | Call of the Deep | action, 2 Fear | Summon 1d4 Cursed Merfolk at Far, spotlight them. |
| | Mucosal Contamination | action + `spotlight` (auto) + `release` (Severe) + `defeated` | Attack; hit: Slimed (Restrained); each spotlight 3d8 direct phy to Slimed PCs. |
| Drake (83) | Relentless (2) | passive | |
| | Guard Dog | reaction, situation, a Stress | Move prompt; `redirectDamage` to itself; `optional` free spotlight when the GM confirms the attacker is in Melee. |
| Dullahan (83) | Specter | passive + action `phase` | Physical resistance; a Stress to move through objects. |
| | Spectral Mount | `ride` (auto onSpotlight), `unhorsed` (auto situation), `summon` (action, a Stress, no spotlight) | Unhorsed tag + Vulnerable; the summon clears both (as Doppelhound's conjure, t2-hf QUESTIONS 2). |
| | Bone Whip Strike | action, a Stress | 4d4+10 direct phy, Vulnerable until they clear a HP. |
| | Death Glare | action, 1 Fear + `tick` (onSpotlight) + `end` (onDefeated) | Presence save (19); success a Stress; fail a HP and a Doom Countdown (4) whose trigger is a death move. |
| Fellmounted Shadow King (83) | Fellmount | passive (situation "on his mount") + `knocked` (Severe) + `summon` | +2 Difficulty while mounted; Severe damage tags him Unmounted and asks the GM to unconfirm "on his mount". |
| | Light and Shadow | passive `shadow` + auto `light` | Advantage in shadow; **manual** disadvantage reminder in bright light. |
| | Relic Hunter | passive, situation | Advantage against PCs with magic gear. |
| | Hellsong | action, 2 Fear | Presence save (18); success a Stress; fail a Stress and a Hope. **Manual**: 2 Fear if they can't lose a Hope. |
| | Air Support | reaction, situation, 3/scene, 1 Fear | `modifyRoll reroll` fold on the picked ally ("with advantage" in the note). |
| Fire Titan (84) | Relentless (3) | passive | |
| | Masterwork Armor | `start` (appears), `tick` (Major+), `armor` (would: reduce 1d12), `triggered` (situation), passive `broken` | Countdown (3) and a Masterwork Armor tag; once triggered, an Armor Broken tag gives +1 Difficulty and attack. |
| | Momentum | auto | |
| | Hurl Rock | action, a Stress | One attack roll against everyone between: 3d12 phy. |
| | Skull Splitter | `prepare` (action, a Stress, a token) + `strike` (auto onSpotlight with a token) | Spends the token: 3d20+5 direct phy; on a miss the target marks a Stress. |
| | Blazing Heart | reaction `onHpMarkedAtLeast half`, 1 Fear | `choose` N Stress, clear N HP. |
| Frost Titan (84) | Relentless (2) | passive | |
| | War Horn | action, a Stress | Presence save; fail a Stress + Vulnerable until the next attack against them (`hit`). |
| | Bull Rush | action, a Stress | Move prompt, attack: 4d10+2 phy, knock back to Close. |
| | Cleaving Strike | reaction `onTargetMarksHp standard`, a Stress | The picked PC marks the trigger's HP. |
| | Trophy Hunter | reaction `onDefeatPc` | **Manual**: takes a trophy. |
| Gargantuan Sea Turtle (84) | Relentless (3) | passive | |
| | Piercing Bite | auto `onHit standard` | The PC's `choose`: forced Armor Slot or double damage (folds). |
| | Tail Bash | action, a Stress | Standard attack on all behind (the GM's pick): +1d12, pushed to Close. |
| | Gigaton Splash | action, 1 Fear | Strength save; fail: pushed, 4d8 phy, temporarily Vulnerable, a Fear each (inside `onFail`); success a Stress. |
| | Steam Breath | action, 2 Fear | Agility save; fail 4d8 magic + temporarily Vulnerable; success `choose` a Stress or half. |
| Lamia (84) | Constriction | action, a Stress + `squeeze` (onSpotlight) + `release` (Major+) | Finesse save; fail Constricted (Restrained); a Stress on each spotlight. Its move ending it is in `endsWhen`. |
| | Life Leech | action, a Stress | The GM picks Vulnerable or Restrained (gates can't "or"); 1d4-1 HP, it clears as many. |
| | Sleep Toxin | reaction `onHit standard`, 1 Fear | Vulnerable until an Instinct Roll (19). |
| Lamplight Beguiler (85) | Doppel-Dangler | action, a Stress | Trusted Form tag; the player names the person (manual, narrative). |
| | Entice | action, 1 Fear | Presence save (18) or pulled into Melee. **Manual**: disadvantage for a trusted form. |
| | Gulp | reaction `pcMoves into melee`, 1 Fear + `digest` + `disgorge` | Attack: 3d6 phy and Swallowed; 3d6 on each spotlight; Major+ disgorges. |
| Manticore (85) | Relentless (3) | passive | |
| | Riddle Me This | passive | Reminder (narrative). |
| | Winged | passive, situation "airborne" | +2 Difficulty and attack. |
| | Pouncing Attack | action, 1 Fear | Pounce, 3d20+6 phy, Shaky until they spend a Hope. **Manual**: disadvantage on attacks. |
| | Paralyzing Tail Spike | action, a Stress | 3d8 phy, Restrained until a Strength Roll. |
| | Locking Jaws | reaction `onHit standard within melee`, a Stress | Restrained and Vulnerable until a Strength Roll (19). |
| Night Children (85) | Horde (2d6+2) | passive | |
| | Swell Ranks | action, 1/scene, `choose` N Stress | Clear N HP. |
| | Overwhelm | reaction `onMarkHp fromAttack within melee`, a Stress | Standard attack against the attacker. |
| Pain Priest (86) | Walk Between Worlds | action, a Stress | Teleport (Very Far), spotlight itself again. |
| | Pleasure and Pain | reactions `hope` (pcHope gain) and `hp` (pcMarksHp), within Close | d8 = 8: **manual** portal and flight with a PC; the GM gains 1d6 Fear. |
| Phoenix (86) | Purifying Aura | reaction `pcRolls action within melee` | The PC's `choose`: spend a Hope, clear a HP or a Stress, clear Vulnerable and Restrained. **Manual**: other conditions (tags). |
| | Fireseed | reaction `onMarkHp` | Summon a Minor Fire Elemental. |
| | Resurrection | `egg` (auto onDefeated), passive `immune`, reaction `touch` (situation) | Smoldering Egg tag on the same instance: immune to both types; touching it deals 3d4 direct magic. **Manual**: hatching in 7 days. |
| Plesiosaurus (86) | Only a Rumor | passive, situation "deep underwater" | `cannotBeTargeted`. |
| | Wall of Water | action, a Stress | Agility save (18) or 3d10 phy and pushed to Far. |
| Roc (86) | Relentless (3) | passive | |
| | Bird of Prey | auto `onSpotlight` | Very Far move prompt ("once per GM turn" in the note: no such limit). |
| | Here Comes the Boom | action, 1 Fear | 1d4+1 targets (rolled first), one attack: 3d12 magic; then everyone within Far (`picked`): Agility save (20). |
| | Crushing Grasp | reaction `onHit standard`, a Stress | 1d4 Stress, Restrained until a Strength Roll (20). |
| | Nest Warden | reaction, situation "eggs threatened" | Tags the Roc; Wrathful and Electrifying Aura require the tag. |
| | Wrathful | passive (Nest Warden) | +2 Difficulty, + marked Stress to its standard attack's damage. |
| | Electrifying Aura | passive (Nest Warden) + auto `shock` (pcRolls failure within veryClose) | Magic resistance; the PC's `choose`: a Hope or 1d4 Stress. |
| Sandwyrm (87) | Venomous Tail Stinger | action, a Stress | 3d10+2 phy; the PC hit: Strength save or Restrained + Vulnerable until they roll with Hope. |
| | Devour | action + `digest` + `disgorge` | Swallowed; a HP on each spotlight; Major+ disgorges. |
| | Hungry, Not Stupid | reactions `main` (half HP) and `swallow` (situation) | d6 <= 3: **manual** retreat. |
| Shapeshifting Fiend (87) | Fiendish Nature | passive | Magic resistance; reminder about illusions. |
| | Impersonate | action, 1 Fear + auto `targeted` (tag + situation) | Impersonating tag; an attacker who cares for that person: Instinct save or the attack fails and a Stress. |
| | Turn Invisible | action, a Stress + `damaged` / `rolls` | Hidden on itself until it attacks or takes damage. |
| | Backhanded Guidance | reaction `pcRolls action`, a Stress | The d6 is rolled. **Manual**: adding it to the Fear Die. |
| | Exposed! (Phase Change) | reactions `main` (onDefeated) and `discovered` (situation) | Summon the Fiend Revealed, spotlight it. |
| Shapeshifting Fiend Revealed (87) | Relentless (3) | passive | |
| | Fiendish Resistance | passive | As Fiendish Nature. |
| | Demonic Rage | action, 1 Fear | Standard attack + marked Stress to the roll, direct damage. |
| | Hall of Mirrors | action, 2 Stress + passive `duplicates` + auto `tick` (onAttacked failed) | The Duplicate Countdown (4) is the stat-block tokens: + tokens to its Difficulty while any remain; a failed attack spends one; at 0 the duplicates are gone. |
| | Flash Claw | action, 1 Fear | One attack against all within Close: 3d20 magic. |
| | Mind Games | reaction `onAttacked succeeded beyond veryClose`, a Stress | Switch prompt; `redirectDamage` to the picked PC. "With Fear" is the GM's call (dcm-2gn). |
| Storm Titan (87) | Relentless (3), Momentum | | |
| | Ball Lightning | action, 1 Fear + `move` (auto onSpotlight) + `strike` (situation) | Summon 1d4 sphere markers; a sphere reaching a PC: 4d6 magic. |
| | Storm Bringer | action, a Stress | Strength save; fail 3d12 magic + Vulnerable until spotlighted; success half. |
| | Thunderclap | action, 1 Fear | Up to 3 PCs: a Stress and Vulnerable until they roll with Hope. |
| Unicorn (88) | Celestial Lance | auto `mark` (onDamaged: tag the attacker) + auto `lance` (onHit standard, target tagged) | Double damage fold on a tagged target. |
| | Healing Touch | action, `choose` N Stress | The ally clears N HP. |
| | Protective Aura | action, a Stress + passive `aura` + auto `end` (onDamaged) | Disadvantage against attacks on it and allies within Very Close. |
| | Teleport | action, a Stress | Teleport prompts for it and up to 3 allies. |
| Vampire Bat Swarm (88) | Horde (2d6) | passive | |
| | Blinding Multitude | passive | Reminder (third-party disadvantage). |
| | Bloodsuckers | reaction `onDealDamage`, a Stress | The target marks a HP; the Swarm clears one. |
| Vampire Lord (88) | Relentless (3), Terrifying | | |
| | Midnight Heart | `defeated` (countdown 6), `tick` (situation: long rest), `heart` (situation: defeat) | **Manual**: the revival. |
| | Unleash Hellfire | action, a Stress | d4 bursts (`check`); one burst's 3d6 magic to each target. **Manual**: extra bursts on one target. |
| | Resurgence | reaction `pcRolls withHope within veryClose`, 1 Fear | Clear a HP or a Stress. |
| | Melt into Shadow | reaction `onDamaged would`, 1 Fear | d6 >= 5: negate, teleport. |
| | Hellwing | auto `onHpMarkedAtLeast half` | Hellwing tag. **Manual**: the new standard attack. |
| | On Crimson Wings | passive (Hellwing, flying) | +1 Difficulty. |
| | Blood Bath | reaction `onDamaged major` (Hellwing) + auto `pool` (onSpotlight) | 3d10 magic to all others within Very Close; a Blood Bath tag; 3d6 to those the GM picks in the pool on later spotlights. |
| Viscera Sucker (89) | Join or Die | passive | Reminder. |
| | Entangling Entrails | action, 1 Fear | Restrained until a Strength Roll (16). |
| | Lifesuck | action, a Stress | Only a Restrained target: a HP; it clears one. |
| Whisper Wraith (89) | Greater Specter | passive | Physical resistance; reminder. |
| | Spooky | auto `onHit any` | Picked PCs within Close mark a Stress; the GM gains a Fear. |
| | Nightmare Shroud | action, 1 Fear + `fear` (pcRolls withFear) + `split` (onDamaged would) + `release` | Shrouded tag; a Stress on their rolls with Fear; incoming damage halved (fold) and half (the trigger's amount) to the Shrouded PC. **Manual**: disadvantage on attacks. |
| Wyvern (89) | Double Strike | action, a Stress | As the Chimera. |
| | Terrifying Shriek | action, 1 Fear + `end` (onDefeated) | Terrified tag on everyone within Far. **Manual**: no Hope from rolls with Hope. |
| | Clutch | reaction `onHit any`, 1 Fear + `release` | Clutched (Restrained). **Manual**: disadvantage on attacks. |
| Young Fire Dragon (89) | Relentless (3) | passive | |
| | Intimidating | auto `onSpotlight` + situation "You spent a Fear to spotlight the Dragon" | `choose` a Stress or a Hope for the PCs within Close. No Fear of its own (QUESTIONS 2). |
| | Flame Breath | action, 1 Fear | Agility save; fail 4d8+3 magic; success `choose` a Stress or half. **Manual**: Vulnerable if they mark HP. |
| | Eruption | action, 1 Fear | PCs on the line: Agility save or Vulnerable until rest, a Fear each. |
| | Blazing Scales | reaction `onAttacked targeted within veryClose` | The attacker marks a Stress. |
| | Slash and Burn | auto `onHit standard` (a Fear) + reaction `burn` (a Stress) | +10 fold on the open hit (type: see dcm-i55). |

## Manual steps, reasons, beads

| Feature (HF p.) | Manual step | Reason | Bead |
|---|---|---|---|
| Archmage Force Salvo (81) | placing the bolts (one HP each, three per creature at most) | no split of forced HP marks | dcm-zhc (new) |
| Lamplight Beguiler Entice (85) | disadvantage on the reaction roll for a trusted form | a `save` has no advantage / disadvantage | dcm-rb0 (new) |
| Shapeshifting Fiend Backhanded Guidance (87) | add the d6 to the Fear Die | no roll change on one duality die | dcm-jog (new) |
| Phoenix Purifying Aura (86) | clear every other condition (tags) | no "clear all conditions" step | dcm-730 (new) |
| Young Fire Dragon Slash and Burn (89) | the extra 10 is magic on a physical hit | a damage add carries no type | dcm-i55 (new) |
| Chimera Rending Jaws (81) | 2 Armor Slots per severity step | no armor-cost modifier | dcm-s77 (reused) |
| Chimera Serpent Strike (81), Cryptimoth Paranoia Glare (82), Manticore Pouncing Attack (85), Whisper Wraith Nightmare Shroud (89), Wyvern Terrifying Shriek and Clutch (89) | the condition's rider on the bearer's rolls / actions | no lasting condition with a rider on the bearer | dcm-kti (reused) |
| Crimson Lepus Leaping Jugular Strike (82), Young Fire Dragon Flame Breath (89) | Vulnerable "if the target marks HP from this attack" | HP is marked after the reaction window | dcm-sos (reused) |
| Dullahan Death Glare (83) | the death move when the Doom Countdown triggers | no forced death move | dcm-702 (reused) |
| Catrin The Weight of Opulence and Expensive Failure (81), Frost Titan Trophy Hunter (84) | gold per bag, stealing gold, taking a trophy | no inventory step | dcm-0gh (reused) |
| Fellmounted Shadow King Hellsong (83), Catrin The Weight of Opulence (81) | "If a PC can't lose a Hope …" | no gate on a PC's Hope | dcm-5xi (reused) |
| Cryptimoth Shadow Swarm (82) | the swarm area | no lasting area | dcm-wuu (reused) |
| Fellmounted Shadow King Light and Shadow (83) | disadvantage on its attacks in bright light | no Mod for disadvantage on the bearer's own attacks | dcm-4dc (reused, card gap) |
| Vampire Bat Swarm Blinding Multitude (88) | disadvantage on attacks against others | no modifier on third-party attacks | dcm-346 (reused) |
| Pain Priest Pleasure and Pain (86), Sandwyrm Hungry, Not Stupid (87) | flees / retreats | no "leave the scene" step | dcm-icd (reused) |
| Phoenix Resurrection (86), Vampire Lord Midnight Heart (88) | hatching / revival with HP and Stress cleared | no restore-a-defeated-adversary step | dcm-145 (reused) |
| Vampire Lord Hellwing (88) | the new standard attack | no evolution step | dcm-gx3 (reused) |
| Vampire Lord Unleash Hellfire (88) | extra bursts on one target, combined | a damage repeat can't differ per target | dcm-1ch (reused) |
| Narrative (no bead): Riddle Me This (85), Join or Die (89), Doppel-Dangler's chosen person (85), "can't be fooled by magic illusions" (87), "can move through solid objects" (89) | reminders | story text; the illusion clause is close to dcm-yea | none |

Gaps without a manual step (the entry works; a GM button or note covers it): Guard Dog, Air Support, Sandwyrm's Swallow,
Midnight Heart's long rest, Intimidating's "spotlight paid with Fear", Counterspell's "not a critical", Mind Games' "with
Fear" (missing trigger narrowings: dcm-2gn, commented); Fish-Tailed as GM buttons (dcm-cdz, commented); Piercing Bite with no
free Armor Slot (dcm-18i, commented); Intimidating's per-PC choice (dcm-bz8, commented); Nightmare Shroud's split half typed
physical (dcm-86z, commented); Ball Lightning spheres and the Blood Bath pool picked by the GM (dcm-wuu, commented); Life
Leech's "Vulnerable or Restrained" as a GM choice (gates are AND only; no bead).

## Notes for AA2 / AA6

1. **A follow-up roll's ATK.** When the use's own roll is an adversary attack, a `followUp` roll inherits the ATK (Double
   Claw, Double Strike: no modifier in the entry). Without a main roll it doesn't (dcm-vv2), so Get Over Here's second
   attack carries +3 itself. Its critical still reads no main roll.
2. **The Archmage's reaction roll** (Counterspell) is a `save` on the Archmage with `difficulty: number triggerAmount`; AA2
   passes the Spellcast Roll's total as `trigger.amount`. The adversary rolls a plain d20 (no Experience).
3. **Tag-gated uses** (Aegis Die, Too Cute, Masterwork Armor, Unhorsed, Hellwing, Nest Warden, Smoldering Egg, Protective
   Aura) are offered by `triggeredUses` only while the instance carries the tag; the tags are written from `self.after.tags`.
4. **Hall of Mirrors** keeps the countdown die in the instance's `tokens`; the server should show it as "Duplicate
   Countdown" and `passiveSummary(...).difficulty` adds it (against attacks: the printed text says "when targeted by an
   attack").
5. **Countdowns inside a PC save** (Death Glare) lose their kind in the `pcSave` prompt (known, TASK-CA-AE-t2-core note 2);
   AA2 resolves the branches from the entry.
6. **`passiveSummary` drops `disadvantageAgainst` on self** (Protective Aura) and `advantage` mods (Light and Shadow, Relic
   Hunter): read `activePassives` (known, dcm-vv2).
7. Riders on a hit (Piercing Bite, Celestial Lance, Slash and Burn, Evasive, Melt into Shadow, Nightmare Shroud's split)
   come back as folds; a forced Armor Slot from a separate reaction run (Piercing Bite) stays in `creatures[].after` and
   should be folded into the open hit's `forcedArmor` (t2-hf note 5).

## QUESTIONS (rule readings for the user)

1. **Psychic Screech / Paranoia Glare** (HF p.82): "Each target must make an Insight Reaction Roll (16)"; "the PC must
   succeed on an Insight Roll (16)". Insight is not a trait. Read as Instinct. Correct, or Knowledge?
2. **Intimidating** (HF p.89): "When you spend a Fear to spotlight the Dragon, all PCs within Close range must mark a
   Stress or lose a Hope." The stat block lists a Fear cost, read as the spotlight's own Fear (CB p.153), not an extra Fear
   for the feature. Correct?
3. **Orbiting Aegis** (HF p.81): "If the result is equal to or less than the value of the Aegis Die, tick the Aegis Die down
   and ignore the damage." When the die reaches 0 (after showing 1), is the Aegis gone, or does it stay at 1? Read as gone.
4. **Counterspell** (HF p.81): "make a reaction roll with a Difficulty equal to the Spellcast Roll's result." Read as a
   plain d20 for the Archmage (adversary reaction roll, CB p.161). Can the GM add an Experience for a Fear?
5. **Force Salvo** (HF p.81): "Spend any number of Fear and roll that many d4s." Read as up to the whole pool (12). Is the
   Archmage's own spotlight Fear separate, as usual (CB p.194)?
6. **Evasive** (HF p.82): "If the damage was already halved, the Lepus takes no damage." Read as halved by anything
   (resistance, a card). Correct?
7. **Dullahan / Shadow King mounts** (HF p.83): "until you mark a Stress to summon it again." Read as usable any time
   without the spotlight (like Doppelhound's conjure, t2-hf QUESTIONS 2). Or only when spotlighted?
8. **Masterwork Armor** (HF p.84): "Until the countdown triggers, reduce incoming damage by 1d12." Every hit, including the
   one that ticks it (reduce first, then check Major / Severe on the reduced damage)? Read as yes.
9. **Skull Splitter** (HF p.84): "The next time the Titan is spotlighted, you must spend the token … and make an attack."
   Read as that spotlight's action (it doesn't need another spotlight, and it replaces any other action then). Correct?
10. **Hall of Mirrors** (HF p.87): the Difficulty bonus "When the Fiend is targeted by an attack". Should it also raise the
    Difficulty of PCs' reaction rolls against its features? Read as attacks only.
11. **Nightmare Shroud** (HF p.89): "damage that would be dealt to the Wraith is split evenly between the Wraith and the
    Shrouded target." With odd damage, who takes the extra point? Read as both rounding up (CB p.107 style). Does the PC's
    half count as damage from the Wraith (thresholds, armor)? Read as yes: an incoming hit for the PC.
12. **Celestial Lance** (HF p.88): "a creature that has dealt damage to it" - for the rest of the scene, or ever? Read as
    until the scene ends.
13. **Life Leech** (HF p.84): "mark 1d4−1 HP. The Lamia then clears an equal number of HP." On a 1 (0 HP), read as nothing
    happens. Correct?
14. **Here Comes the Boom** (HF p.86): the 1d4+1 targets are attacked; "Then each target within Far range of the Roc" makes
    the Agility roll. Read as every PC within Far, not only the attacked ones. Correct?
15. **Gigaton Splash** (HF p.84): "targets all creatures within Far range" but only PCs roll. Do the Turtle's allies take
    anything? Read as no.
16. **Piercing Bite** (HF p.84): with no free Armor Slot, the PC must take double damage (no choice). Confirm.
17. **Slash and Burn** (HF p.89): the extra 10 magic on a physical attack: does the hit count as physical and magic for
    resistance (CB p.99), or are the 10 a separate magic part? Read (and flagged, dcm-i55) as one hit of both types.
