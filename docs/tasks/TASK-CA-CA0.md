# TASK CA0: Combat-actions foundation

Plan `.omc/plans/combat-actions.yaml`, tracer CA0 (wave 1, foundation). Analysis:
`.omc/autopilot/combat-actions-analysis.md` (git-ignored). Book pages are printed pages; CB = Core Book, HF = Hope & Fear.

## What landed

| Area | File | What |
|------|------|------|
| actionLog | `convex/lib/validators/actionLog.ts` | Optional `adversaryBefore: {instanceId, hp, stress, defeated, minionCount?, conditions?, tags?}[]` so undo can restore instances (U4). New kinds `combat` (a PC's attack or card from the map) and `adversary` (an adversary attack or feature). |
| Sheet | `convex/lib/validators/characters.ts`, `src/lib/validation/characters.ts` | Optional `cardTokens: {cardId, count}[]` (max 20 cards, count 0..99; CB p.101 tokens on cards). `featureUses` key cap 40 -> 80 and list cap 20 -> 40, so `card:<cardId>:<useId>` keys fit next to the class features. |
| Encounters | `convex/lib/validators/encounters.ts` | `resistanceValidator {physical, magic: none \| resistant \| immune, conditional?: text}` on `encounterAdversaries.resistance` and `customAdversaries.resistance`; `encounterAdversaries.resistanceActive` (the GM toggle for a conditional resistance, Q8); `encounterAdversaries.effects` (instance modifiers from cards and features: Difficulty, attack, damage, HP marked, half damage, disadvantage; until `temporary \| hit \| scene \| permanent`). |
| Errors | `src/lib/errors/combatActions.ts` | `COMBAT_TARGET_INVALID`, `COMBAT_NO_LINE_OF_SIGHT`, `CARD_NOT_IN_LOADOUT`, `CARD_EXHAUSTED`, `CARD_NOT_COMBAT`, `CARD_COST_UNPAID`, `COMBAT_NOT_YOUR_CHARACTER`; wired into `AppErrorCode` and the client message map. No message names an enemy number (U1). |
| Vocabulary | `src/lib/domain/card-effects/types.ts` | The closed card-effect vocabulary (below). Types only, plus `STEP_KINDS`. |
| Classification | `src/lib/srd/card-effects/classification.ts` | All 210 cards: 177 combat, 19 passive, 14 out of combat (list below). |
| Registry | `src/lib/srd/card-effects/{arcana,…,dread}.ts`, `index.ts` | Ten empty `readonly CardEffect[]` tables; `index.ts` merges them into `CARD_EFFECTS` (a map by card id; a duplicate id throws) and re-exports the classification. |
| Map UI | `combat-map/page.tsx`, `src/components/combat-map/slots.ts`, `actions/**` | Stub slots, mounted: `ActionsProvider` (picked targets), `ActionsPanel` and `IncomingHit` (player column), `AdversaryPanel` and `Resolutions` (GM column, Play), `TargetsLayer` and `HitFlashLayer` (map layers after the fog, Play). Every stub renders nothing; slots.ts documents names, props, owners and order. |
| Tests | `tests/unit/card-classification.test.ts`, `tests/convex/schema-guard.test.ts` | Classification against `DOMAIN_CARDS` and the analysis counts; registry; vocabulary examples; the widened sheet schemas; old rows still validate and read back unchanged; new fields validate; a bad resistance level is refused. |

No new public Convex function, so nothing for the D12 authz matrix. No schema file (`convex/schema.ts`, `convex/tables/*`) changed: the tables already compose these validators.

All widenings are optional fields or wider caps (rule 7, widen only). Stored rows need no migration.

## The card-effect vocabulary

`src/lib/domain/card-effects/types.ts`. The ten CE-* tracers write entries with it; AA0 reuses `OutcomeStep` for
adversary features. **Nobody changes it after CA0.** A step it cannot express becomes `{ kind: "manual", text }` with the
card's words, plus a bead.

### Shape of an entry

```ts
interface CardEffect { cardId: string; uses: readonly CardUse[] }
interface CardUse {
  id: string;                 // "main", or a grimoire spell / card part slug ("fireball")
  name: string;
  activation: Activation;     // action | reaction{trigger} | rider{trigger} | auto{trigger} | passive
  requires?: Requirement[];   // "-Touched" domain counts, armor worn, situations the player confirms
  limit?: Limit;              // once per rest / long rest / session / scene, consumedOn use | success | failure, perTarget
  choices?: NumberChoice[];   // "spend any number of Hope", asked before the roll
  costs?: Cost[];             // paid before the roll (CARD_COST_UNPAID when short)
  roll?: RollSpec;            // spellcast | trait | attack | reaction | adversaryAttack, vs target | fixed | evasion | gm
  targets?: TargetSpec | TriggerTargets;
  mods?: Mod[];               // passive uses only
  steps: Step[];              // in order
  exclusive?: boolean;        // "only one creature at a time"
}
```

The runner (CA1) resolves a use as: requirements, limit, choices, upfront costs, one roll for all targets (R1, R9), then
the steps in order. Every step can carry `when: Gate[]` (all must hold) and a `note`.

### Parts

- **Numbers** (`NumberSource`): `fixed`, `trait`, `spellcast`, `proficiency`, `level`, `spent` (what this use paid), `chosen`
  (a player's number), `cardTokens`, `gmFear`, `marked` / `markedThisMove` (self or target, a track), `targetCount`
  (picked / hit / failedSave), `rollTotal`, `triggerAmount`, `domainCards`, `dice` (sum or highest), `lastRoll`, `byTier`,
  `sum`, `product`, `max`, and `calc` (times, divide with rounding, plus, min, max).
- **Dice** (`DiceExpr`): `{count, sides, plus?}`. "d8+2 using your Proficiency" = `{count: proficiency, sides: 8, plus: 2}`.
- **Targets** (`TargetSpec`): side (self, ally, selfOrAlly, enemy, any, point, object), range (Defined Ranges, `weapon`,
  `unlimited`), count (one, upTo, all, any up to a max), area (aroundSelf, aroundPoint, aroundTarget with `areaRange`,
  front, line, path, between), sight, willing, excludeSelf, excludeFlying, maxDifficulty. `TriggerTargets` acts on the
  trigger's source or subject (Encore, Rapid Riposte).
- **Rolls** (`RollSpec`): `spellcast`, `trait` (one or a pick of traits), `attack` (weapon), `reaction` (no Hope/Fear, CB
  p.99), `adversaryAttack` (AA0); against `target` Difficulty, a `fixed` number, `evasion`, or `gm` (no number on the card;
  the GM sets it, CB p.157). Plus advantage, disadvantage, modifier.
- **Costs**: hope, stress, hp, armor, tokens, fear (AA0), gold (AA0), and `either` ("spend a Hope or mark a Stress").
- **Limits**: `{per: rest | longRest | session | scene, times?, consumedOn?: use | success | failure, perTarget?}`. The
  use is stored as `featureUses` key `card:<cardId>` (or `card:<cardId>:<useId>`) with `until` = per (Q3, Q4).
- **Requirements**: loadoutDomainCount, armor worn / not, hpUnmarkedAtMost, stressFull, trackMarked, hopeAtMost,
  noEnemyWithin, effectActive (a card's own effect is on), `situation` (text the player confirms: low light, natural
  environment, behind the creature).
- **Triggers** (reactions, riders, autos): `whenAllyWouldTakeDamage` (range, includeSelf), `whenAllyTakesDamage`,
  `whenYouWouldTakeDamage` (damage type, severity, melee or beyond), `whenYouTakeDamage`, `whenAttacked` (stage targeted,
  rolled, succeeded, failed; from; damage type), `afterAllyRolls` (range, result, includeSelf), `afterYouRoll`,
  `beforeYouRoll`, `whenYouAttack` (any, success, failure, critical, successWithHope; weapon; weapon range),
  `whenYouDealDamage`, `whenAllyDealsDamage`, `whenTargetMarksHp`, `whenYouMarkHp` (from an attack, without armor, last),
  `whenArmorSlotMarked`, `wouldMakeDeathMove`, `whenEnemyTakesDamage`, `whenEnemyDefeated`, `wouldGainCondition`,
  `gmWouldGainFear`, `gmSpendsFear`, `featureExhausted`, `magicalEffect`, `linkedWouldMark`, `timing` (session start or
  end, after a rest or long rest, scene end). Roles: **source** = who caused it (the attacker, the ally who dealt damage);
  **subject** = whom it happened to (the ally who would take damage, the creature that was damaged).
- **Activation**: `action` (Use button), `reaction` (Use / Pass in the reaction window, Q13), `rider` (a toggle inside the
  actor's own roll), `auto` (no prompt), `passive` (mods only).
- **Gates**: success, failure, critical (counts as success with Hope, CB p.90), withHope, withFear, hit, miss,
  targetMarkedHp, targetDefeated, targetStressFull, targetHas(condition), chosen(option), requires(requirement).
- **Recipients**: self, targets, picked (the step's own `pick`), triggerSource, triggerSubject, allies, selfAndAllies.
- **Durations**: temporary (GM clears, CB p.102), rest, longRest, session, scene, hit, nextRoll, manual (with
  `endsWhen`), permanent.
- **Conditions**: the six standard ones (vulnerable, restrained, hidden, distracted, cloaked, unconscious) or a `tag`
  (Enraptured, Stunned, On Fire, Horrified …) with the standard conditions it `implies`. Tags land in the instance's GM tags.
- **Mods** (effects and passives): stat (evasion, attack, damage, armorScore, majorThreshold, severeThreshold, proficiency,
  spellcast, difficulty, actionRoll, hpMarked), trait (one or all), set (a stat or trait to a value), advantage,
  disadvantageAgainst, resistance (physical / magic / both, resistant / immune), flags (noArmorSlots, cannotBeRestrained,
  cannotBeTargeted, cannotAttack, cannotReact, cannotAct, silenced, flying, halfDamage, noMinorDamage).

### Steps (`STEP_KINDS`, 30)

Flow: `pay` (after the roll; same-roll Hope may pay, R8), `optional` (an add-on with its own costs and limit), `choose`
(options; count and distinct), `save` (the recipients' reaction roll; onFail / onSuccess per recipient), `check` (a dice
test: any at least, all at most, total), `followUp` (a second roll or second target set; no roll = reuse the move's).

Outcomes (`OutcomeStep`, shared with adversaries): `damage` (dice | weapon with Proficiency changes | standardAttack | flat
| sameAsTrigger | sameAsMove; type physical, magic, weapon or both; direct; scale half/double; distribution each, split or
dropDiePerTarget; extraDiePerTarget; repeat), `modifyDamage` (add, multiply, halve, proficiency, reroll, maxDice, type,
minimumSeverity, replaceWithHp), `markHp`, `markStress` (overflow to HP, R5), `markArmor` (noBenefit, AR4), `clear` (hp,
stress, armor; split), `hope` (gain / lose), `fear` (GM gains / loses), `condition`, `clearCondition`, `move` (a prompt:
knockBack, pull, teleport, move, flee), `effect` (mods + duration), `tokens` (set, add, spend, clear; dice on cards),
`toVault` (permanent), `modifyRoll` (reroll, swapDuality, setResult, add, evasion, withHope, fail, hopeDie, doubleTrait,
advantage, rescind), `redirectDamage` (to self, the trigger source, or a picked creature), `extraArmorSlots` (a number or
"any"), `reduceSeverity`, `reduceDamage`, `negate` (damage, attack, condition, effect, deathMove), `convertMarks` (one track
into another or into Hope), `defeat`, `refreshFeature`, `manual`.

### Examples

These compile against the types (the first four are in `tests/unit/card-classification.test.ts`); the CE tracers write
the real entries.

**I Am Your Shield** (Valor 1, CB p.341: "When an ally within Very Close range would take damage, you can mark a Stress to
stand in the way and make yourself the target of the attack instead. When you take damage from this attack, you can mark
any number of Armor Slots."). In the adversary-hit window (Q13) the server lists every ally whose loadout has a
`reaction` with a matching `whenAllyWouldTakeDamage` (range checked against the hit PC); Use folds these two outcomes in:

```ts
{ cardId: "i-am-your-shield", uses: [{
  id: "main", name: "I Am Your Shield",
  activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "veryClose" } },
  costs: [{ kind: "stress", amount: { kind: "fixed", value: 1 } }],
  steps: [
    { kind: "redirectDamage", to: "triggerSubject", target: "self" },   // the hit moves from the ally to you
    { kind: "extraArmorSlots", to: "self", max: "any" },                 // lifts the one-slot cap (CB p.114)
  ],
}] }
```

**Bolt Beacon** (Splendor 1, CB p.340): `roll: spellcast vs target`, `targets: enemy, far, one`; steps
`pay hope 1 when [success]`, `damage dice {proficiency, d8, +2} magic when [hit]`, `condition vulnerable temporary when [hit]`.

**Book of Norai** (Codex 3, CB p.333): two uses. Mystic Tether: `condition restrained temporary` + `markStress 1`, both
`when [hit]`. Fireball: `targets: any, veryFar, one, area aroundTarget, areaRange veryClose`; `save` (fixed 13) `when
[success]` with `onFail: damage d20+5 x Proficiency magic` and `onSuccess: the same damage, scale half` (rolled once, R9).

**Splintering Strike** (Bone 9, CB p.332): `limit {per: longRest, consumedOn: success}`, `costs hope 1`, `roll attack
either weapon`, `targets enemy, weapon range, all`; `damage weapon, type weapon, distribution split, extraDiePerTarget`.

**Rain of Blades** (Midnight 1): `costs hope 1`; `targets enemy, veryClose, all`; `damage {proficiency, d8, +2} magic when
[hit]`; `modifyDamage add 1d8 when [hit, targetHas vulnerable]`.

**Blighting Strike** (Dread 1, HF p.180): `damage {proficiency, d6, +1} when [hit, withHope]`, `damage {proficiency, d10,
+1} when [hit, withFear]`, `effect "Blighted" mods [flag halfDamage] duration hit when [hit]`, `pay either [hope 1] |
[stress 1] when [failure]`.

**Champion's Edge** (Blade 5): `activation rider whenYouAttack critical`; `choices hope 0..3`; `costs hope chosen`;
`choose count spent hope, distinct` with options `clear hp 1 (self)`, `clear armor 1 (self)`, `markHp 1 (targets)`.

**Arcane Reflection** (Arcana 8): `reaction whenYouWouldTakeDamage magic`; `choices hope`; `costs hope chosen`;
`check {spent hope}d6 anyAtLeast 6 then [redirectDamage to triggerSource]`.

**Night Terror** (Midnight 9): `limit longRest`; `targets enemy, veryClose, any`; `save 16 onFail [condition tag Horrified
implies vulnerable]`; `fear lose calc(targetCount failedSave, max gmFear)`; `damage flat dice{same count}d6 when [targetHas
Horrified]`.

**An adversary outcome** (AA0 reuse): Ka-Chomp's "must mark an Armor Slot without gaining its benefit" =
`{ kind: "markArmor", to: "targets", when: ["hit"], amount: 1, noBenefit: true }`; Momentum = `fear gain 1`; Vassal's
Loyalty = `redirectDamage target self`.

### Left to manual by design

Narrative or GM-ruled parts stay `manual`: questions to the GM (Know Thy Enemy, Memory Delve, Dark Whispers), summons and
constructs, walls and zones the map does not model (Wall of Flame's crossing damage, Hold the Line's pull on entry), Chain
Lightning's chain beyond the first hop, Copycat, Shared Clarity and Transcendent Union's "choose who marks", Codex-Touched's
free swap, Resurrection's week.

## Card classification (for review)

Rules: **combat** = a Use button (action), a Use / Pass prompt (reaction) or a toggle inside the actor's own roll (rider);
**passive** = always on, or happens by itself with no choice (no Use button); **out of combat** = social, exploration,
downtime or level-up only (no effect entry; the map refuses it with `CARD_NOT_COMBAT`). `mixed` = a passive part plus a
used part. Totals: **196 usable in combat (177 combat + 19 passive), 14 out of combat**, matching the analysis per domain.

Borderline calls to review:
- Counted **combat** though mostly utility: Floating Eye, Sensory Projection, Rift Walker, Final Words, Teleport, Book of
  Homet, Astral Projection, Through Your Eyes, Shape Material, Plant Dominion, Lean on Me, Mending Touch, Conjured Steeds
  (the analysis counted them as combat-usable).
- Counted **passive**: Vitality (permanent picks, the sheet applies them) and Pick and Pull (always-on advantage), Swift
  Step, Inevitable, Rise Up, Unyielding Armor, Savor the Anguish and Invoke Torment (they fire by themselves; no choice).
- Riders with a choice are **combat** (Not Good Enough, Gore and Glory, Rage Up, Reckless); riders with no choice are
  **passive** (Body Basher; Cruel Precision, which always takes the better of Finesse and Agility).

### Arcana (21 cards: 21 combat, 0 passive, 0 out of combat)

| Lv | Card | Use | How | Why |
|---:|------|-----|-----|-----|
| 1 | Rune Ward | combat | reaction | the ward's holder spends a Hope to reduce damage by 1d8 |
| 1 | Unleash Chaos | combat | action | session tokens, d10 magic per token spent |
| 1 | Wall Walk | combat | action | spend a Hope: a creature climbs walls until the end of the scene |
| 2 | Cinder Grasp | combat | action | Melee spell, 1d20+3 magic, On Fire |
| 2 | Floating Eye | combat | action | spend a Hope for a scouting orb within Very Far |
| 3 | Counterspell | combat | reaction | interrupt a magical effect with a Spellcast reaction roll |
| 3 | Flight | combat | action | Spellcast (15), tokens = Agility, spent per action roll while flying |
| 4 | Blink Out | combat | action | Spellcast (12), teleport within Far, Hope per passenger |
| 4 | Preservation Blast | combat | action | all within Melee, d8+3 magic using Spellcast, knocked back to Far |
| 5 | Chain Lightning | combat | action | 2 Stress, all within Close, reaction roll vs your total, 2d8+4 |
| 5 | Premonition | combat | reaction | once per long rest, rescind a roll's move and consequences |
| 6 | Rift Walker | combat | action | Spellcast (15), place or open a rift for escape |
| 6 | Telekinesis | combat | action | move a target within Far, throw it at a second target for d12+4 |
| 7 | Arcana-Touched | combat | mixed | +1 Spellcast (passive) and a once-per-rest Hope/Fear swap |
| 7 | Cloaking Blast | combat | rider | after another successful spell: spend a Hope to become Cloaked |
| 8 | Arcane Reflection | combat | reaction | when you would take magic damage: d6s per Hope, reflect on a 6 |
| 8 | Confusing Aura | combat | action | once per long rest layers; attacks against you may fail |
| 9 | Earthquake | combat | action | Spellcast (16), all within Very Far save (18), 3d10+8, Vulnerable |
| 9 | Sensory Projection | combat | action | once per rest Spellcast (15) vision of a known place |
| 10 | Adjust Reality | combat | reaction | after you or an ally roll: spend 5 Hope to set the result |
| 10 | Falling Sky | combat | action | all adversaries within Far, 1d20+2 per Stress marked |

### Blade (21 cards: 17 combat, 3 passive, 1 out of combat)

| Lv | Card | Use | How | Why |
|---:|------|-----|-----|-----|
| 1 | Get Back Up | combat | reaction | when you take Severe damage, mark a Stress to reduce one threshold |
| 1 | Not Good Enough | combat | rider | reroll 1s and 2s on your damage dice |
| 1 | Whirlwind | combat | rider | on a Very Close hit, a Hope: same attack on all others, half damage |
| 2 | A Soldier's Bond | **out of combat** | none | compliment or ask someone: both gain 3 Hope (social) |
| 2 | Reckless | combat | rider | mark a Stress for advantage on an attack |
| 3 | Scramble | combat | reaction | once per rest, avoid a Melee attack and move out of Melee |
| 3 | Versatile Fighter | combat | rider | another trait for a weapon; a Stress to max one damage die |
| 4 | Deadly Focus | combat | action | once per rest, +1 Proficiency against one target |
| 4 | Fortified Armor | passive | passive | while wearing armor, +2 damage thresholds |
| 5 | Champion's Edge | combat | rider | on a critical attack, up to 3 Hope for distinct options |
| 5 | Vitality | passive | passive | permanent HP / Stress slot / threshold picks, then vaulted |
| 6 | Battle-Hardened | combat | reaction | once per long rest, instead of a Death Move spend a Hope to clear a HP |
| 6 | Rage Up | combat | rider | before an attack, mark a Stress (up to twice) for +2x Strength damage |
| 7 | Blade-Touched | passive | passive | 4+ Blade cards: +2 attack rolls, +4 Severe threshold |
| 7 | Glancing Blow | combat | reaction | when you fail an attack, mark a Stress for half-Proficiency damage |
| 8 | Battle Cry | combat | action | once per long rest, allies clear a Stress, gain a Hope, advantage on attacks |
| 8 | Frenzy | combat | action | once per long rest Frenzy: +10 damage, +8 Severe, no Armor Slots |
| 9 | Gore and Glory | combat | rider | on a critical weapon attack or a defeat, gain a Hope or clear a Stress |
| 9 | Reaper's Strike | combat | action | once per long rest, a Hope: one target hit marks 5 HP |
| 10 | Battle Monster | combat | rider | on a successful attack, mark 4 Stress: target marks HP = your marked HP |
| 10 | Onslaught | combat | mixed | damage never below Major (passive) and a Stress reaction when an ally is hit |

### Bone (21 cards: 16 combat, 4 passive, 1 out of combat)

| Lv | Card | Use | How | Why |
|---:|------|-----|-----|-----|
| 1 | Deft Maneuvers | combat | action | once per rest, sprint within Far, +1 to the next attack |
| 1 | I See It Coming | combat | reaction | targeted from beyond Melee: a Stress for +d4 Evasion |
| 1 | Untouchable | passive | passive | +half Agility to Evasion |
| 2 | Ferocity | combat | reaction | when you make an adversary mark HP, 2 Hope for Evasion |
| 2 | Strategic Approach | combat | rider | long-rest tokens: advantage, clear an ally's Stress or +d8 damage |
| 3 | Brace | combat | reaction | when you mark an Armor Slot, a Stress marks one more |
| 3 | Tactician | combat | rider | Help an Ally adds an Experience; Tag Team with a d20 Hope Die |
| 4 | Boost | combat | action | mark a Stress, aerial attack within Far with advantage, +d10 damage |
| 4 | Redirect | combat | reaction | an attack from beyond Melee fails: d6s, on a 6 redirect it |
| 5 | Know Thy Enemy | combat | action | Instinct Roll vs a creature, a Hope for information, a Stress to remove a Fear |
| 5 | Signature Move | combat | rider | once per rest, roll a d20 as your Hope Die |
| 6 | Rapid Riposte | combat | reaction | a Melee attack against you fails: a Stress for weapon damage back |
| 6 | Recovery | **out of combat** | none | short rest: take a long rest downtime move (downtime) |
| 7 | Bone-Touched | combat | mixed | +1 Agility (passive); once per rest 3 Hope to make an attack fail |
| 7 | Cruel Precision | passive | passive | successful weapon attacks add Finesse or Agility to damage |
| 8 | Breaking Blow | combat | rider | on a successful attack, a Stress: next hit on that target +2d12 |
| 8 | Wrangle | combat | action | Agility Roll vs all within Close, a Hope to move them |
| 9 | On the Brink | passive | passive | with 2 or fewer HP unmarked, no Minor damage |
| 9 | Splintering Strike | combat | action | a Hope, attack all in weapon range, split the damage |
| 10 | Deathrun | combat | action | 3 Hope, attack all along a path, one damage die fewer per target |
| 10 | Swift Step | passive | auto | an attack against you fails: clear a Stress or gain a Hope |

### Codex (21 cards: 20 combat, 0 passive, 1 out of combat)

| Lv | Card | Use | How | Why |
|---:|------|-----|-----|-----|
| 1 | Book of Ava | combat | action | Power Push, Tava's Armor, Ice Spike |
| 1 | Book of Illiat | combat | action | Slumber, Arcane Barrage, Telepathy |
| 1 | Book of Tyfar | combat | action | Wild Flame, Magic Hand, Mysterious Mist |
| 2 | Book of Sitil | combat | action | Adjust Appearance, Parallela, Illusion |
| 2 | Book of Vagras | combat | action | Runic Lock, Arcane Door, Reveal (Runic Lock is out of combat) |
| 3 | Book of Korvax | combat | action | Levitation, Recant, Rune Circle |
| 3 | Book of Norai | combat | action | Mystic Tether, Fireball |
| 4 | Book of Exota | combat | mixed | Repudiate (reaction) and Create Construct |
| 4 | Book of Grynn | combat | mixed | Arcane Deflection (reaction), Time Lock, Wall of Flame |
| 5 | Manifest Wall | combat | action | Spellcast (15), a Hope, a wall within Far |
| 5 | Teleport | combat | action | once per long rest, Spellcast (16) teleport to a known place (escape) |
| 6 | Banish | combat | action | Spellcast vs Close, d20s set the reaction roll, banished on a failure |
| 6 | Sigil of Retribution | combat | action | mark an adversary; d8s gathered when it deals damage, added to your hit |
| 7 | Book of Homet | combat | action | Pass Through and Plane Gate (escape) |
| 7 | Codex-Touched | combat | rider | a Stress to add Proficiency to a Spellcast Roll; once-per-rest free swap |
| 8 | Book of Vyola | combat | action | Memory Delve, Shared Clarity |
| 8 | Safe Haven | **out of combat** | none | summon an interdimensional home to rest in (downtime) |
| 9 | Book of Ronin | combat | action | Transform, Eternal Enervation |
| 9 | Disintegration Wave | combat | action | once per long rest, Stress per adversary with Difficulty 18 or lower |
| 10 | Book of Yarrow | combat | action | Timejammer, Magic Immunity |
| 10 | Transcendent Union | combat | action | once per long rest, 5 Hope: linked creatures share Stress and HP |

### Grace (21 cards: 16 combat, 0 passive, 5 out of combat)

| Lv | Card | Use | How | Why |
|---:|------|-----|-----|-----|
| 1 | Deft Deceiver | **out of combat** | none | a Hope for advantage to deceive (social) |
| 1 | Enrapture | combat | action | Spellcast vs Close, Enraptured, once per rest a Stress for a Stress |
| 1 | Inspirational Words | combat | action | long-rest tokens: an ally clears a Stress or HP or gains a Hope |
| 2 | Tell No Lies | combat | action | Spellcast vs Very Close; a refusal makes them mark a Stress |
| 2 | Troublemaker | combat | action | Presence Roll vs Far, once per rest d4s, Stress = the highest |
| 3 | Hypnotic Shimmer | combat | action | all in front within Close, once per rest Stunned and a Stress |
| 3 | Invisibility | combat | action | Spellcast (10), a Stress, Invisible with tokens |
| 4 | Soothing Speech | **out of combat** | none | short rest Tend to Wounds bonus (downtime) |
| 4 | Through Your Eyes | combat | action | see through a target's eyes within Very Far |
| 5 | Thought Delver | combat | action | a Hope to read a target's thoughts within Far |
| 5 | Words of Discord | combat | action | Spellcast (13) in Melee: a Stress and it attacks another adversary |
| 6 | Never Upstaged | combat | reaction | when you mark HP from an attack, a Stress for damage tokens |
| 6 | Share the Burden | combat | action | once per rest, take a willing creature's Stress and gain Hope |
| 7 | Endless Charisma | **out of combat** | none | after a roll to persuade or lie, a Hope to reroll a die (social) |
| 7 | Grace-Touched | combat | mixed | Armor Slot instead of Stress; HP marks turned into Stress |
| 8 | Astral Projection | combat | action | once per long rest, a Stress for a projected copy |
| 8 | Mass Enrapture | combat | action | all within Far Enraptured; a Stress makes them all mark a Stress |
| 9 | Copycat | combat | action | once per long rest, mimic another player's card |
| 9 | Master of the Craft | **out of combat** | none | permanent Experience bonus, then vaulted (level-up) |
| 10 | Encore | combat | reaction | an ally within Close deals damage: Spellcast to deal the same |
| 10 | Notorious | **out of combat** | none | leverage notoriety: a Stress for +10 (social) |

### Midnight (21 cards: 17 combat, 2 passive, 2 out of combat)

| Lv | Card | Use | How | Why |
|---:|------|-----|-----|-----|
| 1 | Pick and Pull | passive | passive | advantage to pick locks, disarm traps or steal |
| 1 | Rain of Blades | combat | action | a Hope, all within Very Close, d8+2 using Proficiency, +1d8 if Vulnerable |
| 1 | Uncanny Disguise | **out of combat** | none | a few minutes to prepare: a humanoid disguise (social) |
| 2 | Midnight Spirit | combat | action | a Hope, a spirit; send it: Spellcast vs Very Far, d6s per Spellcast |
| 2 | Shadowbind | combat | action | all adversaries within Very Close Restrained |
| 3 | Chokehold | combat | action | behind a creature, a Stress: Vulnerable, attacks on it +2d6 |
| 3 | Veil of Night | combat | action | Spellcast (13), a curtain of darkness within Far |
| 4 | Glyph of Nightfall | combat | action | Spellcast vs Very Close, a Hope: Difficulty minus Knowledge |
| 4 | Stealth Expertise | combat | reaction | a Stress to turn a sneaking roll with Fear into Hope |
| 5 | Hush | combat | action | Spellcast vs Close, a Hope: Silenced area |
| 5 | Phantom Retreat | combat | action | a Hope to mark a spot, another to return to it |
| 6 | Dark Whispers | combat | action | speak into a touched mind; a Stress and Spellcast for answers |
| 6 | Mass Disguise | **out of combat** | none | a few minutes of silence: disguise willing creatures (social) |
| 7 | Midnight-Touched | combat | mixed | Hope instead of a GM Fear at 0 Hope; a Stress to add the Fear Die |
| 7 | Vanishing Dodge | combat | reaction | a physical attack against you fails: a Hope to become Hidden and teleport |
| 8 | Shadowhunter | passive | passive | in low light: +1 Evasion and advantage on attacks |
| 8 | Spellcharge | combat | mixed | tokens from magic damage taken (auto); spend for d6s on a hit |
| 9 | Night Terror | combat | action | once per long rest, save (16) or Horrified; stolen Fear as d6 damage |
| 9 | Twilight Toll | combat | action | choose a target; tokens from non-damage successes add d12s |
| 10 | Eclipse | combat | action | Spellcast (16), once per long rest darkness: disadvantage against you, Stress on Hope |
| 10 | Specter of the Dark | combat | action | a Stress: Spectral, immune to physical damage |

### Sage (21 cards: 18 combat, 0 passive, 3 out of combat)

| Lv | Card | Use | How | Why |
|---:|------|-----|-----|-----|
| 1 | Gifted Tracker | **out of combat** | none | Hope for tracking questions (exploration) |
| 1 | Nature's Tongue | **out of combat** | none | speak with plants and animals; Hope for +2 Spellcast in nature (exploration) |
| 1 | Vicious Entangle | combat | action | Spellcast vs Far, 1d8+1 physical, Restrained, a Hope for a second |
| 2 | Conjure Swarm | combat | action | Armored Beetles (reduce severity) or Fire Flies (2d8+3) |
| 2 | Natural Familiar | combat | action | a Hope for a familiar; +d6 damage near it |
| 3 | Corrosive Projectile | combat | action | Spellcast vs Far, d6+4 using Proficiency, Stress for Corroded |
| 3 | Towering Stalk | combat | action | once per rest stalk; a Stress to attack a group within Close for d8 |
| 4 | Death Grip | combat | action | Spellcast vs Close, pick pull / 2 Stress / vines, Restrained |
| 4 | Healing Field | combat | action | once per long rest, you and allies within Close clear 1 (or 2) HP |
| 5 | Thorn Skin | combat | reaction | once per rest tokens; reduce damage by d6s and deal it back |
| 5 | Wild Fortress | combat | action | Spellcast (13), 2 Hope, a dome with thresholds 15/30 |
| 6 | Conjured Steeds | combat | action | Hope per steed: -2 attack, +2 damage while riding |
| 6 | Forager | **out of combat** | none | extra downtime move: roll a d6 for a consumable (downtime) |
| 7 | Sage-Touched | combat | rider | +2 Spellcast in nature; once per rest double Agility or Instinct |
| 7 | Wild Surge | combat | action | once per long rest, a Stress: the Wild Surge Die adds to action rolls |
| 8 | Forest Sprites | combat | action | Spellcast (13), Hope per sprite: +3 attack, extra Armor Slot |
| 8 | Rejuvenation Barrier | combat | action | Spellcast (15), once per rest clear 1d4 HP, physical resistance |
| 9 | Fane of the Wilds | combat | rider | long-rest tokens spent for +1 each after a Spellcast Roll |
| 9 | Plant Dominion | combat | action | Spellcast (18), once per long rest reshape plants within Far |
| 10 | Force of Nature | combat | action | a Stress to transform: +10 damage, can't be Restrained, Hope upkeep |
| 10 | Tempest | combat | action | choose Blizzard, Hurricane or Sandstorm, all within Far |

### Splendor (21 cards: 19 combat, 1 passive, 1 out of combat)

| Lv | Card | Use | How | Why |
|---:|------|-----|-----|-----|
| 1 | Bolt Beacon | combat | action | Spellcast vs Far, a Hope, d8+2 magic using Proficiency, Vulnerable |
| 1 | Mending Touch | combat | action | a few minutes: 2 Hope to clear a HP or a Stress |
| 1 | Reassurance | combat | reaction | once per rest, an ally rerolls an action roll |
| 2 | Final Words | combat | action | Spellcast (13), question a corpse |
| 2 | Healing Hands | combat | action | Spellcast (13) in Melee, a Stress to clear 2 HP or 2 Stress |
| 3 | Second Wind | combat | rider | once per rest on a hit, clear 3 Stress or a HP (and an ally's on Hope) |
| 3 | Voice of Reason | passive | passive | social advantage; +1 Proficiency on damage with full Stress |
| 4 | Divination | **out of combat** | none | once per long rest, 3 Hope for a yes-or-no question (exploration) |
| 4 | Life Ward | combat | action | 3 Hope: an ally clears a HP instead of a death move |
| 5 | Shape Material | combat | action | a Hope to shape natural material |
| 5 | Smite | combat | action | once per rest, 3 Hope: the next weapon hit deals double magic damage |
| 6 | Restoration | combat | action | long-rest tokens: clear 2 HP or 2 Stress per token, clear Vulnerable |
| 6 | Zone of Protection | combat | action | Spellcast (16), once per long rest zone: allies reduce damage by the die |
| 7 | Healing Strike | combat | reaction | when you deal damage, 2 Hope to clear an ally's HP |
| 7 | Splendor-Touched | combat | mixed | +3 Severe threshold; once per long rest HP as Stress or Hope |
| 8 | Shield Aura | combat | action | a Stress: an Armor Slot reduces one more threshold |
| 8 | Stunning Sunlight | combat | action | all in front within Far, Hope picks who saves (14), 3d20+3 / 4d20+5 |
| 9 | Overwhelming Aura | combat | action | Spellcast (15), 2 Hope: Presence = Spellcast, attackers mark a Stress |
| 9 | Salvation Beam | combat | action | Spellcast (16), Stress as HP cleared along a line of allies |
| 10 | Invigoration | combat | reaction | an exhausted feature nearby: Hope as d6s, a 6 refreshes it |
| 10 | Resurrection | combat | action | Spellcast (20), restore a dead creature |

### Valor (21 cards: 14 combat, 7 passive, 0 out of combat)

| Lv | Card | Use | How | Why |
|---:|------|-----|-----|-----|
| 1 | Bare Bones | passive | passive | no armor: Armor Score 3 + Strength and tier thresholds |
| 1 | Forceful Push | combat | action | primary weapon attack in Melee, knock back to Close, +d6 on Hope, Vulnerable |
| 1 | I Am Your Shield | combat | reaction | an ally within Very Close would take damage: a Stress, become the target |
| 2 | Body Basher | passive | passive | a successful Melee weapon attack adds Strength to damage |
| 2 | Bold Presence | combat | mixed | a Hope to add Strength to Presence; once per rest avoid a condition |
| 3 | Critical Inspiration | combat | rider | once per rest on a critical attack, allies clear a Stress or gain a Hope |
| 3 | Lean on Me | combat | reaction | once per long rest, an ally failed: both clear 2 Stress |
| 4 | Goad Them on | combat | action | Presence Roll vs Close: a Stress, it must attack you with disadvantage |
| 4 | Support Tank | combat | reaction | an ally within Close fails: 2 Hope to reroll a duality die |
| 5 | Armorer | passive | passive | +1 Armor Score while armored; allies clear an Armor Slot on repair |
| 5 | Rousing Strike | combat | rider | once per rest on a critical attack, everyone clears a HP or 1d4 Stress |
| 6 | Inevitable | passive | auto | after a failed action roll, the next one has advantage |
| 6 | Rise Up | passive | auto | +Proficiency Severe threshold; marking HP from an attack clears a Stress |
| 7 | Shrug It Off | combat | reaction | when you would take damage, a Stress to reduce one threshold; d6 or vault |
| 7 | Valor-Touched | passive | passive | +1 Armor Score; marking HP without armor clears an Armor Slot |
| 8 | Full Surge | combat | action | once per long rest, 3 Stress: +2 to all traits until a rest |
| 8 | Ground Pound | combat | action | 2 Hope, Strength Roll vs Very Close, thrown to Far, save (17) 4d10+8 |
| 9 | Hold the Line | combat | action | a Hope: adversaries entering Very Close are pulled in and Restrained |
| 9 | Lead by Example | combat | reaction | when you deal damage, a Stress: the next attacker clears a Stress or gains a Hope |
| 10 | Unbreakable | combat | reaction | on your last HP, roll a d6 and clear that many HP instead of a death move |
| 10 | Unyielding Armor | passive | auto | marking an Armor Slot: Proficiency d6s, a 6 reduces it for free |

### Dread (21 cards: 19 combat, 2 passive, 0 out of combat)

| Lv | Card | Use | How | Why |
|---:|------|-----|-----|-----|
| 1 | Blighting Strike | combat | action | Spellcast vs Far, d6+1 (Hope) or d10+1 (Fear) using Proficiency |
| 1 | Umbral Veil | combat | mixed | once per rest, tokens = GM Fear; spend them as penalties to attacks on you |
| 1 | Voice of Dread | combat | action | Spellcast vs a creature you see: a Stress and Restrained |
| 2 | Hideous Retribution | combat | reaction | an ally within Close takes damage: reaction roll, d6 magic back |
| 2 | Siphon Essence | combat | action | Spellcast vs Very Close, once per long rest d12+4, heal what it marks |
| 3 | Shared Trauma | combat | action | once per rest, move HP from one willing creature to another |
| 3 | Terrify | combat | action | Spellcast vs Close: 1d4 Stress, flee, Vulnerable with Fear |
| 4 | Chains of Affliction | combat | action | 2 Stress: a Chained target's hits mark one fewer HP |
| 4 | Summon Horror | combat | action | a Stress, d8+1 magic using Spellcast, save (12) or Stress |
| 5 | Dire Strike | combat | reaction | a target marks HP from your attack: a Hope, the GM loses a Fear |
| 5 | Spectral Mist | combat | action | 2 Hope: you and allies incorporeal, immune to physical damage |
| 6 | Darkfire | combat | action | Hope per target within Close, save (15), d8+6 using Spellcast |
| 6 | Jump Scare | combat | reaction | when you deal magic damage, a Stress to teleport in: Vulnerable |
| 7 | Dread-Touched | combat | mixed | 2 Stress to stop a GM Fear; once per rest + GM Fear to a roll |
| 7 | Wall of Hunger | combat | action | Spellcast (10), a Hope, a wall: creatures inside mark 2 Stress |
| 8 | Dark Army | combat | action | Spellcast (14), once per long rest 8 tokens: +1d8 damage or -1d8 taken |
| 8 | Eldritch Flesh | combat | mixed | +1 thresholds per marked Stress; on Fear, 2 Hope to clear an Armor Slot |
| 9 | Damnation | combat | action | Spellcast vs Far, Stress as d20s of magic damage |
| 9 | Savor the Anguish | passive | auto | an adversary within Close takes Severe damage: clear a Stress |
| 10 | Avatar of Terror | combat | action | a Stress to transform: 1d6 damage per GM Fear, Hope upkeep |
| 10 | Invoke Torment | passive | auto | double damage on full-Stress targets; Hope when one is defeated |
