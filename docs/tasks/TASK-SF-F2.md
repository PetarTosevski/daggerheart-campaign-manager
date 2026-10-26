# TASK-SF-F2: Dice box - Slayer choice, Slayer Dice stepper, automatic Tide tokens, Tide stepper

Status: Review. Plan: `.omc/plans/session-features.yaml`, tracer F2 (wave 2, depends on F0). Bead: `dcm-bxp.58`.
Rules: K2, K3, K5, U2-U5, U9, ANSWERED Q1, E3 (plan header, binding).

## Goal
After a roll with Hope a Slayer is asked to take the Hope or store a Slayer Die, attack and damage rolls can spend
Slayer Dice that the server rolls and adds, every roll with Fear places a Know the Tide token, and a Seaborne
character can spend tokens for +1 each before an action roll.

## Book rules (printed pages, re-checked from F0's quotes against `.reference-private/`)
- **K2 Slayer** (Call of the Slayer foundation, CB p.48): "You gain a pool of dice called Slayer Dice. On a roll with
  Hope, you can place a d6 on this card instead of gaining a Hope, adding the die to the pool. You can store a number
  of Slayer Dice equal to your Proficiency. When you make an attack roll or damage roll, you can spend any number of
  these Slayer Dice, rolling them and adding their result to the roll. At the end of each session, clear any unspent
  Slayer Dice on this card and gain a Hope per die cleared."
- **K3 Know the Tide** (Seaborne community, CB p.77): "When you roll with Fear, place a token on your community card.
  You can hold a number of tokens equal to your level. Before you make an action roll, you can spend any number of
  these tokens to gain a +1 bonus to the roll for each token spent. At the end of each session, clear all unspent
  tokens."
- **K5** CB p.18: "Any time you roll with Hope on your Duality Dice ... you gain a Hope (to a maximum of 6)." CB p.90:
  "A critical success counts as a roll with Hope ... along with gaining a Hope, you also clear a Stress". CB p.99:
  reaction rolls "don't generate Hope, Fear, or additional GM moves".
- **Tag Team** CB p.97: "choose one of the rolls to apply for both of your results. On a roll with Hope, all PCs
  involved gain a Hope. On a roll with Fear, the GM gains a Fear for each PC involved." (Q1 answer: only the chosen
  roll counts, for both; U9: either participant or the GM chooses.)

## What was built
### Convex (`convex/rolls.ts`)
| function | change |
|---|---|
| `actionRoll`, `manualRoll` (action kind) | optional `slayerDice` (attack rolls only, else DICE_RULE; reaction rolls never) and `tideTokens` (CLASS_FEATURE_RULE without Know the Tide, DICE_RULE above the held tokens or on a reaction roll). Slayer Dice are spent with F0's `spendSlayerDice`, rolled with the server rng (also for a manual roll: typed values cover only the roll's own dice) and added last as extra d6s; tokens add +n to the modifier. Summary extras: `Know the Tide +n`, `Slayer d6 ×n (values)`. |
| `damageRoll`, `manualRoll` (damage kind) | optional `slayerDice`: spent, rolled by the server and appended as extra d6s; a critical adds their maximum too (like option bonus dice, CB 98 - see QUESTIONS). |
| every Duality roll | after the outcome, `placeTideToken(next, outcome, kind)` in the same saved sheet and the same actionLog row (undo takes it back): action rolls with Fear only, never a reaction roll or a critical (U4, Q1). |
| `tagTeamApply` | U9: the GM or the editor of EITHER character picks (outsiders NOT_FOUND, other players FORBIDDEN). The chosen roll places a Tide token for both participants (kind "action"). Each result row now carries the chosen `roll`, so the Slayer choice can read it (the feed shows its dice under the result line). Arguments and returns unchanged. |
| `pendingChoices` (new `userQuery`, edit access) | `{ slayer: { entryId, prompt } \| null, tagTeam: { entryId, rolls[] } \| null }`: the open Slayer choice (latest live row is an action roll with Hope that applied to the character - a plain roll or its applied Tag Team result - unanswered, pool below Proficiency) and a Tag Team Roll waiting for its pick. |
| `storeSlayerDie` (new `keyedUserMutation`, edit access) | `{ characterId, entryId }`: the row must be the open Slayer choice (else CLASS_FEATURE_RULE; a row of another character NOT_FOUND); F0's `storeSlayerDie` with `hopeGained = rollGaveHope(before ?? sheet, outcome, "action")`; one undoable public row `Bryn stored a Slayer Die (1/2)`. Returns `{ slayerDice, capacity, hope }`. |

