# TASK-HUD-HD4: a player's death move waits for the GM's confirm

Plan `.omc/plans/combat-hud.yaml`, wave 5 batch A, tracer HD4 (boards Main, CmpPromptsGM). Bead dcm-bxp.99.32.7.
User answer 15b (2026-11-01): a player's chosen death move is stored as awaiting the GM; the GM confirms it or sends it
back; only at confirm do the dice and the outcome apply, as they do today; the party sheet and the HUD both show the
wait. H4.3 (HUD death modal, GM confirm popup) and H5.1 (queue) consume the contract below.

The rule (Core Book p. 106, PDF page 107): "DEATH MOVE  Choose one of the following options: Blaze of Glory: Your
character embraces death and goes out in a blaze of glory. Take one action (at the GM's discretion), which critically
succeeds, then cross through the veil of death. Avoid Death: ... After your character falls unconscious, roll your Hope
Die. ... Risk It All: Roll your Duality Dice." The GM chapter (p. 182, PDF page 183): "When a player is considering
which death move to choose, make space for them to work and talk through their decision." The confirm step is the
table's ruling on top of that (answer 15b); the moves themselves are unchanged.

## What landed

- `convex/deathMoves.ts`
  - `choose`: the GM's choose (campaign-level `permissionFor` "owner") is made at once, as before. A player's choose
    (owner or edit grantee) is stored as waiting: one feed row, nothing rolled or applied. New return field
    `awaitingGm`.
  - New `confirm` and `decline` (GM only, keyed). The move-making code moved unchanged into `makeMove`, which the GM's
    choose and `confirm` share.
  - `undo`: undoing the request row takes the request back.
  - `state`: new `request` field. `awaitingMove` is false while a move waits.
- `convex/tables/characters.ts` (**out of owns**, see Deviations): the characters table gets the optional field
  `deathRequest` (rule 7 widen: older rows have none, so no migration and no version bump).
- `src/lib/errors/death.ts`: new code `DEATH_MOVE_NOT_WAITING`.
- `src/components/party/death/waiting.tsx` (new), plus `death-move.tsx`, `badges.tsx` and `death.css`:
  - The sheet's death strip shows the player "Waiting for the GM to confirm <move>." with Take it back.
  - It shows the GM a confirm card (`role="group"`, name "Death move to confirm") with Confirm the death move and
    Send it back.
  - The banner and the dashboard party card show "<move>: waiting for the GM" (`data-testid="death-request"`).
  - `deathResultText` is the shared result line.
- Tests:
  - `tests/convex/hud-death-confirm.test.ts`: 11 tests.
  - `tests/unit/hud/death-confirm.test.tsx`: 7 tests.
  - `tests/e2e/death.spec.ts`: the Castle High player test now goes through the GM's confirm, plus one new two-browser
    test (send back, choose again, confirm, GM undo).

## The contract (for H4.3 / H5.1)

```ts
api.deathMoves.choose({ characterId, move, action?, awayReason?, idempotencyKey })
  -> { entryId, status, pending, hopeDie, fearDie, scarred, journeyEnds, awaitingGm: boolean }
api.deathMoves.confirm({ characterId, awayReason?, idempotencyKey })   // GM only; rate limit "roll"
  -> same shape as choose, awaitingGm: false
api.deathMoves.decline({ characterId, idempotencyKey })                // GM only
  -> null
api.deathMoves.state({ characterId })
  -> { awaitingMove, pending, request: null | { move, action?, awayReason?, entryId, at }, undoEntryId, lessLethal, awayRequested }
```

### `choose`

- **The GM's choose** is made at once, as before.
- **A player's choose** writes one public, undoable `kind: "death"` feed row and stores the move as
  `characters.deathRequest`. The row reads "<name> chooses <Move>[: <action>]. Waiting for the GM to confirm." It has
  no roll and no `before`, and its `groupId` is `death-request:<characterId>:<at>`. The move returns
  `awaitingGm: true`, `entryId` = the request row, every die `null`, `pending: null`.
- **Refused** with DEATH_MOVE_RULE when a move is already waiting, for the player and the GM alike.

### `confirm` (GM)

- Makes the stored move now, exactly as the GM's own `choose` does. The server rolls every die. Blaze of Glory still
  waits for `finishBlaze`, and Risk It All won with Hope still waits for `resolveRiskItAll`; the player or the GM
  takes either step.
- The rows are the GM's (`actorId`). When the request row is still the character's latest live row, the move's row
  joins its group, so the GM's undo takes back both rows and the move is due again.
- `awayReason` (Castle High): given, it is final. Left out, the player's pick stays a request (`away.requested`) that
  the GM settles later with `settleAway` (LL1).

### `decline` (GM)

- Clears the request and undoes the request row when it is still the latest (so it no longer blocks undoing earlier
  rows).
- Logs a public, non-undoable feed line with no `characterId`: "The GM sends back <name>'s <Move>: choose again." (as
  HD3 does). The move is due again.

### Taking it back (player)

- `deathMoves.undo({ entryId: request.entryId })` takes the request back. So does the feed's generic
  `actionLog.undo`: a request whose row is undone no longer counts.

### Errors (`ConvexError.data.code`)

| Code | When |
| --- | --- |
| UNAUTHENTICATED | No signed-in user. |
| NOT_FOUND | Outsider. |
| FORBIDDEN | A player calling `confirm` or `decline`, including the character's own player. |
| DEATH_MOVE_NOT_WAITING (new) | `confirm` / `decline` with nothing waiting: none chosen, already confirmed or sent back, or taken back. |
| DEATH_MOVE_RULE | `confirm` when the move is no longer due (a Hit Point was cleared meanwhile; send it back instead), or `choose` while a move waits. |
| RATE_LIMITED | `confirm`. |
| IDEMPOTENCY_MISMATCH | An idempotency key reused for another request. |

### What the client reads to show the wait

- `deathMoves.state(characterId).request`: non-null exactly while a move waits.
- While a move waits, `awaitingMove` is false (do not open the choose modal) and `undoEntryId === request.entryId`
  (the player's Take it back).
- Player view: "Waiting for the GM to confirm <DEATH_MOVE_LABELS[move]>." GM view: the confirm card from `request`.
- **H4.3 note:** HD1's `combatHud.party` field `deathMoveDue` stays true while a move waits. It does not know about
  requests. To tell "choose" from "waiting", read `deathMoves.state`.
- Optimistic update: none added. The buttons disable while their mutation runs. A confirm rolls on the server, so its
  result can't be predicted.

## Deviations and out-of-owns edits

- `convex/tables/characters.ts`: the stored widen the acceptance asks for. No owned file holds a stored shape: the
  table and the validators are only in `reads`. This is one optional field, inline, with no other change.
- `tests/convex/death-moves.test.ts`: a `played(who, args)` helper (choose, then the GM's confirm when the move waits)
  replaces the players' direct `choose` calls. The undo test now expects the player's FORBIDDEN on the GM's confirmed
  row, then undoes it as the GM.
- `tests/convex/lane3-e1a-use-paths.test.ts` (the Avoid Death and Cloaked test): the GM confirms, and the GM undoes.
- The behaviour change these tests follow: a player no longer undoes their own death move within the dice minute.
  The confirmed rows are the GM's, so the GM undoes them. Before the confirm, the player takes the request back.
- **Not changed** (not owned; classic UI, deleted at wave 9): the Combat Map's `MapDeathMove` in
  `combat-map/actions/reactions/index.tsx` mounts the modal only while `awaitingMove || pending`. On the classic map, a
  player's modal closes once they choose, and the wait shows on the sheet, the party card and the feed, not on the
  map. H4.3 shows it in the HUD.

## Checks

- `pnpm lint`: clean. `pnpm typecheck`: clean (with `convex/_generated` regenerated locally, not committed).
- Focused: `hud-death-confirm.test.ts`, `death-moves.test.ts`, `lane3-e1a-use-paths.test.ts`, `authz/play.test.ts`:
  237 passed. `tests/unit/hud/death-confirm.test.tsx`: 7 passed.
- Full vitest (`--maxWorkers=2 --testTimeout=120000`): 462 files; 10379 passed, 1 expected fail, 1 failed. The one
  failure is the matrix inventory guard (`deathMoves:confirm`, `deathMoves:decline` have no entry). It is fixed by
  merge-time action 1.
- e2e `tests/e2e/death.spec.ts` (ports 3165 / 3442): 5 passed.

## Merge-time actions

1. Add the two entries to `tests/convex/authz/play.entries.ts`, after `deathMoves.state`. Without them,
   `authz-matrix.test.ts`'s inventory guard fails. They were checked locally: matrix and `play.test.ts`, 220 passed.

   ```ts
   // HD4: GM only (`loadCharacter(..., "owner")`); nothing waits in the matrix world, so the GM meets DEATH_MOVE_NOT_WAITING.
   { fn: api.deathMoves.confirm, access: "own", expect: { player: "FORBIDDEN" }, okCodes: ["DEATH_MOVE_NOT_WAITING"] },
   { fn: api.deathMoves.decline, access: "own", expect: { player: "FORBIDDEN" }, okCodes: ["DEATH_MOVE_NOT_WAITING"] },
   ```

   The briefs' "Server work" line names `hud.entries.ts`. The functions live in the `deathMoves` module, whose other
   entries are in `play.entries.ts`, so they go there, as the orchestrator asked.
2. Regenerate `convex/_generated` (`npx convex codegen`): there is no new module, the `deathMoves` module gains
   exports, and the schema gains a field.
3. No migration and no backfill: the field is optional and absent on every existing row.

## Questions

1. **Should the GM's confirm card offer the less-lethal place?** Today the GM confirms the move, and the player's pick
   stays a request that the GM settles afterwards (two clicks when Fear wins). The server already takes `awayReason`
   on `confirm` (final). The safe default leaves it out, so the GM decides after seeing the dice (LL1).
2. **Should a player undo their own confirmed move within the dice minute, as before?** The confirmed rows are the
   GM's, so only the GM undoes them. Book: "Take one action (at the GM's discretion)" (CB p. 106) suggests the GM owns
   the outcome. This is reversible: switch `actorId` to `deathRequest.requestedBy` in `confirm`.
3. **Should an edit grantee who is not the GM also wait?** Today it waits, because only the GM is exempt (the same
   line LL1 draws for `away.requested`).
4. **Does Blaze of Glory's finish step need its own confirm?** HD4 confirms once, at the move. The narrated action and
   the crossing then follow without a second wait.
