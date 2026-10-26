# TASK FE-ancestry-core: Feature effects, Core Book ancestries (18 ancestries, 36 features)

Plan `.omc/plans/sheet-drawer.yaml`, tracer FE-ancestry-core (depends on SD1; bead dcm-bxp.99.19). Book pages are printed
pages; CB = Core Book. The core ancestries are on CB p.53 (Clank) to p.70 (Simiah); mixed ancestry is on CB p.71.

## What landed

| File | What |
|------|------|
| `src/lib/srd/feature-effects/ancestry-core.ts` | `ANCESTRY_CORE_EFFECTS`: 27 entries (19 combat + 8 passive), each quoting its feature with the page |
| `tests/unit/feature-effects/ancestry-core.test.ts` | 31 tests: the table matches the classification exactly (a missing or extra id fails); mixed and single ancestries resolve through `owned()`; every entry runs through `runFeature` with `queueRng`, and the dice queue must be used up exactly |

No vocabulary type changed. Four gaps became `manual` steps, situation confirmations or notes, each with a bead (below).

User answers implemented: **Q1** Luckbender, Fearless, Adaptability and Internal Compass are after-roll reactions
(`afterAllyRolls` / `afterYouRoll`), for SD5's after-roll step. **Q2** Wings and Danger Sense answer after the attack roll
(`stage: "rolled"`), in the reaction window (SD4). **Q3** Luckbender is stored as `feat:ancestry:faerie:luckbender` until
`session`, Danger Sense as `feat:ancestry:goblin:danger-sense` until `rest`. **Q6** Increased Fortitude halves through
`modifyDamage halve`, which folds `ceil(incoming / 2)` (13 → 7). **Q9** Kick's knock-back is a `move` prompt. **Q13** Kick,
Tusks and Charge confirm what the engine can't see (a check box). **Q16** Wings requires `{kind: "flying"}`, which reads
the drawer's Flying toggle (`facts.flying`).

