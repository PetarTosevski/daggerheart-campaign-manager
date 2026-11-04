# TASK LN-SRD-A2: SRD adversary data, tiers 3-4

Plan `.omc/plans/lanes.yaml`, tracer SRD-A2 (lane `w2-srd-data`), wave 5. Wave 4 (E1-E8) taught the engines the
widened vocabulary (docs/tasks/TASK-LN-V.md) with fixture entries; this tracer switches the real tier 3 and tier 4
adversary entries over. Data and per-entry tests only: no types.ts, runner or engine file changed. Book pages are printed
pages (CB = Core Book, HF = Hope & Fear).

Files: `src/lib/srd/adversary-effects/{t3-core,t3-hf,t4-core,t4-hf}.ts` and their tests in
`tests/unit/adversary-effects/`.

## The rule used for every manual step

A manual step became automated steps when the wave-4 engine runs the vocabulary for it: the runner (adversary
`run.ts` over card `run.ts`) produces a plan step the server applies or a structured prompt (split, choose, pcSave
with its dice, death move, revive, flee). Where the vocabulary has the piece but the engine leaves it unread (the plan
drops condition `mods`, the server ignores `inventory` plan steps, `attackedRiders` are not built from PCs' tags, the
post-window re-run is missing), the manual step stays, so the GM is still told, and the engine bead is named below.

One exception: a PC reaction roll's branches are applied by the GM from the `pcSave` prompt (AR11), so a manual step
inside `onFail` / `onSuccess` was never shown. Those were rewritten whenever the vocabulary can say them (the data is
then right for the day the server applies the branches).

## Entries automated

