# TASK AE-t2-core: Adversary feature effects, tier 2 Core Book

Plan `.omc/plans/combat-actions.yaml`, tracer AE-t2-core (depends on AA1). Analysis:
`.omc/autopilot/combat-actions-analysis.md` Part B (git-ignored). Book pages are printed pages; CB = Core Book.

User answers this tracer implements (binding):
- **Q15** "Automate EVERY adversary feature … split by tier and source into parallel tracers": 36 adversaries, 108
  features, one entry each (`src/lib/srd/adversary-effects/t2-core.ts`).
- **Q13** the hit PC chooses Armor and allies react in a window: damage to PCs comes back from the runner as `incoming`
  hits; nothing marks HP before the window.
- **Q17 (a)** the window has no timer (nothing here depends on one).
- **Q18 (a)** no map: no range or line-of-sight checks. Areas ("all targets within Close range") are the creatures the GM
  picks; `allyWithin` requirements hold.
- **Q19 (a)** Fear only on the GM's tap: Fear costs refuse with `confirmFear` until confirmed; reactions are one-tap
  prompts (default No); Momentum-style gains are `auto`.

## What landed

| File | What |
|------|------|
| `src/lib/srd/adversary-effects/t2-core.ts` | `T2_CORE_EFFECTS`: 108 entries, each quoting its feature text; shared builders for Minion, Group Attack, Momentum, Relentless, Horde, Ghost, Terrifying and "spotlight N allies at half damage". |
| `tests/unit/adversary-effects/t2-core.test.ts` | 116 tests: the table matches the SRD exactly (36 / 108), spotlight needs, Fear costs against the printed `fearCost`, a sweep that runs every use of every entry through `run()`, and one or more runs per feature with fixed dice (costs, spotlight, trigger, targets, outcomes). |

The vocabulary types are unchanged. No Convex code.

## Rules used (quoted briefly)

- CB p.194: "For an adversary to use an action, they must have the spotlight. Passives and reactions typically don't
  require the spotlight." "'mark a Stress,' meaning you mark 1 Stress on the adversary".
- CB p.195: reactions "don't take effect until their specific trigger occurs … you don't have to spend Fear to interrupt".
- CB p.193: "If an adversary's feature doesn't specify a Difficulty (like an Agility Reaction Roll), it always use[s]"
  the adversary's Difficulty. So unnumbered reaction rolls use `actorDifficulty`.
- CB p.161: one attack roll against every target (AR7). CB p.201: Group Attack, "Combine this damage" (AR9). CB p.199:
  Horde (X) (AR10). CB p.99: direct damage.
- CB p.153 / p.195 (spotlighting adversaries): a spotlighted adversary may "Move within Close range and make a weapon
  attack" or "Sprint somewhere else on the battlefield". So a passive's "Mark a Stress to move …" (Ghost, Shadow's
  Embrace) is a use that needs the spotlight.

## Conventions

- Actions: `needsSpotlight: true`, except Lurching Lunge (it is what spotlights the Experiment). Passives, reactions and
  autos: `false` (checked by a test).
- "Make an attack" = `adversaryAttack` vs Evasion; the runner adds ATK. "Make a standard attack … On a success, deal X"
  = the attack with X as the damage; "its standard attack" = `standardAttack` damage.
- PCs' reaction rolls are `save` steps: the runner returns a `pcSave` prompt per PC carrying the step; the branches run
  when the PC has rolled (AA2). Tests check the prompt and the branch content.
- Triggered passives ("Targets who mark HP from …", "When the X makes a successful attack …") are `auto`; printed
  reactions are `reaction`, also where the text has no "you can" (Death Quake, Fear Is Fuel, Warding Sphere), because
  the printed kind is a reaction.
- Countdown features have separate uses: activate (the printed trigger), tick, and the effect when the countdown
  triggers (a `situation` reaction, i.e. a GM button).

## Every feature and its reading

Legend: A action, R reaction, Au auto, P passive; S = needs the spotlight; costs in brackets. "PC save" = a reaction
roll prompt per PC.

