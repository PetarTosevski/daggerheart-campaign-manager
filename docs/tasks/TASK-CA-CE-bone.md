# TASK CE-bone: Card effects, Bone (20 cards)

Plan `.omc/plans/combat-actions.yaml`, tracer CE-bone (depends on CA1). Book pages are printed pages; CB = Core Book.
The Bone cards are on CB p.331 (Deft Maneuvers to On the Brink) and p.332 (Splintering Strike, Deathrun, Swift Step).

## What landed

| File | What |
|------|------|
| `src/lib/srd/card-effects/bone.ts` | `BONE_EFFECTS`: 20 entries (16 combat + 4 passive; Recovery is out of combat and has none), each quoting its card |
| `tests/unit/card-effects/bone.test.ts` | 43 tests: the table matches the classification exactly (missing or extra id fails); each card runs through `run()` with `queueRng` and the dice queue must be used up exactly |

User answers implemented: **U3** every Bone card used in combat has an entry. **Q3** limits are stored as `card:<id>` in
`featureUses` (Deft Maneuvers, Signature Move, Bone-Touched: rest; Splintering Strike: long rest). **Q4** Splintering
Strike's "Once per long rest, on a success" is used up only by a success. **Q9** movement is a `move` prompt (Deft
Maneuvers, Boost, Wrangle, Deathrun), conditions go on the tracker (Breaking Blow's tag), choices are dialog inputs
(Strategic Approach's option, Tactician's Experience, Redirect's Stress, Know Thy Enemy's Stress), and what is left is a
`manual` step with the card's words. No vocabulary type changed.

Rules used (quoted briefly): CB p.107 "if you need to round to a whole number, round up unless otherwise specified"
(Untouchable's half Agility). CB p.90 Help an Ally: "You can spend a Hope to Help an Ally who is making an action roll you
could feasibly support … roll a d6 advantage die". CB p.97 Tag Team Rolls: "You both make separate action rolls". CB p.90
(R8): Hope from the same roll can pay a Hope feature (Know Thy Enemy, Wrangle). CB p.104 (R9): one roll, damage rolled once
(Splintering Strike, Deathrun).

## Cards and readings

| Lv | Card | Activation | Reading |
|---:|------|-----------|---------|
| 1 | Deft Maneuvers | action, once per rest | cost 1 Stress; `move` prompt (Far, no Agility Roll); self effect `attack +1`, duration `nextRoll`, `endsWhen` "only for an attack right after the sprint against an adversary within Melee" |
| 1 | I See It Coming | reaction `whenAttacked` targeted, beyond Melee | cost 1 Stress; `modifyRoll evasion +1d4` on self (fold for AA1) |
| 1 | Untouchable | passive | `evasion +` half Agility, rounded up |
| 2 | Ferocity | reaction `whenTargetMarksHp` | cost 2 Hope; self effect `evasion + triggerAmount` (the HP marked), duration `hit` ("until after the next attack made against you") |
| 2 | Strategic Approach | rider `beforeYouRoll attack` + auto `timing afterLongRest` | auto use `tokens`: set tokens = Knowledge, minimum 1 (setting also clears the unspent ones). Rider: requires the situation "first time you moved within Close range of this adversary"; cost 1 token; `choose` one: advantage (`modifyRoll advantage`), clear 1 Stress on an ally within Melee of the adversary (`pick` area aroundTarget, Melee), or `modifyDamage +1d8` |
| 3 | Brace | reaction `whenArmorSlotMarked` self | cost 1 Stress; `extraArmorSlots 1` |
| 3 | Tactician | reaction `afterAllyRolls` (use `help`) + rider `beforeYouRoll action` (use `tag-team`) | help: requires the situation "you helped this ally's roll and they agree to spend a Hope"; choice `experience` (the Experience's modifier, min 1); the ally loses 1 Hope (`hope lose` on `triggerSubject`); `modifyRoll add chosen` on the ally. Tag team: requires "This is a Tag Team Roll"; `modifyRoll hopeDie 20` |
| 4 | Boost | action | requires the situation "a willing ally within Close range"; cost 1 Stress; weapon attack (either weapon) with advantage vs a target within Far; on a hit weapon damage + 1d10; `move` prompt "end your move within Melee range of the target" (also on a miss) |
| 4 | Redirect | reaction `whenAttacked` failed, beyond Melee | `check` Proficiency d6, any 6: optional (1 Stress) `redirectDamage` to a picked adversary within Very Close |
| 5 | Know Thy Enemy | action | Instinct Roll vs the target's Difficulty (any creature you can see); on a success: optional 1 Stress → GM loses 1 Fear; pay 1 Hope; `manual` "ask the GM for one set of information". The optional comes first so an unpaid Hope (which stops its list, CB p.90) can't block it |
| 5 | Signature Move | rider `beforeYouRoll action`, once per rest (use `main`) + rider `afterYouRoll success` (use `clear`) | main: requires "this action performs your named signature move"; `modifyRoll hopeDie 20`. clear: requires "this roll used Signature Move's d20 Hope Die"; clear 1 Stress |
| 6 | Rapid Riposte | reaction `whenAttacked` failed, from Melee | cost 1 Stress; targets the trigger source; weapon damage (either weapon, no roll) |
| 7 | Bone-Touched | reaction `whenAttacked` succeeded (use `main`) + passive (use `agility`) | both require 4+ Bone cards in the loadout. main: once per rest, 3 Hope, `modifyRoll fail` on the attacker's roll. agility: `agility +1` |
| 7 | Cruel Precision | auto `whenYouAttack` success, weapon | `modifyDamage add max(Finesse, Agility)` (no choice: always the better one) |
| 8 | Breaking Blow | rider `whenYouAttack` success (use `main`) + auto `whenYouAttack` success (use `extra`) | main: 1 Stress; tag "Breaking Blow" on the target, duration `hit`; `manual` for another attacker's extra 2d12. extra: on a target with the tag, `modifyDamage +2d12` and clear the tag |
| 8 | Wrangle | action | Agility Roll vs all within Close; on a success pay 1 Hope; `move` prompt for the targets hit and one for willing allies within Close, to one point within Close |
| 9 | On the Brink | passive | requires 2 or fewer HP unmarked; flag `noMinorDamage` |
| 9 | Splintering Strike | action, once per long rest on a success | cost 1 Hope; one attack (either weapon) vs all adversaries in weapon range; weapon damage `split` as the player wishes (`splits`), plus an extra damage die per target |
| 10 | Deathrun | action | cost 3 Hope; `move` prompt (straight path within Far); one attack vs all along the path (`area: path`); weapon damage with +1 Proficiency, `dropDiePerTarget` in the order the player gives the targets |
| 10 | Swift Step | auto `whenAttacked` failed | with 0 Stress marked gain 1 Hope; otherwise clear 1 Stress (the Hope step comes first so clearing the last Stress doesn't also gain a Hope) |

## Manual steps and prompts

| Card | Step | Why | Page |
|------|------|-----|------|
| Know Thy Enemy | `manual`: ask the GM for one set of information | a question to the GM, left manual by design (TASK-CA-CA0, "Left to manual by design"); the GM decides what to tell, so U1 holds | CB p.331 |
| Breaking Blow | `manual`: another character's next successful attack deals +2d12 | the vocabulary has no modifier for "damage taken by the bearer", and other cards' tables can't read this card's tag. The actor's own next attack is automatic (use `extra`) | CB p.331 |
| Deft Maneuvers, Boost, Wrangle (x2), Deathrun | `move` prompts | movement is a prompt (Q9) | CB p.331-332 |

## Vocabulary gaps (beads filed; no type changed)

1. **A cost paid by another PC** (dcm-8yr; Tactician: "they can spend a Hope"). Written as a `hope lose` step on `triggerSubject`;
   the runner can't refuse when the ally has no Hope, so the situation check asks the player to confirm it.
2. **No "when you Help an Ally" trigger** (dcm-iu4; Tactician). Written as `afterAllyRolls` plus a situation the player confirms.
   The Experience is added after the ally's dice are known, which only matters if the ally would decline on a bad roll.
3. **No "damage taken" modifier on a creature** (dcm-9gw; Breaking Blow for other attackers): manual step above.
4. **A rider can't gate on the host roll's result** (dcm-jx6; Signature Move "On a success, clear a Stress"). The runner treats a
   rider with no roll of its own as a success, so the Stress clear is a second rider (`afterYouRoll success`) that the
   server should offer only on the roll that used the first one (the situation text says so).

## QUESTIONS

1. **Untouchable with negative Agility** ("Gain a bonus to your Evasion equal to half your Agility", CB p.331). Half rounds up
   (CB p.107), so Agility −1 gives 0 and −3 gives −1 (a penalty). Should a negative Agility give 0 instead?
2. **Splintering Strike's limit** ("Spend a Hope and make an attack against all adversaries within your weapon's range. Once
   per long rest, on a success against any targets, roll your weapon's damage and distribute …", CB p.332). Read as: the whole
   card is once per long rest, used up only by a success (the CA0 example). The literal text would let you attack without
   damage any number of times; confirm.
3. **Strategic Approach's "first time"** ("The first time you move within Close range of an adversary and make an attack
   against them, you can spend one token", CB p.331). Read as once per adversary (each adversary's first approach), limited by
   the tokens; the player confirms it. Or is it only the first approach after a long rest?
4. **Ferocity's trigger** ("When you cause an adversary to mark 1 or more Hit Points", CB p.331): `whenTargetMarksHp` fires on
   your attacks. Should forced HP marks without an attack (e.g. a card's "mark a Hit Point") count too?
5. **Redirect's damage** ("redirect the attack to damage an adversary within Very Close range instead", CB p.331): read as the
   attack's damage hitting the picked adversary with no new roll. Confirm.
6. **Boost's weapon and movement** ("perform an aerial attack against a target within Far range … end your move within Melee
   range of the target", CB p.331): read as a weapon attack with either active weapon, reaching Far whatever the weapon's
   range, and you land within Melee even on a miss. Confirm.
7. **Breaking Blow** ("the next successful attack against that same target deal an extra 2d12 damage", CB p.331): read as
   anyone's next successful attack (allies too), not only yours. Confirm.
8. **Wrangle's destination** ("move targets you succeed against, and any willing allies within Close range, to another point
   within Close range", CB p.331): read as one point for everyone, within Close of you. Confirm.
9. **Deft Maneuvers' +1** ("If you end this movement within Melee range of an adversary and immediately make an attack against
   them, gain a +1 bonus to the attack roll", CB p.331): stored as `attack +1` until your next roll; the player removes it if
   that roll isn't such an attack. Confirm.
