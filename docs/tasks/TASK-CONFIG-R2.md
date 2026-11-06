# TASK-CONFIG-R2: Out-of-range actions: Refuse

Plan `.omc/plans/config.yaml`, tracer R2 (bead dcm-jh6d.12). User answer Q2 (a), binding.

Core Rulebook p.103 (Range): "Anything beyond a character's Very Far range is Out of Range and usually can't be
targeted." The table setting `tableSettings.outOfRange` (S0) chooses between two behaviours for a target outside the
action's own range band:

- **ask** (the default): today's GM sanction (`pending` + a `combatRequests` row). Unchanged.
- **refuse**: the server throws `COMBAT_TARGET_OUT_OF_RANGE` for a player's action. The message names the farthest band
  a target is at ("Out of range: the target is at Very Far range, …"). Nothing is rolled, paid or logged, and no request
  opens.

The GM or a co-GM acting for a PC is never refused: their character permission is `"owner"`, and they keep today's
sanction. A player with an edit grant on the character is still a player, so they are refused.

## Paths

| Path | ask | refuse (player) |
| --- | --- | --- |
| `combatActions.attack`: the attack's own target | sanction | refused before anything is rolled |
| `combatActions.attack`: a rider's extra target (Hold Them Off, Surrounded) out of the rider's range | sanction (DA2) | dropped (`withoutTargets`, the same as the GM's Decline). A rider left with no target is dropped and not paid. The attack goes on |
| `combatActions.attack` answering a forced attack (`forcedRequestId`) | no range check (the GM chose the targets) | unchanged |
| `combatCards.useCard`, no riders | sanction (dice kept) | refused before the dry run |
| `combatCards.useCard`, with riders or Rise to the Challenge | sanction | refused before anything is paid (the transaction rolls back) |
| `combatFeatures.useFeature`, no riders | sanction (dice kept) | refused before the dry run |
| `combatFeatures.useFeature`, with riders | sanction | refused before anything is paid (the transaction rolls back) |
| `featurePrompts.charge`, `featurePrompts.allyRoll` | already refused (`COMBAT_TARGET_INVALID`); no request | unchanged |

Riders add targets only to weapon attacks: card and feature rolls already refuse an `addTargets` rider ("A rider can't
add targets to this roll yet"), so the drop rule applies to attacks only.

## Code

- `convex/combatActions.ts`: `refusesOutOfRange(campaign, gm)` and `outOfRangeRefusal(targets)`, both exported. `attack`
  drops the out-of-range extra targets of riders, re-picks the riders, then refuses an out-of-range main target.
- `convex/combatFeatures.ts`, `convex/combatCards.ts`: `editableHere` also returns `gm` (the permission
  `loadCharacter` returns is `"owner"`). `useFeature` and `useCard` refuse in both branches, with and without riders.
- `tests/convex/out-of-range-refuse.test.ts`: 14 tests. They cover the attack (player, edit-grant player, GM, co-GM, ask),
  riders (out-of-range target dropped and not paid; in-range target kept; the GM keeps the sanction), cards and features
  (with and without riders; GM, co-GM, ask), and an in-range action under refuse.

## Out of owns

- `convex/combatCards.ts` (the orchestrator approved it): the card path opens its own out-of-range requests in
  `useCard`, so the brief's "cards" need it. The edit is the `gm` field in `editableHere`, one import and two refuse checks.

## Decisions (defaults taken)

- The message names the band the target is at (the farthest when there are several targets), not the action's range.
- With refuse, a rider's extra target is dropped silently, with no extra field in the result (the result's `targets`
  shows what was hit). The UI (U1) may explain it.
- The rider drop happens only under refuse for a player. The GM's own attack keeps the DA2 sanction.

## Checks

`pnpm lint`, `pnpm typecheck`, `npx convex codegen` (locally; `_generated` not committed), focused vitest
(out-of-range-refuse, combat-attack, combat-riders, combat-cards, combat-features, lane3/lane4 use paths, authz-matrix),
and the full suite (`--maxWorkers=1 --testTimeout=120000`). No public function was added, so the authz matrix has no new
entry. No e2e in the acceptance.
