# TASK-PH-C2: sheet dice box

Tracer C2-dice. Branch `phone/C2-dice` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c2-dice`,
from `phone/A1-on-master` at `b8cabf4`. Not committed.

## What changed

The sheet dice stub is the website dice box, adapted for React Native in
`apps/mobile/src/features/sheet/dice/`. Action, reaction, and damage rolls call
`rolls.actionRoll` and `rolls.damageRoll` with idempotency keys. Roll options
match the website: Experiences, attack and Ikonis toggles, help dice, feature
chips, Slayer Dice and Know the Tide spend steppers, Tag Team (`rolls.tagTeam`,
`rolls.tagTeamApply`), post-roll prompts (`classFeatures.use`), and the Slayer
store offer (`rolls.storeSlayerDie` via `rolls.pendingChoices`). The result row
uses `RollResult`, which animates only the server-returned values.

Editors see the box inside the sheet slot; readers keep the slot label with no
subscriptions. Queries: `campaigns.fear`, `characterExtras.get`,
`rolls.pendingChoices`, and `characters.listByCampaign` when Tag Team is open
or waiting on a pick. A player render must not subscribe to or call a GM
function; the harness throws if it does.

## Commands

Node v24 and pnpm from the worktree.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0 on Node v24.22.1. ESLint, `tsc --noEmit`, and Jest passed. 45 suites, 164 tests. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 0. 24 passed. This tracer did not edit that file. |

## Not done

No commit, no push, no merge. Session feature fields on the sheet still depend
on `characters.get` including them when the sheet reader grows; dice tests pass
full sheet patches through the slot props.
