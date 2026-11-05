# TASK-PH-C4: Lorekeeper

Tracer C4-lorekeeper. Branch `phone/C4-lorekeeper` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c4-lorekeeper`,
from `phone/A1-on-master` at `d65152d`. Not committed.

## What changed

The Lorekeeper stub is replaced with a React Native port of the website Lorekeeper
page (`src/app/(gm)/campaigns/[campaignId]/lorekeeper/page.tsx` and
`src/components/lorekeeper/**`). Everything lives under
`apps/mobile/src/features/lorekeeper/`.

The screen mirrors the website layout: header (sigil, title, book-count pill,
Conversations menu), a “Library & rulings” fold (library, How I answer, table
rulings), and the chat column with paginated `lorekeeper.listMessages` (answers
stream through that subscription, including `streaming` / `pending` rows) plus the
composer (`lorekeeper.ask`, toggles, caps via `lorekeeperUsage.mine`).

GM-only UI matches the web: library `setEnabled` switches and About books,
ruling edit/unpin, open Ask-the-GM requests (`lorekeeperAsks.listOpen`), and pin
from asks. Players read library and rulings; `lorekeeperAsks.listOpen` uses
`"skip"` in both `chat.tsx` and `rulings.tsx`.

Mutations omit client optimistic updaters (same policy as Notes on mobile).

## Commands

Node v24, from the worktree.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 1 on Node v24.22.2. ESLint and `tsc --noEmit` passed. Jest: 217 tests passed; `test/features/world/view.roles.test.tsx` failed to load (`react-native-gesture-handler` / Reanimated mock). Lorekeeper suite: 4 passed. This tracer did not edit world tests. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 0. 24 passed. This tracer did not edit that file. |

## Not done

No commit, no push, no merge. Floating Lorekeeper drawer (website L7) is not on
phone. Jump-to-latest scroll affordance is simplified (FlatList auto-scroll).
