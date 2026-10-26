# TASK SD FE-druid-sorcerer: Druid and Sorcerer feature effects

Plan `.omc/plans/sheet-drawer.yaml`, tracer FE-druid-sorcerer (wave 3, depends on SD1). Bead `dcm-bxp.99.19`. Status:
Review.

The Druid and Sorcerer effect table: one entry for each of the 17 features (out of 21) that the classification marks
combat or passive. Wildtouch, Arcane Sense and Minor Illusion are narrative and Clarity of Nature is out of combat, so
they get no entry. The tracer uses SD0's vocabulary and SD1's runner and changes neither.

## Files

| File | What |
|------|------|
| `src/lib/srd/feature-effects/druid-sorcerer.ts` | `DRUID_SORCERER_EFFECTS`: 17 entries, each quoting its feature with the printed page. |
| `tests/unit/feature-effects/druid-sorcerer.test.ts` | 22 tests through `runFeature`. |
| `docs/tasks/TASK-SD-FE-druid-sorcerer.md` | This file. |

## User answers used

- **Q1 (a)**: Volatile Magic is a `reaction` on `afterYouRoll {roll: "damage"}`, so it runs after the damage roll and
  before the damage is applied. The player's picked dice come from `damageDice.reroll`.
- **Q2 (a)**: Natural Evasion and Elemental Dominion Water answer an attack after its roll
  (`whenAttacked stage: "succeeded"`).
- **Q3 (a)**: Elemental Aura is once per rest; Warden's Protection, Transcendence and Enchanted Aid's swap are once per
  long rest. They are stored under `feat:` keys. Channel Raw Power keeps D5's `channelRawPower` key.
- **Q10 (a)**: Evolution and Beastform delegate to D5's `beastform` (NV2). Defender reads the `inBeastform` fact.
- **Q12 (a)**: Enchanted Aid is a rider on named Help (`whenHelping {roll: "spellcast"}`) that gives a d8 `help` die.
- **Q13 (a)**: anything the engine can't see is a `situation` the player confirms: "The attack deals magic damage"
  (Volatile Magic, Arcane Charge), "You cast a spell, or attacked with a weapon that deals magic damage" (Manipulate
  Magic), "The ally marks 2 or more Hit Points" (Defender), "The ally made a Spellcast Roll with your help" (Enchanted
  Aid), and the two range confirmations of Elemental Aura.
- **Q14 (a)**: Elemental Aura is an `area` centred on the druid with radius Close. Its triggered parts check
  `inArea` on the druid's own aura.
- **Q16 (a)**: "can fly" (Elemental Dominion Air) sets no `flying` flag. The drawer's Flying toggle decides when the
  druid is flying.

## Book passages (printed pages) and how each entry reads them

Page note: the plan's acceptance cites Elemental Incarnation as "CB p.31". In the text file it sits under
`===== PAGE 31 =====`, which holds printed page **30** (plan header), so the entries cite CB p.30. Warden of Renewal is
on p.31, the Sorcerer and Elemental Origin on p.46, and Primal Origin on p.47.

