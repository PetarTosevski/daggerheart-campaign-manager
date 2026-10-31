# TASK LN-V2: vocabulary widen 2 and the vocabulary-gap triage

Plan `.omc/plans/lanes-2.yaml`, tracer V2 (lane `w3-vocabulary`), wave 7. Round 1 (`.omc/plans/lanes.yaml`) widened the
vocabulary once (V, `docs/tasks/TASK-LN-V.md`), built the engine lanes E1-E8 and switched the SRD data; the data pass
filed new beads. This tracer triages every open bead labelled `vocabulary-gap` (125 on 2026-10-31) and widens the
vocabulary for the ones that still lack a term, so wave 8 (engine lanes E1-E8) never touches the three types files and
wave 9 (SRD data) can switch the entries. Book pages are printed pages (CB = Core Book, HF = Hope & Fear); every new
term quotes the text it is for (checked against `.reference-private/text/core.txt` and `hopefear.txt`).

Files: `C` = `src/lib/domain/card-effects/types.ts`, `A` = `src/lib/domain/adversary-effects/types.ts`.
`src/lib/domain/feature-effects/types.ts` needed nothing (a `FeatureEffect` is `CardUse`s).

## Verdicts

| Verdict | Count | Meaning |
|---|---:|---|
| needs-term | 28 | V2 added the missing union members / optional fields (below); the engine lane named then runs them, wave 9 writes the data |
| engine-only | 92 | The vocabulary already says it (V or earlier); a wave-8 lane must read it. Most have the round-1 follow-up bead named |
| data-only | 2 | Vocabulary and engine handle it; only SRD data is left (dcm-702), or it is done and can close (dcm-2f3) |
| rule-question | 1 | dcm-13s: which attacks are Spirit Weapon attacks; filed as dcm-xbtw (`rule-question`) with the book text |
| narrative | 2 | dcm-by2d, dcm-lezi: story-only manual steps; P4 close candidates |

## What V2 added (widen only, no `any`)

All new pieces are optional fields or new union members; nothing was renamed or narrowed, and no SRD entry uses them yet.

| Piece | File | Beads |
|---|---|---|
| `Escape` (roll `trait` + `difficulty`, `attack`, `costs`): `condition.escape`, `tokens.escape`, `AreaSpec.leave`, `AreaSpec.dispel` | C | dcm-xobk, dcm-zi3k, dcm-wuu |
| `FeatureOptionRef`; `Mod features.removeOptions`; `StateCheck optionRemoved` | C | dcm-qw4f |
| `NumberSource targetCount.which: "markedHp"` + `.severity` | C | dcm-nsqo, dcm-k4x5 |
| `NumberSource recorded` + `condition.record` | C | dcm-b77 |
| `NumberSource creatureCount.chain` (a line of creatures) | C | dcm-346, dcm-xobk |
| `CheckTest allEven / allOdd` | C | dcm-4yg4 |
| `FollowUpRepeat.until: "checkFails"`, `.check`, `.perLink` | C | dcm-4yg4 |
| `EndEvent castsSpell`, `benefitGranted` | C | dcm-o44e, dcm-5yew |
| `Trigger whenYouChooseThisCard` | C | dcm-40mj |
| `Mod` flags `onlyFlee`, `cannotSpendHope`, `cannotClearHp`, `cannotClearStress`, `attacksHalveEvasion` | C | dcm-zi3k, dcm-5kxg, dcm-4c9m |
| `Mod cannotAttackTarget`, `moveRange`, `damageTaken`, `marksMultiplier` | C | dcm-zi3k, dcm-z5a6, dcm-kvx4, dcm-fbsr |
| `BearerRider.on` `gmSpendsFear`, `casterMoves`, `rolledAgainst`, `marksLastStress` | C | dcm-zi3k, dcm-z5a6, dcm-lvgm, dcm-xobk, dcm-wqgs |
| `RollChange halveEvasion` | C | dcm-5jyp |
| `TargetSpec.points`; `damage.perArea` | C | dcm-va0f |
| `markHp.reduceWith: "hope"` | C | dcm-zi3k |
| `hope.distribution` | C | dcm-nh44 |
| `move.mode: "withCaster"`, `move.relativeTo: "area"` + `.area`, `move.leaveAs` | C | dcm-z5a6, dcm-lvgm, dcm-5yew, dcm-xobk |
| `effect.sharedGrant`; `effect.endFear` / `condition.endFear` | C | dcm-rao5, dcm-8bv |
| `inventory.op: "giveGold" / "giveItem"` + `.text` | C | dcm-vf7i |
| `negate.what: "move"` | C | dcm-xobk |
| `AreaSpec.endsOnCaster`, `.seeThrough`, `.ownerPerObserver`, `.memberCondition`, `.count`, `.anchored` | C | dcm-rx1k, dcm-o44e, dcm-wuu, dcm-5yew |
| New steps `forcedAttack`, `changeForm` (appended to `STEP_KINDS`, so `ADVERSARY_STEP_KINDS` carries them) | C | dcm-c8h3, dcm-zi3k, dcm-3ag5 |
| `pcMoves.stage: "would" / "did"` | A | dcm-xobk |

Shapes chosen so files outside V2's owns did not break: Comatize (dcm-wqgs) is a `bearerRider` on the latched
condition (`marksLastStress`) instead of a new adversary trigger kind; Phantom Retreat's spot is an `anchored` area
instead of a new `AreaSpec.centre`.

### Fallbacks (one line each, in V2's owns; the lane replaces it)

