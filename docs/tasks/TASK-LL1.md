# TASK-LL1: Less-lethal outcome is the player's request; the GM confirms or changes it

Status: Review. Plan: `.omc/plans/followups-2.yaml`, tracer LL1. Builds on D5 T4 (`TASK-D5-T4.md`).

## Rules (user, 2026-10-18)

- HF 127, "A Less Lethal Campaign": "any death moves that would normally lead to a character's demise can instead lead to a character ending up in the infirmary for a few weeks or being sent home for the semester". The book doesn't say who picks. User: "let the player request. GM has final say".
- Decision 5: a character the GM returns to play is not asked for a death move again just because its Hit Points are still all marked.

## What works

- `characters.away.requested` (optional `true`, widened): set when a non-GM makes the less-lethal death move (`choose` with Risk It All lost, or `finishBlaze`). The GM's own move leaves it out, so it is final. Absent means final, so stored rows stay settled. The log row says "The player's request; the GM decides."
- `deathMoves.settleAway({ characterId, reason })`: keyed, GM only (`loadCharacter(..., "owner")`, else FORBIDDEN). It confirms the requested reason or sets the other one and drops `requested`. DEATH_MOVE_RULE when no request is waiting. The log row is not undoable, and because it bumps `updatedAt` it also ends the death move's undo. "Return to play" still works.
- `deathMoves.state` returns `awayRequested`. `characters.get`/`listByCampaign` don't carry `requested`: `awayView` in `convex/characters.ts` sits outside this tracer's owns, so the badges read `state` instead.
- `characters.deathMoveSpent` (optional `true`, widened): `returnFromAway` sets it when the character comes back with every Hit Point marked. `state.awaitingMove` and `choose` treat the character as not due while it is set. `saveSheet` clears it whenever the saved sheet has `hp < hpMax`, so marking the last Hit Point again brings the prompt back. HP and Stress stay as they were.
- UI (`src/components/party/death/`):
  - For a player, the dialog's picker reads "… — the GM decides" and its options read "Request: In the infirmary" / "Request: Sent home".
  - `AwayRequest`, inside both the sheet's banner badges and the party card badge, shows "Requested". The GM also gets "Confirm" and "Change to in the infirmary/sent home".
  - The badge slots now sit inside `DeathBoundary`, because they query.

## Tests

- `tests/convex/death-moves.test.ts` covers the player's request, GM confirm, GM change, that a player can't settle (FORBIDDEN), that the GM's own move is final, and the authz rows for `settleAway`. It also covers return at full HP: no prompt and `choose` refused; clearing a Hit Point clears the flag; marking it again brings the prompt back. Return below full HP sets no flag.
- `tests/e2e/death.spec.ts`:
  - GM: the move is final, and there is no prompt after Return to play.
  - Player: requests "sent home"; the GM sees "Requested" on the party card, then changes it to the infirmary on the sheet, and the player's sheet follows.

## Known gap

- `undoEntry` in `convex/lib/actionLog.ts` restores a sheet with a direct patch instead of `saveSheet`. An undo that brings a flagged character below full HP therefore leaves `deathMoveSpent` set. It is harmless until the last Hit Point is marked again, and then no prompt appears. A fix belongs in `actionLog.ts`, which is outside this tracer's owns.
