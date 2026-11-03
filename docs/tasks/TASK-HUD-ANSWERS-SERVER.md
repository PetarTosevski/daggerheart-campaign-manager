# TASK-HUD-ANSWERS-SERVER: the server side of the Combat HUD answers (2026-11-02)

Source: `.omc/plans/overnight-questions.md`, "## User answers 2026-11-02", plus the user's follow-up: "If the roll has
happened players can't undo rolls"; "Yes, GM-only undo of rolls". Branch `hud-answers-server` (from `rebuild`).

## 1. Players can't undo a roll (GM-only undo of rolls)

**The rule lives in one place:** `groupRolled` in `convex/lib/actionLog.ts` (its doc comment is the rule). Decided per
action (the row's `groupId` group), from the stored roll data:

| Entry | Who undoes it |
| --- | --- |
| Any row of the action carries a `roll`: action / reaction / damage roll, Tag Team, a PC's attack or card use that rolled, a GM-confirmed death move (Avoid Death, Risk It All, Blaze of Glory), a Wither Fear Die, a move whose Cloaked roll joined its group | GM only. A player gets `UNDO_EXPIRED` ("Only the GM can undo a roll.") |
| The action rolled nothing: a feature or card use without dice, a tracker edit, a death-move request still waiting for the GM (HD4's "Take it back"), Risk It All's split, storing a Slayer Die | Its actor or the GM, as before |
| Token moves, requests, waiting uses | Their own paths (`combatTokens.move`, `combatWithdraw.withdraw`): unchanged |

- The old one-minute player window (`PLAYER_DICE_UNDO_MS`, review M2) is gone. `UNDO_EXPIRED` is reused (an existing
  code, now "Only the GM can undo a roll."); no new error code.
- Every undo path goes through `undoEntry`: `actionLog.undo` and `deathMoves.undo` (players); `rests.undo`,
  `deathMoves.decline` (GM). The check runs after the access checks (outsider NOT_FOUND, another player FORBIDDEN) and
  the staleness of the row itself, before any write.
- **What the client sees:** `viewerCanUndo` (same file) applies the rule to the reads, so no client logic changed:
  `feed.list`'s `canUndo` (classic roll feed, HUD Resolutions, GM combat lists) and `deathMoves.state`'s `undoEntryId`
  (the party sheet's "Undo death move") are false / null for a player on a rolled action. `deathMoves.state` also no
  longer offers a player the Undo of a row they are not the actor of (the GM's confirmed move: it was FORBIDDEN anyway).
  Client edits: one doc comment in `src/components/party/dice/roll-feed.tsx`. The HUD's "Take it back" (death request)
  and the sheet's `DeathMoveWait` use the request row, which rolled nothing: unchanged.

## 2. Withdraw covers a Charge waiting for its Difficulty

`convex/combatWithdraw.ts`: `withdrawable(payload)` accepts an open `sanction` or a `difficulty` request with
`ask.kind: "charge"` (CB p.59 / p.104: nothing is rolled or paid before the GM sets the Difficulty). The feed line
reads "<name> withdrew a Charge waiting for the GM". The Cloaked `difficulty` ask stays NOT_FOUND (it follows a move
that already happened). Access unchanged (edit on the character).

## 3. dcm-f3l7: adversary attacks against a Hidden PC

It was missing: `convex/lib/adversaryActions.ts` counted Sturdy and Harrowing Invocation per target, never the target's
conditions. Added `hiddenAgainst` in `targetDisadvantage`: a Hidden (or Cloaked, CB p.42) PC target puts one
disadvantage on the attack against them (CB p.103), per target as DA1 does (one roll; a non-Hidden target in the same
attack keeps its own die), counted once with Sturdy / Harrowing (DA17). PCs only; a Hidden adversary ally hit by an
adversary is left as it was.

## Tests

- `tests/convex/action-log.test.ts`: the rule (a player's fresh roll UNDO_EXPIRED, the GM any time; a row without dice
  stays the player's; a death row with dice; a dice-less row in a rolled group).
- `tests/convex/feed.test.ts`: `canUndo` false on a player's roll, true for the GM; a new test for own plain rows vs
  rolled groups.
- `tests/convex/hud-death-confirm.test.ts`: `undoEntryId` for the request's player and the GM only; null for the player
  after the GM's confirm.
- `tests/convex/feature-prompts.test.ts`: withdrawing a waiting Charge (nothing rolled, paid or moved; GM's answer
  REQUEST_NOT_OPEN; another player FORBIDDEN). `tests/convex/hud-withdraw.test.ts`: the Cloaked ask stays NOT_FOUND.
- `tests/convex/adversary-attack-defences.test.ts`: Hidden alone, per Hidden target, Cloaked, Hidden + Sturdy once.
- Tests that had a player undo a roll to test undo itself now undo as the GM, keeping their intent: combat-attack,
  combat-cards, countdown-rolls, countdowns-chase, death-moves, lane-n2-characters, rolls, rolls-session-features,
  wither. `tests/e2e/countdown-rolls.spec.ts`: the player's row shows no Undo; the GM undoes.
- Authz matrix: no expectation changed (`actionLog.undo` uses a GM row: players FORBIDDEN; `deathMoves.undo` uses a
  waiting request: the player ok). Comments in `core.entries.ts`, `play.entries.ts` and `hud.entries.ts` name the rule.

## Open

- The player HUD's "Waiting for the GM" (`hud/pick/waiting.tsx`) lists sanctions only; a waiting Charge has no
  Withdraw button yet (UI, out of this task's scope).
- Vulnerable on a PC (CB p.102: rolls against them have advantage) is not applied to adversary attacks either; not
  asked here.
