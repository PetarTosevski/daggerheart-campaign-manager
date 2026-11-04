# TASK LN-V: vocabulary widen for every wave-4 gap

Plan `.omc/plans/lanes.yaml`, tracer V (label `w1-vocabulary`). The effect vocabulary is widened ONCE so the eight
wave-4 engine lanes (E1-E8) never touch the three types files. Modelled on drawer-answers DA0 (commit 2fe78f9): widen
only, no behaviour change, no SRD data touched. Book pages are printed pages (CB = Core Book, HF = Hope & Fear).

Files: `C` = `src/lib/domain/card-effects/types.ts`, `A` = `src/lib/domain/adversary-effects/types.ts`.
`src/lib/domain/feature-effects/types.ts` needed nothing (a `FeatureEffect` is `CardUse`s, so it gets every card piece).

## Rules for the wave-4 lanes

- Every new piece is an optional field or a new union member; nothing was renamed or narrowed. No SRD entry uses them
  yet: wave 5 switches the data over, one file per tracer.
- Where a widened union reached an exhaustive site, V added ONE fallback that keeps today's behaviour. The lane that owns
  the site replaces the fallback with the real behaviour:
  | Site | Fallback | Owner lane |
  |---|---|---|
  | `card-effects/run.ts` `targetGate` | `targetCheck` holds (true); `isTargetGate` counts it as per-target | E3 (reads E5's `stateCheckMet`) |
  | `card-effects/run.ts` `recipientsOf` | `chooser` is no one | E3 |
  | `card-effects/run.ts` `saveDifficulty` | `raised` = its `base`; `falling` = its `start` | E3 |
  | `card-effects/run.ts` check test | `even` / `odd` are evaluated (one line); `table` is not read yet | E3 |
  | `card-effects/run.ts` `runOutcome` | the 9 new step kinds become a manual prompt (`note` or the kind) | E3 (and the lane named per step below) |
  | `card-effects/run.ts` `ResolvedMod` / `resolveMods` | new `Mod` kinds travel as written (numbers unresolved) | E3 |
  | `card-effects/run.ts` `moveText` | labels for `ground`, `leaveScene` | E3 / E4 |
  | `card-effects/availability.ts` `stateCheckMet` | every new `StateCheck` is `undefined` (the player confirms, Q13); `inArea` with `who` other than self too | E5 |
  | `combat-actions/numbers.ts` `resolveNumber` | every new `NumberSource` is 0; `NumberEnv.dieSides` takes `companion` | E5 (E3 for `dualityDie`) |
  | `convex/lib/cardRunner.ts` `sheetMods` | a new `Mod` kind shows as its kind in the effect's text | E4 (cardRunner) / E6 |
- Shapes chosen so sites outside V's owns did not break: a failure with Hope / Fear is `result: "failure"` + `duality`
  (keeps `combatActions.ts resultHolds` exhaustive); the adversary's "lacks a condition" is `hasCondition.lacks` and its
  engine-read state is `situation.check` (keeps `adversaryFeatures.ts requirementText` and `features.ts
  adversaryRequirementMet` exhaustive; they ignore the new fields until E7 reads them); long limits are `Limit.period`
  beside `per` (keeps `featureDrawer.ts PER_WORD` and `hand/model.ts PER_LABEL`); `Duration` and `Cost` are unchanged
  (so `cardRunner UNTIL`, `cardRows INSTANCE_UNTIL` and the hand's Cost map needed no line).
- A `check` step's `table` rows hold card `Step`s, also in adversary entries (outcome and card flow steps; no summon /
  countdown / spotlight inside a row).
- A gap V missed: write a manual step and file a bead labelled `vocabulary-gap` plus your lane label (the DA0 rule).

## The table

Every bead labelled `lane:w1-*` (144). "Covered" = the vocabulary already had it (the lane wires the engine). "No
vocabulary needed" = runner, server or UI work only.

### E1 `w1-e1-triggers-rolls`

| Bead | Vocabulary | Lane |
|---|---|---|
| dcm-0gi Eclipse, ally succeeds with Hope vs an adversary | `RollResult` `successWithHope` (C:304); `afterAllyRolls.result: RollResult`, `.against: RollTarget` (C:702, C:319) | E1 |
| dcm-1o3 Dread-Touched, succeed with Fear | `afterYouRoll.result` `successWithFear` (C:718); `gmWouldGainFear.byYou` / `.result` (C:795) | E1 |
| dcm-3ft Adjust Reality, after any roll | `afterAllyRolls.roll: RollFilter` (`any` incl. damage / reaction) (C:702) | E1 |
| dcm-3ou Ill Omen, bonus on the Fear Die | Covered: `RollChange` `dieBonus` `die: "fear"`, amount `gmFear`, in a `modifyRoll` on `triggerSubject` of an auto `pcRolls` | E1 |
| dcm-5dg Versatile Fighter, another trait for a weapon | `Mod` `weaponTrait` (C:1055) | E1 |
| dcm-5z3 Courage, fail with Fear | `afterYouRoll.duality` (`result: "failure"`, `duality: "fear"`) (C:721) | E1 |
| dcm-733 Patron's Mantle, advantage to intimidate | `Mod` `advantage.situation` (C:951) | E1 |
| dcm-7zb Lead by Example, next PC attacking the adversary | `Mod` `attackedRider` with `AttackedRider.by: "pcs"`, `attackerSteps` (C:1039, C:1087), duration `hit` | E1 (E2 for the hit side) |
| dcm-86z Encore, the trigger's damage type | `RunContext.trigger.damageType` (run.ts, V widened); no types.ts change: a `sameAsTrigger` damage takes it | E1 fills it, E3 reads it |
| dcm-94h Twilight Toll, action roll vs them with no damage roll | `afterYouRoll.against.creature`, `.noDamageRoll` (C:718) | E1 |
| dcm-a9n Favor / Diminish My Foes | `afterYouRoll.result` `successWithHope` (C:304) | E1 |
| dcm-ab5 Ignition, primary weapon only | `whenYouAttack.weaponSlot` (C:745); also on `beforeYouRoll` (C:732) | E1 |
| dcm-bn1 Fangs is an attack; Feed narrowed to Fangs | Covered: `RollSpec.trait.attack` (DA0); new `fromUse` on `whenYouAttack` / `afterYouRoll` / `beforeYouRoll` / `whenYouDealDamage` / `whenTargetMarksHp` (C:751, C:725, C:732, C:758, C:770) | E1 |
| dcm-bxp.99.19.1 Perfect Recall | `Trigger` `whenYouRecall` (C:854); step `loadout` `op: "reduceRecallCost"` (C:1523) | E1 |
| dcm-f0m Cinder Grasp's On Fire, on the bearer's action | `Mod` `bearerRider` `on: "acts"` (C:1045, C:1105) carried by `condition.mods` (C:1366) | E1 (E2 for damage) |
| dcm-g6t Forest Sprites, ally attack vs enemy near a sprite | `afterAllyRolls.roll: "attack"`, `.against.inArea` (C:702, C:319) | E1 |
| dcm-gvr Elemental Breath / Long Tongue are weapon attacks | `RollSpec.trait.asWeapon` (C:428) | E1 |
| dcm-iu4 Tactician, when you Help | `whenHelping.helper: "self"` (C:851) | E1 |
| dcm-jog Backhanded Guidance, +1d6 on the Fear Die | Covered: `RollChange` `dieBonus` `die: "fear"`, amount `dice` | E1 |
| dcm-nhr Ethereal Visage, success with Hope | `afterYouRoll.result` `successWithHope` (C:304) | E1 |
| dcm-p1r Codex-Touched, swap with a vault card | step `loadout` `op: "swapWithVault"` (C:1523) | E1 |
| dcm-y3e Parallela, extra target on the next attack | `Mod` `extraTargets` (C:1057) + `EndEvent` `bearerAttacks` (C:228) | E1 |
| dcm-z1a Fane of the Wilds, Sage domain spell | `afterYouRoll.cardDomain` (C:718) | E1 |

### E2 `w1-e2-damage-window`

| Bead | Vocabulary | Lane |
|---|---|---|
| dcm-bxp.99.19.3 Poisoned, 1d10 direct each time the bearer acts | `Mod` `bearerRider` `on: "acts"` (C:1045) on `condition.mods` (C:1366) | E2 |
| dcm-fyb a hit ends until-hit effects | No vocabulary needed (server: `expire(sheet, "hit")` on a successful adversary attack) | E2 |
| dcm-18i can't mark an Armor Slot | `markArmor.ifUnable` (C:1341); gate `targetCheck` + `StateCheck` `track` `armor` `free` atMost 0 (C:1288, C:617) | E2 |
| dcm-6ju option the PC picks (Money Talks, Double or Nothing) | `optional.by` / `choose.by` (`ChooserSpec`, C:1669, C:1685, C:1621); `Recipient` `chooser` (C:1257); `convertMarks.into: "gold"` (C:1476) | E2 (E3 runs `by`) |
| dcm-98d Unyielding Armor | `whenArmorSlotMarked.stage: "would"` (C:778); covered: `reduceSeverity.insteadOfArmorSlot` (DA0) | E2 |
| dcm-9gw Breaking Blow / Chokehold, damage taken by a creature | `Mod` `attackedRider` (`damage`, `onSuccess`, `by`) (C:1039, C:1087) | E2 |
| dcm-kti conditions with riders (Poisoned, Envelop, Ignite, Taunted, Shadow Shackles, …) | `condition.mods` (C:1366); `Mod` `bearerRider` (with `costs`, `timing`) (C:1045, C:1105), `disadvantage` (C:1051), `dualityDie` (C:1069); flags `noHopeFromRolls`, `cannotHelp` (C:1027, C:1029); existing flags `attackDisadvantage` / `actionDisadvantage` + duration `nextRoll` | E2 |
| dcm-nt4 Rejuvenation Barrier, resistance from outside | `Mod` `resistance.from: "outsideArea"` (C:975) inside an `AreaSpec` with `follows` (C:1606) | E2 (E4 for the area) |
| dcm-raa Grace-Touched, would force HP | `whenTargetMarksHp.stage: "would"`, `.source: "any"` (C:770) | E2 |
| dcm-s77 Armor Eater etc., dearer Armor Slots | step `armorCost` (`slotsPerStep`, `alsoMark`) (C:1567) | E2 |
| dcm-sim Shield Aura ends at no HP marked | `EndEvent` `reducedToNoHp` (C:240) | E2 (E6 ends it) |
| dcm-sos marked HP from this hit, after the window | gate `targetCheck` + `StateCheck` `usedArmor` (Rend and Crush) (C:1288, C:647); the `targetMarkedHp` re-run after the window is no vocabulary (runtime) | E2 |

### E3 `w1-e3-steps-saves`

| Bead | Vocabulary | Lane |
|---|---|---|
| dcm-0gh steal an item / gold / rust a weapon | step `inventory` (C:1530); `NumberSource` `gold` (C:147) | E3 |
| dcm-0ib markedThisMove who:target for a self recipient | No vocabulary needed (run.ts reads the use's single target) | E3 |
| dcm-27j multi-outcome check, parity | `CheckTest` `even` / `odd` (C:483); `check.table` / `CheckRow` (C:1722, C:487) | E3 (E7 for adversary entries) |
| dcm-40m two choose steps kept distinct | `choose.distinctFrom` (C:1687) | E3 |
| dcm-5fc end another feature's effect | step `endEffect` `of` (C:1540) | E3 (E6 does the end) |
| dcm-5xi can't lose a Hope | `hope.ifUnable` (C:1350); gate `targetCheck` + `track` `hope` (C:617) | E3 |
| dcm-730 clear all conditions | `clearCondition.all` (C:1374) | E3 |
| dcm-7az attack chain until a miss | `followUp.repeat` (`FollowUpRepeat` `until: "miss"`, `costEach`) (C:1729, C:1631) | E3 (E7 for adversary) |
| dcm-8x8 end a card's own effect; max = free Stress | step `endEffect` (`of` unset) (C:1540); `NumberSource` `free` (C:122) | E3 |
| dcm-bz8 per-recipient choice | `choose.by` (C:1685, C:1621); `Recipient` `chooser` (C:1257) | E3 |
| dcm-d1b the host roll's Hope / Fear Die | `NumberSource` `dualityDie` (C:127) | E3 |
| dcm-d1d delegate can't read the use's roll | No vocabulary needed (runner passes the roll to the delegate) | E3 |
| dcm-fev auto-fail a save for a condition | `save.autoFail` (C:1709) | E3 |
| dcm-fnq choice max reads the target | `NumberChoice.afterTargets` (C:1801) | E3 |
| dcm-kkx non-stacking effect | `effect.stacking` (C:1408) | E3 |
| dcm-q0a allies pay to raise a save's Difficulty | `SaveDifficulty` `raised` (C:464) | E3 |
| dcm-qbn pick which Prayer Dice to spend | No vocabulary needed (runner reads the picked dice) | E3 |
| dcm-rb0 save with advantage / disadvantage | `save.advantage`, `.disadvantage`, `.modsWhen` (C:1706-1708) | E3 |
| dcm-rou Chain Lightning's chain | `followUp.repeat` `until: "noTargets"` (C:1631); `TargetSpec.origin: "chain"` (C:396) | E3 |
| dcm-uyc listed values (Teleport) | `NumberChoice.values` (C:1796) | E3 |
| dcm-xp0 tokens on a PC (bramble) | `tokens.holder: "recipient"`, `.name` (C:1428); `NumberSource` `creatureTokens` (C:149); `StateCheck` `tokens` `who`/`name` (C:629) via gate `targetCheck` | E3 (E5 reads the check) |
| dcm-y45 pick among hit targets | `TargetSpec.among: "hit"` (C:387) | E3 |
| dcm-yzr ground a flyer | `move.mode: "ground"` (C:1388) | E3 |
| dcm-zhc spread forced HP marks | `markHp.distribution: "split"`, `.maxPer` (C:1330) | E3 |

### E4 `w1-e4-targeting-areas`

| Bead | Vocabulary | Lane |
|---|---|---|
| dcm-ssf Elemental Incarnation Water | `whenYouDealDamage.within` (C:758); `TargetSpec.excludeSubject` (C:389) | E4 |
| dcm-x7p Manipulate Magic, extend the host's reach | `RollChange` `reach` (C:1239); `TargetSpec.hostRange` (C:391) | E4 |
| dcm-1yo Immovable Object | `Mod` `forcedMoveReduce` (C:1059) | E4 |
| dcm-3oe Hurricane, can't move against the wind | `Mod` `moveLimit.direction` (C:1065) | E4 |
| dcm-bhp Cloaked | `Mod` `replaceCondition` (C:1067); `EndEvent` `bearerAttacks`, `endsMoveInSight` (C:228, C:230); `AreaSpec.perObserver` (C:1617) | E4 |
| dcm-bpr Hold the Line | `Trigger` `whenEnemyEntersRange` (C:856); `condition.endsOnCaster` with `moves`, `failWithFear` and `endsOn` `gmSpendsFear` (C:1367, C:232, C:234, C:222) | E4 (E6 the ends) |
| dcm-bxp.99.19.39 Dark Cloud at a point | `AreaSpec.placeWithin` (C:1612); centre `point` existed | E4 |
| dcm-bxp.99.19.57 Attack bar ally chips | No vocabulary needed (UI) | E4 |
| dcm-bxp.99.19.64 traits read raw sheet.traits | No vocabulary needed | E4 |
| dcm-cj8 Wild Fortress dome | `AreaSpec.damageable` (C:1610) | E4 |
| dcm-cma persistent area on entry / crossing | `AreaSpec.shape: "wall"`, `onEnter`, `onCross`, `onActInside`, `follows` (C:1596-1606) | E4 |
| dcm-d7h minimum target count | `TargetCount.upTo.min`, `.any.min` (C:336, C:344) | E4 |
| dcm-dgu range origins | `TargetSpec.origin` (C:396); the point / shape arguments of `useCard` are runtime | E4 |
| dcm-ii4 Circle of Power | `StateCheck` `inArea.who` (C:607); `EndEvent` `tokensGone`, `ownerLeavesArea` (C:236, C:238) | E4 |
| dcm-jx6 rider gated on its host roll | No vocabulary needed (the rider's scope gets the host roll; `when: ["success"]` then holds) | E4 |
| dcm-ofy Dark Army, target within Very Close | `whenYouDealDamage.within` (C:758) | E4 |
| dcm-v27 Blink Beast duplicate token | `summon.duplicate` (A:373) | E4 |
| dcm-wuu area hazard, movement limit | `AreaSpec.onEnter` / `onActInside` / `excludeOwner` (C:1602, C:1608); `Mod` `moveLimit.maxRange` (C:1065) | E4 |
| dcm-zos Fearsome Presence | `Mod` flag `noHopeFeaturesAgainst` (C:1019) | E4 |

### E5 `w1-e5-checks-limits-numbers`

| Bead | Vocabulary | Lane |
|---|---|---|
| dcm-bxp.99.19.4 Armored Shell, Armor Score | `NumberSource` `stat` `armorScore` (C:132) | E5 |
| dcm-13s Spirit Weapon range; its attacks | `StateCheck` `weaponRange` (C:638); trigger `fromUse` (C:751) | E5 |
| dcm-2f3 Hydra, lacks a condition | `AdversaryRequirement` `hasCondition.lacks` (A:273); card side `StateCheck` `not` (C:651) | E5 (E7 reads the adversary one) |
| dcm-2g9 Feed, no tokens | `StateCheck` `tokens` (C:629) | E5 |
| dcm-3i4 Enchanted Talisman | `whenAllyWouldTakeDamage.unlimited` (C:669); `StateCheck` `holdsItem` (C:640) | E5 |
| dcm-7n7 Invisibility / Never Upstaged tokens | `StateCheck` `tokens` (C:629) via `situation.check` or gate `targetCheck`; `EndEvent` `tokensGone` (C:236) | E5 |
| dcm-85u Sneak Attack | `StateCheck` `allyNear`, `anyOf` (C:633, C:653) | E5 |
| dcm-8yr Tactician, ally pays | `pay.paidBy` (C:1650); `Payer` (C:552) | E5 |
| dcm-9l4 Kick / Tusks, target within Melee | `StateCheck` `within` (C:631) | E5 |
| dcm-a7o target's Major threshold | `NumberSource` `stat` `majorThreshold` (C:132) | E5 |
| dcm-aym a week / a day | `Limit.period` (C:544) | E5 |
| dcm-c75 Words of Discord memory | `StateCheck` `usedOnBefore` (C:645) | E5 |
| dcm-fjh trait of your choice; Stress slot | `RollSpec.reaction.anyTrait` (C:436); `ModStat` `stressMax` (C:921); `choose.distinctFrom` (C:1687) | E5 |
| dcm-qdm actor carries a tag | Covered: `situation.check` `hasCondition` `who: "self"` (DA0) | E5 |
| dcm-ttz count creatures | `NumberSource` `creatureCount` (C:139) | E5 |
| dcm-u6z Vitality slots | `ModStat` `hpMax`, `stressMax` (C:919, C:921) | E5 |
| dcm-uj0 Rune Ward holder pays | `CardUse.paidBy` (C:1847); `whenAllyWouldTakeDamage.unlimited` (C:669) | E5 |
| dcm-war Ward Die 8 spends the ward | step `exhaust` (C:1547) | E5 |
| dcm-wut Surrounded, Melee weapon before the roll | `beforeYouRoll.weaponRange` (C:732); `StateCheck` `weaponRange` `attacking` (C:638) | E5 |

### E6 `w1-e6-endings-durations`

| Bead | Vocabulary | Lane |
|---|---|---|
| dcm-0ey Spectral Mist | duration `scene` + `EndEvent` `actionRoll` (C:226) | E6 |
| dcm-3ea Reliable Backup's Presence Roll | `effect.endsOnRoll` (`RollEnd` `roll: "presence"`) (C:1410, C:249) | E6 |
| dcm-4qv Night's Glamour maintain | `effect.maintain` (`Maintain`) (C:1411, C:261) | E6 |
| dcm-8bv Marked for Death | `EndEvent` `targetDefeated`, `gmSpendsFear` (C:224, C:222) | E6 |
| dcm-awh Stance Fighter sets the stance | step `setStance` (C:1542) | E6 |
| dcm-b77 Banish's return | `Mod` `bearerRider` `on: "pcRollsWithFear"` (C:1105) with a `save` whose `SaveDifficulty` is `falling` (C:474) | E6 (E3 runs the save) |
| dcm-cwh Timejammer / Specter of the Dark | `endsOnRoll` `by: "caster"`, `targetsCreature` (C:249) | E6 |
| dcm-ffk Menacing Reach weapon | `endsOnRoll` `roll: "attack"`, `result: "success"`, `weapon: "primary"` (C:249) | E6 |
| dcm-utu until the bearer takes damage | `EndEvent` `takeDamage`, `gmSpendsFear` (C:220, C:222); Jump Scare: existing `markHp` | E6 |
| dcm-v17 Unstoppable | `Mod` flag `cannotBeVulnerable` (C:1017); `NumberSource` `classDie` (C:151); ending on D5's die drop is runtime (or a step `endEffect`) | E6 |
| dcm-wjv Eye of the Storm, the caster's Severe | `effect.endsOnCaster` (C:1409) | E6 |

### E7 `w1-e7-adversary-engine`

| Bead | Vocabulary | Lane |
|---|---|---|
| dcm-145 revive; Horde HP from a count | step `revive` (C:1552); `summon.hp` (A:372) | E7 |
| dcm-1ch On My Signal, combined damage | `AdversaryFeatureUse.groupAttack.name`, `.eachRolls`, `.advantage` (A:449) | E7 |
| dcm-1jg Deadly Drop, after the PCs' next action | `Mod` `bearerRider` `on: "afterPcsNextAction"` (C:1105) on the target's condition | E7 |
| dcm-2gn trigger narrowings | `AdversaryTrigger` `pcSpotlit`, `allyAttacks`, `pcDealsDamage`, `pcsRest` (A:201-207); `onDamaged.weaponAttack` (A:110); `allyDefeated.allyType` (A:147); `pcRolls.result` (all `RollResult` + `failureWithHope`) and `.notCritical` (A:171, A:175); `onMarkStress.stage` (A:136); `onMarkHp.includeZero` (A:130); `onSpotlight.byFear` (A:187) | E7 |
| dcm-346 rolls / damage vs a third party | `Mod` `attackedRider` `by: "others"` (C:1087); `disadvantage.unlessTarget: "caster"` (C:1051); `creatureCount` (C:139) | E7 |
| dcm-4dc Sandstorm, own attacks from beyond Melee | `Mod` `disadvantage.beyond` (C:1051) | E7 |
| dcm-51s riders for creatures with its condition | `Mod` `attackedRider` `by: "caster"` (C:1087); `bearerRider` `on: "casterSpotlit"`; `condition.endsOnCaster` (C:1367); `disadvantageAgainst.situation` (C:963 block); `DamageChange` `best` (C:1182) | E7 |
| dcm-63j Mind Meld, Stress onto allies | `markStress.distribution: "split"` (C:1335); `onMarkStress.stage: "would"` (A:136) | E7 |
| dcm-702 death move, mark all HP | step `deathMove` (C:1554); `NumberSource` `free` `hp` (C:122) | E7 |
| dcm-bxp.78 countdown Start buttons | `countdown.tickOn` (A:395); the buttons are UI / server | E7 |
| dcm-c5h once per GM turn | `Limit.period: "gmTurn"` (C:544) | E7 |
| dcm-cdz passive condition on itself | `AdversaryModifier` `selfCondition` (A:317); `situation.check` `tokens` (A:283) | E7 |
| dcm-dv6 fire | `DamageKeyword` (C:34); damage `keyword` (C:1321); `DamageChange.add.keyword` (C:1141); `Mod` `weakness` (C:1080), `resistance.keyword` (C:976); `whenYouWouldTakeDamage.keyword` (C:679); `onDamaged.keyword` (A:111) | E7 (E2 for the PC side) |
| dcm-e75 Goad Them On | `Mod` `mustAttack` (C:1053) + `disadvantage`; `EndEvent` `bearerAttacks` (C:228) | E7 |
| dcm-eut Defensive stance | `Mod` `disadvantageAgainst.from`, `.buyOff` (C:963) | E7 |
| dcm-gx1 Relentless (X) from heads | `relentless.timesFrom` (A:308) | E7 |
| dcm-gx3 evolution | `Mod` `standardAttack`, `features` (C:1076, C:1078) in a permanent `effect` on self | E7 |
| dcm-i55 Slash and Burn +10 magic | Covered: `DamageChange.add.type` (SD0) | E7 |
| dcm-icd flee the scene | `move.mode: "leaveScene"` (C:1388) | E7 |
| dcm-idz GM control | `Mod` `gmControl` (C:1074) | E7 |
| dcm-m5s increasing / decreasing countdown | `countdown.direction`, `.onZero` (A:393) | E7 |
| dcm-mhn crit on 19-20 | `RollSpec.critRange` (C:445) | E7 |
| dcm-tal count dice at or above | Covered: `NumberSource` `dice` `keep: "countAtLeast"` (SD0 NV12) | E7 |
| dcm-vkp one target at a time | `AdversaryFeatureUse.exclusive` (A:451) | E7 |
| dcm-vv2 runner bugs | No vocabulary needed | E7 |
| dcm-xyw attack mods keyed to the target | `Mod` `attackedRider` (`advantage`, `direct`, `halveEvasion`) (C:1087); `RollSpec.halveEvasion` (C:447); flag `cannotBeHidden` (C:1015) | E7 |
| dcm-yea immunities | flags `noForcedStress`, `noCritDamage`, `mindImmune` (C:1021-1025) | E7 |

### E8 `w1-e8-session-features-rests`

| Bead | Vocabulary | Lane |
|---|---|---|
| dcm-bxp.99.19.58 Efficient on an interrupted long rest | No vocabulary needed | E8 |
| dcm-2a1 short-rest / during-rest timing, downtime moves | `timing.restType`, `.during` (C:812); step `downtime` (C:1561) | E8 |
| dcm-2z2 companion die, range, type, training | `DiceExpr.sidesOf: "companion"` (C:166); `DamageRoll` `companion` (C:1133); `TargetSpec.companionRange` (C:398); `ModStat` `companionTraining` (C:923) | E8 |
| dcm-53f delegated Hex names the map target | No vocabulary needed | E8 |
| dcm-78x delegate to session features; tide tokens | `NumberSource` `tideTokens` (C:153); the delegate routing is runtime | E8 |
| dcm-bxp.99.19.2 Eloquent, extra downtime move | step `downtime` `op: "extraMove"`, `at: "nextRest"` (C:1561) | E8 |
| dcm-gov Otherworldly Ire, targets after the dice | Covered: `TargetCount.upTo.rolledFirst` (DA0) with `n` = `dice` (`count` the Favor chosen, `sidesOf: "patron"`, `keep: "highest"`) | E8 |
| dcm-lk8 Lunar Phases moon die | `StateCheck` `moonPhase` (C:649); the bump is a `delegate` routed to `bumpMoonDie` (runtime) | E8 |
| dcm-sa2 reroll Slayer 1s | `RollChange` `rerollHeld` (C:1241) | E8 |

Totals: 144 beads; 127 got new vocabulary, 6 were covered by existing pieces (dcm-3ou, dcm-jog, dcm-qdm, dcm-i55,
dcm-tal, dcm-gov; dcm-bn1 and dcm-98d partly too), 11 need no types.ts vocabulary (dcm-fyb, dcm-0ib, dcm-d1d, dcm-qbn,
dcm-bxp.99.19.57, dcm-bxp.99.19.64, dcm-jx6, dcm-vv2, dcm-bxp.99.19.58, dcm-53f, dcm-86z (types-side: run.ts RunContext)).

New step kinds (appended to `STEP_KINDS`, so `ADVERSARY_STEP_KINDS` carries them too): `loadout`, `inventory`,
`endEffect`, `setStance`, `exhaust`, `revive`, `deathMove`, `downtime`, `armorCost`. New adversary trigger kinds
(appended to `ADVERSARY_TRIGGER_KINDS`): `pcSpotlit`, `allyAttacks`, `pcDealsDamage`, `pcsRest`.

## Validators the lanes will need (outside V's owns; nothing stored uses the new shapes yet)

1. `convex/lib/validators/combatMaps.ts` `combatAreaFields.shape: v.literal("circle")`: widen to
   `v.union(v.literal("circle"), v.literal("wall"))` (plus the wall's end points) when E4 stores walls (dcm-cma).
2. `src/lib/validation/characters.ts` `FEATURE_USE_UNTIL` (+ `convex/lib/validators/characters.ts` line 168) and
   `convex/lib/validators/encounters.ts` `instanceFeatureUseValidator.until` (line 99): only if a lane stores
   `Limit.period` itself (`week`, `day`, `gmTurn`). Until then the use is recorded under `per` (the fallback period).
3. `convex/lib/validators/encounters.ts` `instanceEffectValidator`: when E2 / E7 store `attackedRider` / `bearerRider`
   / `disadvantage` mods on an instance, the stored mod shape must widen (widen, migrate, narrow; rule 7).

## Tests

`tests/unit/card-effects/types-widen.test.ts`: a V block writes each bead's mechanic with the new pieces (the types are
the test) and checks that the V step kinds follow SD0's in `STEP_KINDS` and `ADVERSARY_STEP_KINDS`, and the V trigger
kinds end `ADVERSARY_TRIGGER_KINDS`. Two existing assertions in that file (V owns it) now bound the SD0 slice instead
of assuming SD0 is last. Every other test passes unchanged.

## QUESTIONS

None blocking. Shapes that carry an open reading, for the lane to confirm with the user when it builds them:

1. **`DamageKeyword` is only `"fire"`** (Made of Straw, HF p.79; Fireproof, HF p.22: "immune to damage from magical or
   mundane flame"). Other keywords get added when a feature names one.
2. **Lead by Example (dcm-7zb)** is an `attackedRider` with `by: "pcs"` and duration `hit`; CB p.342: "The next PC to make
   an attack against that adversary can clear a Stress or gain a Hope." Whether the caster's own next attack counts is
   the lane's to ask (`by: "others"` would exclude them).
