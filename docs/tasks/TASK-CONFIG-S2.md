# TASK-CONFIG-S2: campaign settings single-field setter

Plan `.omc/plans/config.yaml`, tracer S2 (bead dcm-jh6d.6). Server only; no UI.

## What changed

- **`convex/campaignSettings.ts` (new):** `campaignSettings.set`, a `gmMutation` with args `{ campaignId, change }`,
  returns `null`. `change` is `tableSettingChangeValidator` (exported, with its `TableSettingChange` type): a `v.union`
  of one `{ key, value }` object per field of `tableSettings`:
  `playersSeeFear` boolean, `outOfRange` ask/refuse, `spotlightToPlayers` boolean, `lorekeeperWeb` boolean,
  `lorekeeperAsk` everyone/gm, `fearAtStart` carry/pcs, `sessionOpensOn` journal/combatMap, `autoSessionLog` boolean.
  The value validators are S0's (`convex/lib/validators/campaigns.ts`), built from the choice lists in
  `src/lib/config/campaign-settings.ts`.
- The handler patches only that field of `campaigns.tableSettings` (the other stored fields kept). A change equal to
  the resolved value (the stored one, or the default when unset) writes nothing, so an untouched field keeps following
  the default.
- Every member reads the result from `campaigns.get`'s `settings` (S0), so a change reaches everyone at once.

## Decisions

- No-op = equal to the **resolved** value: setting a default on an unset field does not store it.
- No archived check in the handler: G1's wrapper guard throws `CAMPAIGN_ARCHIVED` for every campaign mutation. The
  test is `it.todo` in `tests/convex/campaign-settings.test.ts` until G1 merges.
- Access is `gmMutation` (`need: "owner"`); G1's `rolePermission('coGm') = 'owner'` lets co-GMs in without changes here.
  A campaign edit grant does not reach it (grantee FORBIDDEN in the matrix).

## Tests

- `tests/convex/campaign-settings.test.ts`: patches one field and both GM and player `campaigns.get` see it; every key
  sets; no-op writes nothing; unknown key / wrong type / missing value / extra field fail the args validator; a player
  gets FORBIDDEN and nothing is written; archived todo.
- `tests/convex/authz/config-settings.entries.ts` (+ `.test.ts`): class `gm`, grantee and otherPlayer FORBIDDEN.

## Questions used

Q3 / Q2 a / Q5 a (meanings of the fields, from S0). None of the 2026-11-05 questions block S2.

## Checks

`pnpm lint`, `pnpm typecheck`, focused vitest (campaign-settings, authz config-settings, authz-matrix), full vitest
(`--maxWorkers=1 --testTimeout=120000`), `pnpm tracer:guard`. `npx convex codegen` run locally; `_generated` not
committed.