| Entry | File | Was | Now | Bead |
|---|---|---|---|---|
| Crushing Blows, Acidic Form | t3-core | manual extra HP | `markHp` gated on `targetCheck` track armor free atMost 0, before the slot | dcm-18i (t3 part) |
| Hydra: Relentless (X) | t3-core | times 5 + a reminder on every spotlight | `relentless.timesFrom` = stat-block tokens (its heads) | dcm-gx1 |
| Hydra: Magical Weakness / Regeneration | t3-core | manual "can't regenerate while Dazed" | Regeneration `requires` `hasCondition` Dazed `lacks` | dcm-2f3 (data) |
| Demon of Jealousy: What's Yours Is Mine | t3-core | manual theft (in the save's failure) | `inventory` op take, item any | dcm-0gh (data) |
| Vault Guardian Sentinel: Box In | t3-core | "one target at a time" in the manual | `exclusive: true` (the manual keeps only the disadvantage) | dcm-vkp |
| Archmage: Force Salvo | t3-hf | check + manual bolt placing | `markHp` `distribution: "split"`, `maxPer: 3`, amount Nd4, over the picked creatures | dcm-zhc |
| Chimera: Rending Jaws | t3-hf | manual | `armorCost` `slotsPerStep: 2` (the server reads it into the hit) | dcm-s77 (t3 part) |
| Cursed Merfolk: "Get Over Here!" | t3-hf | follow-up `modifier: fixed(3)` | no modifier: the runner adds ATK (+ Gang Up's +2 with no map) | dcm-6n0p |
| Fellmounted Shadow King: Hellsong | t3-hf | manual "can't lose a Hope: 2 Fear" (save branch) | `hope.ifUnable: [fear gain 2]` | dcm-5xi (data) |
| Fellmounted Shadow King: Fellmount | t3-hf | situation "on his mount" + manual | passive `requires` Unmounted `lacks`; the tag carries the fall | dcm-2f3 (data) |
| Lamplight Beguiler: Entice | t3-hf | manual disadvantage | `save.disadvantage` with `modsWhen` (the GM confirms the trusted form) | dcm-rb0 |
| Phoenix: Purifying Aura | t3-hf | Vulnerable + Restrained + manual | `clearCondition.all` | dcm-730 |
| Arch-Necromancer: Not Today, My Dears | t4-core | teleport + manual "leaves the scene" | `move` `leaveScene` (the trace stays manual) | dcm-icd (data) |
| Fallen Sorcerer: Shackles of Guilt | t4-core | manual Hope loss | a GM button use `fail` (situation trigger) losing a Hope | none (story roll) |
| Realm-Breaker: Tormenting Lash | t4-core | manual | `armorCost` `slotsPerStep: 2` | dcm-s77 (t4 part) |
| Realm-Breaker: All-Consuming Rage | t4-core | loop + reset prompt + manual doom | countdown `direction: "decreasing"`, `onZero`, `tickOn: "actionRoll"`; doom `markHp` = free HP + `deathMove` | dcm-m5s, dcm-702 |
| High Seraph: Judgment | t4-core | "one target at a time" in the manual | `exclusive: true` (manual keeps the Hope rider) | dcm-vkp |
| High Seraph: God Rays | t4-core | note only | `save.disadvantage` with `modsWhen` targetHas Guilty | dcm-rb0 |
| Kraken: Boiling Blast | t4-core | manual (save branch) | `armorCost.alsoMark` 1 Stress | dcm-s77 (t4 part) |
| Perfected Zombie: Fearsome Presence | t4-core | manual reminder | modifier flag `noHopeFeaturesAgainst` (cardRunner refuses Hope uses) | dcm-zos |
| Ashen Tyrant: Ashes to Ashes | t4-core | manual | `hope.ifUnable: [markHp 1]` with the text as `note` (unknown Hope: the table is asked) | dcm-5xi (data) |
| Molten Scourge: Cracked Scales | t4-core | check + manual further Fear | `fear` amount `dice` `keep: "countAtLeast"`, `atLeast: 4` | dcm-tal |
| Harbingers: Mount (x4) | t4-hf | situation + two manuals | Unhorsed tag on Severe damage, cleared by the Stress; Difficulty while it `lacks` the tag | dcm-2f3 (data) |
| Cephilith Titan: "It's Here…" / Merely a Projection | t4-hf | manual "loses Merely a Projection" | permanent Full Form tag; Merely a Projection `lacks` it; the extra HP `requires` it | dcm-2f3 (data) |
| Cloud Titan: Lightning Strike | t4-hf | bounce `modifier: fixed(3)` (ATK counted twice: 16) | no modifier (13) | dcm-6n0p (the "ATK +3 on a bounce" note) |
| Adonix: Elemental Archon 3 | t4-hf | `modifier: fixed(8)` | no modifier: the runner adds ATK 8 | dcm-6n0p |
| Mitera: Elemental Breath 1, Fire | t4-hf | manual choice | `choose.by` targets: Armor Slot or 2 HP | dcm-bz8 (data) |
| Gargantuan War Machine: Awesome Size | t4-hf | manual choice | `choose.by` every PC: lose a Hope or 1d4 Stress | dcm-bz8 (data) |
| Harbinger of Death: Decapitate | t4-hf | manual | `markHp` free HP + `deathMove` | dcm-702 (data) |
| Harbinger of Famine: Hunger Pangs | t4-hf | manual reset | countdown `direction: "decreasing"` | dcm-m5s |
| Harbinger of Pestilence: Locust Swarm | t4-hf | manual choice | `choose.by` targets: Armor Slot, or 4d10 direct + d6 (1-2 Contagious) | dcm-bz8 (data) |
| Ruby Dragon: Hot-Blooded | t4-hf | manual 1d4 HP | `markHp` 1d4 gated on no free Armor Slot | dcm-18i (t4 part) |
| Adonix: Alpha to Omega / Forsaken / Armageddon | t4-hf | manual + situation "Omega form" | `revive` self (all HP and Stress) + permanent Omega Form tag the other two `require`; Armageddon `deathMove` for every PC | dcm-145, dcm-702 (data) |
| Temporal Enforcer: Time Looper | t4-hf | five clears + manual tags | `clearCondition.all` | dcm-730 |
| Wyrmlings: Ravenous | t4-hf | note "once per GM turn" | `limit: { per: "scene", period: "gmTurn" }` | dcm-c5h (t4-hf) |

The two `modifier` removals (dcm-6n0p) were checked against the stat blocks (Merfolk ATK +3, Cloud Titan +3, Adonix
+8). A use whose own roll attacks already passes its ATK to every roll (`context.roll.modifier`), so Lightning Strike's
bounce had the ATK twice (16, now 13); "Get Over Here!"'s total moves from 13 to 15 only because the runner now adds
the Merfolk's passive Gang Up (+2, which holds with no map, Q18); the test pins both.

## Manual steps, before and after

Counted by walking every entry (one count per step object, so a step repeated in each of N options counts N times).

| File | Before | After |
|---|---|---|
| t3-core | 26 | 21 |
| t3-hf | 48 | 30 |
| t4-core | 21 | 14 |
| t4-hf | 51 | 33 |
| total | 146 | 98 |

## Manual steps left, and why

Story or table steps (nothing for an engine to do; no bead): Slow / Slow Firing's "describe what they're preparing",
Execute Them!, Casus Belli, Doppel-Dangler's player answer, Riddle Me This, Pleasure and Pain's portal (x2),
Resurrection's 7 days, Hungry, Not Stupid's retreat (x2), Fiendish Nature / Resistance (illusions), Ball Lightning's
spheres (x2), Join or Die, Greater Specter, Not Today's trace, Ominous Knowledge, Verdant Explosion.

The engine doesn't read the vocabulary yet (the manual stays until the engine bead lands):

| Engine bead | Entries |
|---|---|
| dcm-mm0f (condition riders on the bearer's own rolls and actions; the plan drops condition `mods`) | Your Struggle Is Pointless, Battle Lust, Water Jet, Envelop, Box In's disadvantage, Frozen Scales, Serpent Strike, Paranoia Glare, Pouncing Attack (Shaky), Nightmare Shroud, Terrifying Shriek, Clutch, Judgment's Hope rider, Grapple and Drown, Disorienting Presence, Gaze into the Abyss (Confused), Elemental Breath 4 (Sickened), Halo of Contagion, Shadow Grapple, Venomous Bite |
| dcm-ehgy (re-run "marks HP from this attack" steps after the reaction window) | Draining Bite, Rend and Crush, Leaping Jugular Strike, Flame Breath, Beam of Decay, Your Life Is Mine, Shattering Strike, All-Consuming Rage's Shock Troops, Tail Swipe |
| dcm-0n1u (the adversary engine reads `inventory`, creature tokens) | Expensive Failure, Trophy Hunter, Burrowing Leechpoles (also dcm-kvx4) |
| dcm-5cn5 / dcm-6ju (a hit-PC answer the attacker grants) | Money Talks, Double or Nothing, Treasure Hoarder |
| dcm-of7v (pcRolls autos change the PC's duality die) | Backhanded Guidance, Ill Omen |
| dcm-xyw (server builds `attackedRiders` from PCs' tags) | Mark Target, Mist Weaver's advantage |
| dcm-4dc / dcm-346 (`disadvantage` mods on an adversary's own attacks, `unlessTarget`) | Light and Shadow, Blinding Multitude |
| dcm-e75 (`mustAttack` on an instance) | Lock Up |
| dcm-1yo (`forcedMoveReduce`) | Immovable Object |
| dcm-gx3 (standardAttack / features on an instance) | Hellwing |
| dcm-idz (GM control of a PC) | Gaze into the Abyss (Enthralled), Breath Weapon |
| dcm-145 (revive a defeated ally: resolveCreatures refuses defeated instances) | Wake the Fallen |
| dcm-8rh (adversary NumberEnv: creatureCount, PC thresholds) | Blade of the Forest, Relentless (X) = PCs (Cephilith Titan, Xero: `timesFrom` creatureCount would read 0 and give 1 today) |
| dcm-cma / dcm-wuu / dcm-3p7s (lasting areas with entry / inside steps on the adversary path) | Bramble Patch, Shadow Swarm, Circle of Defilement (x2), Ashen Cloud, Eruption, Elemental Breath 5 and 6, Ground-Breaking, Ground-Breaking Stomp, Volcanic Fissure |

No vocabulary yet (beads filed by this tracer, labels `vocabulary-gap`, `lane:w2-srd-data`):

| Bead | Entries |
|---|---|
| dcm-4c9m | Never Misses (halve Evasion on every attack, the standard attack too) |
| dcm-va0f | Unleash Hellfire (damage repeated per overlapping burst) |
| dcm-fbsr | Reality Quake (double a creature's spends and marks) |
| dcm-5kxg | Hunger Pangs' Ravenous ("can't spend Hope"), Nightmare Stare ("can't clear HP or Stress") |
| dcm-k4x5 | Frenzied Feeding (count of creatures who took Severe damage) |
| dcm-4yg4 | Lightning Strike's later bounces, Elemental Archon 3's even-dice chain (repeat while a check holds, per-link damage change) |
| dcm-qw4f | Seven-Headed (remove one option of another feature for good) |
| dcm-3ag5 | Transform (x2: swap the stat block, keep the marks) |
| dcm-wqgs | Comatize (trigger: a PC marks their last Stress) |
| dcm-kvx4 | Burrowing Leechpoles (+1 per leechpole on any damage taken) |

Rule questions (label `rule-question`; the manual steps stay inside the PCs' failure branches):

- dcm-trz9 The Weight of Opulence (HF p.81): "lose a Hope for each bag of gold they're carrying. If the PC loses their
  last Hope or has no Hope to lose, they mark Stress instead." How much Stress, and does reaching 0 Hope also count?
- dcm-6rke Power Slide (HF p.97) and Elemental Archon 1, Fire Beam (HF p.96): "take Severe damage" / "Minor damage" with
  no damage type: damage equal to the threshold or HP marked outright, and which type?

## Beads

| Bead | State | Notes |
|---|---|---|
| dcm-730 clear every condition | done | Purifying Aura, Time Looper. |
| dcm-rb0 save advantage / disadvantage | done | Entice (GM-confirmed situation), God Rays (Guilty). |
| dcm-zhc spread forced HP marks | done | Force Salvo. |
| dcm-6n0p follow-up ATK workaround | done (t3/t4) | "Get Over Here!", Lightning Strike's bounce (was counted twice), Elemental Archon 3. SRD-A1 owns Discordant Visions (t1-hf). |
| dcm-gx1 Relentless (X) from heads | done | Hydra. |
| dcm-m5s increasing / decreasing countdown | done | All-Consuming Rage, Hunger Pangs. |
| dcm-tal count dice at or above | done | Cracked Scales. |
| dcm-vkp one target at a time | done | Judgment, Box In. Forsaken's "only one Forsaken Countdown at a time" is a countdown, not a tag: its note stays. |
| dcm-zos Fearsome Presence | done | The flag; cardRunner reads it (E4). |
| dcm-c5h once per GM turn | done (t4-hf) | Ravenous. |
| dcm-18i, dcm-s77, dcm-2f3, dcm-702, dcm-145, dcm-5xi, dcm-bz8, dcm-0gh, dcm-icd | partly (t3/t4 data) | Not in this tracer's close list; the t3/t4 entries listed above use them now. |

## Tests

Each automated entry's test in its group file now proves the new steps (the old "is manual" assertions became the
automation's numbers): e.g. Force Salvo's split (3 on Mira, 4 asked on Bram capped at 3, the split prompt with the total
and cap), Crushing Blows with a full armor track (an HP instead), Cracked Scales' 2 Fear from 2, 5, 4, Decapitate's
death move, the Harbingers' Unhorsed tag, Ravenous refused in the same GM turn, the bounce's roll total 13. The two
"every use runs" sweeps (t3-core, t4-hf) give a use the tags its `hasCondition` requirements name (not `lacks`).
coverage.test.ts is unchanged and passes.

## Follow-ups

None beyond the beads above. When dcm-mm0f lands, the condition riders listed under it can move into `condition.mods`
and their manual reminders go (the vocabulary already has `bearerRider`, `disadvantage`, `dualityDie` and the flags).
