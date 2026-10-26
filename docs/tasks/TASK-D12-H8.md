# TASK-D12-H8: Authz matrix - play (classFeatures, levelUp, deathMoves, rests, rolls, sessionFeatures, photoImport)

Plan `.omc/plans/d12-hardening.yaml`, tracer H8 (depends on H0). Covers the session-features functions of bead
dcm-bxp.64 (`rolls.storeSlayerDie`, `rolls.pendingChoices`, `rolls.tagTeamApply`, `sessionFeatures.bumpMoonDie`, and
the changed `rolls.actionRoll` / `damageRoll` / `manualRoll`) and the rolls/rests functions bead dcm-bxp.79 points to.

## What landed

`tests/convex/authz/play.entries.ts`: all 40 play functions are entries, `pending` is empty.
`tests/convex/authz/play.test.ts` is unchanged (`runMatrix(area)`).

| Access | Count | Functions |
|---|---|---|
| `own` | 25 | classFeatures use, endEffect, gotHit, lastRoll; levelUp apply, undoLast, canUndo, correctLevel; deathMoves choose, finishBlaze, resolveRiskItAll, returnFromAway, settleAway, state; rests projects, choose, createProject; rolls actionRoll, damageRoll, manualRoll, tagTeam, pendingChoices, storeSlayerDie, tagTeamApply; sessionFeatures bumpMoonDie |
| `gm` | 12 | levelUp partyLevelUp; rests start, finish, interrupt, undo; rolls gmRoll, reveal; photoImport available, uploadUrl, claim, discard, create |
| `scoped` | 2 | deathMoves undo, photoImport read |
| `view` | 1 | rests current |

## Expectations read from the code

- `own` writes go through `loadCharacter(..., "edit")`: owner (player) and GM ok, the other party member FORBIDDEN,
  a stranger NOT_FOUND. Reads (`lastRoll`, `canUndo`, `deathMoves.state`, `rests.projects`) load with `"view"`, so
  the other member is ok.
- `rolls.pendingChoices` loads with `"edit"`: `otherPlayer: FORBIDDEN`.
- GM-only character functions load with `"owner"`: `levelUp.correctLevel`, `deathMoves.returnFromAway`,
  `deathMoves.settleAway` set `player: FORBIDDEN`.
- `rolls.tagTeamApply` (U9): setup has playerB lead a Tag Team with characterB and characterA as partner. The lead's
  editor (otherPlayer), the partner's editor (player) and the GM are ok. The grantee row runs with its edit grant
  removed in setup, so it is a plain member outside the Tag Team: FORBIDDEN. This proves "refuses others".
- `deathMoves.undo` (scoped): setup marks every Hit Point on characterA and playerA makes a real Avoid Death move.
  The actor (player) and the GM are ok, the other member FORBIDDEN (`undoEntry`: not the actor), the outsider
  NOT_FOUND.
- `photoImport.read` (scoped action): the GM check is in the internal `readContext` query. Players get FORBIDDEN, the
  outsider NOT_FOUND, the GM gets ok with `okCodes: PHOTO_IMPORT_UNAVAILABLE` (no key in the test deployment) and
  `PHOTO_IMPORT_RULE` (a key but no photos).
- `okCodes` used after the access check: CLASS_FEATURE_RULE, LEVEL_UP_RULE, DEATH_MOVE_RULE, REST_RULE, DICE_RULE,
  NOT_ENOUGH_HOPE, PHOTO_IMPORT_UNAVAILABLE, PHOTO_IMPORT_RULE.

Arguments that would otherwise fail validation before the access check: `levelUp.correctLevel` level 2,
`rests.createProject` name and startingValue 4, `rolls.gmRoll` one d6, `rolls.tagTeam` partnerId characterB,
`photoImport.create` `validDraft()` (tests/fixtures/photo-import). Setups: an open short rest (`rests.finish`,
`interrupt`, `undo`, `choose`), a roll by playerA (`storeSlayerDie`), a GM roll (`reveal`), a non-image stored file
(`photoImport.claim`; the GM's claim deletes it and answers `{ ok: false }`).

## knownBug

None. Every row matched the code's intended access.

## Timing

- `play.test.ts` alone: 35.4 s wall time (23.0 s of tests), load average 41.
- `play.test.ts` plus `authz-matrix.test.ts`, `--maxWorkers=4`: 40.0 s, 197 tests passed.

Both are under the 60 s per-area budget.

## Checks

- `pnpm vitest run tests/convex/authz/play.test.ts tests/convex/authz-matrix.test.ts --maxWorkers=4 --testTimeout=60000`: passes.
- `pnpm exec eslint` on the area files and `pnpm typecheck`: clean.
- `pnpm tracer:guard .omc/plans/d12-hardening.yaml H8`: OK.
