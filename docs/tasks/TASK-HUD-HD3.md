# TASK-HUD-HD3: a player withdraws a use waiting on GM approval

Plan `.omc/plans/combat-hud.yaml`, wave 4 batch A, tracer HD3 (board CmpPromptsPlayer). Bead dcm-bxp.99.32.6.
User answer 8a (2026-11-01): add a player withdraw for a use waiting on GM approval; nothing was rolled or paid, the
GM's queue item disappears. Server only: no UI, so no board shots (H3.0 draws "Waiting for the GM" with Withdraw).

## What landed

- `convex/combatWithdraw.ts`: `combatWithdraw.withdraw({ requestId })`, a `keyedCampaignMutation` (`need: "view"`).
- `tests/convex/hud-withdraw.test.ts`: 6 content tests (card / attack / feature, GM queues, feed line, nothing paid,
  idempotency, already answered, who may withdraw, NOT_FOUND cases).
- `tests/convex/authz/hud.entries.ts`: the matrix entry (class `view`; otherPlayer FORBIDDEN, grantee ok).
  `hud.test.ts` is unchanged (it already runs the area).

## The mutation contract (for H3.0)

```ts
api.combatWithdraw.withdraw({ campaignId, idempotencyKey, requestId: Id<"combatRequests"> })
  -> { status: "withdrawn", requestId }
```

- **What it withdraws:** an open `sanction` request (combat-actions Q1): an out-of-range attack
  (`combatActions.attack` -> `{ status: "pending", requestId }`), card use (`combatCards.useCard`) or feature use
  (`combatFeatures.useFeature`). The `requestId` is the one the pending result returned, or a row of
  `combatRequests.mine` / `combatCards.pending` / `combatFeatures.pending`.
- **Who:** edit permission on the request's character, decided by `loadCharacter(ctx, ctx.user, characterId, "edit",
  "owner")` (`permissionFor` underneath), as `useCard` / `useFeature` decide who may use it: the character's player,
  an edit grantee, or the GM. Anonymous UNAUTHENTICATED, outsider NOT_FOUND, another player FORBIDDEN (checked before
  the request's status, so another player never learns whether it is still open).
- **Errors (`ConvexError.data.code`):** NOT_FOUND (bad id, another campaign's request, a request that is not a
  sanction); FORBIDDEN (no edit on the character); REQUEST_NOT_OPEN (already approved, declined, withdrawn or closed
  with its encounter; existing code in `src/lib/errors/adversaryActions.ts`, no new code added); IDEMPOTENCY_MISMATCH
  (a key reused for another request).
- **Idempotent:** `ctx.once("combat_withdraw", { requestId })`: a retry with the same key returns the stored
  `{ status: "withdrawn", requestId }`; a second withdraw with a new key is REQUEST_NOT_OPEN. No rate limit (it rolls
  nothing; the wrapper's idempotency and the one-open-row nature bound it).
- **Effects:** closes the row (`closeRequest`: status, `resolvedAt`, `resolvedBy`). The open-row reads
  (`combatRequests.mine`, `combatCards.pending`, `combatFeatures.pending`) drop it at once, so the GM's queue item and
  the player's "Waiting for the GM" both disappear reactively; the GM's later `sanction` answers REQUEST_NOT_OPEN.
  Nothing is rolled, paid or refunded (nothing was). Kept dice (`keepDice`, a feature use's choice dice) are left to
  expire on their own (`KEPT_DICE_MS`, 15 min), so withdrawing and re-sending never rerolls them.
- **Feed line:** one `actionLog` row, `kind: "combat"`, `visibility: "public"`, `undoable: false`, actor the caller,
  summary `"<name> withdrew <use> waiting for the GM"` (`<use>`: the card's printed name, the feature's name, or
  "an attack"). It has no `characterId`, so it never blocks undoing the character's own earlier action
  (`latestLiveRow` reads by character).
- **Optimistic update (H3.0):** the client may drop the request from its local `combatRequests.mine` /
  `combatCards.pending` / `combatFeatures.pending` results on click.

## Status chosen

`combatRequestStatusValidator` is `open | resolved | declined`; there is no `withdrawn`, and HD3 does not own the
validator. Per the brief, a withdrawn request is stored as **`status: "declined"` with `resolvedBy` = the withdrawing
user** (a GM decline carries the GM's id; for the usual case, the player who asked, `resolvedBy === createdBy`). The
feed line is the durable record. Limitation: when the GM withdraws (allowed through edit), the row reads as a GM
decline, which means the same thing at the table. The retention cron sweeps it a day later like any declined row.

Widen filed for the vocabulary lane: **dcm-bxp.99.32.17** (`lane:w3-vocabulary`): widen with `withdrawn`, add it to
the retention cron's range and `closeRequest`'s type, migrate `sanction` rows with `declined` and
`resolvedBy === createdBy`, then switch `withdraw` to write it. The return value (`status: "withdrawn"`) stays as is.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean.
- Focused: `tests/convex/hud-withdraw.test.ts` + `tests/convex/authz/hud.test.ts`: 30 passed.
- Full vitest (`--maxWorkers=2 --testTimeout=120000`): 454 files, 10261 passed, 1 expected fail.

## Merge-time actions

- Regenerate `convex/_generated` (new module `combatWithdraw`; the generated file is not committed).
- No schema change, no migration, no new error code.

## Questions

1. Should other requests that wait on the GM be withdrawable too? HD3 takes only `sanction` (the plan's "card,
   feature or attack use" waiting for approval). A player's Charge (CB p.59, `featurePrompts.charge`) also waits on
   the GM, for its Difficulty ("The GM sets this Difficulty", CB p.104), with nothing rolled or paid yet, so it could be
   withdrawn the same way (`difficulty` request, `ask.kind: "charge"`). The Cloaked `difficulty` ask follows a move
   that already happened and is not a use. Both stay NOT_FOUND here. Safe reversible default: sanctions only; adding
   the Charge is a one-line widening of the kind check.
2. Should the GM's queue show a short "withdrawn" notice instead of the item simply disappearing? Today it only
   disappears (answer 8a), plus the public feed line.
