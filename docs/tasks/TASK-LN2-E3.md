# TASK LN2-E3: steps, choices and saves, round 2 (the run.ts halves)

Plan `.omc/plans/lanes-2.yaml`, wave 8, tracer E3 (label `w1-e3-steps-saves`), on V2's vocabulary
(`docs/tasks/TASK-LN-V2.md`). E3 owns `src/lib/domain/card-effects/run.ts`, so this round does the runner half of every
bead V2's triage listed under e3, and turns V2's manual-prompt fallbacks into real plan steps where the runner can.
No SRD entry uses the new terms yet (wave 9 switches the data), so the tests use inline fixtures
(`tests/unit/card-effects/lane-e3-round2.test.ts`). CB = Core Book, HF = Hope & Fear (printed pages).

Files: `run.ts`, `convex/lib/cardChoices.ts` (`triggerDamageType`), the test file and this doc. No types.ts, no
`src/lib/srd/**`, nothing outside E3's owns.

## What the runner reads now

- **New `RunContext` fields** (optional; absent behaves as before): `numbers` (cardRunner `BuiltRun.numbers`: `self`,
  `byId`, `creatures`), `payers` (`Partial<Record<Payer, PayerState>>`), `modsOn` (the lasting mods each creature
  carries), `pointsOf` (the `TargetSpec.points` each creature stands in). `limitKeys.until` takes the whole `Limit`.
- **New `ActorState` fields:** `tideTokens`, `classDice`, `stats`, `companionDamageType`; `dieSides.companion`.
- **`env()`** fills `NumberEnv` with the actor's and the target's slot maximums, stats, gold and tokens, the map's
  creatures, `classDice`, `tideTokens` and `dualityDice` (this move's roll, else the host roll), so numbers.ts (E5)
  resolves `stat`, `free`, `gold`, `creatureCount`, `classDie`, `tideTokens` and `dualityDie` from them.
- **New plan entries:** `setStance`, `exhaust`, `forcedAttack`, `changeForm`, `heldReroll`; `inventory` ops `giveGold` /
  `giveItem` (+ `text`); `condition` gains `mods`, `endsOnCaster`, `endsOnRoll`, `escape`, `recorded`, `endFear`;
  `effect` gains `sharedGrant`, `endFear`; `pay.phase` may be `upfront` with a `payerId`.
- **`rollTargetCount(use, actor, rng, choices?)`** takes the player's choices (Otherworldly Ire's Favor count).

## Beads

