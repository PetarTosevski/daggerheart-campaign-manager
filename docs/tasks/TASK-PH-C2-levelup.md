# TASK-PH-C2: character sheet level-up

Tracer C2-levelup. Branch `phone/C2-levelup` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c2-levelup`,
branched from `phone/A1-on-master` at `b8cabf4`. Not committed.

## What changed

The level-up slot (`apps/mobile/src/features/sheet/level-up/`) replaces the
stub with the website's guided level-up: the header level circle, ▲ to start,
− to undo, the ribbon with steps, a client draft validated by
`src/lib/domain/level-up`, tier history on the slot, and the GM level
correction. Mutations go through `levelUp.apply`, `undoLast`, and
`correctLevel` (keyed, via the shared `useIntent` helper). Players subscribe
to `levelUp.canUndo` only when the undo control is shown; the GM never
subscribes.

The slot mounts once under the sheet header (C1-party wiring unchanged).
Advancement history lives in the slot until the sheet core can mount a
story-page region; `characters.get` still omits `advancements` from the typed
sheet reader, so history counts come from the parsed full sheet when the API
sends them.

## Commands

Node 24, from the phone worktree.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0 on Node v24.12.0. ESLint, `tsc --noEmit`, and Jest passed. 45 suites, 162 tests. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 1. 23 passed, 1 failed (`setPin` / `codex.list` tokenId expectation). This tracer did not edit that file. |

## Not done

No commit, no push, no merge. Deck exchange, multiclass choosers, and
cross-tab navigation match the website in a later pass once the sheet can
wire ribbon `goTo` to page tabs. Party level-up stays on the roster (C1-party).
