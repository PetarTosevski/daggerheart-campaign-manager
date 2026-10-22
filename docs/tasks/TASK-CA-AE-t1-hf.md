# TASK AE-t1-hf: Adversary feature effects, tier 1 Hope & Fear

Plan `.omc/plans/combat-actions.yaml`, tracer AE-t1-hf (depends on AA1). Analysis: `.omc/autopilot/combat-actions-analysis.md`
Part B (git-ignored). Book pages are printed pages; CB = Core Book, HF = Hope & Fear.

User answers this tracer implements (binding):
- **Q15** "Automate EVERY adversary feature … split by tier and source into parallel tracers": 35 adversaries, 103
  features, one entry each.
- **Q19 (a)** "Fear spent only on the GM's tap; Fear-cost features and a second spotlight ask first; optional ones are a
  one-tap prompt defaulting to No; Fear gains automatic": printed reactions are `reaction` (one-tap prompt); Fear gains and
  mandatory riders are `auto`.
- **Q18 (a)** "with no live map the GM targets PCs from the party list with no range or line-of-sight restrictions": ranges in
  the entries are for the map only.
- **Q13** the hit PC chooses Armor in the reaction window: damage to PCs comes out of `run` as `incoming` hits.

## What landed

| File | What |
|------|------|
| `src/lib/srd/adversary-effects/t1-hf.ts` | `T1_HF_EFFECTS`: 103 entries (one per printed feature), each quoting its feature text. |
| `tests/unit/adversary-effects/t1-hf.test.ts` | 95 tests: coverage (no missing or extra feature), Fear and Stress costs against the printed text, spotlight need, Fear confirmation, and each feature through `run()` with fixed dice (costs, trigger, targets, outcomes). |

No vocabulary type, engine or registry file is changed.

## Conventions

- Actions need the spotlight; passives and reactions don't (CB p.194: "For an adversary to use an action, they must have the
  spotlight. Passives and reactions typically don't require the spotlight."). A test checks `needsSpotlight` on every use.
- A printed Fear cost equals the entry's Fear cost (a test compares with `AdversaryFeature.fearCost`); "mark a Stress to" is a
  Stress cost on the adversary (CB p.194; a test reads the text).
- A Reaction Roll with no number uses the adversary's Difficulty (CB p.193: "If an adversary's feature doesn't specify a
  Difficulty …, it always uses the adversary's Difficulty"): `actorDifficulty`. A PC's reaction roll is a `pcSave` prompt.
- `trigger.source` = the creature who acted (the PC who moved, rolled or attacked); `trigger.subject` = the one it happened to
  (the PC this adversary hit, the creature who marked HP). AA2 must fill them that way.
- A trigger the engine can't see is a `situation` reaction (a GM button) with picked targets.
- "until they succeed on a Strength Roll (10)" and the like: `duration: "manual"` with `endsWhen`; the GM clears it.
- A passive whose damage replaces the standard damage (Headbutt, Pack Tactics) is a second attack use the GM picks instead of
  the standard attack, with a requirement for its condition.
- Effects that depend on a PC marking HP from one attack are a second use on `onTargetMarksHp` (a PC marks HP only when the
  window resolves), offered as a reaction because the trigger can't name the feature.
- Stat-block tokens: the instance's `tokens` (AA1); a Pool bonus is `stat attack` = `cardTokens`.
- "Story only" passives (no mechanics) are a passive use with one manual step, so the GM sees the text.

## Every feature and its reading

M = has a manual step (reason in the next section).