| Adversary (page) | Feature | Reading |
|---|---|---|
| Apprentice Assassin (220) | Minion (6) | P: `minion 6`. |
| | Group Attack | A S [1 Fear]: one shared roll vs one target, 4 per Minion combined; the Minions' move into Melee is a move prompt. |
| Archer Squadron (220) | Horde (1d6+3) | P: `horde 1d6+3`. |
| | Focused Volley | A S [1 Fear]: attack with advantage vs everyone within Close of a point in Far; 1d10+4 phy on hits. |
| | Suppressing Fire | A S [1 Stress]: point in Far; **manual** zone. |
| Assassin Poisoner (220) | Grindletooth Venom | Au on `onTargetMarksHp` (any attack): the PC becomes Vulnerable until they clear a HP (`manual` duration). |
| | Out of Nowhere | P while Hidden: `advantage on attack`. |
| | Fumigation | A S: everyone within Close gets the tag Dizzied (`nextRoll`); **manual** disadvantage. |
| Battle Box (221) | Relentless (2) | P: `relentless 2`. |
| | Randomized Tactics | A S [1 Stress]: d6 `check`, then a chain of checks reading the same result; each branch is a `followUp` on the GM's picked creatures: 1 Mana Beam (attack +2 vs one in Far, 2d10+2 mag), 2 Fire Jets (attack vs all in Close, 2d8 phy), 3 Trample (attack, 1d6+5 phy and Vulnerable until their next roll with Hope), 4 Shocking Gas (PC save Finesse: 3 Stress), 5 Stunning Clap (PC save Strength: Vulnerable until the Box is defeated), 6 Psionic Whine (PC save Presence: 2d4+9 direct mag). |
| | Overcharge | R `onAttack beforeDamage` [1 Stress]: +1d6 to the damage (a fold) and the GM gains a Fear. |
| | Death Quake | R `onMarkHp last`: PC save Instinct within Close, 2d8+1 mag on a failure. |
| Chaos Skull (221) | Levitation | P: flags `flying`, `cannotBeRestrained`. |
| | Wards | P: resistant to magic. |
| | Magic Burst | A S [1 Stress]: attack vs all within Close, 2d6+4 mag. |
| | Siphon Magic | A S [1 Fear]: attack vs one in Very Close; on a hit the PC marks 1d4 Stress, the Skull clears the rolled amount, and a spotlight-self prompt. |
| Conscript (221) | Minion (6) / Group Attack | As above, 6 per Minion. |
| Courtesan (221) | Searing Glance | Two R uses on a PC's Presence Roll within Close [1 Stress each]: `on-failure` 2 Stress + Vulnerable for the scene (or until a social success against her); `on-success` 1 Stress. |
| Cult Adept (222) | Enervating Blast | A S [1 Fear]: attack vs one in Far, standard damage, +1 Stress on a hit. |
| | Shroud of the Fallen | A S [1 Stress]: an ally within Close gets the effect "Protected" (resistant to both) until the Adept marks their last HP. |
| | Shadow Shackles | A S [1 Fear]: everyone within Close of a point in Far is Restrained until a Strength or Instinct success; **manual** "spend a Hope to make an action roll". |
| | Fear Is Fuel | R on a PC's failure with Fear, twice per scene: clear 1 Stress. |
| Cult Fang (222) | Shadow's Embrace | `climb` P (no modifier); `shadow-step` A S [1 Stress]: teleport prompt within Far. |
| | Pick Off the Straggler | A S [1 Stress]: PC save Instinct; fail 2 Stress, teleported with the Fang, temporarily Vulnerable; success 1 Stress. |
| Cult Initiate (222) | Minion (6) / Group Attack | As above, 5 per Minion. |
| Demonic Hound Pack (222) | Horde (2d4+1) | P. |
| | Dreadhowl | A S [1 Stress]: everyone within Very Close loses a Hope; **manual** fallback (2 Stress without Hope). |
| | Momentum | Au on a hit: GM gains a Fear. |
| Electric Eels (222) | Horde (2d4+1) | P. |
| | Paralyzing Shock | A S [1 Stress]: attack vs all within Very Close, standard damage; **manual** Fear per target who marks HP. |
| Elite Soldier (222) | Reinforce | A S [1 Stress]: move prompt, attack vs one in Very Close, 2d10+2 phy; the picked ally clears a Stress on a hit. |
| | Vassal's Loyalty | R (situation "a knight or other noble within Very Close would take damage") [1 Stress]: move prompt, `redirectDamage` to self. |
| Failed Experiment (223) | Warped Fortitude | P: resistant to physical. |
| | Overwhelm | Au `onAttack beforeDamage` while `allyWithin veryClose of target`: damage ×2 (a fold). |
| | Lurching Lunge | A, no spotlight [1 Stress]: spotlight self. |
| Giant Beastmaster (223) | Two as One | R `onSpotlight`: spotlight one picked animal. |
| | Pinning Strike | A S: standard attack vs one in Far; optional `pin` [1 Stress] on a hit: Restrained until a Finesse or Strength success. |
| | Deadly Companion | A S, twice per scene: summon 1 Tier 1 animal at Close; spotlight it. |
| Giant Brawler (223) | Battering Ram | A S [1 Stress]: move prompt; PC save Agility for everyone within Very Close of the object, 2d4+3 phy. |
| | Bloody Reprisal | R `onMarkHp atLeast 2, fromAttack, attacker within Very Close`: attack the attacker, 2d6+15 phy. |
| | Momentum | Au. |
| Giant Eagle (223) | Flight | P while "While flying": Difficulty +3, flag `flying`. |
| | Deadly Dive | A S [1 Stress]: attack vs one in Far, 2d10+2 phy, Vulnerable until they next act. |
| | Take Off | A S: attack vs one in Very Close, 2d4+3 phy; on a hit PC save Agility: temporarily Restrained and lifted to Very Far (move prompt). |
| | Deadly Drop | A S while flying: the held target loses Restrained; **manual** fall (2d20). |
| Giant Recruit (223) | Minion (7) / Group Attack | As above, 5 per Minion. |
| Gorgon (224) | Relentless (2) | P. |
| | Sunsear Arrows | Au on a standard-attack hit: tag Glowing for the scene; **manual** advantage against it / can't become Hidden. |
| | Crown of Serpents | A S: attack vs one in Melee; on a hit `pay` 1 Stress, then 2d10+4 phy and 1 Stress on the target (no Stress, no damage). |
| | Petrifying Gaze | `gaze` R `onDamaged fromAttack within Close` [1 Fear]: the attacker's PC save Instinct; fail: 1 HP and Petrification countdown (4). `tick` Au `onAttacked targeted`: tick. `end` Au `onDefeated`: end all. |
| | Momentum | Au. |
| Juvenile Flickerfly (224) | Relentless (3) | P. |
| | Peerless Accuracy | Au `onAttack before`: d6 `check`, 4+ gives a **manual** "Evasion halved". |
| | Mind Dance | A S [1 Stress]: PC save Instinct within Close; each failure: GM gains a Fear and the PC gets the tag "Fear known to the Flickerfly". |
| | Hallucinatory Breath | `activate` R `onDamaged first ever`: countdown start 1d6, loop. `breath` R (situation "countdown triggers"): PC save Instinct in front up to Far; fail 1 Stress and lose a Hope. |
| Knight of the Realm (224) | Chevalier | `mounted` P while mounted: Difficulty +2. `unhorsed` Au `onDamaged severe` while mounted: **manual** (dismount; the GM unconfirms "mounted"). |
| | Heavily Armored | Au `onDamaged would, physical`: reduce damage by 3 (a fold). |
| | Cavalry Charge | A S while mounted: move up to Far, attack, 2d8+4 phy and 1 Stress on a hit. |
| | For the Realm! | A S [1 Stress]: spotlight 1d4+1 allies; each spotlit ally gets a `halfDamage` effect. |
| Masked Thief (225) | Quick Hands | A S: attack vs one in Melee, 1d8+2 phy; **manual** theft. |
| | Escape Plan | A S [1 Stress]: PC save Agility (13) around a point anywhere; fail Restrained and Vulnerable until a Finesse or Strength Roll (13). |
| Master Assassin (220) | Won't See It Coming | P while Hidden: `directAttacks`. |
| | Strike as One | A S [1 Stress]: spotlight "Assassin" allies, count = 5 − marked Stress after paying. |
| | The Subtle Blade | R `onHit standard` vs a Vulnerable target [1 Fear]: the hit's damage becomes Severe (`minimumSeverity severe`, a fold). |
| | Momentum | Au. |
| Merchant Baron (225) | Everyone Has a Price | A S [1 Fear]: PC save Presence (17); failure: choose 2 Stress or take the deal. |
| | The Best Muscle Money Can Buy | A S, once per scene [1 Stress]: summon 1d4+1 Tier 1 adversaries at Far. |
| Minotaur Wrecker (225) | Ramp Up | `spotlight-cost` P: `spotlightCostsFear`; `sweep` A S: standard attack vs all within range (Very Close), no Fear of its own. |
| | Charging Bull | A S [1 Stress]: attack vs all in its path, 2d6+8 phy, knocked back to Very Far; optional `collision` adds 1d6 to the picked creatures' total. |
| | Gore | A S: move to Melee, attack vs one in Very Close, 2d8 direct phy. |
| Mortal Hunter (225) | Terrifying | Au on a hit: every picked PC loses a Hope, GM gains a Fear. |
| | Deathlock | A S [1 Fear]: tag Deathlocked for the scene; **manual** direct damage and one at a time. |
| | Inevitable Death | A S [1 Stress]: spotlight 1d4 allies at half damage. |
| | Rampage | `activate` R first spotlight in the scene: countdown 1d6, loop. `rampage` R (situation): move to Far, attack all in the path, 2d8+2 phy. |
| Royal Advisor (225) | Devastating Retort | Au on a PC's action roll against it with total ≤ 16: the PC marks a Stress. |
| | Bend Ears | A S [1 Stress]: **manual** (social). |
| | Scapegoat | A S [1 Fear]: **manual** (social). |
| Secret-Keeper (226) | Seize Your Moment | A S [2 Fear]: spotlight 1d4 allies at half damage. |
| | Our Master's Will | R `allySpotlit within Far` [1 Stress]: GM gains a Fear. |
| | Summoning Ritual | `activate` R first spotlight: countdown 6. `tick` Au `onMarkHp`: tick by the HP marked. `summon` R (situation): Minor Demon at Close. |
| | Fallen Hounds | R `onMarkHp atLeast 2`, once per scene [1 Stress]: summon a Demonic Hound Pack at Close, spotlight it. |
| Shark (226) | Terrifying | Au. |
| | Rending Bite | Au on a hit: 1 Armor Slot without its benefit; **manual** extra HP when none is free. |
| | Blood in the Water | R `pcMarksHp within Close` [1 Stress]: spotlight self, move to Melee, standard attack vs that creature. |
| Siren (226) | Captive Audience | A S: the standard attack against an Entranced target as its own button: 2d10+1 phy only if the target has the tag Entranced. |
| | Enchanting Song | A S [1 Fear]: PC save Instinct within Close; fail: tag Entranced (implies Vulnerable) and `cannotAct` until they mark 2 Stress; **manual** other Sirens' +1 Difficulty. |
| Spectral Archer (226) | Ghost | `resistance` P (physical); `phase` A S [1 Stress]: move up to Close through objects. |
| | Pick Your Target | A S [1 Fear]: attack vs one in Far, 2d8+12 phy. |
| Spectral Captain (226) | Ghost | As above. |
| | Unending Battle | A S [2 Fear]: summon (return) up to 1d4+1 defeated Spectral allies. |
| | Hold Fast | R (situation "Spectral allies forced to make a reaction roll") [1 Stress]: +2 to the allies' roll (a fold). |
| | Momentum | Au. |
| Spectral Guardian (226) | Ghost | As above. |
| | Grave Blade | A S [1 Fear]: attack vs one in Very Close, 2d10+6 phy, 1 Stress on a hit. |
| Spy (227) | Gathering Secrets | A S [1 Fear]: **manual** (narrative). |
| | Fly on the Wall | `reveal` R (situation) [1 Stress]: **manual** reveal. `report` R (situation "escapes to report"): GM gains 1d4 Fear. |
| Stonewraith (227) | Stonestrider | `immune` P while "within stone or earth": immune to both. `enter-stone` A S: move prompt, Hidden until it leaves the stone. |
| | Rocky Ambush | A S while Hidden [1 Stress]: leap to Melee; PC save Agility or Instinct (15): 2d8 phy, temporarily Restrained. |
| | Avalanche Roar | A S in a cave [1 Fear]: PC save Agility (14) within Close, 2d10 phy; Progress Countdown (8) for the rubble. |
| | Momentum | Au. |
| War Wizard (227) | Battle Teleport | `before` / `after` R around its standard attack [1 Stress]: teleport within Far. |
| | Refresh Warding Sphere | A S [1 Stress]: `refreshFeature` (drops Warding Sphere's use record). |
| | Eruption | A S [1 Fear]: PC save Agility (14) within Very Close of a point; fail 2d10 phy and thrown out; success half. |
| | Arcane Artillery | A S [1 Fear]: PC save Agility for everyone in the scene; fail 2d12 mag, success half. |
| | Warding Sphere | R `onDamaged fromAttack within Close`: 2d6 mag to the attacker; then exhausted (scene limit) until refreshed. |

## Manual steps

Narrative or social (no bead; the fiction is the GM's): Bend Ears, Scapegoat, Gathering Secrets, Fly on the Wall's
reveal (CB p.225, p.227); Knight of the Realm's dismount (CB p.224: the GM unconfirms "mounted" so Chevalier and
Cavalry Charge stop; a situation, not a vocabulary gap); Merchant Baron's "take the deal" option (CB p.225).

Vocabulary gaps (one bead each, reused where another tracer filed the same gap):

| Feature (page) | Manual step | Reason | Bead |
|---|---|---|---|
| Suppressing Fire (CB p.220) | The zone until the next roll with Fear | No lasting area with an entry trigger | dcm-wuu (reused; dcm-pgl closed as its duplicate) |
| Fumigation (CB p.220) | Disadvantage on the next action roll | No condition rider on the bearer's own rolls | dcm-kti (reused) |
| Shadow Shackles (CB p.222) | "must spend a Hope to make an action roll" | Same | dcm-kti (reused) |
| Dreadhowl (CB p.222) | 2 Stress when no Hope can be lost | No gate on a PC target's Hope | dcm-5xi |
| Paralyzing Shock (CB p.222) | A Fear per target who marks HP | HP is marked after the window | dcm-sos (reused) |
| Deadly Drop (CB p.223) | 2d20 unless the PCs prevent the fall | No delayed outcome | dcm-1jg |
| Sunsear Arrows (CB p.224) | Advantage against Glowing, can't become Hidden | No modifier keyed to the target | dcm-xyw |
| Peerless Accuracy (CB p.224) | Target's Evasion halved for the attack | Same | dcm-xyw |
| Deathlock (CB p.225) | Direct damage vs the Deathlocked target; one at a time | Same | dcm-xyw |
| Quick Hands (CB p.225) | Steals an item | No inventory step | dcm-0gh |
| Rending Bite (CB p.226) | Extra HP when no Armor Slot is free | No fallback for a full armor track | dcm-18i (reused) |
| Enchanting Song (CB p.226) | Other Sirens' Stress for +1 Difficulty each | Allies can't pay into a roll | dcm-q0a |

Also noted on dcm-27j: Randomized Tactics' six-way d6 is a chain of checks (works, but a multi-outcome check would be
clearer).

