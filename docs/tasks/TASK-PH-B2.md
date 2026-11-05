# TASK-PH-B2: player and GM screen harness

Tracer B2-harness. Branch `phone/A1-on-master` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-a1`. No new worktree.
Not committed.

## What changed

A screen test can render as a player or as the GM against a fake Convex client.
No screen was added. `convex/` was not edited.

`apps/mobile/jest.setup.ts` wraps `convex/react`. While `renderAsPlayer` or
`renderAsGm` (`apps/mobile/test/harness/render.ts`) has a client active, the
hooks are the fake ones. Otherwise the real hooks are used. A test file that
mocks `convex/react` itself, such as `test/features/account/fear-proof.test.tsx`,
keeps its own mock: this setup runs first, and that file's `jest.mock` runs next.

The fake client records every subscribed query on `client.subscribed` and every
mutation or action call on `client.called`. `useQuery` and `usePaginatedQuery`
with `"skip"` do not subscribe and do not fail. A second active subscription of
the same function throws `Duplicate subscription <name>`.

Rendered as a player, subscribing to a GM function throws
`Player subscribed to GM function <name>`, and calling one throws
`Player called GM function <name>`. The GM render may subscribe and call those
functions. The names come from `getFunctionName`.

The GM set is a source scan of `convex/**/*.ts` for line-anchored
`export const <name> = gmQuery|gmMutation|keyedGmMutation(`. The anchor skips
the sample in the comment in `convex/lib/functions.ts`. Names are
`module:export`, with nested modules kept (`trackers/horizon:get`).
`apps/mobile/test/harness/gm-functions.test.ts` requires
`encounters:list`, `spritePacks:packs`, `combatMaps:list`,
`customAdversaries:list`, `sessionPrep:get`, `combatVision:previewAs`, and
`members:access`, and fails when that scan's length differs from `rg --count-matches`
of the same pattern.

## Commands

Node v24.22.1 and pnpm 10.8.0, from the phone directory.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. 21 suites, 53 tests. Watchman printed a recrawl warning. |
| `pnpm lint` | Exit 0. |
| `pnpm typecheck` | Exit 0. |
| `pnpm test` | Exit 1. Vitest 4.1.10: 1 file failed, 324 passed (325). 2 tests failed, 8387 passed, 1 expected fail (8390). Duration 53.12s. |

Both failures are in `tests/convex/codex.test.ts`. This tracer did not edit that file. Root Vitest only includes `tests/unit` and `tests/convex`. The phone harness is not in that run.

- "map pins also come from a map not split into rows yet": `view.entries[0]` had `tokenId: null` where the test expects `4`. Left as it failed.
- "images: players get only revealed ones; revealing marks the entry known": `gmView.entries[0].images` was `[]` where the test expects two URL strings. Left as it failed.

## Not done

No screen, no commit, no push, no merge.
