# Build workflow: tracer bullets in worktrees

Decided 2026-10-18. Applies to every build plan (agents and humans).

## Tracer bullets

A tracer bullet is a thin slice that runs end to end through every layer it needs (schema → Convex function → UI → test). It works on its own and is kept, not thrown away; later tracers widen it. Every build plan is a list of tracers.

## Plan format

Plans live in `.omc/plans/<plan>.yaml`:

```yaml
plan: d5-level-up
waves:
  - wave: 1
    tracers:
      - id: T1
        goal: One sentence: what works end to end when this lands.
        depends_on: []            # tracer ids that must be merged first
        owns:                     # files/globs only this tracer may change
          - convex/levelUp.ts
          - convex/tables/levelUp.ts
          - src/app/(gm)/campaigns/[campaignId]/party/[characterId]/level-up/**
          - tests/convex/level-up.test.ts
        reads:                    # files it uses but must not change
          - convex/lib/permissions.ts
        acceptance:               # how the orchestrator knows it is done
          - tests/convex/level-up.test.ts passes
          - tests/e2e/level-up.spec.ts passes
```

Rules:
- Tracers in the same wave never share an `owns` entry (checked by `scripts/plan-check.mjs`).
- A tracer may start only when every `depends_on` tracer is merged.
- Files every feature touches are split so tracers rarely share them (see below). Whatever is still shared (`package.json`, the lockfile, `convex/schema.ts` composition) goes into a small foundation tracer (T0) that lands first, or the orchestrator edits it at merge time.

## Shared files

- **Schema:** each domain's tables live in `convex/tables/<domain>.ts`; `convex/schema.ts` only combines them. A tracer owns its domain's table file.
- **Error messages:** each domain's messages live in their own module; `src/lib/convex-errors.ts` only combines them.
- **Generated code:** `convex/_generated/**` is never committed from a worktree branch. The orchestrator regenerates it (`npx convex codegen`) after each merge.
- **Docs:** each tracer writes its own `docs/tasks/TASK-*.md`; the orchestrator updates `docs/data-model.md` at merge time from the tracer's report, unless the tracer owns it.

## Worktrees

- Each tracer's agent runs in its own git worktree, created from the integration branch (`rebuild`) at the start of its wave. The Agent tool creates worktrees from the default branch (`master`), so every tracer's first step, before any edit, is `git merge --ff-only rebuild`. This works because `master` is an ancestor of `rebuild`. The orchestrator checks the base with `git merge-base --is-ancestor rebuild <branch>` before merging.
- Setup per worktree (`scripts/worktree-setup.mjs`): `pnpm install` (cheap, shared pnpm store), copy the git-ignored `.env.local` and `.env.e2e.local`, and pick a free e2e port and local Convex backend so worktrees can run browser tests at the same time.
- Worktrees use local Convex backends only. The cloud dev deployment receives pushes only from the main checkout after merges.

## Testing

- **In the worktree:** lint, typecheck, unit/Convex tests, and the tracer's own e2e spec.
- **After a wave is merged:** the orchestrator runs the full e2e suite once on `rebuild`, because tracers that pass alone can still break together.

## Merging (orchestrator only)

1. Before merging, `scripts/tracer-guard.mjs <plan> <tracer>` compares the branch diff with the tracer's `owns` list and rejects files outside it. A rejected tracer goes back to its agent.
2. Merge in dependency order, one squashed commit per tracer, authored by petar, with no Co-Authored-By trailer. Do not push unless asked.
3. Regenerate `convex/_generated`, then run lint, typecheck and vitest after each merge.
4. Remove the worktree once merged. Squash-merged branches are kept, because deleting them needs a force delete, which the git guardrail blocks during autopilot. The user prunes them.

## Also binding

- `docs/best-practices.md` (Convex, Next.js, React, testing rules).
- `AGENTS.md`.
