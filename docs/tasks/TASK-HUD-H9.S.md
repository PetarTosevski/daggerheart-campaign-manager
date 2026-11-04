# TASK-HUD-H9.S: spotlight server: hand it to the whole party, take it for an adversary with 1 Fear

Status: Review. Plan `.omc/plans/combat-hud.yaml`, wave 10, tracer H9.S (boards CmpTokens, GMDesktop). User answers
2026-11-04 Q7 (a) and Q8 (a) (`.omc/plans/combat-hud-v2-delta.md`).

## Rules implemented

- CB p.155 (GM chapter, "Fear"): "When you spend a Fear, you can: Interrupt the players to make a move." and "you can
  spend a Fear to interrupt the action and spotlight an adversary". CB p.153: "You can spend a Fear to make an
  additional GM move, shifting the spotlight to another adversary" (the per-turn charge `encounterTracking.spotlight`
  and the adversary actions already apply).
- Q7 (a): "1 Fear" pays the interrupt and counts as that adversary's spotlight this GM turn, so its first action costs
  nothing more (no double charge). "Free" costs nothing. Giving it to a PC or the party is free.
- Q8 (a): "The whole party (players decide who acts)" is a holder: players' controls unlock as with a PC holder.

## What landed

- **Helpers** `convex/lib/spotlight.ts`:
  - `giveToParty(ctx, campaign)`: deletes the campaign's `combatSpotlight` row, which `state` already reads as holder
    null ("the players, nobody in particular"); returns whether it moved (false when there was no row).
  - `takeWithFear(ctx, campaign, actorId, tokenId?)` and `INTERRUPT_FEAR = 1`. Order: token check
    (COMBAT_TOKEN_NOT_FOUND; INVALID for a token that is not an adversary's), then the Fear check (**NOT_ENOUGH_FEAR**
    when the GM has less than 1), then the move (as `spotlightAdversary` / `moveToGm("gmTook")`). Only when the
    spotlight moved: `spendFear(…, 1, "interrupt")` (a `history` row, kind fear, action spend), the adversary's running
    encounter instance marked spotlit for the current `gmTurn` (`applySpotlight`) unless it already is, and one
    undoable `actionLog` group (kind `adversary`): a GM row naming the adversary with `fearDelta: -1`, and a public row
    "The GM spent 1 Fear to interrupt" that names nobody (players never learn an unseen adversary from the feed).
    Taking what the GM already holds spends nothing. A token with no running encounter: only the Fear is spent.
- **Functions** `convex/combatSpotlight.ts`:
  - `gmTake({ campaignId, idempotencyKey, tokenId?, pay? })`: `pay: v.optional(v.union(v.literal("free"),
    v.literal("fear")))` (widened; omitted = `free` = the old behaviour). Returns `{ moved }` (unchanged).
  - **New** `handToParty({ campaignId, idempotencyKey })`: `keyedGmMutation`, returns `{ moved: boolean }`; idempotent.
  - `state`'s `returns` validator is unchanged (holder null already meant the party).
- **No double charge:** the adversary actions' `spotlightFearFor` asks no spotlight Fear for an instance already
  spotlit this GM turn, so the paid adversary's first action asks nothing more, even as the turn's second spotlight
  (tested with a real `adversaryActions.attack`). Clicking the tracker's own `encounterTracking.spotlight` for it after
  a paid take still counts (and charges) a further spotlight; that file is not H9.S's (bead dcm-iukg).
- **Undo:** the GM's `actionLog.undo` of the paid take gives the Fear back (`fearReverted: -1`, a history row with
  action undo). Players get FORBIDDEN (the rows are the GM's). The spotlight stays where it is (moving it is the GM's
  next move, as in H1.S) and so does the instance's spotlight count: `adversaryBefore` has no spotlight fields (an
  engine validator, not owned): bead dcm-iukg.

## Tests

- `tests/convex/spotlight-v2.test.ts`: party holder (from a GM and a PC holder, idempotent, free, everyone unlocked);
  Free and omitted `pay` cost nothing; 1 Fear spends it and counts the spotlight; no double charge on the adversary's
  first attack (with a free-take contrast that asks `confirmFear`); an already-spotlit adversary is not counted twice;
  a general interrupt; no spend when nothing moves; NOT_ENOUGH_FEAR with nothing written; bad tokens refused before
  spending; the log group and the GM's undo restoring the Fear; players FORBIDDEN on both mutations and on undoing the
  paid take.
- `tests/convex/authz/spotlight.entries.ts`: `handToParty` (access gm).

## For H9.1 (spotlight disc)

- Party row: `handToParty({ campaignId, idempotencyKey })`; optimistic update: `state` becomes the "none" shape
  (holder, since, reason, rollBy, adversaryTokenId, adversaryName null; `reactionsOnly` false).
- Adversary row: `gmTake({ tokenId, pay: "free" | "fear" })`; disable "1 Fear" at 0 Fear; NOT_ENOUGH_FEAR is already
  mapped in `src/lib/errors/refusals.ts`.

## Out of owns

None. The module already existed, so its new function is typed without codegen; the orchestrator regenerates after
merge as usual.
