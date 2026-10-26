# TASK SD FE-ranger-rogue: Feature effects of Ranger and Rogue

Plan `.omc/plans/sheet-drawer.yaml`, tracer FE-ranger-rogue (wave 3, depends on SD1). Bead `dcm-bxp.99.19`. Status:
Review.

The Ranger and Rogue effect table holds one entry for each of the 20 features the classification marks combat or
passive. The other 2 (Path Forward, Well-Connected) are narrative. Every entry quotes its feature with the printed page
and uses only the SD0/SD1 vocabulary, which this tracer does not change. Every entry is tested through `runFeature` with
fixed dice.

## Files

| File | What |
|------|------|
| `src/lib/srd/feature-effects/ranger-rogue.ts` | `RANGER_ROGUE_EFFECTS` (20 entries), `RANGER_ROGUE_IDS`, `RANGER_ROGUE_SITUATIONS`, `FOCUS_TAG`. |
| `tests/unit/feature-effects/ranger-rogue.test.ts` | 26 tests: the id set against the classification, source / owner / card against `owned()`, a no-throw sweep over every use, and one or more tests per feature. |

## User answers implemented

- **Q1 (a)**: Ranger's Focus reroll and Contacts Everywhere's +3 die are after-roll riders (`afterYouRoll`).
- **Q4 (a)**: the Companion's Command uses run from the companion's token (`actor: "companion"`). Battle-Bonded reads the
  companion's reach (`inCompanionReach`). Loyal Friend picks the companion (`pick.companion`).
- **Q9 (a)**: Sneak Attack is `auto` (it says "add", so it is not optional). Cloaked is passive; the map decides when it
  starts and ends (see the gaps below).
- **Q13 (a)**: situations the engine can't read yet are check boxes (`RANGER_ROGUE_SITUATIONS`). When the engine knows
  the fact (`hasCondition`, `featureEffect`), it decides and shows no box.
- **Q14 (a)**: Dark Cloud is an `area` step with `blocksSight`.
- **Q3 / Q7**: the limits are long rest (Loyal Friend) and session (Contacts Everywhere, 3 with Reliable Backup).

## Entries (book text: CB p.38-43, printed pages)

