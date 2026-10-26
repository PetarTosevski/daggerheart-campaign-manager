# TASK-D12-H6: Authz matrix - countdowns

Plan `.omc/plans/d12-hardening.yaml`, tracer H6 (depends on H0). Bead dcm-bxp.79. Rule 14 / TE2.

## What landed

`tests/convex/authz/countdowns.entries.ts`: 16 entries, `pending` empty. `countdowns.test.ts` is unchanged (it runs
`runMatrix(area)`).

| Function | Wrapper | Access | Rows beyond the class defaults | State the entry needs |
|---|---|---|---|---|
| `countdowns:listByCampaign` | campaignQuery view (enough owner) | view | player, otherPlayer, grantee: `empty` | area countdown is private |
| `countdowns:create` | keyedGmMutation | gm | | `startingValue: 4` (the schema needs one start) |
| `countdowns:createChase` | keyedGmMutation | gm | | start 6, lead small |
| `countdowns:setVisibility` | keyedGmMutation | gm | | |
| `countdowns:setArmed` | keyedGmMutation | gm | | |
| `countdowns:decideChase` | keyedGmMutation | gm | | a chase with both rows at 0 |
| `countdowns:operate` | keyedUserMutation | scoped | anon UNAUTHENTICATED, outsider NOT_FOUND, otherPlayer / player / grantee FORBIDDEN, gm ok | |
| `countdownRolls:preview` | gmQuery | gm | | a counted action roll by playerA |
| `countdownRolls:applyRoll` | keyedGmMutation | gm | | the roll plus a standard countdown |
| `countdownRolls:countedRows` | gmQuery | gm | | the roll |
| `countdownTracks:setStep` | keyedGmMutation | gm | | value 5 |
| `countdownTracks:setRestMode` | keyedGmMutation | gm | | |
| `countdownTracks:afterRest` | gmQuery | gm | | |
| `countdownTracks:tickOnRest` | keyedGmMutation | gm | | a finished long rest |
| `environmentActions:spendFear` | keyedGmMutation | gm | | Hope & Fear on, GM Fear 5; Raging River / Undertow |
| `environmentActions:startCountdown` | keyedGmMutation | gm | | Hope & Fear on; Mountain Pass / Icy Winds |

The area setup creates one dashboard countdown per world: long-term (the countdownTracks functions accept it),
unarmed (a finished long rest does not tick it before `tickOnRest` does) and private (players see none in
`listByCampaign`). No entry uses `okCodes`: every GM row reaches a real success.

### countdowns.operate: plan text versus code

The plan's goal says "player NOT_FOUND on a hidden countdown, ok on a revealed one". The code does not do that, and
correctly so: `operate` loads the countdown's campaign through `campaignAccess(..., "owner")` and throws FORBIDDEN for
any member below owner, whatever the countdown's visibility (countdowns are GM-run; players read them only). The entry
therefore states FORBIDDEN for player, otherPlayer and the edit grantee, NOT_FOUND for the outsider. A player who
somehow holds a private countdown's id learns only that it exists in their own campaign; no fields leak and nothing
is written, so this is not filed as a bug.

## Bead .79 coverage

- Added (all have entries): countdowns.setArmed, createChase; countdownRolls.preview, applyRoll, countedRows;
  countdownTracks.setStep, setRestMode, afterRest, tickOnRest.
- Changed, in this area: countdowns.create, listByCampaign, operate, setVisibility; environmentActions.startCountdown.
- Changed, in other areas: rolls.actionRoll, rolls.manualRoll, rolls.tagTeamApply (play, H8); rests.finish,
  rests.interrupt, rests.undo (play, H8); actionLog.undo (core, H5).

## knownBug

None.

## Checks

- `pnpm vitest run tests/convex/authz/countdowns.test.ts tests/convex/authz-matrix.test.ts --maxWorkers=4
  --testTimeout=60000`: 2 files, 77 tests passed (68 countdown rows), 13.6 s wall, load average about 30.
- Area runtime: countdowns.test.ts alone 17-29 s of test time (load average 28-40), within the 60 s budget.
- `pnpm exec eslint` on the area files and `pnpm typecheck`: clean.
- `pnpm tracer:guard .omc/plans/d12-hardening.yaml H6`: passes.