| Bead | State | How |
|---|---|---|
| dcm-rs1z Limit to untilOf, env copies | done | `untilOf(limit)` for the use's and an optional's limit; env copies listed above. |
| dcm-4zti numbers and payers | done (runner) | `RunContext.numbers` / `payers` read in `env()` and the cost checks. cardRunner passing them is E4's one line (follow-up). |
| dcm-a9c exhaust, paidBy, anyTrait, target gate, duality dice | done (runner) | (1) `targetCheck` already went to `stateCheckMet` with the recipient's facts; (2) `paidBy` on the use and on `pay` steps: the payer pays, checked with `unaffordableBy` when `payers` is given, refused / stopped otherwise; (3) `exhaust` writes the entries (as `exhaustKey`, with the card's `until`) and a feed step; (4) an `anyTrait` reaction rolls `context.roll.trait`; (5) `dualityDice` from the host roll. |
| dcm-uj0 Rune Ward's holder pays | done (runner) | `CardUse.paidBy` (see a9c). Data: arcana.ts. |
| dcm-war Ward Die 8 spends the ward | done (runner) | `exhaust` step (see a9c). Data: arcana.ts. |
| dcm-nsjj / dcm-18i markArmor.ifUnable | done (runner) | A recipient with no free Armor Slot runs `ifUnable` (its `targets` is them). Data: Spit Acid entries. |
| dcm-inou / dcm-sa2 rerollHeld | done (runner) | A `modifyRoll` `rerollHeld` after a use spent held dice of that kind rerolls those at or under `atMost` once each; `spent: heldDie` follows; plan `heldReroll`. Without spent dice it stays a fold. Data: guardian-warrior.ts. |
| dcm-mhn crit on 19-20 | done (runner) | An `adversaryAttack` roll crits at `critRange` or above. E7 reads it on adversary attacks outside run.ts. |
| dcm-fjh any-trait reaction | done (runner) | See a9c (4). The At Ease Stress slot is E4's (dcm-o3j). |
| dcm-b9hc / dcm-2z2 companion die, type | done (runner) | `roll: {kind: "companion"}` rolls `dieSides.companion` (default d6) x Proficiency, typed `companionDamageType` (default physical). The callers fill them (E6 combatFeatures.prepare / E8). `companionRange` is targeting (server). |
| dcm-q3t1 / dcm-gov Otherworldly Ire count | partly | `rollTargetCount` reads the choices; featurePrompts (E8) must pass the Favor choice and pay it with the roll. |
| dcm-rm9 / dcm-78x tideTokens | done (runner) | `ActorState.tideTokens` reaches the numbers; featureRunner fills it (E8, dcm-me3). |
| dcm-awh Stance Fighter | done (runner) | `setStance` becomes plan `setStance` (named stance or the pick in `choice`; neither: manual prompt). featureRunner applies it (E8, dcm-4xl). |
| dcm-fbsr Unstuck doubles spends and marks | done (runner) | `modsOn` `marksMultiplier` multiplies the payer's Hope / Stress / HP / Armor costs and the recipient's `markHp` / `markStress` / `markArmor` steps. Marks on hits are E2's. |
| dcm-5kxg can't spend Hope / clear | done (runner) | `cannotSpendHope` refuses a Hope cost (use, optional, pay, chooser); `cannotClearHp` / `cannotClearStress` turn a clear into a manual line. |
| dcm-63j Mind Meld spreads Stress | done (runner) | `markStress` `distribution: "split"` as `markHp`'s (splits, prompt for missing shares). E7 builds the would-mark hook. |
| dcm-nh44 Stone of Omens split | done (runner) | `hope` gain `distribution: "split"` goes out by `splits`, never past the total; a split prompt asks for missing shares. |
| dcm-va0f Unleash Hellfire | done (runner) | `damage.perArea` with `pointsOf`: one roll per point, each creature takes the sum of its points'. Without `pointsOf` it is an ordinary damage step. The server must send `pointsOf` (E4 / E7). |
| dcm-4yg4 chain while a check holds | done (runner) | `repeat.until: "checkFails"`: after each link the `check` (fresh `dice`, or the link's own damage dice) must hold; `perLink` `add` changes each link's pending damage once per earlier link (other change kinds are folds). E7 builds the adversary chain prompts. |
| dcm-b77 Banish's return | done (runner) | `condition.record` is resolved into plan `recorded`; a `recorded` number in the condition's mods reads it. E7 runs the bearer riders. |
| dcm-iedr condition keeps mods / ends (runner half) | done (runner) | The condition entry carries `mods` (resolved), `endsOnCaster`, `endsOnRoll`, `escape`. Storing them is E7 / E6's. |
| dcm-8bv endFear | done (runner) | `endFear` resolved on `condition` and `effect` entries. |
| dcm-rao5 shared grant | done (runner) | `effect.sharedGrant` carried. Ending it on all is E6's. |
| dcm-vf7i Contacts Everywhere gifts | done (runner) | `giveGold` (default 1 handful) / `giveItem` (`text`) become `inventory` entries; the server writes them (E8). |
| dcm-c8h3 / dcm-zi3k forced attack | done (runner) | `forcedAttack` lists the attackers and the `picked` victims (never an attacker; none: the GM picks). The server prompts / runs the attack (E7). |
| dcm-3ag5 Transform | done (runner) | `changeForm` on an adversary becomes plan `changeForm`; on a PC a manual line. E7 swaps the stat block. |
| dcm-86z Encore's damage type | done (runner + choice) | `triggerDamageType` choice id parsed; a `sameAsTrigger` damage typed `weapon` takes `trigger.damageType`. cardRunner filling `trigger.damageType` is E4's. Data: grace.ts (Encore's damage `type: "weapon"`). |
| dcm-i55 Slash and Burn type merge | done (runner) | Already: `modifyDamage add` with a `type` makes pending damage `both`, and the fold carries the step. E7 merges hit types. |
| dcm-7n7 gates on card tokens | done (runner) | Already: a `tokens` check reads `cardTokens` (self) and named tokens. |
| dcm-p1r Codex-Touched swap (dialog) | not done | Labelled `combat-ui`: waits on the user's combat UI design (dcm-bxp.99.32). dcm-aw16 (1) with it. |

## Follow-ups

- dcm-q40t (lane E4): cardRunner passes `numbers`, `payers`, `modsOn`, `pointsOf`, `trigger.damageType` and applies the
  new plan entries.
- dcm-pqbo (lane E8): featureRunner fills `tideTokens`, `classDice`, `stats`, the companion die / type; featurePrompts
  passes Otherworldly Ire's Favor choice; applies `setStance` and the inventory gifts.
- dcm-f70y (lane E7): runs `forcedAttack`, `changeForm` and the condition entry's new fields on instances.
- dcm-p1r / dcm-aw16 (1): the Hand dialog's vault swap waits on the combat UI design.

## Data switches ready for wave 9

grace.ts (Encore `sameAsTrigger` typed `weapon`), arcana.ts (Rune Ward `paidBy` + `exhaust`), guardian-warrior.ts
(Weapon Specialist `rerollHeld`), warlock.ts (Otherworldly Ire count from the Favor choice), the Spit Acid entries
(t1-core, t2-core, t3-core, t2-hf, t3-hf: `markArmor.ifUnable`), t3-hf.ts (Unleash Hellfire `perArea`), t4-hf.ts
(Lightning Strike / Bolt `checkFails`; Ravenous / Afflicted flags), t2-hf.ts (Mind Meld split), t1-hf.ts (Stone of Omens
split), t4-core.ts (Unstuck `marksMultiplier`), codex.ts (Banish `record`), Eye of the Sage `critRange`, Attack of
Opportunity `anyTrait`, Contacts Everywhere gifts, Words of Discord / Tentacle Rays `forcedAttack`, Transform
`changeForm`, Stance Fighter `setStance`, Bird's-Eye View `sharedGrant`, Marked for Death `endFear`.

## QUESTIONS

None. Lightning Strike (HF p.91) reads "the Titan makes this attack against a different target … Each time the
lightning bounces, decrease the damage it deals by 1d10": each bounce is a new attack, so the wave-9 entry gives the
follow-up its own roll (its damage is rolled again, as Double Swipe's) and `perLink` takes 1d10 off per earlier bounce.
