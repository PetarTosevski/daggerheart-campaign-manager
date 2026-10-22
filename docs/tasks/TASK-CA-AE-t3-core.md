# TASK AE-t3-core: Adversary feature effects, tier 3 Core Book

Plan `.omc/plans/combat-actions.yaml`, tracer AE-t3-core (depends on AA1). Analysis:
`.omc/autopilot/combat-actions-analysis.md` Part B (git-ignored). Book pages are printed pages; CB = Core Book.

User answers this tracer implements (binding):
- **Q15** "Automate EVERY adversary feature … split by tier and source into parallel tracers": 23 adversaries, 87
  features, one entry each (`src/lib/srd/adversary-effects/t3-core.ts`).
- **Q13** the hit PC chooses Armor and allies react in a window: damage to PCs comes back from the runner as `incoming`
  hits; nothing marks HP before the window.
- **Q17 (a)** the window has no timer (nothing here depends on one).
- **Q18 (a)** no map: no range or line-of-sight checks. Areas ("all targets within Close range") are the creatures the GM
  picks; `allyWithin` requirements hold.
- **Q19 (a)** Fear only on the GM's tap: Fear costs refuse with `confirmFear` until confirmed (see the runner bug under
  Notes for My Turn); reactions are one-tap prompts (default No); Momentum-style gains are `auto`.

## What landed

| File | What |
|------|------|
| `src/lib/srd/adversary-effects/t3-core.ts` | `T3_CORE_EFFECTS`: 87 entries, each quoting its feature text; shared builders for Minion, Group Attack, Momentum, Relentless, Terrifying, Slow / Slow Firing, forced Armor (Crushing Blows, Acidic Form), save-for-half. |
| `tests/unit/adversary-effects/t3-core.test.ts` | 93 tests: the table matches the SRD exactly (23 / 87), spotlight needs, Fear costs against the printed `fearCost`, a sweep that runs every use of every entry through `run()`, and one or more runs per feature with fixed dice (costs, spotlight, trigger via `triggeredUses`, targets, outcomes). |

The vocabulary types are unchanged. No Convex code.

## Rules used (quoted briefly)

- CB p.194: "For an adversary to use an action, they must have the spotlight. Passives and reactions typically don't
  require the spotlight." "'mark a Stress,' meaning you mark 1 Stress on the adversary".
- CB p.195: reactions "don't take effect until their specific trigger occurs … you don't have to spend Fear to interrupt".
- CB p.193: a feature that doesn't specify a Difficulty uses the adversary's Difficulty (`actorDifficulty`).
- CB p.161: one attack roll against every target (AR7). CB p.201: Group Attack, "Combine this damage" (AR9). CB p.99:
  direct damage.

## Conventions (shared with the tier 1 and 2 tables)

- Actions: `needsSpotlight: true`; passives, reactions and autos: `false` (checked by a test). Group Attack needs the
  spotlight, as in the tier 2 table (the tier 1 table reads it the other way; see QUESTIONS).
- "Make an attack" = `adversaryAttack` vs Evasion; the runner adds ATK. "Its standard attack damage" = `standardAttack`.
- PCs' reaction rolls are `save` steps: the runner returns a `pcSave` prompt per PC carrying the step; the branches run
  when the PC has rolled (AA2). Tests check the prompt and the branch content.
- Triggered passives are `auto`; printed reactions are `reaction`, also without "you can" (You Pale in Comparison,
  Lifesuck, Magical Weakness, Detonation, Frozen Scales). Story triggers are `situation` reactions (GM buttons).
- Countdown features have separate uses: activate, tick (where printed), and the effect when it triggers (a button).
- Tokens on the stat block count Slow's token, the Hydra's heads and the Demon of Avarice's handfuls of gold.
- "Take half damage" on the adversary (Uncanny Reflexes, Mistform) is a `modifyDamage halve` fold on `self` at
  `onDamaged` stage `would`; damage added to another adversary's hit (Rivalry, Concentrate Fire) is a `modifyDamage add`
  fold on the trigger's subject.

## Every feature and its reading

Legend: A action, R reaction, Au auto, P passive; S = needs the spotlight; costs in brackets. "PC save" = a reaction roll
prompt per PC.

