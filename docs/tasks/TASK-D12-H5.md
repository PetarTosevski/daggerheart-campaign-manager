# TASK-D12-H5: Authz matrix - core

Plan `.omc/plans/d12-hardening.yaml`, tracer H5 (depends on H0). Rule 14 / TE2. Owns
`tests/convex/authz/core.entries.ts`, `tests/convex/authz/core.test.ts` (unchanged) and this file.

## What landed

`core.entries.ts` has **32 entries** and an empty `pending`: the 31 core functions (campaigns, members, settings,
users, fear, wither, feed, history, actionLog, campaignTime) plus the worked `characters:get` entry from H0. The three
Convex Auth exports stay in `exempt`. 157 rows run on the default witherwild world (campaign time and Wither tokens).

| Class | Functions |
|---|---|
| `user` (4) | campaigns:list, campaigns:create, settings:get, settings:update |
| `maybe` (2) | campaigns:get (outsider `null`: no existence leak), users:viewer |
| `view` (5) | campaigns:markOpened, members:roster, members:leave, feed:list, campaignTime:get |
| `gm` (16) | campaigns:remove, setOption, updateTome; members:access, invite, removePlayer, rotateJoinCode; fear:adjust, set; wither:gain, adjust; feed:remove, clear; history:list; campaignTime:advance, setDay |
| `scoped` (4) | campaigns:restore, members:revokeInvite, members:joinByCode, actionLog:undo |
| `own` (1) | characters:get (H0) |

### Scoped entries (all roles stated)

| Function | Setup | anon | outsider | otherPlayer | player | grantee | gm |
|---|---|---|---|---|---|---|---|
| campaigns:restore | GM deleted the campaign | UNAUTHENTICATED | NOT_FOUND | NOT_FOUND | NOT_FOUND | NOT_FOUND | ok |
| members:revokeInvite | GM invited an email | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | FORBIDDEN | FORBIDDEN | ok |
| members:joinByCode | the world's code | UNAUTHENTICATED | ok | - | ok | - | ok |
| actionLog:undo | GM's Wither correction on characterA | UNAUTHENTICATED | NOT_FOUND | FORBIDDEN | FORBIDDEN | FORBIDDEN | ok |

### Arguments and okCodes

- `wither:adjust` gets `delta: 1` and `campaignTime:setDay` gets `cycleDay: 2` (H0's sample threw WITHER_RULE /
  TIME_RULE for the GM with the synthesized 0); both now resolve for the GM with no okCodes.
- `fear:set` `value: 3`; `campaigns:setOption` `witherPersists` (a witherwild option); `members:invite` an email;
  `members:removePlayer` removes playerB; `campaigns:create` a name.
- `campaigns:updateTome` okCodes `INVALID`: only a custom campaign has a tome, and the check runs after the GM check.
- `members:leave` okCodes `INVALID`: the GM cannot leave their own campaign (after the view check).
- `campaigns:get` gets the campaign id (its argument is a `v.string()` URL segment, which the synthesizer would fill
  with "x").

### Extra rows

Grantee rows (edit grant on the campaign) on the gm entries that a grant could plausibly loosen (all FORBIDDEN, as
`need: "owner"` requires); otherPlayer and grantee rows on member reads and on markOpened and leave.

## knownBugs

None. Every function's runtime access matches the code's intent and rules 2 and 3: owner-only writes go through
`gm*` or `permissionFor(..., "owner")`, member reads through `need: "view"`, and the three hand-checked user mutations
(restore, revokeInvite, undo) derive access from the target row's campaign, never from an argument.

## Timing

`core.test.ts` alone, `--maxWorkers=4`, load average about 28 (other tracers running): 157 tests, 23.8 s of tests,
30.8 s wall including module loading. Within the 60 s area budget. With `authz-matrix.test.ts`: 166 tests, 14.9 s
wall at a moment of lower load.

## Checks

- `pnpm vitest run tests/convex/authz/core.test.ts tests/convex/authz-matrix.test.ts --maxWorkers=4 --testTimeout=60000`: green.
- `pnpm exec eslint` on the entries file and `pnpm typecheck`: clean.
- `pnpm tracer:guard .omc/plans/d12-hardening.yaml H5`: passes.