| Adversary (page) | Feature | Reading |
|---|---|---|
| Ahuizotl (p.62) | Aquatic Attacker | Passive while the GM confirms "attacks from the water": advantage on attacks (mod) and +1d6 to its standard attack (`attackDamage`). |
| | Tail Swat | Action, 1 Stress, attack vs one target within Very Close, 1d8+2 phy on a hit. |
| | Drag and Bag | Action, 1 Fear, one target within Close, no roll: pull into Melee, temporary `Bagged` tag (implies Restrained). M: advantage against them. |
| Atototl (p.62) | Wind Lord | Passive while flying (situation): disadvantage on attacks against it. |
| | Stone of Omens | Situation reaction "A PC searches the remains": a d12 fate roll (CB p.168). M: even / odd outcome. |
| | Archer's Bane | Reaction on "would take damage from an attack beyond Very Close", 1 Fear, attack roll vs the attacker; a hit negates the damage (fold) and deals the trigger amount back. Weapon attacks only: the GM declines otherwise. |
| Bugboar (p.62) | Surprise! | Passive with no HP or Stress marked and "first attack in this scene": advantage and +1d8 damage. |
| | Brutal | Reaction on a standard-attack hit, 1 Stress: +1d6 to that hit (a `modifyDamage` fold for the window). |
| | Warheart | Reaction on `wouldGainCondition`, 1 Fear: negate (fold). |
| Common Ruffian (p.62) | Group Attack | 1 Fear, shared roll, 1d8 per Ruffian (rolled per Ruffian), combined; `groupAttack within close`. |
| | Survival Instinct | Reaction when half its HP is marked: d6, 4+ flees (M), else +1 Fear. |
| Darkweave Crawler (p.63) | Minion (3) | `minion 3`. |
| | Skin-Crawling | 1 Fear, every PC within Melee marks a Stress. |
| | Group Attack | 1 Fear, 2 per Crawler, combined. |
| | Darkweave Venom | Reaction on a hit, 1 Stress: `Exhausted` tag until a Strength Roll (9). M: Stress per action roll. |
| Darkweave Queen (p.63) | Relentless (3) | `relentless 3`. |
| | Den Mother | Once per scene, 2 Fear: summon up to two Darkweave adversaries (not Queens) within Close; spotlight them. |
| | Quicker Than She Looks | 1 Fear: move up to Far (prompt), standard attack with advantage. |
| | Darkfang Envenomation | Reaction on a standard-attack hit, 1 Fear: Vulnerable and Restrained until a Strength Roll (12) or a rest. |
| | Terrifying | `auto` on a PC's failed attack against her: +1 Fear. |
| Darkweave Spinner (p.63) | Wrap in Shadow-Silk | 1 Stress, Melee attack: Vulnerable and Restrained until a Strength Roll (10). |
| | Shadow Fang | Reaction on a hit within Melee, 1 Fear: `Shaky` until an Instinct Roll (10). M: disadvantage on attacks. |
| Darkweave Swarmlings (p.63) | Horde (1d4) | `horde 1d4`. |
| | "Get 'em Off, Get 'em Off!" | Reaction when its attack makes a target mark HP, 1 Stress: temporary `Covered in Spiders`. M: the d6 per action roll. |
| Elk (p.64) | Headbutt | Attack use "headbutt" (situation: moved from Close or farther): 1d12+2 phy instead of its damage. |
| | Bolt | Two `auto` uses (marks HP / marks Stress): its reaction roll (10) or it flees (M). |
| Falcon (p.64) | Nimble Flyer | Passive while flying: +3 Difficulty. |
| | Dive Bomb | 1 Stress, standard attack with +2 to the roll and +2 damage. |
| Grimmling Warband (p.64) | Horde (1d4+1) | `horde 1d4+1`. |
| | Cowardly | Reactions on its last Stress / an ally defeated: d6, 2 or lower flees (M). Leader allies only (GM declines others). |
| Harpy (p.64) | Toxic Aura | `conditionAura` Vulnerable to all within Very Close (other Harpies excepted by the GM). |
| | Swooping Attack | 1 Stress, straight-line move to Far (prompt), attack a target in its path (`area: path`), 3d6 phy. |
| Kelpie (p.64) | Captivating | `auto` when a PC moves out of its Melee range: that PC marks a Stress. |
| | Heart's Desire | Story only (M). |
| | Shapeshifter | 1 Stress, `Shapeshifted` tag on itself. M: viewers' disadvantage. |
| | Enchant | 1 Fear, one PC within Close: Instinct reaction roll vs its Difficulty or `Enchanted` until they take damage. M: the behaviour. |
| Masque Muerte (p.65) | Libre | Flag `cannotBeRestrained`. |
| | Heel Turn | 1 Stress, attack within Close: the target marks a Stress and is temporarily Vulnerable. |
| | Spectral Suplex | 1 Fear, no roll, no range in the text: 1d10+6 magic to the target if Restrained. |
| | Unmasking Death | 1 Fear, each PC within Close: Presence reaction roll or mark a Stress. |
| | Tag Team | Reaction when it damages a PC, 1 Fear: `Pinned` (implies Restrained) until a Strength Roll. M: extra 1d12. |
| Mechanorb (p.65) | Hive Mind | Shown (M). |
| | Adaptive Tactics | Pool: `auto` +1 token on a miss; passive attack bonus = tokens; `auto` clear on Severe damage, its defeat, or a Mechanorb ally's defeat. |
| Mountain Troll (p.65) | Relentless (3) | `relentless 3`. |
| | Stolen Armor | `auto` at combat start: start the "Stolen Armor" countdown (M: start value = number of PCs); `auto` on "would take damage": reduce severity 1 (fold) and tick. |
| | Flail Swipe | 1 Stress, one roll against all in front within Very Close, 2d8+2 phy. |
| | Enraged Mountain Troll | Situation reaction "the countdown triggers", once a scene (HF p.61): +1 Difficulty (effect). M: the feature and attack swap. |
| | Double Swipe | 1 Fear, move up to Close, two Claw Swipe attacks (1d10+3) on one Melee target; two hits combine (one incoming hit) and cost a Hope. |
| Octopus (p.66) | Grapple | Attack within Close: Restrained and Vulnerable until a Strength Roll. |
| | Squirt Ink | 1 Stress; GM picks land / underwater. M: the area. |
| Panther (p.66) | Shadow Stalker | Passive while Hidden: +2 attack. |
| | Pouncing Strike | 1 Stress, leap into Melee of a target within Far (prompt), 1d12+2 phy. |
| Phantom (p.66) | Incorporeal | Resistant to physical. M: moves through solid objects (story). |
| | Fear Aura | Situation reaction "a PC takes the spotlight within Very Close": Presence reaction roll (10) or a Stress. |
| | Lingering Haunt | Reaction at its defeat, 1 Fear: start a 1d6 countdown and tag itself; `auto` tick on a PC's roll with Fear while tagged; situation reaction at 0: clear its HP, untag, spotlight it. |
| Poltergeist (p.66) | Specter | Resistant to physical; action use "move": 1 Stress, move up to Close through objects. |
| | Possessor | 1 Stress: `Possessing` tag; `auto` on "would take damage" while tagged: negate the damage, untag. |
| | Ghost Storm | 1 Fear, all within Very Close: Agility reaction roll; 1d12+2 phy, half on a success. |
| Rabble Mawb (p.66) | Horde (1d4+1) | `horde 1d4+1`. |
| | Come Back Worse | Reaction at its defeat, 1 Fear: clear all HP and Stress, a permanent +1 attack effect per use. |
| Redcap Biters (p.67) | Horde (1d4+2) | `horde 1d4+2`. |
| | Ankle Weights | As Captivating. |
| Redcap Breaker (p.67) | Backbreaker | 1 Stress, Melee attack, 3d4+10 phy; use "restrain" on `onTargetMarksHp`: Restrained until they clear a HP. |
| | Kneecapper | Reaction on a standard-attack hit, 1 Fear: temporarily Vulnerable. |
| Redcap Butcher (p.67) | Chop Happy | 1 Stress, one standard-attack roll against up to three targets; use "fear" on `onTargetMarksHp` (standard): +1 Fear per target. |
| | Knife Thrower | 1 Stress, standard attack within Far; use "hidden" (requires Hidden) with advantage. |
| Redcap Candlemaker (p.67) | Hand of Glory | `auto` on appearing: 5 tokens and Hidden; `auto` on marking HP: a token per HP marked. M: Hidden ends at 0 tokens. |
| | Torchbearer | While it has tokens: +1 damage aura to allies within Close (Redcaps only, by the GM). |
| | Dance in the Flames | Requires a token and spends it; a group within Far: Agility reaction roll, 2d10 magic, half on a success. |
| Redcap Skinner (p.67) | Minion (4) | `minion 4`. |
| | Shallow Cuts | Reaction on a PC's failed roll, against that PC. M: 1 damage per Skinner in Melee, combined. |
| | Group Attack | 1 Fear, 2 per Skinner, combined. |
| Rugaru (p.68) | Relentless (3) | `relentless 3`. |
| | Child of Night | Passive in moonlight: +2 Difficulty. |
| | Bloodthirsty | `auto` +1 token when a PC marks HP from its standard attack; attack bonus = tokens; `auto` clear on Severe damage. |
| | Howl at the Moon | 1 Stress, each PC within Far: Presence reaction roll (15); a failure loses a Hope and gains a Fear. M: the no-Hope branch. |
| | Flesh Ripper | 1 Stress, Melee attack, 1d12+2 direct phy. |
| Sawtoothed Gillbeast (p.68) | Ka-Chomp | 1 Stress, Melee attack, 1d12 phy and a forced Armor Slot without benefit (in the hit's `forcedArmor`). |
| | Feeding Frenzy | Reactions when a PC / an ally marks HP, 1 Fear: spotlight Gillbeasts within Very Close of them. M: their attacks combined. |
| | Scaly | Reaction on "would mark HP": d6, on a 6 the HP become Stress (`convertMarks` fold). |
| Soul-Shattered Mage (p.68) | Relentless (3) | `relentless 3`. |
| | Broken Magic | 1 Stress; a choose step for the move (M: the d6). Rift: teleport prompt + 2d6 direct magic; Dilation: `Slowed` (implies Vulnerable) until they roll with Hope (M: Stress on moving); Visions: attack up to three within Close, 2d8 direct magic. |
| | Feel My Pain | Reaction when it marks HP: d6s equal to its marked Stress, direct magic to every PC within Very Close. |
| Spellbound Armor (p.68) | Tireless | Shown (M). |
| | Clatter & Recombobulate | Reaction at its defeat, once a scene, 1 Fear: clear 2 HP, spotlight it. |
| Viper (p.69) | Minion (4) | `minion 4`. |
| | Venomous | `auto` on a standard-attack hit: temporary `Envenomated`. M: Stress per action roll. |
| | Group Attack | 1 Fear, 1 per Viper, combined. |
| Waxwork Creation (p.69) | Relentless (2) | `relentless 2`. |
| | No Vital Organs | Shown (M). |
| | Wax Ball | 1 Stress, attack within Far: 1d12+2 phy and Restrained until a Strength Roll (15). |
| | Splutch! | Reaction on a weapon attack from Melee against it: d6, 5+ the weapon is stuck (tag) until a Strength Roll (15). |
| | Smothering Grapple | Reaction on a Melee standard-attack hit, 1 Fear: `Trapped` (implies Restrained) until it takes Major damage. M: the rider. |
| Weredrake (p.143) | Climber | Story only (M). |
| | Pack Tactics | Attack use "pack-attack" (requires another Weredrake within Melee of the target): 1d8+6 phy and +1 Fear on a hit. |
| | Innocent Guise | Action: `Innocent Guise` tag on itself until it dies or uses the feature again. |
| Will-o'-the-Wisps (p.69) | Horde (1d4−1) | `horde 1d4 + (−1)`; the server passes `hordeDamage(def)` = "1d4-1". |
| | Kaleidoscopic | `conditionAura` Vulnerable to all within Very Close. |
| | Fascinating | 1 Fear, each PC within Far: Instinct reaction roll (13) or a Stress and a move toward it. |
| Yufo (p.69) | Telepathic | Story only (M). |
| | Psychic Strongbox | Shown (M); not damage immunity (CA2 excludes it). |
| | Glitch Wave | 1 Fear, up to three within Close: Instinct reaction roll or `Desynced` until a downtime move. M: disadvantage on Instinct Rolls. |
| | Temporal Corrosion | Reaction on a standard-attack hit, 1 Stress: −2 to both thresholds until they repair their armor (effect). |

## Manual steps (reason, page, bead)

| Feature (page) | Manual step | Why | Bead |
|---|---|---|---|
| Drag and Bag (p.62) | advantage against targets Restrained this way | no per-target advantage for a tagged creature | dcm-51s |
| Stone of Omens (p.62) | even: Hope = half; odd: Fear = half | no parity test on a check | dcm-27j |
| Survival Instinct (p.62), Bolt (p.64), Cowardly (p.64) | "flees the scene" | no step removes an instance without defeating it | dcm-icd |
| Darkweave Venom (p.63), Get 'em Off (p.63), Venomous (p.69), Broken Magic: Time Dilation (p.68) | the condition's rule on the bearer's rolls / moves | no lasting condition with a rider on the bearer's actions | dcm-kti (reused) |
| Shadow Fang (p.63), Glitch Wave (p.69) | disadvantage on the bearer's attack / Instinct rolls | same | dcm-kti (reused) |
| Heart's Desire (p.64), Incorporeal's "through solid objects" (p.66), Climber (p.143), Telepathic (p.69), Enchant's behaviour (p.64) | story text | no mechanics to automate | none |
| Shapeshifter (p.64) | disadvantage for creatures who find its form pleasing | per-viewer disadvantage | dcm-51s |
| Tag Team (p.65), Smothering Grapple (p.69) | extra 1d12 against Pinned; Trapped's Stress, move and release | effects on creatures carrying its condition | dcm-51s |
| Hive Mind (p.65), Shallow Cuts (p.67), Stolen Armor start (p.65) | +1 per Mechanorb; 1 per Skinner combined; number of PCs | no number source counting creatures | dcm-ttz |
| Enraged Mountain Troll (p.65) | lose two features, gain Double Swipe, new standard attack | no evolution step | dcm-gx3 |
| Squirt Ink (p.66) | the ink / darkness area | no lasting area | dcm-wuu (reused) |
| Hand of Glory (p.67) | Hidden ends at 0 tokens | a passive can't give itself a condition | dcm-cdz |
| Howl at the Moon (p.68) | a PC with no Hope marks a Stress and becomes Vulnerable | no gate on a target's Hope | dcm-5xi (reused) |
| Feeding Frenzy (p.68) | each Gillbeast's attack, combined | no combined damage of several attacks | dcm-1ch (reused) |
| Broken Magic (p.68) | the d6 that picks the move | no check with three outcomes | dcm-27j |
| Tireless (p.68), No Vital Organs (p.69), Psychic Strongbox (p.69) | immunity to forced Stress / crit damage / mind effects | no modifier for non-damage immunities | dcm-yea |

Other gaps without a manual step (the entry works, but needs the GM to decline): Phantom Fear Aura (no "a PC takes the
spotlight" trigger: a situation button), Archer's Bane (no weapon filter on `onDamaged`), Cowardly (no type filter on
`allyDefeated`): dcm-2gn. Backbreaker's Restrain and Chop Happy's Fear (the trigger can't name the feature): dcm-sos (reused).
Dance in the Flames' token cost: `AdversaryCost` has no token kind, so the entry requires a token and spends it in a step (no
bead; it is automated).

Runner findings (not the vocabulary, AA1 / CA1 code): dcm-vv2 (bug) — a follow-up attack gets no ATK; follow-up damage reuses
a cached identical roll; `passiveSummary` drops advantage / disadvantage-against mods; a negative Horde plus formats as
"1d4+-1"; a revived instance stays `defeated` (see dcm-145). The table works around the first two (Broken Magic's roll carries
ATK +2; Double Swipe's second attack rolls 1d10 and adds 3).

## For AA2

- Fill `trigger.source` / `trigger.subject` as above; pass `followUp` = the same target for Double Swipe and the move's
  targets for Broken Magic.
- Situation reactions (Stone of Omens, Fear Aura, Enraged Mountain Troll, Lingering Haunt's return) are GM buttons; their
  targets are picked.
- Multi-use features: offer the action uses (Headbutt, Pack Tactics, Knife Thrower "hidden", Specter "move") next to the
  standard attack; run triggered uses from `triggeredUses`.
- The Pool (Adaptive Tactics) is per instance until TASK-CA-AA1 Q5 is answered.

## QUESTIONS

1. **Howl at the Moon** (HF p.68): "Targets who fail lose a Hope. Gain a Fear for each Hope lost. If a PC has no Hope, they must
   mark a Stress and become Vulnerable until they roll with Hope." Read as: only a PC who fails and has no Hope to lose marks
   the Stress and becomes Vulnerable. Or does every PC with no Hope (even on a success) take it?
2. **Spectral Suplex** (HF p.65): "suplex a Restrained PC, dealing 1d10+6 magic damage" has no range and no attack roll. Read as:
   no roll, any range (GM picks a Restrained PC). Should it need Melee?
3. **Hand of Glory** (HF p.67): "Remove a token whenever the Candlemaker marks a HP." Read as one token per HP marked (marking 2
   HP removes 2). Or one token per marking?
4. **Come Back Worse** (HF p.66): "a bonus to all rolls equal to the number of times this feature has been used". Read as +1 per
   use on its attack rolls (its reaction rolls by hand). Confirm the bonus stacks per use (2nd revival = +2).
5. **Archer's Bane damage type** (HF p.62): it deals "the attacker's damage back"; the entry deals the same amount as
   physical (the weapon's type isn't in the trigger). Should it keep the attacker's damage type?
6. **Stolen Armor** (HF p.65): "When the Troll takes damage, reduce the severity by one threshold, then tick down the
   countdown." Read as every time it takes damage (an `auto` reduction), until it evolves. Confirm it applies even to damage that
   would already be Minor (Minor to none).
7. **Feeding Frenzy** (HF p.68): "When a creature marks HP" — read as any creature, PC or adversary (two uses). Confirm
   adversaries count.
