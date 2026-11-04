# TASK DA-DA2: attack riders — Death Strike prompt, out-of-range extra targets to the GM, First Strike on a crit, Rise to the Challenge on by default

Plan `.omc/plans/drawer-answers.yaml`, tracer DA2 (bead dcm-bxp.99.19). Closes dcm-bxp.99.19.47 (1) and (3) pin,
dcm-bxp.99.19.48 (2) pin and (3), dcm-bxp.99.19.49 (2), dcm-bxp.99.19.43, dcm-bxp.99.19.44 pin. Builds on SD5
(docs/tasks/TASK-SD-SD5.md).

Status: Review (implemented and tested in the worktree; see "Not built" for the open pin).

## Rules quoted (printed pages; CB = Core Book, HF = Hope & Fear)

- HF p.8, Death Strike: "When you deal Severe damage to a creature, you can mark a Stress to force them to mark an
  additional Hit Point."
- HF p.8, First Strike: "The first time in a scene you succeed on an attack, you deal double damage."
- CB p.48, Rise to the Challenge: "While you have 2 or fewer Hit Points unmarked, you can roll a d20 as your Hope Die."
- CB p.38, Hold Them Off: "Spend 3 Hope when you succeed on an attack with a weapon to use that same roll against two
  additional adversaries within range of the attack."
- HF p.10, Surrounded: "When you make an attack with a Melee weapon, you can spend any number of Hope to target an equal
  number of additional creatures within Melee range."
- CB p.98: a critical success on an attack adds the damage dice's maximum to the damage roll.
- CB p.42, Cloaked: "After you make an attack or end a move within line of sight of an adversary, you are no longer
  Cloaked." Vanishing Act: "You remain Cloaked in this way until you roll with Fear or until your next rest."

## User answers applied (2026-10-30)

- Death Strike hits ONE creature, and the player picks it. Coordinator follow-up: even with one Severe creature the player
  gets the prompt (Use / Pass, the Stress is optional); with several, the prompt also picks the creature. It is never
  applied without the prompt.
- First Strike doubles the whole damage, added dice included, and stacks with a critical: critical damage first, then
  doubled.
- Rise to the Challenge is ON automatically while 2 or fewer HP are unmarked, with a toggle to switch it off.
- Hold Them Off / Surrounded: an out-of-range extra target waits for the GM like card targets.

## What was built