### Dice box (`src/components/party/dice/**`)
- `slayer.tsx` (new): `SlayerOffer`, fed by `rolls.pendingChoices`: "Take the Hope or store a Slayer Die?" with
  "Take the Hope" (closes, no call) and "Store a Slayer Die" (`storeSlayerDie`). Because it comes from the query it
  shows whoever rolled (manual roll, the partner picking a Tag Team) and survives a reload. Other prompts still go to
  `classFeatures.use` (E3); the `slayerStore` prompt in the roll result is filtered out there, so it shows once.
- `dice-box.tsx`: '+ Slayer Dice' stepper (label "Slayer Dice to spend", max = pool, "n held") under Roll options on
  attack rolls (Attack roll or Ikonis attack ticked) and damage rolls for Slayer holders with dice; '+ Tide tokens'
  stepper (label "Tide tokens to spend", max = held, "n held (+1 each)") on action rolls, rendered ONLY for
  `holdsTide` sheets. Both reset after a roll. The result label adds " · Know the Tide +n" and
  " · Slayer d6 ×n (values)"; `DiceTiles` labels the Slayer dice "Slayer d6".
- `tag-team.tsx`: the pick comes from `pendingChoices.tagTeam`, so it shows in both participants' boxes (and the GM's)
  even when the Tag Team panel is closed.
- `dice.css`: steppers row, held counts, the Slayer prompt and Slayer die tile; 390 px stacks them.

## Acceptance evidence
- `tests/convex/rolls-session-features.test.ts` (11 tests): every new argument, `storeSlayerDie` and `pendingChoices`
  for anonymous, outsider, player owner, player non-owner and GM; store instead of the Hope; store twice for one roll;
  full pool; roll with Fear / reaction roll; store after a later roll; store at Hope max (no Hope taken); a critical
  keeps its cleared Stress; undo of the store row; Slayer Dice on manual damage, attack and critical damage rolls;
  refusals (not an attack, reaction, above the pool, non-Slayer); Tide tokens placed only on action rolls with Fear,
  at the level cap, none for a non-holder; undo of a roll removes its token; spending +1 each, refusals; Tag Team pick by
  the partner, tokens and the Slayer choice from the chosen roll.
- `tests/convex/rolls.test.ts`: unchanged except the access test for U9 (coordinator-approved): the partner's owner
  applies ("ok"), a campaign player in neither character gets FORBIDDEN, the GM applies a second Tag Team.
- e2e `tests/e2e/session-features-dice.spec.ts`: passes (store, spend on damage, Tide token and spend, no Tide stepper
  for a non-Seaborne PC). Existing `dice`, `dice-3d`, `class-features`, `class-features-hf` specs pass.
- Visual `tests/e2e/visual/SF-F2.spec.ts` (shots in `test-results/visual/SF-F2/`):

| shot | 1440 | 1024 | 390 |
|---|---|---|---|
| slayer-prompt | ok: dc-prompt row under Roll options in the sheet look | ok | ok: wraps, 44 px buttons, no horizontal scroll |
| slayer-stepper | ok: stepper next to Help dice with "1 held" | ok | ok: own line, 44 px steppers |
| tide-stepper | ok: "1 held (+1 each)" | ok | ok, no horizontal scroll |

  Deliberate deviation: no board counterpart exists for these controls; they reuse the box's `CountStepper` and
  `dc-prompt` styles.

## Notes for F3/F4
- The Class Features chips (U7) are F3's; the dice box shows the held count next to each stepper only.
- `pendingChoices` is the single source of the Slayer offer; F4 can drive it with manual rolls.

## Questions
1. **Hope gained with an Experience at Hope max**: the roll row keeps only the sheet before costs (`before`), so a roll
   at Hope max that paid exactly 1 Hope (one Experience) and gained it back reads as "no Hope gained", and storing then
   keeps that Hope. Exact derivation would need the roll to record the Hope it gave (a field on the row or in
   `sessionFeatures`, F0 / actionLog validators). Reversible; plan wording followed.
2. **Critical damage and Slayer Dice**: a critical adds the Slayer dice's maximum too, consistent with option bonus
   dice (Rally, Sneak Attack). If the book means only weapon dice, drop the `critical` term in `withSlayerDamage`.
3. Tag Team result rows now carry the chosen roll, so the dashboard feed shows its dice under the result line.