| Feature | Page | Uses | Reading |
|---|---|---|---|
| Hold Them Off (Hope) | 38 | rider `whenYouAttack` success + weapon | 3 Hope; `addTargets` 2, same roll, `damage: same` (NV18). |
| Ranger's Focus | 38 | `main` action; `stress` auto; `reroll` rider | 1 Hope, weapon attack vs the target's Difficulty; on a hit, weapon damage and the temporary tag `Ranger's Focus` (`exclusive`). `stress`: when you deal damage to a creature with the tag, it marks 1 Stress. `reroll`: after a failed attack on your Focus, reroll the Duality Dice (fold) and clear the tag. |
| Companion | 38, 40 | `attack`, `command` (actor companion) | Spellcast Roll (against the target's Difficulty for an attack, the GM's for any other action). An optional Companion Experience is a chosen number added to the roll that costs 1 Hope when above 0. Attack damage is Proficiency × d6, physical (the level-1 values; SD-C substitutes the companion sheet's). A success with Hope adds the advantage reminder as a manual step. |
| Expert Training, Advanced Training | 38 | passive, no mods | Build time: the companion sheet's `bonusTraining`. |
| Battle-Bonded | 38 | passive | +2 Evasion `versus inCompanionReach, attacksByThem` (NV9). |
| Loyal Friend | 38 | reaction `whenAllyWouldTakeDamage` close + self | Once per long rest; a `choose` step sets the direction: you take the companion's damage (`redirectDamage` self), or the companion takes yours (`redirectDamage` picked companion). |
| Ruthless Predator | 39 | `main` rider before damage; `severe` auto | Mark 1 Stress for Proficiency +1. When you deal Severe damage to an adversary (`whenEnemyTakesDamage severe byYou`), it marks 1 Stress. |
| Elusive Predator | 39 | passive | +2 Evasion `versus tagged Ranger's Focus, attacksByThem`. |
| Apex Predator | 39 | rider before attack | Requires that the target is your Focus; 1 Hope; the GM loses 1 Fear `when: success` (the host attack's success). |
| Rogue's Dodge (Hope) | 42 | action | 3 Hope; `delegate roguesDodge` (D5 writes the `until: hit` effect, and its rest hook ends it). |
| Cloaked | 42 | passive, no mods | The map engine owns it (gap below). |
| Sneak Attack | 42 | auto `whenYouAttack` success | Situation box; `modifyDamage add` (tier)d6, using `byTier [1,2,3,4]`. |
| Shadow Stepper | 42 | action | Situation box; 1 Stress; pick a point within Far; teleport prompt; Cloaked (manual end). Upgrade: Fleeting Shadow sets the range to Very Far (NV3). |
| Dark Cloud | 42 | action | Spellcast (15); on a success, an area centred on you, radius Close, side all, `blocksSight`, temporary. |
| Adrenaline | 42 | passive | Requires Vulnerable (engine-read); damage + level. |
| Fleeting Shadow | 42 | passive | +1 Evasion (SD2 replaces derived.ts' bonus); the range upgrade sits on Shadow Stepper. |
| Vanishing Act | 42 | action | 1 Stress; Cloaked `duration: rest, endsOn: rollWithFear`; clears Restrained. |
| Contacts Everywhere | 43 | `main` action + riders `die`, `snipe`, `shield`, `backup` | Once per session, choose a benefit: supply (manual), die (an effect for the next roll; the rider adds +3 to the Hope or Fear Die), snipe (an effect ending on `dealDamage`; the auto adds 2d8). The riders require the waiting effect's `option` (`featureEffect`). |
| Reliable Backup | 43 | passive, no mods | Upgrades on Contacts Everywhere: `limitTimes: 3`, plus the options shield (an effect ending on `markHp`; the reaction is `adjustHpMarked fewer 1`, NV4) and backup (a manual end; the rider sets a d20 Hope Die, with a "conversation" box). |

## Manual steps and engine notes

- Companion: "if your next action builds on their success, you gain advantage" is a manual step (situational).
  Contacts Everywhere supply is a manual step.
- Ranger's Focus "You know precisely what direction they are in" is narrative (no step).
- Q4: "they gain any benefits that would normally only apply to you (such as Ranger's Focus)". When SD-C runs a
  companion's damage, it must fire the Focus `stress` auto as if the ranger dealt the damage.
- Riders whose steps target the move (`modifyDamage to: targets`: Ruthless Predator, Sneak Attack, snipe) need the host
  move's targets in the context (SD5). With no targets they produce nothing.
- Apex Predator's `when: success` reads the host attack's roll, so SD5 must run the rider's steps against that roll.
- Contacts Everywhere `die`: the effect lasts `nextRoll`, and the after-roll rider has to see it on that same roll. SD5
  must read waiting effects before it ends `nextRoll` effects.
- Loyal Friend's "would mark the companion's last Stress / your last Hit Point" is a check box (no state check for the
  companion's Stress or for the hit's outcome).

## Vocabulary and runner gaps (beads, label `feature-effects` + `vocabulary-gap`)

| Bead | Gap |
|---|---|
| dcm-d1d | A `delegate` step can't read the use's own roll, so D5 `rangersFocus` / `focusReroll` (`classState.focus`) can't run from the entry. The Focus is a map tag, which makes it a second record next to the Party sheet's. |
| dcm-2z2 | The companion's die, range, damage type and training count come from its sheet; the vocabulary can't read them. |
| dcm-bhp | Cloaked: no Hidden → Cloaked replacement, no end on "attack / move ending in an adversary's sight", no per-observer Cloaked (Dark Cloud). |
| dcm-85u | No state check for "an ally within Melee range of your target", and a requirement can't OR two checks (Sneak Attack). |
| dcm-3ea | No effect end on "your next roll of a kind" (Reliable Backup's Presence Roll in conversation). |

## Open questions (multiple choice; the first option is what the entry does now)

1. **Ranger's Focus: does the attack that makes the Focus also make it mark a Stress?** CB p.38: "On a success, deal your
   attack's normal damage and temporarily make the attack's target your Focus. Until this feature ends …, you gain the
   following benefits against your Focus: … When you deal damage to them, they must mark a Stress."
   (a) No: the damage comes first, so the benefits start with the next damage. (b) Yes: the first hit marks a Stress too.
2. **Dark Cloud's area.** CB p.42: "create a temporary dark cloud that covers any area within Close range."
   (a) A circle of Close radius centred on the rogue. (b) A point the rogue picks within Close range, with a fixed
   radius (which one?). (c) The GM draws the area by hand.
3. **Contacts Everywhere: when is the +3 die chosen?** CB p.43: "On your next action roll, their help provides a +3
   bonus to the result of your Hope or Fear Die."
   (a) After that roll, when the player sees the dice (Q1 after-roll step). (b) Before the roll, with the die named in
   advance.
4. **Rogue's Dodge used twice.** CB p.42: "Spend 3 Hope to gain a +2 bonus to your Evasion until the next time an attack
   succeeds against you." CB p.107 allows activating a non-roll feature more than once.
   (a) A second activation refreshes the same +2 (D5 replaces its effect). (b) The activations stack (+4 for 6 Hope).
5. **Vanishing Act and the usual Cloaked end.** CB p.42: "You remain Cloaked in this way until you roll with Fear or
   until your next rest."
   (a) Only a roll with Fear or a rest ends it; attacking or moving in sight does not. (b) The usual Cloaked ends
   (CB p.42 Cloaked) also apply.

## Checks

See the commit: `pnpm lint`, `pnpm typecheck`, `pnpm vitest run --maxWorkers=2 --testTimeout=60000`,
`pnpm tracer:guard .omc/plans/sheet-drawer.yaml FE-ranger-rogue`.