| Site | Fallback | Owner lane |
|---|---|---|
| `combat-actions/numbers.ts` `resolveNumber` | `targetCount` `markedHp` and `recorded` read 0 | e7 (markedHp after the window), e7 / e3 (recorded) |
| `card-effects/availability.ts` `stateCheckMet` | `optionRemoved` is `undefined` (the table confirms, Q13) | e7 |
| `card-effects/run.ts` `runOutcome` | `forcedAttack`, `changeForm`, `inventory` `giveGold` / `giveItem` become a manual prompt (`note`, `text` or the kind) | e7 (e8 for a feature's gift) |
| `card-effects/run.ts` `ResolvedMod` | the four new `Mod` kinds travel as written | e2 / e4 / e7 |
| `card-effects/run.ts` `moveText` | label for `withCaster` ("Move along with the caster") | e4 |
| `card-effects/run.ts` check test | `allEven` / `allOdd` are evaluated (one line) | done |

Read by nobody yet (optional fields, so no site broke; until a lane reads them they change nothing): `escape`,
`record`, `endFear`, `chain` (counted as plain `within`), `reduceWith`, `distribution` on `hope` (each recipient gets
the amount), `sharedGrant`, `perArea`, `points`, the `AreaSpec` fields, `removeOptions`, `leaveAs`, `relativeTo:
"area"`, `pcMoves.stage`, the new flags, `BearerRider.on` members, `negate` `move`, `halveEvasion`, `FollowUpRepeat`
`checkFails` (runs like `noTargets`: the table gives no next targets when the check fails), `whenYouChooseThisCard`.

## Outside owns (for the orchestrator)

1. **A PC's successful escape as an adversary trigger** (dcm-xobk (3), Encumber, CB p.218: "If bramble tokens are
   removed from a target using a Finesse Roll, a number of Tangle Bramble Minions spawn within Melee range equal to the
   number of tokens removed"). The clean piece is a new `AdversaryTrigger` kind, e.g. `{ kind: "pcEscapes"; from?: string;
   by?: "roll" | "any" }` with `triggerAmount` = tokens removed, appended to `ADVERSARY_TRIGGER_KINDS`. It was NOT added:
   `src/lib/domain/adversary-actions/features.ts` `matchesTrigger` is a default-less switch returning `boolean` (TS2366
   on a new kind), and V2 doesn't own it. Whoever owns features.ts in wave 8 (e7) adds the kind to A and one line
   `case "pcEscapes": return false;` (or the real match) in `matchesTrigger`, plus its `AdversaryEvent` member.
2. No other site outside the owns needed a line: `pnpm typecheck` is clean with every widen above.

## Triage table

Lanes: e1 `w1-e1-triggers-rolls`, e2 `w1-e2-damage-window`, e3 `w1-e3-steps-saves`, e4 `w1-e4-targeting-areas`, e5
`w1-e5-checks-limits-numbers`, e6 `w1-e6-endings-durations`, e7 `w1-e7-adversary-engine`, e8 `w1-e8-session-features-rests`.
"SRD data" is the file wave 9 edits once the lane has landed (`-`: the data is already switched or nothing to write).

### needs-term (28)

| Bead | What it needs | Lane (wave 8) | SRD data (wave 9) |
|---|---|---|---|
| dcm-xobk Tier 1 leftovers (Shield Wall, Drain and Multiply, Encumber, Thorny Cage) | New: `pcMoves.stage: "would"` + `negate.what: "move"`, `creatureCount.chain` (the guard line), `move.leaveAs: "combined"`, `tokens.escape` (`Escape`: Finesse 12 + tokens), `BearerRider.on: "rolledAgainst"` (the cage). NOT added: an adversary trigger for a PC's successful escape (spawn Minions = tokens removed), see Outside owns | e7 (escape roll, rolledAgainst, would-move hook in combatTokens.move: e4) | t1-core.ts |
| dcm-5jyp A d6 before the attack halves the target's Evasion (Peerless Accuracy, Skillful Strike) | New: `RollChange` `halveEvasion` in a `modifyRoll` of the `onAttack` `before` use's check | e7 | t2-core.ts, t2-hf.ts |
| dcm-nsqo A Fear per target that marked HP (Suppressing Blast, Paralyzing Shock) | New: `NumberSource targetCount.which: "markedHp"` (fallback 0), read after the window with dcm-ehgy | e7 (+e5 numbers.ts env field) | t1-core.ts, t2-core.ts |
| dcm-zi3k Tentacle Rays beams Beguile, Scare, Doom | New: `Mod cannotAttackTarget`, step `forcedAttack`, `BearerRider.on: "gmSpendsFear"`, flag `onlyFlee`, `condition.escape`, `markHp.reduceWith: "hope"` | e7 (+e2 for the PC's Hope spend before forced HP) | t2-hf.ts |
| dcm-z5a6 Movement riders (Unleash the Beast, Pin) | New: `Mod moveRange`, `BearerRider.on: "casterMoves"`, `move.mode: "withCaster"` | e4 (token moves) + e7 | t2-hf.ts |
| dcm-kvx4 +1 per leechpole on any damage taken (Burrowing Leechpoles) | New: `Mod damageTaken` (`add` `creatureTokens` self) | e2 (PC hits) + e7 (tokens on a PC, dcm-0n1u) | t4-hf.ts |
| dcm-wqgs A PC marks their last Stress while latched (Comatize) | New: `BearerRider.on: "marksLastStress"` on the latched condition (no new adversary trigger needed) | e7 (bearer riders, with dcm-mm0f) | t4-hf.ts |
| dcm-3ag5 Swap the stat block, keep the marks (Forlorne Transform) | New step `changeForm` (manual prompt fallback) | e7 | t4-hf.ts |
| dcm-qw4f Remove one option of another feature for good (Seven-Headed) | New: `Mod features.removeOptions` (`FeatureOptionRef`), `StateCheck optionRemoved` (fallback undefined) | e7 | t4-hf.ts |
| dcm-4yg4 Follow-up repeating while a check holds, per-link damage change (Lightning Strike, Lightning Bolt) | New: `FollowUpRepeat.until: "checkFails"`, `.check`, `.perLink`; `CheckTest allEven / allOdd` (evaluated) | e3 (run.ts followUp) + e7 (adversary chain prompts) | t4-hf.ts |
| dcm-k4x5 Count of creatures who took Severe damage (Frenzied Feeding) | New: `targetCount.which: "markedHp"` + `severity` | e7 | t4-hf.ts |
| dcm-5kxg Can't spend Hope / can't clear HP or Stress (Ravenous, Afflicted) | New flags `cannotSpendHope`, `cannotClearHp`, `cannotClearStress` | e5 (costs refused) + e3 (clear steps) via dcm-mm0f condition mods | t4-hf.ts |
| dcm-fbsr Double a creature's spends and marks (Unstuck) | New: `Mod marksMultiplier` | e2 (marks on hits) + e3 (costs) | t4-core.ts |
| dcm-va0f Overlapping bursts (Unleash Hellfire) | New: `TargetSpec.points`, `damage.perArea` | e7 (+e3 run.ts damage) | t3-hf.ts |
| dcm-4c9m Every attack halves Evasion (Never Misses) | New flag `attacksHalveEvasion` (read by run() and runStandardAttack) | e7 | t3-core.ts |
| dcm-rx1k An area ends on its caster's event (Hush) | New: `AreaSpec.endsOnCaster` | e4 (combatAreas end) + e6 (caster events) | midnight.ts |
| dcm-rao5 One shared advantage for the first roll by anyone (Bird's-Eye View) | New: `effect.sharedGrant` | e6 (end every copy) | beastforms.ts |
| dcm-vf7i Gain gold or a mundane item (Contacts Everywhere supply) | New: `inventory.op: "giveGold" / "giveItem"`, `.text` (manual prompt fallback) | e7 (inventory writes, with dcm-0n1u) or e8 (feature runner) | ranger-rogue.ts |
| dcm-lvgm Carry a creature along (Wings of Light) | New: `move.mode: "withCaster"` + `BearerRider.on: "casterMoves"` (as dcm-z5a6) | e4 (token moves) | seraph-witch.ts |
| dcm-5yew A remembered map point; placed markers (Phantom Retreat, Forest Sprites) | New: `AreaSpec.anchored`, `.count`, `move.relativeTo: "area"` + `.area`, `EndEvent benefitGranted` | e4 | midnight.ts, sage.ts |
| dcm-o44e Darkness only some see through (Eclipse, Veil of Night) | New: `AreaSpec.seeThrough`, `.ownerPerObserver`, `.endsOnCaster`, `EndEvent castsSpell` | e4 (vision, walls dcm-3p7s) + e6 (castsSpell) | midnight.ts |
| dcm-40mj Permanent pick when the card is chosen (Vitality) | New: `Trigger whenYouChooseThisCard` (auto) | e8 (level-up / card acquisition flow; gainSlots dcm-o3j) | blade.ts |
| dcm-c8h3 Force an adversary to attack another adversary (Words of Discord) | New step `forcedAttack` (manual prompt fallback) | e7 (the instance's attack) | grace.ts |
| dcm-nh44 Split a Hope gain among the PCs (Stone of Omens) | New: `hope.distribution: "split"` (unread: each recipient gets the amount until the lane splits) | e3 (run.ts split prompt) + e7 | t1-hf.ts |
| dcm-b77 Banish's return (falling Difficulty from the cast) | New: `condition.record` + `NumberSource recorded` (fallback 0); bearerRider pcRollsWithFear and falling save existed | e7 (bearer riders on instances) + e3 (save) | codex.ts |
| dcm-8bv Marked for Death ends on defeat or the GM's Fear | New: `effect.endFear` / `condition.endFear` (the Fear a `gmSpendsFear` end costs; E6 Q2); the end events existed | e6 (callers on defeat dcm-wn7, GM Fear intent dcm-kmr) | assassin-brawler.ts, codex.ts (Slumber) |
| dcm-346 Third-party mods (I've Got 'Em, In Your Face, Shield Wall line) | New: `creatureCount.chain` (the line); the rest existed (`attackedRider by: others`, `disadvantage.unlessTarget`) | e7 (`unlessTarget`, creatureCount env dcm-8rh) | t1-core.ts, t3-hf.ts (Blinding Multitude) |
| dcm-wuu Lasting area hazards (Bramble Patch, Shadow Swarm) | New: `AreaSpec.memberCondition`, `.leave`, `.dispel` (`Escape`); onEnter / onActInside / moveLimit existed | e4 (areas on the adversary path, dcm-3p7s) | t3-core.ts, t3-hf.ts, t4-core.ts |

### engine-only (92)

| Bead | What it needs | Lane (wave 8) | SRD data (wave 9) |
|---|---|---|---|
| dcm-bxp.99.19.3 Poisoned 1d10 each time the bearer acts | Vocabulary there (`bearerRider on: acts`, data done); bearer riders don't run | e7 (adversary bearer acts, dcm-mm0f) | beastforms.ts (drop the manual prompt after) |
| dcm-bxp.99.19.4 Armored Shell's Armor Score | `stat armorScore` resolves; nobody fills `NumberEnv.self.stats` | e2 (window fills the actor's stats) + e8 (dcm-me3) | beastforms.ts (shell) |
| dcm-x7p Manipulate Magic, extend the host's reach | `RollChange reach`, `hostRange` exist; combatActions doesn't read them (dcm-76l5) | e1 | druid-sorcerer.ts |
| dcm-ssf Elemental Incarnation Water | `within`, `excludeSubject` exist; `within` unmatched (dcm-76l5) | e1 | druid-sorcerer.ts |
| dcm-umti Auto riders get no picked creatures | runRiderPart sets picked = [] | e1 | druid-sorcerer.ts |
| dcm-gtmp 'Would force HP' on the PC's own attacks and markHp steps | `whenTargetMarksHp.stage: would` exists | e1 (+e4 cardRunner markHp steps) | grace.ts |
| dcm-mm0f Bearer riders run where the bearer rolls or acts | Vocabulary there | e1 (PC bearer) + e7 (adversary bearer); collision-free split by file | - |
| dcm-yd5h attackedRider damage on attacks against the bearer | Vocabulary there | e1 (PC attacks) + e7 (instance mod store, validators/encounters.ts) | - |
| dcm-5cn5 A hit-PC answer the attacker grants (Money Talks) | Vocabulary there (`optional.by`, `convertMarks into gold`) | e2 (window, incomingHits, validators/combatRequests.ts); respond args in convex/adversaryActions.ts is e7's file: collision | t3-core.ts |
| dcm-ehgy Re-run targetMarkedHp / usedArmor steps after the window | Vocabulary there | e7 | t3-core.ts, t3-hf.ts, t4-* (manuals listed in TASK-LN-SRD-A2) |
| dcm-nsjj markArmor.ifUnable in the card runner | Vocabulary there | e3 | - |
| dcm-b9hc Companion die, range, type reach the runner | Vocabulary there | e3 (run.ts DamageRoll companion, companionRange) + e6 caller combatFeatures.prepare | - |
| dcm-q3t1 Otherworldly Ire rolls its count from the Favor | Vocabulary there | e3 (rollTargetCount choices) + featurePrompts.ts (e8) | warlock.ts |
| dcm-inou rerollHeld rerolls spent Slayer Dice | Vocabulary there | e3 | guardian-warrior.ts |
| dcm-rm9 tideTokens / moonPhase facts | Evaluators done (E5) | e8 (featureRunner fills, dcm-me3) + e3 (run.ts env copy, dcm-rs1z) | heritage-hf.ts |
| dcm-wut Surrounded, Melee weapon before the roll | `beforeYouRoll.weaponRange`, `weaponRange attacking` exist | e1 (match + fact dcm-aeg) | assassin-brawler.ts |
| dcm-kkx Non-stacking effect (Blight Seed) | `effect.stacking` runs in run.ts; nobody passes `effectsOn`; `replace` unapplied | e8 (featureRunner passes effectsOn) + e6 (replace, dcm-9z2z) | assassin-brawler.ts |
| dcm-awh Stance Fighter sets the stance | Vocabulary there, data done | e8 (featureRunner calls setStance, dcm-4xl) + e3 (run.ts plan step) | - |
| dcm-ffk Menacing Reach ends on a primary-weapon success | Vocabulary there, data done | e1 (roll paths fire roll ends, dcm-wn7) | - |
| dcm-733 Patron's Mantle situational advantage | Server done, data done | e1 (dice dialog situation boxes, dcm-cfpv; UI) | - |
| dcm-gov Otherworldly Ire targets after the dice | Vocabulary covered (`rolledFirst`) | e3 (with dcm-q3t1) | warlock.ts |
| dcm-fjh Any-trait reaction roll; At Ease Stress slot | `anyTrait`, `stressMax` exist | e3 (run.ts rolls the picked trait, dcm-a9c) + e4 (gainSlots, dcm-o3j) | guardian-warrior.ts |
| dcm-sa2 Weapon Specialist rerolls Slayer 1s | Vocabulary there | e3 (with dcm-inou) | guardian-warrior.ts |
| dcm-v17 Unstoppable's end with the die, classDie | Vocabulary there, flag data done | e8 (calls after D5 actions, classDie fact, dcm-4xl) | - |
| dcm-3i4 Enchanted Talisman, unlimited range | Vocabulary there, data done | e2 (window, dcm-ofo) | - |
| dcm-lk8 Lunar Phases moon die | Delegate done, data done | e8 (moonPhase fact, dcm-me3) | - |
| dcm-4qv Night's Glamour maintain | Engine pieces done, data done | e2 (offer before the end, dcm-t8c) | - |
| dcm-ii4 Circle of Power | Vocabulary there, data done | e4 (point arg, tokensGone, dcm-u2wx) + e8 (subject areas, dcm-me3) | - |
| dcm-qbn Pick which Prayer Dice to spend | Runner reads `heldDicePicks` | e8 (pass the picks) | - |
| dcm-78x Know the Tide tokens | Delegate done; number unfilled | e8 (+e3 rs1z) | heritage-hf.ts (max = tideTokens) |
| dcm-wjv Eye of the Storm ends on the caster's Severe | Vocabulary there, data done | e2 (incomingHits fires endsOnCaster, dcm-t8c) | - |
| dcm-bxp.99.19.1 Perfect Recall | Server done, data done | e1 (characters.moveCard / Hand pass recallRiders, dcm-cfpv) | - |
| dcm-eut Defensive stance buy-off | Vocabulary there | e5 (passives.ts reads from / buyOff) + e7 (attacker's pay prompt) | stances.ts |
| dcm-3ea Reliable Backup ends on a Presence Roll | Vocabulary there, data done | e1 (fire roll ends, dcm-wn7) + e6 (upgrade options, dcm-i2tv) | - |
| dcm-85u Sneak Attack ally near | Evaluator done, data done | e1 (rider facts, dcm-aeg) | - |
| dcm-bhp Cloaked | Vocabulary there, data done | e6 (replaceCondition, bearerAttacks end) + e4 (perObserver) | - |
| dcm-2z2 Companion stats | Vocabulary there, data done | e3 (with dcm-b9hc) | - |
| dcm-d1d Delegate reads the use's roll | Runner sends `DelegateRequest.roll` | e8 (delegate.ts, dcm-8dhe) | ranger-rogue.ts (delegate rangersFocus) |
| dcm-gvr Elemental Breath / Long Tongue as weapon attacks | Vocabulary there, data done | e8 (feature uses with a roll take riders, dcm-1kvg) | - |
| dcm-9l4 Kick / Tusks target within Melee | Evaluator done, data done | e1 (target distance fact, dcm-aeg) | - |
| dcm-bn1 Fangs is an attack; Feed narrowed | Vocabulary there, data done | e8 (dcm-1kvg) | - |
| dcm-5fc End another feature's effect | Runner done, data done | e6 (apply endEffect, dcm-9z2z) | - |
| dcm-i55 Slash and Burn +10 magic | Covered (`DamageChange.add.type`); hit-type merge unbuilt | e3 (run.ts fold) + e7 | t3-hf.ts (add type magic) |
| dcm-jog Backhanded Guidance on the Fear Die | Covered (`dieBonus fear`) | e7 (pcRolls uses on PC rolls, dcm-of7v); E1 Q1 (a matched result after a bonus) open | t3-hf.ts |
| dcm-3ou Ill Omen on the Fear Die | Covered (`dieBonus fear`, amount gmFear) | e7 (dcm-of7v) | t4-hf.ts |
| dcm-idz A PC under the GM's control | Vocabulary there (`Mod gmControl`) | e7; blocked on a user design answer (how a GM-controlled PC is spotlighted and attacks) | t4-hf.ts |
| dcm-a7o Target's Major threshold | `stat majorThreshold` resolves | e7 (adversary NumberEnv, dcm-8rh) | t3-core.ts |
| dcm-1yo Immovable Object | Vocabulary there | e4 (structured mod on instance effects, dcm-3p7s) | t3-core.ts |
| dcm-6ju Money Talks, Double or Nothing | Vocabulary there | e2 (Money Talks via dcm-5cn5) + e7 (Double or Nothing reroll on a PC roll) | t3-core.ts |
| dcm-63j Mind Meld spreads Stress to allies | Vocabulary there | e3 (markStress split) + e7 (would-mark-Stress hook) | t2-hf.ts |
| dcm-v27 Blink Beast duplicate token | Vocabulary there, data done | e4 (second token, dcm-3p7s) | - |
| dcm-7az Rip & Tear chain | Runner done, data done | e7 (chain prompts, dcm-e16o) | - |
| dcm-dv6 Fire keyword | Matching done, data done | e2 (hits carry the keyword, Fireproof) + e1 (PC attacks on Made of Straw) | heritage-hf.ts (drop Fireproof's check box) |
| dcm-mhn Crit on 19-20 | Vocabulary there, data done | e3 (rollOnce reads critRange) | - |
| dcm-icd Flee the scene | User answer 2026-10-31: remove from map and encounter, log fled | e7 (remove the instance, undoable) | - |
| dcm-cdz Passive condition on itself | Engine done in E7 | e1 (PC attacks read selfConditions) | - |
| dcm-2gn Trigger narrowings | Matching done | e1 (emit the event facts from the PC side) | t1-hf.ts, t2-hf.ts, t3-hf.ts, t4-core.ts (situation buttons to triggers) |
| dcm-51s Riders for creatures with its condition | Partly built | e7 (casterSpotlit riders, disadvantageAgainst.situation, best) | - |
| dcm-0gh Inventory steps | Plan step there | e7 (server writes inventory, dcm-0n1u) | t3-hf.ts (Expensive Failure, Trophy Hunter) |
| dcm-q0a Allies raise a save's Difficulty | Runner done, data done | e7 (saveRaisers, dcm-e16o) | - |
| dcm-1jg Deadly Drop after the PCs' next action | Vocabulary there, data done | e7 (hook after the PCs' next action) | - |
| dcm-xyw Attack mods keyed to the target | Engine pieces done | e7 (build attackedRiders from PCs' tags) | t3-hf.ts (Mark Target, Mist Weaver) |
| dcm-5xi Gate on a PC's Hope | Runner done, data done | e7 (hopeOf, dcm-e16o) + e4 (cards, dcm-x4ft) | - |
| dcm-145 Revive / Horde HP | Partly built | e7 (a defeated ally can be named) | t3-hf.ts (Wake the Fallen) |
| dcm-1ch On My Signal combined damage | Vocabulary there | e7 (groupAttack name / eachRolls) | t1-core.ts, t1-hf.ts |
| dcm-yea Immunities | Flags summed | e1 (enforce on PC damage / forced Stress) | - |
| dcm-gx3 Evolution | Vocabulary there | e7 (instance effect shape widen, validators/encounters.ts) | t3-hf.ts (Hellwing) |
| dcm-xp0 Tokens on a PC | Runner done, data done | e7 (store creature tokens, dcm-0n1u) + e4 (dcm-x4ft) | - |
| dcm-ttz Count creatures | Evaluator done, data done | e7 (adversary NumberEnv creatures, dcm-8rh) | t4-hf.ts (Relentless = PCs) |
| dcm-kti Conditions with riders on the bearer | Vocabulary there | e7 + e1 (dcm-mm0f), e7 (plan keeps condition mods, dcm-iedr) | t3-*, t4-* (manuals listed in TASK-LN-SRD-A2 under dcm-mm0f) |
| dcm-sos Gate on HP marked after the window | Vocabulary there | e7 (dcm-ehgy) | - |
| dcm-18i No free Armor Slot | Vocabulary there, data done | e3 (dcm-nsjj) | - |
| dcm-ofy Dark Army target range | `whenYouDealDamage.within` exists | e1 (dcm-76l5) | dread.ts (situation to within) |
| dcm-1o3 Dread-Touched on success with Fear | Vocabulary there; rider phase done for weapon attacks only | e1 (card rolls) | dread.ts (reaction to rider) |
| dcm-0ey Spectral Mist (action roll or scene end) | Vocabulary there | e1 (roll paths fire, dcm-wn7) | dread.ts (duration scene + endsOn actionRoll) |
| dcm-cwh Timejammer / Specter of the Dark | Vocabulary there, data done | e1 (dcm-wn7) | - |
| dcm-p1r Codex-Touched swap | Server done, data done | e3 (Hand dialog sends swapWith, dcm-aw16; UI) | - |
| dcm-cma Persistent areas on entry / crossing | Vocabulary there | e4 (walls dcm-3p7s, run entry steps, point arg) | codex.ts, dread.ts (walls, Rune Circle) |
| dcm-yzr Ground a flyer | Runner done, data done | e4 (PC Flying effect ends, dcm-x4ft) | - |
| dcm-y3e Parallela extra target | Server done, data done | e4 (Attack bar, dcm-jkhp; UI) | - |
| dcm-utu Until the bearer takes damage | Vocabulary there, data done | e2 (hits on PCs, dcm-t8c) + e1 (weapon attacks on instances, dcm-wn7) | - |
| dcm-f0m On Fire on the bearer's action | Vocabulary there, data done | e7 (adversary bearer acts, dcm-mm0f) | arcana.ts (drop the manual step) |
| dcm-rou Chain Lightning chain | Runner done, data done | e4 (pass chain links, dcm-x4ft; drop CHAIN_CARDS dcm-io4m) | - |
| dcm-3ft Adjust Reality after any roll | Vocabulary there, data done | e1 (another player's reaction on a roll, dcm-cfpv) | - |
| dcm-8x8 End a card's own effect | Runner done, data done | e6 (apply endEffect, dcm-9z2z) | - |
| dcm-uj0 Rune Ward's holder pays | Vocabulary there | e3 (paidBy, dcm-a9c) + e2 (unlimited, dcm-ofo) | arcana.ts (costs + paidBy instead of the hope step) |
| dcm-war Ward Die 8 spends the ward | Vocabulary there, data done | e3 (exhaust, dcm-a9c) + e4 (dcm-gl9) | - |
| dcm-c75 Words of Discord memory | Evaluator done, data done; E5 Q2 (how long) open | e4 (facts and memory, dcm-gl9) | - |
| dcm-7n7 Gates on card tokens | Evaluator done, data done | e6 (tokensGone, dcm-erhv) + e3 (gate, dcm-a9c) + e4 (cardTokens fact) | - |
| dcm-86z Encore's damage type | Vocabulary there | e3 (cardChoices, dcm-aw16) + e4 (cardRunner trigger.damageType) | grace.ts |
| dcm-raa Grace-Touched would force HP | Vocabulary there | e1 (dcm-gtmp) | grace.ts (stage would) |
| dcm-22q Grace-Touched Armor Slot for a Stress | User answer 2026-10-30; vocabulary there (`wouldMarkStress` + `convertMarks`) | e2 (window) + every Stress-marking path (cardRunner e4, featureRunner e8, rests): best as one cross-lane tracer | grace.ts |

### data-only (2)

| Bead | What it needs | Lane (wave 8) | SRD data (wave 9) |
|---|---|---|---|
| dcm-702 Death move / mark all HP | Vocabulary and engine there (deathMove, free hp) | - | t2-hf.ts (Accursed Caress), t3-hf.ts (Death Glare): a reaction on the countdown's trigger with markHp free + deathMove |
| dcm-2f3 Hydra lacks a condition | Done: card `not` (E5), adversary `lacks` (E7), data (SRD-A1/A2) | - (done; close at merge) | - |

### rule-question (1)

| Bead | What it needs | Lane (wave 8) | SRD data (wave 9) |
|---|---|---|---|
| dcm-13s Spirit Weapon range; its attacks | Vocabulary there; which attacks count is a rule question | (dcm-xbtw filed) | seraph-witch.ts |

### narrative (2)

| Bead | What it needs | Lane (wave 8) | SRD data (wave 9) |
|---|---|---|---|
| dcm-by2d SRD adversaries tier 1-2 story-only manuals | No mechanic | - | - |
| dcm-lezi SRD-C2 narrative manuals | No mechanic | - | - |

## Wave 8: beads per lane (primary and shared) and the files each lane touches

Beads per lane (a bead listed in two lanes has one half in each; the table says which half):

- **e1** (25): dcm-x7p, dcm-ssf, dcm-umti, dcm-gtmp, dcm-mm0f, dcm-yd5h, dcm-wut, dcm-ffk, dcm-733, dcm-bxp.99.19.1, dcm-3ea, dcm-85u, dcm-9l4, dcm-dv6, dcm-cdz, dcm-2gn, dcm-yea, dcm-kti, dcm-ofy, dcm-1o3, dcm-0ey, dcm-cwh, dcm-utu, dcm-3ft, dcm-raa
- **e2** (13): dcm-zi3k, dcm-kvx4, dcm-fbsr, dcm-bxp.99.19.4, dcm-5cn5, dcm-3i4, dcm-4qv, dcm-wjv, dcm-6ju, dcm-dv6, dcm-utu, dcm-uj0, dcm-22q
- **e3** (26): dcm-4yg4, dcm-5kxg, dcm-fbsr, dcm-va0f, dcm-nh44, dcm-b77, dcm-nsjj, dcm-b9hc, dcm-q3t1, dcm-inou, dcm-rm9, dcm-awh, dcm-gov, dcm-fjh, dcm-sa2, dcm-78x, dcm-2z2, dcm-i55, dcm-63j, dcm-mhn, dcm-18i, dcm-p1r, dcm-uj0, dcm-war, dcm-7n7, dcm-86z
- **e4** (24): dcm-xobk, dcm-z5a6, dcm-rx1k, dcm-lvgm, dcm-5yew, dcm-o44e, dcm-wuu, dcm-gtmp, dcm-fjh, dcm-ii4, dcm-bhp, dcm-1yo, dcm-v27, dcm-5xi, dcm-xp0, dcm-cma, dcm-yzr, dcm-y3e, dcm-rou, dcm-war, dcm-c75, dcm-7n7, dcm-86z, dcm-22q
- **e5** (3): dcm-nsqo, dcm-5kxg, dcm-eut
- **e6** (11): dcm-rx1k, dcm-rao5, dcm-o44e, dcm-8bv, dcm-b9hc, dcm-kkx, dcm-3ea, dcm-bhp, dcm-5fc, dcm-8x8, dcm-7n7
- **e7** (47): dcm-xobk, dcm-5jyp, dcm-nsqo, dcm-zi3k, dcm-z5a6, dcm-kvx4, dcm-wqgs, dcm-3ag5, dcm-qw4f, dcm-4yg4, dcm-k4x5, dcm-va0f, dcm-4c9m, dcm-vf7i, dcm-c8h3, dcm-nh44, dcm-b77, dcm-346, dcm-bxp.99.19.3, dcm-mm0f, dcm-yd5h, dcm-5cn5, dcm-ehgy, dcm-eut, dcm-i55, dcm-jog, dcm-3ou, dcm-idz, dcm-a7o, dcm-6ju, dcm-63j, dcm-7az, dcm-icd, dcm-51s, dcm-0gh, dcm-q0a, dcm-1jg, dcm-xyw, dcm-5xi, dcm-145, dcm-1ch, dcm-gx3, dcm-xp0, dcm-ttz, dcm-kti, dcm-sos, dcm-f0m
- **e8** (16): dcm-vf7i, dcm-40mj, dcm-bxp.99.19.4, dcm-q3t1, dcm-rm9, dcm-kkx, dcm-awh, dcm-v17, dcm-lk8, dcm-ii4, dcm-qbn, dcm-78x, dcm-d1d, dcm-gvr, dcm-bn1, dcm-22q

Main source files (from round 1's TASK-LN-E1..E8 and the beads' own notes):

| Lane | Files |
|---|---|
| e1 | `convex/lib/combatActions.ts` (riderPhase, runRiderPart, attack path), `convex/combatCards.ts`, `convex/lib/cardHand.ts`, `convex/lib/rolls.ts`, `convex/characters.ts` (`moveCard` recallRiders); UI: the dice dialog's situations (dcm-733) |
| e2 | `src/lib/domain/adversary-actions/window.ts`, `src/lib/domain/adversary-actions/severity.ts`, `convex/lib/incomingHits.ts`, `convex/lib/adversaryHits.ts`, `convex/lib/validators/combatRequests.ts` (dcm-5cn5 stored answer) |
| e3 | `src/lib/domain/card-effects/run.ts`, `convex/lib/cardChoices.ts`, `src/components/combat-map/actions/hand/dialog.tsx` (dcm-p1r swapWith) |
| e4 | `convex/lib/cardRunner.ts`, `convex/combatAreas.ts`, `src/lib/domain/feature-effects/areas.ts`, `convex/lib/combatVision.ts`, `convex/combatTokens.ts` (`move`), `convex/lib/validators/combatMaps.ts` (dcm-3p7s); UI: Attack bar `riders.tsx` (dcm-y3e / dcm-jkhp) |
| e5 | `src/lib/domain/card-effects/availability.ts`, `src/lib/domain/combat-actions/numbers.ts`, `src/lib/domain/feature-effects/passives.ts`, `src/lib/domain/characters/slots.ts` |
| e6 | `src/lib/domain/characters/expiry.ts`, `convex/lib/cardRows.ts`, `convex/lib/stanceDrop.ts`, `convex/combatFeatures.ts` |
| e7 | `src/lib/domain/adversary-effects/run.ts`, `src/lib/domain/adversary-actions/features.ts`, `convex/lib/adversaryFeatures.ts`, `convex/lib/adversaryActions.ts`, `convex/adversaryActions.ts`, `convex/lib/validators/encounters.ts` |
| e8 | `convex/lib/featureRunner.ts`, `src/lib/domain/feature-effects/run.ts`, `src/lib/domain/feature-effects/delegate.ts`, `convex/lib/featurePrompts.ts`, `convex/featurePrompts.ts`, `convex/lib/companion.ts`, `src/lib/domain/rest/*`, `convex/rests.ts`; the level-up card flow for dcm-40mj |

Collisions to settle before wave 8:

1. `convex/adversaryActions.ts`: dcm-5cn5 (e2) needs the `respond` args validator there, which is e7's file. Give
   dcm-5cn5 to e7, or let e2 own that one validator edit and e7 stay out of `respond`.
2. `convex/lib/validators/encounters.ts`: e7 widens `instanceEffectValidator` for stored mods (dcm-yd5h, dcm-gx3,
   dcm-e75), and e4 needs structured `forcedMoveReduce` / `moveLimit` on instance effects (dcm-1yo, dcm-3p7s). One lane
   (e7) should do the whole widen (widen, migrate, narrow, rule 7) with e4's fields in it.
3. `src/lib/domain/card-effects/run.ts` is e3's only: every run.ts half of an e7 / e8 / e5 bead (dcm-mhn critRange,
   dcm-i55 type merge, dcm-63j split, dcm-4yg4 chain, dcm-b9hc companion, dcm-awh plan step, dcm-rs1z env copy) is
   listed under e3.
4. `src/lib/domain/feature-effects/passives.ts`: dcm-eut's from / buyOff reading is e5's; e7 builds only the attacker's
   pay prompt.
5. `convex/combatTokens.ts` `move`: e4 owns the token moves (withCaster drags, Shield Wall's would-move hook that emits
   `pcMoves` `stage: "would"`); e7 runs the triggered use. The event shape (`AdversaryEvent` in features.ts) is e7's.
6. UI: dcm-733 (dice dialog boxes), dcm-y3e / dcm-5dg (Attack bar, dcm-jkhp), dcm-p1r (Hand dialog), dcm-qbn (Prayer Dice
   picker) need UI; the combat UI overhaul (dcm-bxp.99.32) waits on the user's design, so these may wait too.
7. e7 carries 47 beads (25 of them as a shared half). Splitting it in two (pure `adversary-effects/run.ts` +
   `features.ts` vs. the server `convex/lib/adversary*.ts` + validators) would keep it in step with the other lanes.

Beads blocked on a user answer (the lane should ask first): dcm-idz (how a GM-controlled PC is spotlighted and attacks),
dcm-jog / dcm-3ou (E1 Q1: is a matched result after a die bonus a critical?), dcm-c75 (E5 Q2: how long Words of Discord
remembers), dcm-8bv (E6 Q2: now `endFear` carries the book's amount; whether the GM intent reads it).

## Wave 9: SRD data per file

- `t1-core.ts`: dcm-xobk, dcm-nsqo, dcm-346, dcm-1ch
- `t2-core.ts`: dcm-5jyp, dcm-nsqo
- `t2-hf.ts`: dcm-5jyp, dcm-zi3k, dcm-z5a6, dcm-63j, dcm-702, dcm-2gn
- `t4-hf.ts`: dcm-kvx4, dcm-wqgs, dcm-3ag5, dcm-qw4f, dcm-4yg4, dcm-k4x5, dcm-5kxg, dcm-3ou, dcm-idz, dcm-ttz
- `t4-core.ts`: dcm-fbsr, dcm-wuu, dcm-2gn
- `t3-hf.ts`: dcm-va0f, dcm-346, dcm-wuu, dcm-ehgy, dcm-i55, dcm-jog, dcm-702, dcm-2gn, dcm-0gh, dcm-xyw, dcm-145, dcm-gx3
- `t3-core.ts`: dcm-4c9m, dcm-wuu, dcm-5cn5, dcm-ehgy, dcm-a7o, dcm-1yo, dcm-6ju
- `midnight.ts`: dcm-rx1k, dcm-5yew, dcm-o44e
- `beastforms.ts`: dcm-rao5, dcm-bxp.99.19.3, dcm-bxp.99.19.4
- `ranger-rogue.ts`: dcm-vf7i, dcm-d1d
- `seraph-witch.ts`: dcm-lvgm, dcm-13s
- `sage.ts`: dcm-5yew
- `blade.ts`: dcm-40mj
- `grace.ts`: dcm-c8h3, dcm-gtmp, dcm-86z, dcm-raa, dcm-22q
- `t1-hf.ts`: dcm-nh44, dcm-2gn, dcm-1ch
- `codex.ts`: dcm-b77, dcm-8bv, dcm-cma
- `assassin-brawler.ts`: dcm-8bv, dcm-wut, dcm-kkx
- `druid-sorcerer.ts`: dcm-x7p, dcm-ssf, dcm-umti
- `warlock.ts`: dcm-q3t1, dcm-gov
- `guardian-warrior.ts`: dcm-inou, dcm-fjh, dcm-sa2
- `heritage-hf.ts`: dcm-rm9, dcm-78x, dcm-dv6
- `stances.ts`: dcm-eut
- `dread.ts`: dcm-ofy, dcm-1o3, dcm-0ey, dcm-cma
- `arcana.ts`: dcm-f0m, dcm-uj0

## Tests

`tests/unit/card-effects/types-widen-2.test.ts`: a V2 block writes each needs-term bead's mechanic with the new pieces
(the types are the test) and checks that the V2 step kinds end `STEP_KINDS` and are in `ADVERSARY_STEP_KINDS`; the
fallbacks hold: `markedHp` and `recorded` read 0 (the old counts still read), `optionRemoved` is undefined,
`forcedAttack` / `changeForm` / the inventory gifts become manual prompts (no inventory plan step), `withCaster` is a
labelled move prompt, `allEven` / `allOdd` read every die, and the new mods travel on an effect as written.
`tests/unit/card-effects/types-widen.test.ts` (V2 owns it): two assertions that assumed V's step kinds end the list now
bound V's slice and count V2's two kinds. Every other test passes unchanged.

## QUESTIONS

None blocking. One rule question filed: dcm-xbtw (Spirit Weapon attacks, CB p.44; from dcm-13s).
