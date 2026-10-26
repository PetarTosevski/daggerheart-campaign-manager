# TASK-PF-PF6: Lazy add-adversary dialog and title-menu dialogs

Status: Review. Plan: `.omc/plans/performance.yaml`, tracer PF6. Branched from `rebuild` at a8a01e2.

## What changed

- **Session prep add dialog** (CL8). `sessions/prep/encounter.tsx` loads D8's `AddAdversaryDialog` with
  `next/dynamic` (`ssr: false`). It mounts on the first "+ Add adversary" click and stays mounted, so closing and
  focus return work as before. While the chunk loads, the column shows "Loading the adversary list…"
  (`role="status"`). `srd/adversaries.ts` and the dialog left the Sessions route's initial JS. The H22 accessibility
  and tablet fixes on Sessions are in other files and are untouched.
- **Title-menu dialogs** (CL8). `title-menu.tsx` loads `SettingsDialog` and `JoinDialog` with `next/dynamic`
  (`ssr: false`). Each mounts on its first open and stays mounted. zod, which came in through
  `settings-dialog.tsx`, left `/`. `settings-dialog.tsx` (D12 H17's file) and `join-dialog.tsx` are unchanged.
- No loading state on the title-menu dialogs: their `Modal` renders nothing while closed, and the chunks are small.
- The `next/dynamic` options are inline object literals, as PF5 found the production build requires.

## Measurements

`node scripts/perf/bundle.mjs` (initial client JS, KB raw / gzip / async). Before = `rebuild` a8a01e2, same worktree.

| Route | Before | After | Target | Watched modules after |
|---|---:|---:|---:|---|
| `/` (title menu) | 851 / 319 / 0 | **753 / 287 / 115** | ≤ 730 | none (pkg:zod gone) |
| `/campaigns/[id]/sessions` | 1,209 / 412 / 102 | **883 / 339 / 429** | ≤ 950 | none (srd/adversaries gone) |

Other routes are unchanged.

### What still holds the title menu

`/` is 23 KB over its target. The target came from the 804 KB baseline minus zod; since then `pkg:next` grew to
571 KB and `src/lib/errors` to about 21 KB, both shared by every route (`/_not-found`, the floor, is 691 KB). Above
that floor, `/` keeps:

1. `src/lib/frames/index.ts`, 17 KB: `title-menu.tsx → lib/campaign-display.ts (frameName) → lib/frames/index.ts`.
   A small frame-name map (or a `campaigns.list` field with the frame name) would drop it. Outside owns.
2. `pkg:tailwind-merge`, 26 KB: `title-menu.tsx → components/brand/brand.tsx → lib/utils.ts (cn)`. Shared by
   most routes; dropping it from `/` needs `brand.tsx` without `cn`. Outside owns.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `vitest run --maxWorkers=4 --testTimeout=60000`: 235 files, 5,622 passed, 1 expected fail.
- e2e (reused servers, load average 28-36): session-prep, session-encounter, sessions-hub, sessions-shell,
  sessions-flow, campaigns, settings-backup, players, a11y-entry and encounter-builder ran. 47 of 49 passed on the
  first run. `a11y-entry` "load campaign and join by link" timed out on the `/campaigns` list, then passed on a
  rerun. `sessions-flow` failed in three runs, each time at a different step after the lazy Join dialog and the add
  dialog had both worked: a Convex mutation timeout (`Function execution timed out`), the session tally after a Fear
  change, and the Combat Map's Combatants panel still "Loading …" at the 5 s timeout. All three steps are outside
  this tracer's files and point to host load.
- `tests/unit/lazy-boundaries.test.ts` (not in owns) could add guards for these two files; suggested in the handoff.