| Adversary (page) | Feature | Reading |
|---|---|---|
| Adult Flickerfly (228) | Relentless (4) | P: `relentless 4`. |
| | Never Misses | Au `onAttack before`: **manual** "Evasion halved". |
| | Deadly Flight | P while "While flying": flag `flying`; the longer move is the GM's (no map rules). |
| | Whirlwind | A S [1 Fear]: attack vs all within Very Close, 3d8 direct phy. |
| | Mind Dance | A S [1 Stress]: PC save Instinct within Close; each failure: GM gains a Fear, tag "Fear known to the Flickerfly". |
| | Hallucinatory Breath | `activate` R `onDamaged first ever`: countdown 1d6, loop. `breath` R (situation): PC save Instinct in front up to Far; fail: lose 2 Hope, 3d8+3 direct mag. |
| | Uncanny Reflexes | R `onDamaged would, fromAttack, within Close` [1 Stress]: halve (fold). |
| Demon of Avarice (228) | Money Talks | `disadvantage` P while "the attacker hasn't spent a handful of gold": `disadvantageAgainst attack`. `hoard` Au `appears`: tokens = number of targets (the party). `collect` R (situation "PCs spend handfuls"): tokens + trigger amount. `pay-instead` Au `onTargetMarksHp standard`: **manual** gold instead of HP. |
| | Numbers Must Go Up | P: attack + tokens (`cardTokens`). |
| | Money Is Time | `gold` A S, tokens ≥ 3: spend 3, spotlight 1d4+1 allies. `fear` A S [1 Fear]: the same spotlight. |
| Demon of Despair (228) | Depths of Despair | Au `onAttack beforeDamage` while "The target has 0 Hope" (GM confirms): damage ×2 (fold). |
| | Your Struggle Is Pointless | A S [1 Fear]: every PC within Far tagged Despairing until a success with Hope or a rest; **manual** d8 Hope Die. |
| | Your Friends Will Fail You | R on a PC's failure with Fear [1 Stress]: the other PCs within Close (picked) lose a Hope. |
| | Momentum | Au. |
| Demon of Hubris (229) | Terrifying | Au on a hit: picked PCs lose a Hope, GM gains a Fear. |
| | Double or Nothing | `offer` Au on a PC's failure within Far: **manual** Fear Die reroll (the PC's choice). `still-failed` R (situation): the PC marks 2 Stress, the Demon clears 1. |
| | Unparalleled Skill | A S [1 Stress]: standard attack damage (3d10) to one target within Close, no roll. |
| | The Root of Villainy | A S [1 Fear]: spotlight 2 allies within Far ("two other Demons"). |
| | You Pale in Comparison | R on a PC's failure within Close: that PC marks a Stress. |
| Demon of Jealousy (229) | Unprotected Mind | P: `directAttacks` (its standard attack is its only attack). |
| | My Turn | R `onMarkHp fromAttack` [Fear = HP marked]: the attacker marks that many HP. |
| | Rivalry | R `allyMarksHp within Close` [1 Stress]: +1d4 to the other adversary's damage (fold). |
| | What's Yours Is Mine | R `pcMarksHp severe within Very Close` [1 Fear]: PC save Finesse; fail: **manual** theft. |
| Demon of Wrath (229) | Anger Unrelenting | P: `directAttacks`. |
| | Battle Lust | A S [1 Fear]: every PC within Far tagged Battle Lust for the scene; **manual** d20 Fear Die. |
| | Retaliation | R `onDamaged fromAttack within Close` [1 Stress]: standard attack vs the attacker. |
| | Blood and Souls | `activate` R (situation "first attack within sight"): countdown 6, loop. `tick` R (situation "a PC takes a violent action"). `summon` R (situation): 1d4 Minor Demons at Close. |
| Dire Bat (230) | Flying | P while flying: Difficulty +3, flag `flying`. |
| | Screech | A S [1 Stress]: everyone in front within Far marks 1d4 Stress. |
| | Guardian | R `allyMarksHp` named "Vampire" [1 Stress]: move to Melee of the attacker, attack with advantage, 2d6+2 phy. |
| Dryad (230) | Bramble Patch | A S [1 Stress]: point in Far; **manual** thorn patch. |
| | Grow Saplings | A S [1 Fear]: summon 3 Treant Saplings at Close, spotlight them. |
| | We Are All One | R `allyDefeated within Close` [1 Fear]: clear 2 HP and 2 Stress. |
| Elemental Spark (230) | Minion (9) / Group Attack | P `minion 9`; A S [1 Fear], 5 per Minion combined. |
| Greater Earth Elemental (230) | Slow | `prepare` Au on spotlight without a token: add a token, manual "describe". `act` Au with a token: clear it. |
| | Crushing Blows | Au on a hit: 1 Armor Slot without benefit; **manual** extra HP when none is free. |
| | Immovable Object | `reduce` Au `onDamaged would, physical`: reduce by 7 (fold). `immovable` R (situation "an attack would move it"): **manual** two ranges fewer. |
| | Rockslide | A S [1 Stress]: PC save Agility (19) in front within Close; fail 2d12+5 phy + Vulnerable until their next roll with Hope; success half. |
| | Momentum | Au. |
| Greater Water Elemental (230) | Water Jet | A S [1 Stress]: attack vs one in Very Close; hit 2d4+7 phy + tag Drenched (`nextRoll`), **manual** disadvantage; miss: the target marks a Stress. |
| | Drowning Embrace | A S [1 Fear]: attack vs all within Very Close; hit: Restrained and Vulnerable until a Strength or Instinct success. |
| | High Tide | R `onHit standard` [1 Stress]: knock the target back to Close. |
| Head Vampire (232) | Terrifying | Au. |
| | Look into My Eyes | Au `pcMoves into Melee`: PC save Instinct; fail: GM gains 1d4 Fear. |
| | Feed on Followers | A S while an ally is in Melee: the ally marks a HP, the Vampire clears one. |
| | The Hunt Is On | A S [2 Fear]: summon 1d4 Vampires at Far, spotlight them (`sameName` Vampire). |
| | Lifesuck | R `onSpotlight`: d8 check; 6+: every target within Very Close marks a HP. |
| Huge Green Ooze (231) | Slow | As above. |
| | Acidic Form | As Crushing Blows. |
| | Envelop | `envelop` A S: attack vs one in Melee; hit: tag Enveloped, 2 Stress, **manual** Stress per action roll. `release` Au `onDamaged severe`: clear Enveloped from the picked PCs. |
| | Split | R `onHpMarkedAtLeast 4` [1 Fear]: defeat self, summon 2 Green Oozes, spotlight both. |
| Hydra (231) | Many-Headed Menace | `heads` Au `appears`: tokens 3. `lose-head` Au `onDamaged major+`: spend a token. |
| | Relentless (X) | `relentless` P: `relentless 5` (the most heads). `heads` Au on spotlight: **manual** "as many times as it has heads". |
| | Regeneration | A S with marked HP [1 Fear]: clear a HP, +2 tokens (max 5). |
| | Terrifying Chorus | A S: every PC within Far loses 2 Hope. |
| | Magical Weakness | R `onDamaged magic`: tag Dazed and an effect "immune to magic" until the next roll with Fear; **manual** no Regeneration while Dazed. |
| Monarch (231) | Execute Them! | A S [1 Fear per PC: an `either` of 1-12 Fear, the GM picks the party size]: every PC tagged Condemned; manual trial (fiction). |
| | Crownsguard | A S, once per scene [1 Stress]: summon 6 Tier 3 Minions at Close. |
| | Casus Belli | `activate` R (situation "desire for war first revealed") [1 Fear]: long-term countdown 8. `war` R (situation): manual war (fiction), GM gains 1d4 Fear. |
| Oak Treant (232) | Just a Tree | `appears` Au `appears` and `hidden` Au `wouldGainCondition hidden`: tag "Just a Tree" on self until it acts or a PC's Instinct success. |
| | Seed Barrage | A S [1 Stress]: attack vs up to 3 within Close, 2d10+5 phy. |
| | Take Root | `root` A S [1 Stress]: tag Rooted + Restrained on self. `rooted` P while Rooted: resistant to physical. `uproot` A S while Rooted: clear both (instead of moving). |
| Stag Knight (231) | From Above | A S while "attacks from above the target": the standard attack vs one in Melee with 3d12+3 phy. |
| | Blade of the Forest | A S [1 Fear]: attack vs all within Very Close, 3d4 phy + **manual** Major threshold. |
| | Thorny Armor | R `onDamaged fromAttack within Melee` [1 Stress]: 1d10+5 phy to the attacker. |
| Treant Sapling (232) | Minion (6) / Group Attack | P `minion 6`; A S [1 Fear], 8 per Minion combined. |
| Vampire (232) | Draining Bite | A S: attack vs one in Melee, 5d4 phy; **manual** Hope, Stress and the Vampire's HP if the target marks HP. |
| | Mistform | R `onDamaged would, physical` [1 Fear]: halve (fold). |
| Vault Guardian Gaoler (232) | Blocking Shield | P while "the attacker is within Melee range and not trapped inside": `disadvantageAgainst attack`. |
| | Lock Up | A S [1 Stress]: attack vs one in Very Close; hit: Restrained until a Strength Roll (18); **manual** "can only attack the Gaoler". |
| Vault Guardian Sentinel (232) | Kinetic Slam | Au `onHit standard`: knock back to Very Close. |
| | Box In | A S [1 Stress]: tag Boxed In on one target; **manual** disadvantage within Very Close; one focus at a time (the GM clears the old tag). |
| | Mana Bolt | A S [1 Fear]: PC save Agility within Very Close of a point in Far; fail 2d8+20 mag + knock back to Close; success half. |
| | Momentum | Au. |
| Vault Guardian Turret (233) | Slow Firing | As Slow; "can't make a standard attack". |
| | Mark Target | A S [1 Fear]: tag Marked until the Turret is destroyed or the target becomes Hidden; **manual** Evasion halved. |
| | Concentrate Fire | R `allyDealtDamage within Far` [1 Stress]: +3d10+3 (its printed damage) to that damage (fold). |
| | Detonation | R `onDefeated`: PC save Agility within Close; fail 3d20 phy, success half. |
| Young Ice Dragon (233) | Relentless (3) | P. |
| | Rend and Crush | Au `onDealDamage toPc`: **manual** a Stress if the target didn't mark an Armor Slot. |
| | No Hope | Au on a PC's roll with Fear within Far: that PC loses a Hope. |
| | Blizzard Breath | A S [2 Fear]: PC save Agility in front within Close; fail 4d6+5 mag + Restrained until a Strength success; success: `choose` 2 Stress or half damage (the PC picks). |
| | Avalanche | A S [1 Fear]: PC save Instinct within Far; fail: Vulnerable until they dig out, GM gains a Fear per failure. |
| | Frozen Scales | R `onAttacked succeeded within Very Close`: the attacker marks a Stress, tag Chilled until a rest or they clear a Stress; **manual** disadvantage on attacks. |
| | Momentum | Au. |

