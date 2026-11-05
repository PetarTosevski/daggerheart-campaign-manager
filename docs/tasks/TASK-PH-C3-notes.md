# TASK-PH-C3: Notes

Tracer C3-notes. Branch `phone/C3-notes` in
`/Users/nikolablagoevski/Desktop/Nikola_Random/daggerheart-phone-c3-notes`,
from `phone/A1-on-master` at `21b9441`. Not committed.

## What changed

The Notes stub is replaced with a React Native port of the website Notes
shell (`src/app/(gm)/campaigns/[campaignId]/notes/page.tsx` and
`src/components/notes/**`). Everything lives under
`apps/mobile/src/features/notes/`.

The screen mirrors the website slots: journal heading, search, own page groups,
shared tabs, players’ / past journals, torn-out pages, quick keys, and the paper
column (`page`, `threads`, shared views, `journal`, `bin`). It calls the same
Convex modules: `notes`, `notesEntries`, `notesSharing`, `notesJournals`,
`notesBin`, `notesThreads`, `sessionRecords.list`, and `codex.list` (mentions).

`JournalsList` subscribes to `notesJournals.playerJournals` only when
`access.isGm` is true (`"skip"` for players), matching
`src/components/notes/journals/index.tsx`.

`NotesJournalProvider` holds a single `notes.journal` subscription for the tree
(Convex dedupes on web; the test harness rejects duplicate watches).

Export builds Markdown with `journalToMarkdown` and opens the system share sheet
(no browser download). Mutations omit client optimistic updaters so mobile
`tsc` does not pull in `@/` paths from `src/lib/optimistic/*`.

`apps/mobile/app/campaign/[campaignId]/notes/[pageId].tsx` passes
`initialPageId` into `NotesScreen`.

## Commands

Node v24.22.1, from the worktree.

| Command | Result |
| --- | --- |
| `pnpm --filter @dualityheart/mobile run check` | Exit 0. ESLint, `tsc --noEmit`, and Jest passed. 51 suites, 191 tests. |
| `pnpm exec vitest run tests/convex/codex.test.ts` | Exit 0. 24 passed. This tracer did not edit that file. |

## Not done

No commit, no push, no merge. Tear-out rip animation and undo toast from the
website bin are simplified (confirm + restore only). Mention editing uses a
`TextInput` and @ picker sheet rather than the web contenteditable chip editor.
