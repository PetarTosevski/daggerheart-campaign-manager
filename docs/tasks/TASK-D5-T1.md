# TASK-D5-T1: Server dice, manual entry and the roll feed (2D)

Status: Review. Plan: `.omc/plans/d5.yaml`, tracer T1 (wave 1, after T0).

A player rolls Duality or damage dice from the sheet (or types in physical dice, marked manual); the server rolls, applies Hope, Stress and GM Fear, and writes one action log row. Every member sees player rolls in the dashboard feed; GM free rolls stay hidden from players until revealed; the roller or the GM can undo.

## What landed

| Piece | Where |
|---|---|
| Pure resolver, injectable `Rng`: `advantagePlan`, `rollAdvantage`, `rollDuality`, `dualityEffects`, `applyDualityEffects`, `experienceBonus`, `spendHope`, `applyRollOptions`, `weaponDice`, `rollDamage`, `rollFree`, `queueRng` (manual entry) | `src/lib/domain/dice/index.ts` |
| `rolls.actionRoll`, `rolls.damageRoll`, `rolls.manualRoll` (keyedUserMutation, rateLimit `roll`, `editable` = loadCharacter edit, `assertCanAct`) | `convex/rolls.ts` |
| `rolls.tagTeam` + `rolls.tagTeamApply` (keyedUserMutation, rateLimit `roll`) | `convex/rolls.ts` |
| `rolls.gmRoll` (keyedGmMutation, rateLimit `roll`, `visibility: "gm"`), `rolls.reveal` (gmMutation) | `convex/rolls.ts` |
| `feed.list` (campaignQuery need view, enough owner, paginated; returns a union of the GM row and the player row) | `convex/feed.ts` |
| Dice box (sheet slot `SheetDiceBox`), roll feed (dashboard slot `RollFeed`), tag team panel, per-device 3D/sound settings, error boundary, 2D sound | `src/components/party/dice/` |
| 3D seam for T1b: `play3d(container, { dice, sound }) → Promise<boolean>` (always `false` in T1; no three import) | `src/components/party/dice/dice3d/index.ts` |

No new error codes: refusals use `DICE_RULE` (dice module), `NOT_ENOUGH_HOPE` (class-features module) and `CHARACTER_UNAVAILABLE` (actionLog module). No schema change.

### Server behaviour

- Duality roll: costs are paid first (Experiences 1 Hope each, roll-option costs), then Hope die, Fear die, advantage dice, option dice are rolled in that order (manual entry supplies values in the same order; missing, out-of-range or surplus values are `DICE_RULE`). Action rolls: critical = +1 Hope and clear 1 Stress; Hope higher = +1 Hope; Fear higher = `gainFear(1)`. Hope is held to `hopeMax`. Reaction rolls change nothing and refuse help.
- Every roll writes one public `actionLog` row (`kind: "roll"`) with the `roll`, `fearDelta` = Fear actually gained, and `before` only when the sheet changed. Undo is T0's `actionLog.undo`.
- Effects: `withEffects` gives the live trait; `attackBonus` is added when the roll is marked as an attack, `damageBonus` to weapon and override damage.
- Damage: weapon = the leading weapon die × Proficiency, further dice and the flat bonus once (`"d8+1 phy"` at Proficiency 2 → 2d8+1); a critical adds the dice's maximum, or the override's `critBase`. Sources: primary/secondary weapon, a `weaponOverrides` entry, or dice as given (spells).
- Tag team: `tagTeam` checks both characters can act, takes 3 Hope from the initiator, marks `featureUses` `tagTeam` until session, rolls an action roll for each and logs both rows in one group ("not applied yet"). `tagTeamApply` (the initiator's editor) applies the picked roll to both: Hope (and a critical's Stress clear) to both, or GM Fear × 2; it writes one more row per character in the same group. Undoing any row of the group undoes the whole tag team.
- Feed: the GM reads `by_campaign_at`, players `by_campaign_visibility_at` with `visibility: "public"`; rows never carry the `before` snapshot. `canUndo` = undoable, not undone, and the viewer is the actor or the GM.

## Book references (re-checked)

- CB 90: "When this happens on an action roll, even if you fail, mark one of the Hope slots"; Fear: "even if you succeed, the GM gains a Fear"; critical: "along with gaining a Hope, you also clear a Stress"; "you can only hold a maximum of 6 Hope at a time"; Utilize an Experience: "spend a Hope to use one of your relevant Experiences on an action or reaction roll, adding its modifier"; Help an Ally: "roll a d6 advantage die ... they take the highest of all the advantage dice rolled".
- CB 94: success/failure with Hope/Fear; "If your total meets or exceeds the Difficulty, the action succeeds"; bonuses are added before the roll. CB 95: worked examples (8 and 8 is a critical).
- CB 97, Tag Team Rolls: "Once per session, each player can choose to spend 3 Hope ... You both make separate action rolls, but before resolving the roll's outcome, choose one of the rolls to apply for both of your results. On a roll with Hope, all PCs involved gain a Hope. On a roll with Fear, the GM gains a Fear for each PC involved."
- CB 98: "you roll a number of your weapon's damage dice equal to your Proficiency"; critical: "Start with the highest possible value the damage dice can roll, and then make a damage roll as usual" (wand example 12 + 9 + 1 = 22, in `tests/unit/dice.test.ts`).
- CB 99, Reaction Rolls: "they don't generate Hope, Fear, or additional GM moves ... other characters can't help you on a reaction roll"; a critical reaction roll doesn't clear Stress or gain Hope.
- CB 100: advantage and disadvantage "always cancel each other out ... if you have two sources of advantage and one of disadvantage ... you would have advantage" (settled rule: a single d6 remains).

## Tests

- `tests/unit/dice.test.ts` (22): outcome matrix, Difficulty edge, effects per outcome, Hope cap with scars, advantage cancelling and help, reaction-help refusal, Experiences and Hope, roll options (auto, held die, once-per uses), weapon dice at Proficiency, crit damage (CB 98 example), crit base, manual queue.
- `tests/convex/rolls.test.ts` (13): anonymous/outsider/player/GM for all seven functions; a Fear roll raises GM Fear, a Hope roll gains Hope; server roll consistency; reaction gives nothing and refuses help; Experience cost on a reaction roll and NOT_ENOUGH_HOPE; undo reverts Hope, Stress and Fear; unconscious and dead → CHARACTER_UNAVAILABLE; damage dice and crit, manual damage count; tag team cost, once per session, apply and group undo; tag team refusals; idempotent replay.
- `tests/convex/feed.test.ts` (4): access matrix; player vs GM rows and reveal; a player paging through the feed never receives a `gm` row; undone rows.
- `tests/e2e/dice.spec.ts` (3): a player rolls from the sheet and GM and player see it in the feed; a GM free roll is hidden from the player until revealed; a manual entry shows "manual" and undoing that Fear roll lowers GM Fear.

## Open questions

1. Tag Team: does a critical's Stress clear apply to both PCs? Implemented: yes (the chosen result applies to both); CB 97 names only the Hope.
2. Help an Ally: the helper's Hope is not deducted by the app (decision 7 lists the cross-character actions; Help an Ally is not among them). The roller types the number of help dice; helpers spend their Hope on their own sheet.
3. Manual entry ignores optional roll options (auto options still apply; with the empty class registry there are none yet).