## Manual steps

Narrative (no bead; the fiction is the GM's): Slow / Slow Firing "describe what they're preparing to do" (CB p.230,
p.231, p.233), Execute Them!'s trial (CB p.231), Casus Belli's war (CB p.231).

Vocabulary gaps (one bead each; reused where another tracer filed the same gap, with a comment naming these features):

| Feature (page) | Manual step | Reason | Bead |
|---|---|---|---|
| Never Misses (CB p.228) | Evasion halved against every attack | No modifier keyed to the target | dcm-xyw (reused) |
| Mark Target (CB p.233) | A Marked target's Evasion halved | Same | dcm-xyw (reused) |
| Money Talks (CB p.228) | The PC pays gold instead of HP | No option offered to the PC | dcm-6ju (new) |
| Double or Nothing (CB p.229) | The PC may reroll their Fear Die | Same | dcm-6ju (new) |
| Your Struggle Is Pointless (CB p.228) | d8 Hope Die | No condition rider on the bearer's own rolls | dcm-kti (reused) |
| Battle Lust (CB p.229) | d20 Fear Die | Same | dcm-kti (reused) |
| Water Jet (CB p.230) | Next action at disadvantage | Same | dcm-kti (reused) |
| Envelop (CB p.231) | A Stress per action roll | Same | dcm-kti (reused) |
| Lock Up (CB p.232) | Can only attack the Gaoler | Same | dcm-kti (reused) |
| Box In (CB p.232) | Disadvantage on attacks within Very Close | Same | dcm-kti (reused) |
| Frozen Scales (CB p.233) | Chilled: disadvantage on attacks | Same | dcm-kti (reused) |
| What's Yours Is Mine (CB p.229) | Seizes an item | No inventory step | dcm-0gh (reused) |
| Bramble Patch (CB p.230) | The thorn patch | No lasting area hazard | dcm-wuu (reused) |
| Crushing Blows (CB p.230), Acidic Form (CB p.231) | Extra HP when no Armor Slot is free | No fallback for a full armor track | dcm-18i (reused) |
| Immovable Object (CB p.230) | Pushed two ranges fewer | No forced-movement modifier | dcm-1yo (new) |
| Relentless (X) (CB p.231) | X = the Hydra's heads | `relentless` takes a fixed number | dcm-gx1 (new) |
| Magical Weakness (CB p.231) | No Regeneration while Dazed | No "lacks a condition" requirement | dcm-2f3 (new) |
| Blade of the Forest (CB p.231) | + the target's Major threshold | No number source for a threshold | dcm-a7o (new) |
| Draining Bite (CB p.232) | Hope, Stress and the Vampire's HP when the target marks HP | HP is marked after the window | dcm-sos (reused) |
| Rend and Crush (CB p.233) | A Stress when the target didn't mark Armor | No gate on the window's armor answer | dcm-sos (reused) |

