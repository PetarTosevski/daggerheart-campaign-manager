# TASK-RULES-RK: countdowns tick on action rolls (K1)

Plan `.omc/plans/rule-switches.yaml`, tracer RK. Rule switch `countdownTicks` (K1, modes Book · Manual). User answer
Q3 (a), 2026-11-05.

CB p.162 (standard countdown): "ticks down every time a player makes an action roll, regardless of the result."
CB p.97: "A Tag Team Roll counts as a single action roll for the purposes of any countdowns".

## Behaviour

| Mode | After a counted PC action roll |
|---|---|
| Book | Every armed, active dashboard countdown that is not long-term ticks by the roll (today's behaviour). |
| Manual | Nothing ticks. The GM gets one GM-only note naming the armed countdowns: `Action roll: tick Ambush (3), Collapse (5) by 2?` (value now; `by N` when the roll would tick it more than 1). A countdown the roll would not move (amount 0) is left out. No armed countdown, no note. |

What counts as a roll does not change: a Tag Team counts once (on its group's first result row), reaction rolls never.
In Manual the GM still ticks by hand from the feed's "Tick countdowns" button (`countdownRolls.applyRoll`) or the card.

## Where

- `src/lib/domain/countdowns/advanced.ts`: `rollsTickCountdowns(mode = "book")` and `manualTickNote(ticks)` (pure).
- `convex/countdownRolls.ts`: `tickArmedCountdowns` reads `ruleMode(campaign, "countdownTicks")`; in Manual it posts
  the note through `postRuleNote` with the roll row's `groupId` when it has one (a Tag Team: undone with the roll). A
  plain roll row has no group, so its note has no `groupId` and no `characterId` (never undoable, RS0's guard).
  `groupOf` ignores `rule` rows so a note in a Tag Team group keeps the feed button on the result row.
- `src/app/(gm)/campaigns/[campaignId]/countdowns/new-dialog.tsx`: the Armed checkbox reads "Remind me on action
  rolls" in Manual.
- Tests: `tests/convex/rules-countdowns.test.ts`.
