# TASK-D12-H12: Authz matrix - sessions (sessions, sessionRecords, sessionPrep, sessionPlay, sessionWrap; dcm-bxp.57)

Plan `.omc/plans/d12-hardening.yaml`, tracer H12 (depends on H0). Harness API: `docs/tasks/TASK-D12-H0.md`.
Beads: dcm-bxp.57 (the D10 session functions), dcm-bxp.64 (`sessions.start` / `end`).

## What landed

| File | Change |
|---|---|
| `tests/convex/authz/sessions.entries.ts` | 32 entries (sessions 4, sessionRecords 6, sessionPrep 9, sessionPlay 7, sessionWrap 6); `pending` is empty. |
| `tests/convex/authz/sessions.test.ts` | `runMatrix(area)` plus one content test of the players' view of sessions. |

`combatTokens:sessionEncounter` and `combatTokens:placeSessionEncounter` (also bead .57) are in
`combat.entries.ts` (H11).

## Access classes (read from the code)

| Functions | Class | Rows |
|---|---|---|
| `sessions:current`, `sessionWrap:dashboard` | `view` (campaignQuery `need: "view"`) | class defaults: anon UNAUTHENTICATED, outsider NOT_FOUND, player ok, gm ok |
| `sessionRecords:list` | `view` (`need: "view"`, `enough: "owner"`) | with only a planned session: anon UNAUTHENTICATED, outsider NOT_FOUND, **player and otherPlayer empty**, gm ok |
| the other 29 (`sessions:allowExtraCharacters`, `start`, `end`; every sessionRecords change; all of sessionPrep, sessionPlay; sessionWrap `get`, `setRecap`, `setLoot`, `setThreads`, `callMilestone`) | `gm` (gm* wrappers, `need: "owner"`) | class defaults plus **grantee FORBIDDEN**: a campaign edit grant does not reach the GM's session tools |

## Setup and arguments

- Area setup: one planned session (`sessionRecords:create`), which the `sessionId` hint picks.
- `sessions:allowExtraCharacters` and `sessions:end` start that session first (`allowExtraCharacters` is INVALID
  without a live session; `end` then has a session to end, so the GM row runs the full end path).
- `sessionPrep:setScene` / `removeScene` add a scene first (`sceneId`); `linkEncounter` creates an unlinked encounter
  (the `encounterId` hint); `sessionPlay:log` / `removeLog` add a typed log line (`w.use("sessionLog", id)`, the
  `logId` hint); `bumpSpotlight` uses characterA (active) through the `characterId` hint.
- Arguments that pass validation are given where synthesis would fail it (`"x"` is no date, an empty log line is
  INVALID): titles, a `YYYY-MM-DD` date, hooks, recap, loot, threads, a log line.

## Players' view

- Matrix rows: `sessionRecords:list` with only a planned session is empty for both players; every GM read
  (`sessionPrep:get`, `current`; `sessionPlay:spotlight`, `tally`, `log`; `sessionWrap:get`) refuses both the player
  and the grantee with FORBIDDEN.
- `sessions.test.ts` content test, with a played session (recap), a live one (hooks, a log line, a spotlight count) and
  a planned one: for player and otherPlayer, `sessionRecords:list` holds exactly the live and the played session,
  carries the recap, no `startedAt` / `endedAt` and no prep text; `sessionWrap:dashboard` and `sessions:current`
  name the live session; on both the live and the played session `sessionPrep:get`, `sessionPlay:log`,
  `sessionPlay:spotlight`, `sessionPlay:tally` and `sessionWrap:get` throw FORBIDDEN. The GM's list holds all three.

## Known bugs

None found: every row matched the expected access on the first run.

## Checks

- `pnpm vitest run tests/convex/authz/sessions.test.ts tests/convex/authz-matrix.test.ts --maxWorkers=4 --testTimeout=60000`:
  168 passed (sessions 159 = 158 matrix rows + 1 content test; guard 9).
- Area runtime: `sessions.test.ts` alone 9.3 s of tests (14.5 s wall with module loading) at load average about 27.
- `pnpm typecheck` clean; `pnpm exec eslint` on both test files clean.
- `pnpm tracer:guard .omc/plans/d12-hardening.yaml H12`: passes.