Not manual, but worked around: Depths of Despair's "PCs with 0 Hope" is a situation the GM confirms (no gate on a PC
target's Hope, dcm-5xi, commented); Blocking Shield's "attacker within Melee" is a situation requirement; Execute Them!'s
Fear per PC is an `either` cost (party sizes 1-12) so the Fear is still asked first.

## Notes for AA2 / AA6 (runner behaviour found while testing)

1. **My Turn spends Fear without the GM's tap** (bug dcm-yle, P2). Its cost is `fear` × `triggerAmount`; `upfrontFear`
   resolves costs with `adversaryNumberEnv`, which has no `triggerAmount`, so `run` never refuses with `confirmFear`, and
   the card runner then pays it (verified: trigger amount 2, `fearConfirmed: false` → `fearSpent: 2`). Same root cause as
   TASK-CA-AE-t2-core note 1. The test runs it with `fearConfirmed: true` only.
2. **Money Talks' hoard** counts the use's targets (`targetCount picked` resolves to the targets passed): AA2 passes the
   party as `targets` when the Demon appears.
3. **Self-halving folds** (Uncanny Reflexes, Mistform) and Immovable Object's `reduceDamage 7` come back as `fold` steps
   on `self`; the server folds them into the damage the adversary is about to take (as Heavily Armored in tier 2).