- **Death Strike prompt** (`convex/lib/combatActions.ts` `damagePrompts`, `answerRiderPick`; `combatActions.riderPick`).
  Damage-phase `rider` uses (a held feature or a loadout card whose trigger is the damage dealt) are no longer toggles or
  riders that run at once. After the attack's damage is written, each one the attacker can use (ready) whose damage
  happened (Severe for Death Strike) opens a `combatRequests` row of the new kind `riderPick` with the candidate tokens.
  `attack` returns `riderPicks: [{requestId, name, candidates}]` (token ids only, U1); `combatRequests.mine` lists the row
  with the candidates' names and the costs. `combatActions.riderPick {requestId, choice: {kind: use, tokenId} | {kind:
  pass}}` (the player or the GM; another player FORBIDDEN): Use runs the rider on that ONE creature (its Stress paid
  then), logged into the attack's actionLog group (one undo reverts both); Pass pays nothing. A token that isn't a
  candidate is INVALID; an undone attack's prompt is declined; REQUEST_NOT_OPEN once answered. The same prompt is opened
  after a card's damage when the card ran with riders (`combatCards`). Automatic damage-phase uses (Ruthless Predator's
  Severe Stress) still run on the first creature that qualifies.
- **Out-of-range extra targets go to the GM** (`addedOutOfRange`, `withoutTargets`). `attack` checks the riders' picked
  extra targets against the rider's range before anything is rolled; any out of range turns the attack into a sanction
  (as an out-of-range own target does, Q1), with the extra tokens in `outOfRange` and in the new optional payload field
  `added`. The GM's Approve resolves it with one roll, the extra targets' range waived (`waived`, carried through a held
  after-roll attack too). The GM's Decline, when only extra targets are out of range, resolves the attack without them:
  a rider left with no extra target is dropped (nothing paid), and a number chosen per target (Surrounded's Hope) goes down
  by the targets dropped (never below 1). When the attack's own target is out of range, Decline declines the whole attack
  as before. Line of sight stays required (Q2).
- **First Strike with a critical** (`foldedDamage`): the damage roll's total (the critical's maximum already in it) plus
  the riders' added damage, then multiplied. This was the built order; it is now a named function with a pure test and a
  convex test with a known roll (every die 1, a critical) that checks the total is `2 × (dice + maximum + flat)`.
- **Rise to the Challenge on by default** (`DEFAULT_ON_RIDERS`, `defaultOnRiders`, `hopeDieSwitch`, `withHopeSides`).
  The feature's `rider` use runs as an automatic before-roll rider whenever its requirement holds (2 or fewer HP
  unmarked), unless the request says `riseToTheChallenge: false` (new optional arg of `attack` and `useCard`, stored in a
  sanction's roll options). Its `modifyRoll hopeDie` step is folded (`Folds.hopeDie`): the attack's Duality roll draws its
  Hope Die from 20 sides (the record says d20; a held attack replays it). Card rolls (`useCard`, and the card sanction):
  `runWithHopeDie` finds the Hope Die's draw in a first run and draws it from 20 sides in the second. `combatActions.riders`
  lists it with `defaultOn: true` only while it applies; the Attack bar shows it as a toggle that starts ticked (44 px row),
  and unticking sends `riseToTheChallenge: false`.
- **Surrounded's extra targets may be allies** (pin dcm-bxp.99.19.44). SD5's code refused any non-enemy token; now a
  rider whose added targets may be any creature (Surrounded's `side: "any"`) can add an ally-side adversary token of the
  encounter or another PC's token. A PC is hit against their Evasion by the same roll and, on a hit, gets the incoming-hit
  window (armor, reactions) in the attack's group, with the attacker shown as the PC and the feature's name (AA2b's PC
  attacker shape; `cardId` holds the feature id).
- **Pins kept**: Sneak Attack's ally is another PC token or an `ally` token, never neutral (test); an after-roll feature
  counts only the final roll's Hope / Fear and the discarded roll's Hope may pay and is then taken back (SD5's tests, code
  unchanged).

## Public functions (authz: tests/convex/authz/riders.entries.ts)

- New `combatActions.riderPick` (keyed campaign mutation, `view` + edit on the character: the player or the GM; another
  player FORBIDDEN).
- Widened: `combatActions.attack` (`riseToTheChallenge`, returns `riderPicks`), `combatActions.riders` (`defaultOn`),
  `combatActions.afterRoll` (result `riderPicks`), `combatCards.useCard` (`riseToTheChallenge`), `combatRequests.sanction`
  (Decline of extra targets resolves), `combatRequests.mine` (`riderPick` rows).
- Validators (widen only, convex/lib/validators/combatRequests.ts): request kind and payload `riderPick` (schemaVersion
  1), `riderPickChoiceValidator`, `hostRollValidator`, sanction payload `added?`, afterRoll action `waived?`, roll options
  `riseToTheChallenge?`. No change to convex/schema.ts. For docs/data-model.md (orchestrator): the new kind and fields.

## Tests

- tests/convex/combat-riders.test.ts: Death Strike prompt with one creature (Use: a Stress, one more HP, undo), Pass,
  several candidates (the ONE picked, a non-candidate INVALID, `mine` view), another player FORBIDDEN and an undone
  attack's prompt declined; Hold Them Off out of range pending → Approve (the same roll) and Decline (dropped target,
  rider unpaid); First Strike on a known critical; `foldedDamage`; Rise to the Challenge on (d20), off (d12), not at 3 HP
  unmarked, and on a card's roll; Surrounded on an ally PC; Sneak Attack and a neutral token.
- tests/unit/combat-riders.test.tsx: the default-on toggle and what it sends; the Death Strike prompt with one and two
  creatures.
- tests/convex/authz/riders.entries.ts: `riderPick` rows.

## Not built

- **Pin "Cloaked still ends after the rogue attacks, except Vanishing Act's Cloaked" (dcm-bxp.99.19.42).** Not built: the
  sheet holds Vanishing Act's Cloaked as the plain `cloaked` condition (the feature runner, `writeSheetChanges` in
  convex/lib/cardRunner.ts, records no source for a standard condition), so the attack can't tell it from the rogue's
  usual Cloaked and ends both, as before. It needs a marker written when Vanishing Act is used (cardRunner /
  combatFeatures, outside DA2's owns), then a one-line check in `uncloaked` (combatActions.ts). Same gap for DA3's move.
- The Attack bar's extra-target chips list enemies only; Surrounded on an ally works through the API and tests.
- A card used without riders and without Rise to the Challenge keeps its old path; with Rise on, a card goes through the
  rider path, which doesn't keep its dice while it asks for a choice (SD5's rider path, as before).
- Known edge: a card whose picked creature the roll missed is re-run by `runCard` with replayed dice; with a d20 Hope Die
  above 12 that re-run draws a fresh Hope Die (cardRunner's replay checks the die's sides).

## QUESTIONS

1. **What the Death Strike prompt reveals (U1).** HF p.8: "When you deal Severe damage to a creature". The prompt's
   candidates are the creatures that took Severe damage, so the player learns which creatures took Severe damage (not
   their HP or thresholds). Built that way, since the player must pick among them. OK?
2. **Decline with a number per target (Surrounded, HF p.10: "spend any number of Hope to target an equal number of
   additional creatures").** Built: when the GM declines out-of-range extra targets, the Hope picked goes down by the
   targets dropped (at least 1, while one target is left) and a rider left with none is not used. Should the declined
   Hope be spent anyway?
3. **Rise to the Challenge on reaction rolls.** CB p.48 says "your Hope Die" without naming a roll; the effect table says
   action rolls (`beforeYouRoll: action`). Built for weapon attacks and card action rolls only. Should reaction rolls
   (which have Hope and Fear Dice but no Hope gain) use the d20 too?
4. **Vanishing Act's Cloaked** (see Not built): may a later tracer write a source marker for Vanishing Act's Cloaked so
   attacks and moves can leave it alone?
