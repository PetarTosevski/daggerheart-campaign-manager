# TASK-PH-C2: sheet orchestrator wire-up

Follow-up on `phone/A1-on-master` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-a1`.
Not committed.

## What changed

1. **`RestSlot`** — `LoadedSheet` already subscribes to `rests.current` for the
   downtime reference and `readOpenRest`. The rest picker now receives that
   query result as `restState={rest}` so the slot does not subscribe twice.
2. **`readCharacter`** — Keeps play-time sheet fields the dice box and features
   panels parse (`sessionFeatures`, `conditions`, `effects`, `heldDice`,
   `featureUses`, `classState`, and related defaults) via
   `characterSheetSchema` instead of dropping them from `characters.get`.

## Commands

Node 24, from the phone repo root.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. Node v24.22.1. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 0. 24 tests passed. |

## Not done

No commit, no push, no merge into master.