4. **`allyName` matches exactly**: Guardian's "allied Vampire" is `allyName: "Vampire"`, so a Head Vampire marking HP does
   not offer it (see QUESTIONS).
5. **Choose inside a PC save** (Blizzard Breath's success branch): the option is the PC's; AA2 should ask the player, not
   the GM, when it resolves the branch.

## QUESTIONS (rule readings for the user)

1. **Hydra, Relentless (X)** (CB p.231): "can be spotlighted X times per GM turn, where X is the Hydra's number of heads."
   The modifier takes a fixed number, so it is set to 5 (the most heads) with a reminder of the heads on each spotlight.
   Would you rather it be 3 (the starting heads), so the engine never allows too many?
2. **Guardian** (Dire Bat, CB p.230): "When an allied Vampire marks HP". Does a Head Vampire count as a Vampire? Now only
   adversaries named "Vampire" set it off.
3. **Rivalry and Concentrate Fire** (CB p.229, p.233): read as a bonus added to the other adversary's damage roll (a fold
   before the damage lands). Concentrate Fire adds the Turret's printed damage dice (3d10+3), rolled. Confirm.
4. **Money Talks' starting hoard** (CB p.228): "a number of handfuls equal to the number of PCs" is set when the Demon
   appears (the PCs in the party). Should it count the PCs in the scene instead?
5. **Unparalleled Skill** (CB p.229): "deal the Demon's standard attack damage to a target within Close range": no attack
   roll, the damage lands (the PC still chooses Armor). Confirm.
6. **Blizzard Breath** (CB p.233): "Targets who succeed must mark 2 Stress or take half damage": the PC chooses. Or the GM?
7. **Just a Tree** (CB p.232): read as a tag on the Treant when it appears and when it would become Hidden (the GM
   clears it when it acts or a PC identifies it). Should "Hidden" itself be applied too?
8. **Group Attack needs the spotlight?** The tier 2 table (and this one) says yes (an action); the tier 1 table says no
   ("Spend a Fear to … spotlight all …": the Fear brings the spotlight). The two should agree.
9. **Lifesuck** (CB p.232): "all targets within Very Close range must mark a HP": read as PCs only (enemies). Or every
   creature, allies included?
