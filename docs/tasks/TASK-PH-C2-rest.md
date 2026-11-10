# TASK-PH-C2: sheet rest picker

Tracer C2-rest. Branch `phone/C2-rest` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c2-rest`,
branched from `phone/A1-on-master` at `b8cabf4`. Not committed.

## What changed

The rest slot (`apps/mobile/src/features/sheet/rest/`) replaces the stub with
the website's downtime picker: two moves per open rest, ally targets, Work on a
Project with an existing countdown or a GM roll, and a long-rest New project
form. It calls `rests.choose`, `rests.projects`, and `rests.createProject`
through the same keyed `useIntent` helper as the dashboard rest panel. It
subscribes to `characters.listByCampaign` for allies and to `rests.projects`
on a long rest only.

The sheet body already subscribes to `rests.current` for the downtime
reference. This slot accepts an optional `restState` prop with that query
result so the harness does not mount `rests.current` twice. The orchestrator
should pass `restState={rest}` on `<RestSlot />` in
`apps/mobile/src/features/sheet/index.tsx` when merging this tracer; until
then the picker appears only when tests or callers pass `restState`.

Card swaps during a rest stay on the Domains tab (`characters.moveCard`), as
on the phone sheet layout.

## Commands

Node 24, from the phone worktree.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. 45 suites, 162 tests. Node v24.22.1. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 0. 24 tests passed. This tracer did not edit that file. |

## Not done

No commit, no push, no merge. Orchestrator must wire `restState` on the sheet
body. Dice, level-up, death, incoming hit, and features slots remain stubs.
