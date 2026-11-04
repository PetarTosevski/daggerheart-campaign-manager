# TASK LN-SRD-A1: SRD adversary data, tiers 1-2, on the wave-4 vocabulary

Plan `.omc/plans/lanes.yaml`, tracer SRD-A1 (lane `w2-srd-data`), wave 5. Wave 4 widened the vocabulary (TASK-LN-V.md)
and taught the engines to run it with fixture entries (TASK-LN-E1..E8.md); this tracer switches the real entries of
`src/lib/srd/adversary-effects/{t1-core,t1-hf,t2-core,t2-hf}.ts` over. Data and per-entry tests only; no types or
engine file changed. Book pages are printed pages (CB = Core Book, HF = Hope & Fear).

## Manual steps

`manual` objects in each table (what `coverage.test.ts` counts):

| File | Before | After | Left (distinct) |
|---|---|---|---|
| t1-core | 29 | 13 | 13 |
| t1-hf | 33 | 7 | 6 (Feeding Frenzy has two uses) |
| t2-core | 18 | 7 | 7 |
| t2-hf | 32 | 12 | 9 (Tentacle Rays' 3 beams sit in the d8 table and in the Fear pick) |
| total | 112 | 39 | |

## Entries automated

| Entry | Was manual | Now | Bead |
|---|---|---|---|
| Spit Acid, Acidic Form (×2), Armor-Shredding Shards (CB p.210-216), Rending Bite (CB p.226), Corrode beam (HF p.75) | no free Armor Slot | `markArmor.ifUnable` (an HP; Spit Acid + a Fear; Corrode doubles the damage) | dcm-18i |
| Acid Bath (CB p.210) | blood pool | `area` at a point, Very Close, owner excluded, 1d6 physical `onEnter` | dcm-wuu, dcm-cma |
| Hobbling Shot (CB p.212) | Agility disadvantage | `Hobbled` tag gated `targetMarkedHp`, `disadvantage` on Agility, until an HP is cleared (by hand) | dcm-sos |
| Venomous Stinger (CB p.211), Neurotoxic Spore Cloud (HF p.74) | Poisoned d6 | `bearerRider` before each action roll: d6 ≤ 4 marks a Stress | dcm-kti |
| Envelop, Ignite (CB p.215-216), Darkweave Venom, Venomous (HF p.63, 69), Petrify's Stiff (HF p.70), Panicked (HF p.76) | per-roll / per-act / per-spotlight rider | `bearerRider` (`actionRoll` / `acts` / `spotlight`); Envelop also `endsOnCaster: takeSevere` | dcm-kti |
| I've Got 'Em + Hold Them Down (CB p.213) | double damage | Restrained carries `attackedRider by: others, multiply 2`; both conditions `endsOnCaster: majorDamage` | dcm-346 |
| Preferential Treatment (CB p.214) | disadvantage vs the Merchant | `disadvantage` on Presence with a situation (the "pay more" stays) | |
| My Land, My Rules; Exile (CB p.216) | social disadvantage | `disadvantageAgainst` / `disadvantage` with a situation; Exile also tags the picked PCs (the target's allies) | |
| Creeping Fire (CB p.216) | movement limit | passive `moveLimit` Very Close | dcm-wuu |
| Won't Stay Dead (CB p.217) | re-forms | `revive` all HP (lifts `defeated`) | dcm-145 |
| In Your Face (CB p.218) | disadvantage vs others | aura `disadvantage unlessTarget: caster` | dcm-346 |
| Drain and Multiply (CB p.218) | Horde HP | summon `hp` = Tangle Brambles within Close (removing them stays) | dcm-145, dcm-ttz |
| Encumber, Crush (CB p.218) | bramble tokens | `tokens holder: recipient`; Vulnerable at 3+ (`targetCheck tokens`); Crush's requirement `check`; ends on the Swarm's Major damage | dcm-xp0 |
| Goading Strike (CB p.218) | Taunted | `disadvantage unlessTarget: caster`, `endsOn: attackSucceeds` | dcm-kti |
| Drag and Bag (HF p.62) | advantage on the Bagged | `attackedRider by: caster, advantage` | dcm-51s |
| Stone of Omens (HF p.62) | even / odd | d12 `check` `even`: half (rounded up) as Hope to the searching PC, else half as the GM's Fear | dcm-27j |
| Survival Instinct, Bolt (×2), Cowardly (×2) (HF p.62-64) | flees | `move mode: leaveScene` (`plan.fled`) | dcm-icd |
| Shadow Fang, Glitch Wave (HF p.63, 69) | disadvantage | condition `disadvantage` (attack / Instinct) | dcm-kti |
| "Get 'em Off" (HF p.63) | Covered in Spiders | `bearerRider` on action rolls: d6 ≥ 4, the bearer picks a Stress or the GM's Fear (reading: dcm-72qk) | dcm-kti |
| Shapeshifter (HF p.64) | per-viewer disadvantage | `disadvantageAgainst` with a situation on its Shapeshifted tag | dcm-51s |
| Tag Team (HF p.65) | +1d12 magic | Pinned `attackedRider by: caster, add 1d12 magic` | dcm-51s |
| Hive Mind (HF p.65), Battle Formation (HF p.72), Pack Fury (×2, HF p.70) | count allies | passive `stat` difficulty / attack = `creatureCount` | dcm-ttz |
| Enraged Mountain Troll (HF p.65) | feature swap | permanent self effect: `features` remove / add, `standardAttack` Claw Swipe 1d10+3 phy | dcm-gx3 |
| Squirt Ink (HF p.66) | ink / cloud | `area`s: ink with an Agility reaction roll `onEnter` (Vulnerable), a `blocksSight` cloud | dcm-cma |
| Hand of Glory (HF p.67) | Hidden while tokens | passive `selfCondition` Hidden, requires 1+ tokens | dcm-cdz |
| Shallow Cuts (HF p.67) | damage per Skinner | flat damage = Skinners within Melee of the PC | dcm-ttz |
| Howl at the Moon (HF p.68) | no Hope | `hope.ifUnable`: a Stress and Vulnerable `endsOnRoll` with Hope; the Fear gated on Hope held | dcm-5xi |
| Broken Magic (HF p.68) | GM picks the d6 move | d6 check `table` 1-2 / 3-4 / 5-6; Slowed gets a Stress-per-move rider and `endsOnRoll` | dcm-27j |
| Tireless, No Vital Organs, Psychic Strongbox (HF p.68-69) | immunities | flags `noForcedStress`, `noCritDamage`, `mindImmune` | dcm-yea |
| Smothering Grapple (HF p.69) | Trapped | `bearerRider casterSpotlit`: a Stress and a move with it; `endsOnCaster: majorDamage` | dcm-51s |
| Suppressing Fire (CB p.220) | zone | `area` at the point, Close: Agility reaction roll `onEnter`, 2d6+3 or half | dcm-cma |
| Fumigation (CB p.220) | Dizzied | `disadvantage` on action rolls, duration `nextRoll` | dcm-kti |
| Shadow Shackles (CB p.222) | Hope to act | `bearerRider` before action rolls with a Hope cost | dcm-kti |
| Dreadhowl (CB p.222) | no Hope | `hope.ifUnable`: 2 Stress | dcm-5xi |
| Deadly Drop (CB p.223) | the fall | Falling tag, `bearerRider afterPcsNextAction`: 2d20 physical | dcm-1jg |
| Sunsear Arrows (CB p.224) | Glowing | `cannotBeHidden` + `attackedRider advantage` | dcm-xyw |
| Chevalier (CB p.224) | unhorsed | Unhorsed tag; the +2 `requires` it lacks it (`lacks`); a new `remount` use clears it on its spotlight | dcm-2f3 |
| Quick Hands (CB p.225) | theft | `inventory take` | dcm-0gh |
| Deathlock (CB p.225) | direct damage, one at a time | `attackedRider by: caster, direct`; `exclusive` | dcm-xyw, dcm-vkp |
| Enchanting Song (CB p.226) | Sirens raise the Difficulty | `SaveDifficulty raised` (other Sirens within Close of the target, a Stress each, +1) | dcm-q0a |
| CRONCH!, Petrifying Slash (HF p.70, 75) | death move | `deathMove` (`plan.deathMoves`) | dcm-702 |
| Eye of the Sage (HF p.70) | 19-20 | `critRange: 19` | dcm-mhn |
| Armor Eater (HF p.71) | 2 slots per step | `armorCost slotsPerStep: 2` (read by `hitArmorCost`) | dcm-s77 |
| Blink Beast (HF p.71) | duplicate, the attacker's d6 | `summon duplicate`; d6 `odd` negates the attack | dcm-v27, dcm-27j |
| Screeching Caterwaul (HF p.72) | best of two | `modifyDamage best of 2`; Rattled `endsOnRoll` with Hope | dcm-51s |
| Tentacle Rays (HF p.75) | GM picks the beam | d8 check `table` of the 8 beams, or a Fear-paid pick; Slow's Stress to move is a rider cost; Hypnosis ends on damage | dcm-27j |
| Rip & Tear (HF p.76) | the chain | `followUp.repeat until: miss, costEach: Stress` | dcm-7az |
| Pack Attack (HF p.77) | + other Shifters | `modifyDamage add creatureCount` | dcm-ttz |
| Bee-Ruption (HF p.77) | Restrained fail | `save.autoFail: [restrained]` | dcm-fev |
| Rust Touch (HF p.78) | weapon die | `inventory damageWeapon metalWeapon` | dcm-0gh |
| Made of Straw (HF p.79) | fire | passive `weakness` keyword fire | dcm-dv6 |
| Dream Petal Poison (HF p.79) | Sleepy | `bearerRider` before action rolls: Presence reaction roll (13, the Sprite's), fail: 2 Stress or Asleep (`endsOn: takeDamage`) | dcm-kti |
| Corpse Whisperer (HF p.80) | even / odd, resurrect | d6 `even`: `revive` half HP; odd: a Stress | dcm-27j, dcm-145 |

## Manual steps left and why

| Entry | Why | Bead |
|---|---|---|
| Shield Wall (CB p.212) line bonus; the blocked move | no "Guards in a line" count; no step blocks a move | dcm-346, dcm-xobk |
| On My Signal (CB p.212), Feeding Frenzy ×2 (HF p.68) | each attacker rolls, hits on one target combine: `groupAttack.eachRolls` / `name` exist but E7 doesn't run them (a shared roll would be wrong) | dcm-1ch |
| Suppressing Blast (CB p.217), Paralyzing Shock (CB p.222) | a Fear per target that marked HP: no such count | dcm-nsqo |
| Drain and Multiply (CB p.218) | removing the combined Minions | dcm-xobk |
| Encumber (CB p.218) | the Finesse removal that spawns Minions | dcm-xobk |
| Thorny Cage (CB p.218) | a Stress for action rolls against the cage | dcm-xobk |
| Peerless Accuracy (CB p.224), Skillful Strike (HF p.79) | the d6 can't halve the Evasion of the attack it precedes | dcm-5jyp |
| Unleash the Beast ×3 (HF p.75-76), Pin (HF p.71) | a wider move before acting; dragging the Restrained target | dcm-z5a6 |
| Mind Meld (HF p.74) | `markStress distribution: split` exists, but the card runner marks the whole amount on each recipient | dcm-63j |
| Tentacle Rays beams Beguile, Doom, Scare (HF p.75) | can't attack the caster / forced attack; the PC's Hope spend before forced HP; a rider on the GM's Fear spend | dcm-zi3k |
| Slow ×2, Scapegoat ×2, Climber ×2, Preferential Treatment ×2 (story parts), Heart's Desire, Enchant, Incorporeal, Telepathic, Everyone Has a Price ("take the deal"), Bend Ears, Gathering Secrets, Fly on the Wall | story only | dcm-by2d |

## Beads

| Bead | State | Notes |
|---|---|---|
| dcm-27j check > 2 outcomes / parity | done here (data) | Broken Magic and Tentacle Rays tables; Stone of Omens, Blink Beast, Corpse Whisperer parity. Battle Box's Randomized Tactics (CB p.221, t2-core) still reads its d6 through a chain of checks: works, left as is. |
| dcm-fev auto-fail a save | done | Bee-Ruption. |
| dcm-s77 dearer Armor Slots | done (t2-hf part) | Armor Eater; Tormenting Lash / Boiling Blast / Rending Jaws are SRD-A2's. |
| dcm-6n0p drop the follow-up ATK workaround (t1-hf) | not done | Discordant Visions now sits in a check table row, and the adversary runner doesn't translate table rows (no ATK added there): the `modifier: fixed(2)` stays until dcm-b3bb. Totals in the tests unchanged. |
| dcm-c5h once per GM turn (t2-hf Ravenous) | nothing in these files | Ravenous is the Wyrmlings' (HF p.97), a t4-hf entry (SRD-A2). No tier 1-2 entry says "once per GM turn" (only Relentless). |
| Switched data for engine beads | data done | dcm-18i, dcm-145, dcm-1jg, dcm-2f3, dcm-346 (In Your Face, I've Got 'Em; Shield Wall's line still open), dcm-51s, dcm-5xi, dcm-702, dcm-7az, dcm-cdz, dcm-dv6, dcm-gx3, dcm-icd, dcm-kti, dcm-mhn, dcm-q0a, dcm-sos, dcm-ttz, dcm-v27, dcm-vkp, dcm-wuu, dcm-xp0, dcm-xyw, dcm-yea, dcm-0gh, dcm-cma: the tier 1-2 entries their titles name now use the vocabulary. |

## Follow-ups filed

- dcm-b3bb (E7): the adversary runner doesn't translate `check.table` rows (follow-up ATK, halving, `hasFollowUpAttack`).
- dcm-e16o (E7): the adversary run context forwards no `hopeOf`, `saveRaisers`, `creatureTokens`, map creatures or
  `chain` to the card runner, so Dreadhowl / Howl at the Moon always ask the table, Enchanting Song gets no raisers, the
  creature counts resolve 0 (Drain and Multiply's summon prompt says "with 0 HP" until then) and Rip & Tear asks for each
  next target.
- dcm-iedr (E7 / E6): the plan's condition step drops `mods`, `endsOnCaster`, `endsOnRoll`.
- Vocabulary gaps: dcm-nh44 (split a Hope gain: Stone of Omens), dcm-nsqo, dcm-5jyp, dcm-xobk, dcm-z5a6, dcm-zi3k, dcm-by2d
  (story only, P4).
- Known runtime gaps from wave 4, not refiled: `markArmor.ifUnable` in the card runner (dcm-nsjj), bearer riders at roll
  time (dcm-mm0f), `critRange` in `rollOnce` (dcm-mhn), `targetMarkedHp` after the window (dcm-ehgy), `eachRolls` (dcm-1ch).

## QUESTIONS (not blocking; dcm-72qk)

1. Covered in Spiders (HF p.63): "they must mark a Stress or you gain a Fear". Built: the bearer picks.
2. Goading Strike (CB p.218): "until their next successful attack. The next time the Taunted target attacks, they have
   disadvantage against targets other than the Weaponmaster." Built: the disadvantage lasts the whole Taunt.
3. Exile (CB p.216): "the target and their allies". Built: the target plus the PCs the GM picks.
4. Stone of Omens (HF p.62): "half the result". Built: rounded up (CB p.107: "round up unless otherwise specified").

## Checks

`pnpm lint` clean; `pnpm typecheck` (tsc) clean; `pnpm test`: 9273 passed, 2 failed under load (tests/convex/schema-guard.test.ts timed out at 15 s, tests/convex/auth-signup.test.ts global sign-up bucket 65 > 63, a timing bound); both pass rerun alone (49 / 49). Neither touches adversary data. `tests/unit/adversary-effects/`: 1022 passed, coverage.test.ts included.