Rules used (quoted briefly): CB p.107 "you can spend 3 Hope to take half as much damage instead" (incoming damage) and
"round up unless otherwise specified"; "When a feature allows you to reroll a die, you always take the new result"; CB
p.104 "roll damage once and apply the total to each target" (Elemental Breath's group); CB p.91 Minor damage marks 1 Hit
Point (Thick Skin); CB p.102 "temporarily" (Retracting Claws); CB p.71 "You must choose the first feature from one ancestry
and the second from another" (mixed ancestries come through `owned()`).

## Scope: which core features have an entry here

- **27 entries**: every core ancestry feature classified combat or passive in `classification.ts`, except Luckbringer.
- **Luckbringer** (halfling, CB p.64, passive): no entry here. FE-heritage-hf's acceptance names it ("Know the Tide and
  Luckbringer delegated to the session features"), and two entries for one id throw in `mergeFeatureTables`. The test
  lists it as owned elsewhere. **Orchestrator: confirm FE-heritage-hf wrote it**; if it did not, it is a two-line
  addition here (see Questions, QA1).
- **Out of combat** (Efficient, Celestial Trance, Dread Visage, Natural Climber, Fungril Network): FE-heritage-hf's
  roll-option and rest-trigger entries (its acceptance lists Efficient, Celestial Trance, Dread Visage and Natural
  Climber).
- **Narrative** (Caprine Leap, Death Connection, Ribbet Amphibious): text only, no entry.

## Features and readings

| Page | Feature | Activation | Reading |
|---:|------|-----------|---------|
| 53 | Purposeful Design | passive | no mods; a `manual` note "+1 to the Experience you chose" (gap dcm-t6q) |
| 54 | Scales | reaction `whenYouWouldTakeDamage` severe | 1 Stress; `adjustHpMarked fewer 1` (NV4) |
| 54 | Elemental Breath | action | Instinct Roll vs each target's Difficulty; targets `any` enemies within Very Close; on a hit `d8 × Proficiency` magic, rolled once (gap dcm-gvr) |
| 55 | Thick Skin | reaction `whenYouWouldTakeDamage` minor | 2 Stress; `adjustHpMarked fewer 1` (Minor marks 1 HP, so it marks none) |
| 55 | Increased Fortitude | reaction `whenYouWouldTakeDamage` physical | 3 Hope; `modifyDamage halve` → fold `ceil(incoming / 2)` (Q6) |
| 56 | Quick Reactions | rider `beforeYouRoll reaction` | 1 Stress; `modifyRoll advantage` |
| 57 | Luckbender | reaction `afterAllyRolls` Close, `includeSelf` | once per session; 3 Hope; `modifyRoll reroll all` on the roller (`triggerSubject`) |
| 57 | Wings | reaction `whenAttacked rolled` | requires flying (Q16); 1 Stress; `modifyRoll evasion +2` against that attack |
| 58 | Kick | rider `whenYouAttack success` | requires the situation "The target is within Melee range" (gap dcm-9l4); 1 Stress; `+2d6` damage; `choose` knock back yourself or the target to Very Close (`move` prompt) |
| 59 | Charge | action | requires the situation "You move from Far or Very Far range into Melee range with one or more targets"; Agility Roll vs the GM's Difficulty; targets all enemies within Melee; on a success an optional Stress deals `1d12` physical to each (QA2) |
| 59 | Unshakable | auto `wouldMarkStress` | `check 1d6 ≥ 6` → `manual` "don't mark that Stress" (gap dcm-qq3) |
| 61 | Shell | passive | `majorThreshold` and `severeThreshold` `+ Proficiency` |
| 61 | Retract | action | 1 Stress; effect "Retracted into your shell" (physical resistance, `actionDisadvantage`, `cannotMove`), duration `manual`, ended by its End button ("You come out of your shell") |
| 62 | Endurance | passive | no mods: `slots.ts` adds the HP slot once (`ancestry:giant:0`) |
| 62 | Reach | passive | `set meleeRange 1` (Very Close, NV10) |
| 63 | Surefooted | passive | `flag ignoreAgilityDisadvantage` |
| 63 | Danger Sense | reaction `whenCreatureAttacked` self or ally within Very Close, `rolled` | once per rest; 1 Stress; `modifyRoll reroll all` on the attacker (`triggerSource`) |
| 64 | Internal Compass | reaction `afterYouRoll action` | `modifyRoll reroll hope ifAtMost 1`; a reaction, not `auto` as the classification's `how` says, because "you can" and a 1 on both dice is a critical the player may keep (QA3) |
| 65 | High Stamina | passive | no mods: `slots.ts` adds the Stress slot once (`ancestry:human:0`) |
| 65 | Adaptability | reaction `afterYouRoll action failure` | requires `rollUsedExperience`; 1 Stress; `modifyRoll reroll all` |
| 66 | Fearless | reaction `afterYouRoll action withFear` | 2 Stress; `modifyRoll withHope` |
| 67 | Feline Instincts | rider `afterYouRoll agility` | 2 Hope; `modifyRoll reroll hope` |
| 67 | Retracting Claws | action | Agility Roll vs one enemy in Melee; on a hit Vulnerable `temporary` |
| 68 | Sturdy | passive | requires `hpUnmarkedAtMost 1`; `disadvantageAgainst attack` (SD2's adversary engine reads it) |
| 68 | Tusks | rider `whenYouAttack success` | requires the situation "The target is within Melee range" (gap dcm-9l4); 1 Hope; `+1d6` damage |
| 69 | Long Tongue | action | 1 Stress; Finesse Roll vs one enemy within Close; on a hit `d12 × Proficiency` physical (gap dcm-gvr) |
| 70 | Nimble | passive | `evasion +1` (SD2 adds it in derived stats) |

## Manual steps and vocabulary gaps (beads, label `feature-effects vocabulary-gap`)

- **dcm-qq3** Unshakable: no outcome cancels the Stress about to be marked (`negate` has no `stress`). The d6 rolls by
  itself; a 6 shows the manual step "Unshakable rolled a 6: don't mark that Stress".
- **dcm-t6q** Purposeful Design: no Mod raises one Experience. A passive use with a manual note; the player adds the +1 to
  the Experience on the sheet.
- **dcm-9l4** Kick, Tusks: no state check for "a target within Melee range" (`whenYouAttack.weaponRange` covers Melee
  weapons only, not a spell attack on a Melee target). The player confirms it (Q13).
- **dcm-gvr** Elemental Breath, Long Tongue: a feature that is its own weapon can only be a `trait` roll (RollSpec
  `attack` needs a primary or secondary weapon), so `rollMatches("attack" | "weaponAttack")` is false for them and attack
  riders (Tusks, Kick, Rage Up, Sneak Attack) may not be offered on these attacks. SD5 should know this.

## Questions (open rulings; the entries follow option (a) until answered)

**QA1. Luckbringer's entry: here or in FE-heritage-hf?**
- Book: CB p.64, Luckbringer: "At the start of each session, everyone in your party gains a Hope." The session features
  already apply it (`src/lib/domain/session-features/luckbringer.ts`).
- Plan: this tracer's goal says every core combat or passive feature; FE-heritage-hf's acceptance tests "Luckbringer
  delegated to the session features".
- Options: **(a)** FE-heritage-hf writes it (this table leaves it out; the test says so). (b) This table writes it (an
  `auto` use on `timing sessionStart` that notes the session features apply it), and FE-heritage-hf drops it. (c) No entry:
  it stays passive text, the session features keep it.

**QA2. Charge: is the token moved before or by the Agility Roll?**
- Book: CB p.59, Charge: "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with one
  or more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range."
- The use's targets ("all within Melee") are read where the token stands when Charge is used.
- Options: **(a)** The player moves the token into Melee first (Q9 prompt), then uses Charge: the confirmation names the
  run, the Agility Roll decides it, and on a failure the GM moves the token back (undo). (b) Charge starts at range: the
  player picks the square, the roll is made, and on a success the server moves the token and then picks the targets in
  Melee of the new square (needs a server step this table can't express). (c) Charge is a manual step after a normal
  Agility Roll.

**QA3. Internal Compass: can a rerolled 1 be rerolled again?**
- Book: CB p.64, Internal Compass: "When you roll a 1 on your Hope Die, you can reroll it." CB p.107: "When a feature
  allows you to reroll a die, you always take the new result."
- Options: **(a)** Yes: it has no limit, so each new 1 offers it again. (b) Once per roll: the new result stands even when
  it is a 1.

**QA4. Purposeful Design's +1: already on the sheet?**
- Book: CB p.53, Purposeful Design: "At character creation, choose one of your Experiences that best aligns with this
  purpose and gain a permanent +1 bonus to it."
- Options: **(a)** The player enters it in the Experience's value at creation; the entry is a reminder (today). (b) The
  sheet stores which Experience was chosen and derived stats add the +1 (a sheet field and a Mod; follow-up of dcm-t6q).

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm vitest run --maxWorkers=2 --testTimeout=60000`,
`pnpm tracer:guard .omc/plans/sheet-drawer.yaml FE-ancestry-core`.
