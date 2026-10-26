# TASK-D12-H10: Authz matrix - adversaries (encounters, encounterTracking, customAdversaries)

Plan `.omc/plans/d12-hardening.yaml`, tracer H10 (depends on H0). Harness API: `docs/tasks/TASK-D12-H0.md`.

## What landed

| File | Change |
|---|---|
| `tests/convex/authz/adversaries.entries.ts` | 27 entries (4 customAdversaries, 12 encounters, 11 encounterTracking); `pending` is empty. |
| `tests/convex/authz/adversaries.test.ts` | Unchanged: `runMatrix(area)`. |

## Access classes (read from the code)

Every function is a GM wrapper (`gmQuery`, `gmMutation`, `keyedGmMutation`: `need: "owner"`), so every entry is
`gm`. Each entry also runs the other player and the edit grantee: an edit grant on the campaign is less than
`owner`, so `permissionFor` answers FORBIDDEN.

| Role | anon | outsider | otherPlayer | player | grantee | gm |
|---|---|---|---|---|---|---|
| Outcome (all 27) | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | FORBIDDEN | FORBIDDEN | ok |

162 rows (27 x 6).

## Players' view

Adversary stat blocks (HP, Stress, thresholds, Difficulty), live tracks, Battle Points and encounter notes come only
from GM queries (`encounters:list`, `encounters:get`, `encounterTracking:customBlocks`, `customAdversaries:list`):
both players and the grantee get FORBIDDEN, an outsider NOT_FOUND. No query in this area returns a filtered player
view, so there is no content test; adversary tokens on the players' combat map belong to the combat area (H11).

## World and setup

Area setup (every world), all through the GM's public API: a custom adversary (a copy of the SRD Bear,
`validateCustom(fromSrd(bear))`), an encounter, one instance of that custom block (so `customBlocks` returns a
block), and `encounters:start` (the tracker mutations refuse an encounter that is not running). Ids registered:
`customId`, `encounterId`, `instanceId`; synthesis picks them through the default NAME_HINTS.

Entry setups:

- `encounters:start`: ends the encounter first (start refuses while another encounter runs; an ended one restarts).
- `customAdversaries:remove`: a second, unused custom adversary (remove answers ENCOUNTER_RULE for a block an
  instance comes from).
- `encounterTracking:defeatMinions`: a Minion group (4 Jagged Knife Lackeys) chosen as the instance.
- `encounterTracking:spendFear`: one `fear:adjust` increase, so the GM has a Fear to spend.

Arguments that pass validation are given where the synthesized defaults would not (`addAdversary` source `bear`,
count 1; `markHp`/`markStress` delta 1; `applyDamage` 5; `spendFear` amount 1). No `okCodes` are needed.

## Known bugs

None found: every row matched the expected access.

## Checks

- `pnpm vitest run tests/convex/authz/adversaries.test.ts tests/convex/authz-matrix.test.ts --maxWorkers=4 --testTimeout=60000`:
  171 passed (adversaries 162, guard 9).
- Area runtime: `adversaries.test.ts` alone 17.6 s of tests (25.5 s wall with module loading) at load average about 22; under the 60 s budget.
- `pnpm typecheck` clean; `pnpm exec eslint` on the entries and test files clean.