## Notes for AA2 / AA6 (runner and server behaviour found while testing)

1. **`adversaryNumberEnv` has no `triggerAmount`.** Prompt numbers (countdown `amount`, summon `count`) are resolved with
   it, so Summoning Ritual's tick "by the number of HP marked" (`amount: triggerAmount`) resolves to 0. The entry is
   right; `run.ts` should pass `context.trigger.amount` into the prompt environment.
2. **Adversary-only steps inside a PC save lose their kind.** `run` replaces `summon` / `countdown` / `spotlight` with
   placeholder `manual` steps before the card runner; a PC save's `pcSave` prompt carries the translated step, so
   Petrifying Gaze's failure branch reaches the server as `markHp` + a manual "Petrification" instead of a countdown.
   AA2 should resolve the PC's branches from the original entry (`useOf(...).steps`), not from the prompt's step.
3. **A follow-up attack roll in a use without a main roll doesn't get ATK** (the runner adds ATK only when the use's own
   `roll` is an adversary attack). Randomized Tactics carries the Box's +2 in each branch's roll; a natural 20 on such a
   branch doesn't max the damage (the critical is read from the main roll only).
4. **`passiveSummary` drops `advantage` mods** on self (Out of Nowhere: advantage while Hidden). The entry states it; the
   summary only keeps `flag` mods. AA2 should read it when it builds `advantage` for the attack.