| Feature id | Book (quoted in the entry) | Entry |
|---|---|---|
| `hope:druid` | CB p.30 Evolution: "Spend 3 Hope to transform into a Beastform without marking a Stress. When you do, choose one trait to raise by +1 until you drop out of that Beastform." | action, 3 Hope; delegates D5 `beastform` (option `form`, no Stress: a delegate pays only D5's once-per key) and D5 `evolution` (option `trait`). |
| `class:druid:beastform` | CB p.30 Beastform: "Mark a Stress to magically transform …" | action, 1 Stress; delegates D5 `beastform` (option `form`). |
| `subclass:warden-of-the-elements:elemental-incarnation` | CB p.30: "Mark a Stress to Channel one of the following elements until you take Severe damage or until your next rest" + Fire / Earth / Water / Air | `main`: 1 Stress, `exclusive`, a `choose element` with one `effect` per element (`option` = element, duration `rest`, `endsOn: ["takeSevere"]`). Earth: +Proficiency to the Major and Severe thresholds. Air: advantage on Agility. `fire`: auto on `whenYouMarkHp {sourceWithin: melee}`, 1d10 magic damage to the trigger source. `water`: auto on `whenYouDealDamage {toEnemy}`, **manual** (gap dcm-ssf). |
| `subclass:warden-of-the-elements:elemental-aura` | CB p.30: "Once per rest while Channeling, you can assume an aura matching your element. The aura affects targets within Close range until your Channeling ends." + four auras | `main`: needs Channeling, once per rest, `choose element`; each option's `area` is gated on Channeling that element (Close, centred on you, duration `rest` + `takeSevere`). Earth: +1 Strength for allies. `fire` (auto, `whenEnemyTakesDamage {range: close}`): the adversary marks a Stress. `water` (reaction after you take damage, 1 Stress): move the attacker within Very Close of where they are (move prompt). `air-self` (auto, `whenYouWouldTakeDamage {from: beyondMelee}`) and `air-ally` (reaction, `whenAllyWouldTakeDamage {range: close}` + confirm "beyond Melee"): reduce by 1d8. |
| `subclass:warden-of-the-elements:elemental-dominion` | CB p.30: "While Channeling, you gain the following benefit" + four | `fire` passive +1 Proficiency; `earth` auto on `whenYouMarkHp`: `adjustHpMarked fewer` by the count of 6s on (trigger amount) d6 (NV4 + NV12); `water` reaction on a successful attack, 1 Stress: the attacker is temporarily Vulnerable; `air` passive +1 Evasion. Each use requires Channeling its element. |
| `subclass:warden-of-renewal:regeneration` | CB p.31: "Touch a creature and spend 3 Hope. That creature clears 1d4 Hit Points." | action, 3 Hope, one creature (`side: any`) in Melee, clear 1d4 HP. Upgrade (NV3): with Regenerative Reach, the range is Very Close. It can be activated again for another 3 Hope (CB p.107, `times`). |
| `subclass:warden-of-renewal:regenerative-reach` | CB p.31: "You can target creatures within Very Close range with your 'Regeneration' feature." | passive with no mods; it works as Regeneration's upgrade. |
| `subclass:warden-of-renewal:wardens-protection` | CB p.31: "Once per long rest, spend 2 Hope to clear 2 Hit Points on 1d4 allies within Close range." | action, once per long rest, 2 Hope, allies in Close (`upTo 1d4`), each clears 2 HP. See open ruling Q-C (gap dcm-d95). |
| `subclass:warden-of-renewal:defender` | CB p.31: "When you're in Beastform and an ally within Close range marks 2 or more Hit Points, you can mark a Stress to reduce the number of Hit Points they mark by 1." | reaction on `whenAllyWouldTakeDamage {range: close}`; requires `inBeastform` and the confirmation "2 or more"; 1 Stress; `adjustHpMarked fewer 1` on the ally. |
| `hope:sorcerer` | CB p.46 Volatile Magic: "Spend 3 Hope to reroll any number of your damage dice on an attack that deals magic damage." | reaction `afterYouRoll damage` (Q1), 3 Hope, confirm magic damage, `modifyDamage rerollChosen` (the picked dice). |
| `class:sorcerer:channel-raw-power` | CB p.46: "Once per long rest, you can place a domain card from your loadout into your vault and choose to either: Gain Hope equal to the level of the card. Enhance a spell that deals damage, gaining a bonus to your damage roll equal to twice the level of the card." | action; delegates D5 `channelRawPower` (option `card` = `hope:<cardId>` or `damage:<cardId>`). D5's long-rest key is the limit. |
| `subclass:elemental-origin:elementalist` | CB p.46: "spend a Hope and describe how your control over this element helps an action roll you're about to make, then either gain a +2 bonus to the roll or a +3 bonus to the roll's damage." | rider `beforeYouRoll action`, 1 Hope, `choose`: +2 to the roll or +3 to damage. The chosen element and the harmless effects are narrative. |
| `subclass:elemental-origin:natural-evasion` | CB p.46: "When an attack roll against you succeeds, you can mark a Stress … roll a d6 and add its result to your Evasion against the attack." | reaction `whenAttacked succeeded`, 1 Stress, `modifyRoll evasion` + 1d6. |
| `subclass:elemental-origin:transcendence` | CB p.46: "Once per long rest … choose two of the following benefits to gain until your next rest: +4 bonus to your Severe threshold; +1 bonus to a character trait of your choice; +1 bonus to your Proficiency; +2 bonus to your Evasion" | action, once per long rest, `choose benefits` count 2 `distinct`, one `effect` (duration `rest`) per benefit; the trait is the player's pick in `trait` (NV15). |
| `subclass:primal-origin:manipulate-magic` | CB p.47: "After you cast a spell or make an attack using a weapon that deals magic damage, you can mark a Stress to do one of the following" + four | rider `afterYouRoll any` + confirmation, 1 Stress, `choose option`: reach (**manual**, gap dcm-x7p), +2 to the roll, double one chosen damage die, `addTargets 1` (same roll, same damage). |
| `subclass:primal-origin:enchanted-aid` | CB p.47: "When you Help an Ally with a Spellcast Roll, you can roll a d8 as your advantage die. Once per long rest, after an ally has made a Spellcast Roll with your help, you can swap the results of their Duality Dice." | `main` rider on `whenHelping spellcast`: a d8 `help` die for that ally (in place of the d6). `swap`: reaction `afterAllyRolls` + confirmation, once per long rest, `modifyRoll swapDuality`. |
| `subclass:primal-origin:arcane-charge` | CB p.47: "When you take magic damage, you become Charged. Alternatively, you can spend 2 Hope to become Charged. When you successfully make an attack that deals magic damage while Charged, you can clear your Charge to either gain a +10 bonus to the damage roll or gain a +3 bonus to the Difficulty of a reaction roll the spell causes the target to make. You stop being Charged at your next long rest." | Charged is the condition tag `Charged` (duration `longRest`): `main` (2 Hope) and `charged` (auto `whenYouTakeDamage magic`). `release`: rider on a successful attack, requires the tag and a magic-damage confirmation; `choose`: +10 damage, or a `reactionDifficulty +3` effect on the targets until their next roll; then `clearCondition Charged`. |

## Manual steps (the vocabulary cannot express them; one bead per gap)

1. **Elemental Incarnation, Water** (`elemental-incarnation:water`): "If the adversary you damaged is within Melee range:
   all other adversaries within Very Close range must mark a Stress." `whenYouDealDamage` has no range, and a pick
   can't leave out the trigger's subject. Bead **dcm-ssf**.
2. **Manipulate Magic, reach** (`manipulate-magic` option `reach`): "Extend the spell or attack's reach by one range." A
   rider can't change its host move's range. The same bead covers "within range" of `addTargets`, which uses `weapon`
   and so is wrong for a spell. Bead **dcm-x7p**.

Runner gap (no manual step): **Warden's Protection** rolls its 1d4 count after the pick. Bead **dcm-d95** (Q-C).

## Open rulings (questions for the user, multiple choice)

**Q-A. Elemental Incarnation Water: Very Close of whom?** CB p.30: "When you deal damage to an adversary within Melee
range, all other adversaries within Very Close range must mark a Stress."
- (a) Very Close of the druid (the reading of the manual step's text).
- (b) Very Close of the damaged adversary.

**Q-B. Elemental Incarnation Air: does hovering count as flying?** CB p.30: "Air: You can hover, gaining advantage on
Agility Rolls." Elemental Dominion, CB p.30: "Air: You gain a +1 bonus to your Evasion and can fly."
- (a) No. Hovering is only the Agility advantage; the Flying toggle (Q16) is offered only with Elemental Dominion Air.
  (Implemented.)
- (b) Yes. Channeling Air offers the Flying toggle, and "while flying" features read it.

**Q-C. Warden's Protection: when is the 1d4 rolled?** CB p.31: "spend 2 Hope to clear 2 Hit Points on 1d4 allies within
Close range."
- (a) The drawer rolls the 1d4 first, then the player picks that many allies (needs dcm-d95 in SD3 or the runner).
- (b) As implemented now: the player picks, the runner rolls, and the use is refused when the roll is lower than the
  number picked. A retry rolls again, so this is open to abuse.
- (c) The player picks up to 4 allies and the 1d4 is shown, but the GM trims the extras by undo.

**Q-D. Regeneration: which creatures?** CB p.31: "Touch a creature and spend 3 Hope. That creature clears 1d4 Hit
Points."
- (a) Any creature, including yourself and adversaries, as printed. (Implemented: `side: "any"`.)
- (b) You or an ally only.

## Notes for later tracers (no mechanic decided here)

- **Beastform restrictions (SD3 / SD6, Q10).** The entries leave D5's `beastform` sheet effect as the one record of the
  form. They add no `noWeaponsOrSpells` flag effect, because a second effect would outlive D5's End button. The engine
  should read "can't use weapons or cast spells from domain cards" from the `inBeastform` fact.
- **Channeling ends the aura.** The aura area ends on the same events as the Channeling (`rest`, `takeSevere`). If the
  druid Channels again while an aura is up, the old aura is not ended (SD-A).
- **Elemental Dominion Earth** runs on `whenYouMarkHp` with the trigger amount = the Hit Points about to be marked. The
  reaction window (SD4) must offer it before the marks are written ("When you would mark Hit Points").
- **Elemental Incarnation Fire** reads "deals damage to you" as `whenYouMarkHp {sourceWithin: melee}`. Damage that
  Armor reduces to no Hit Points does not trigger it.
- **Arcane Charge's +3 Difficulty** is an effect on the targets until their next roll (`reactionDifficulty`). SD5
  applies it to the reaction roll the same spell causes.
- **Volatile Magic on the Party sheet** stays D5's `volatileMagic` (the dice box's last roll). On the map the entry
  rerolls the move's damage dice (NV8). Both cost 3 Hope.

## Tests (`tests/unit/feature-effects/druid-sorcerer.test.ts`, 22)

- Coverage: the table's ids equal the classification's combat and passive rows for the six owners (17); there are none
  for the narrative or rest features. Source, owner and subclass card match the id and the printed card in
  `SUBCLASSES`, and every `feat:` key fits.
- Evolution (3 Hope, no Stress, D5 Beastform plus the +1 trait effect, refused below 3 Hope) and Beastform (1 Stress).
- Elemental Incarnation: all four channels last until Severe damage or the next rest (`rest` + `takeSevere`, the
  `option`, `exclusive`). Earth gives +2 thresholds at Proficiency 2 and Air gives Agility advantage. Fire deals 1d10
  magic to the attacker, and only while Channeling Fire. Water is a manual prompt.
- Elemental Aura: the Earth area (+1 Strength for allies, Close), a non-matching element draws nothing, not Channeling
  is refused, once per rest. The Fire Stress, the Water move (1 Stress), and Air's 1d8 reduction for you and an ally.
- Elemental Dominion: Earth with dice 6, 2, 6 on 3 HP gives 2 fewer; the Water Vulnerable reaction; the Fire and Air
  passive mods, gated on their channel.
- Regeneration: 3 Hope, 1d4 HP on the touched ally; Very Close with Regenerative Reach and Melee without it; twice for
  6 Hope (CB p.107). Regenerative Reach has an empty passive entry.
- Warden's Protection: 2 Hope, two allies clear 2 each with a 1d4 of 3, the long-rest key, refused on a 1.
- Defender: in Beastform, 1 Stress, 1 fewer HP for the ally; refused outside Beastform.
- Volatile Magic: after the damage roll (Q1), 3 Hope, a `rerollChosen` fold on the picked dice; refused without the
  magic-damage confirmation.
- Channel Raw Power: Rune Ward (level 1) vaulted for 1 Hope through D5; exhausted by D5's key.
- Elementalist (+2 roll / +3 damage, 1 Hope), Natural Evasion (+d6 Evasion, 1 Stress), Transcendence (two distinct
  benefits from a repeated pick, the trait pick, once per long rest).
- Manipulate Magic (all four options, refused without confirmation), Enchanted Aid (d8 Help, swap once per long rest),
  Arcane Charge (2 Hope or magic damage → Charged; +10 damage or +3 Difficulty, then the Charge is cleared; refused when
  not Charged).

## Checks

- `pnpm lint`: clean for the owned files (the one warning, an unused constant, is fixed).
- `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=2 --testTimeout=60000`: 301 files, 7908 passed, 1 expected fail, 2 failed, neither
  from this tracer:
  - `tests/unit/feature-classification.test.ts`, "has the twelve group tables, empty until their FE tracers fill them":
    SD0's old assertion. Every FE tracer breaks it, and on `rebuild` it already checks that entries are classified
    instead (orchestrator note).
  - `tests/unit/combat-terrain-light.test.ts`, the 50 ms speed budget: a timing failure while the machine was loaded.
    It passes when run alone (19/19).
- `pnpm tracer:guard .omc/plans/sheet-drawer.yaml FE-druid-sorcerer`: OK.