5. **Riders and reactions on an attack** (Overcharge, Overwhelm, The Subtle Blade, Heavily Armored, Rending Bite,
   Sunsear Arrows) run as their own uses and return folds or marks; the server folds them into the attack's hit (and
   needs the attack's targets in the context, or `to: "targets"` steps find no recipient).

## QUESTIONS (rule readings for the user)

1. **Overwhelm without a map** (CB p.223): "When a target the Experiment attacks has other adversaries within Very Close
   range, the Experiment deals double damage." It is `allyWithin veryClose of: target`, and with no live map AA1's
   requirement holds (Q18), so it would always double. Should the server ask the GM instead when there is no map?
2. **Strike as One** (CB p.220): "spotlight a number of other Assassins equal to the Assassin's unmarked Stress." Read as
   after paying this feature's Stress (5 Stress, 1 marked: 4 Assassins). Or before paying (5)?
3. **"Make a standard attack … deal 2d10+2 instead"** (Reinforce, CB p.222; Cavalry Charge, CB p.224): the attack uses
   the standard attack's ATK and the printed dice replace its damage. Confirm.
4. **The Subtle Blade** (CB p.220): "deal Severe damage instead of their standard damage." Read as damage of Severe
   severity (3 HP before armor; the PC may still mark an Armor Slot to make it Major). Or forced 3 HP that armor can't
   reduce?
5. **Warding Sphere** (CB p.227): "can't be used again until the Wizard refreshes it". Stored as a once-per-scene use
   that Refresh Warding Sphere drops; a new scene also resets it. Should a new scene keep it spent?
6. **Movement in passives** (Ghost, Shadow's Embrace, Stonestrider): "Mark a Stress to move up to Close range through
   solid objects." Read as part of the adversary's spotlight (needs the spotlight). Or usable at any time?
7. **Randomized Tactics targets** (CB p.221): the GM picks the move's creatures before the d6 is rolled (the runner takes
   targets up front). Fine, or should the d6 be rolled first and the targets asked after (two steps on the server)?
8. **Death Quake, Fear Is Fuel, Warding Sphere** have no "you can" but are printed reactions: offered as one-tap
   prompts (default No, Q19) like every reaction. Or should they happen automatically?
9. **Siphon Magic** (CB p.221): "the target marks 1d4 Stress and the Skull clears that many Stress." Read as the number
   rolled (even if the PC's track overflowed into HP). Confirm.
