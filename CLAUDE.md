# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.
The full project instructions are in `AGENTS.md`; read it before any task.

## Binding rules

These rules bind every agent and human working in this repository. They are
stated in both `AGENTS.md` and `CLAUDE.md`; keep the two copies identical.
Only the user's explicit current instructions override them.

### Best practices: Top 15 rules

Verbatim from `docs/best-practices.md`. The full rulebook in that file (Convex,
Next.js, React and testing rules, each with its reason and enforcement) is
binding too; read the sections that apply before you change code.

1. Every client-callable Convex function is `userQuery` / `userMutation` / `userAction` (or a campaign wrapper built on them) from `convex/lib/functions.ts`. Raw `query`/`mutation`/`action` appear only in that file, `convex/auth.ts` and `convex/http.ts`; `internal*` functions are exempt.
2. Campaign and GM access is decided only by `permissionFor` (wrapper option `need: "view" | "edit" | "owner"`). No role checks anywhere else.
3. Identify the caller from `ctx.auth` (via the wrapper's `ctx.user`), never from an argument and never from an unverified email.
4. Every public function has an `args` validator with no `v.any()`. No stored field is `v.any()` (only exception: `operations.result`). Player-facing queries declare a `returns` validator.
5. Queries on growing tables use `.withIndex()`. No `.filter()` on database queries; `.collect()` only on provably small results, otherwise `.take()`, `.paginate()` or a counter.
6. Growing collections are their own table with a back-reference index, never an array inside one document. Fields that change often live outside documents that many queries read.
7. Every JSON blob that is not yet a typed validator carries `schemaVersion`. Change a shape by widen → migrate (`@convex-dev/migrations`, batched) → narrow; never edit a validator in place.
8. Every table that only grows (idempotency records, soft-deleted campaigns, orphan uploads) has an internal, batched, self-rescheduling cleanup cron in `convex/crons.ts`.
9. Throw `ConvexError<AppError>` with an object payload `{ code, message? }` from `src/lib/errors/*`. Convert only `RuleError` and `ZodError`; let programming errors throw.
10. Uploads: issue URLs only from access-checked, rate-limited mutations; after upload check size and an explicit type allowlist (png/jpeg/webp/gif); delete rejected files; never accept a storage id as proof of access.
11. Wrap every `useQuery` subtree in an error boundary; every route segment has `error.tsx`, the root has `global-error.tsx`.
12. Mutations send intents (delta, id, single field), never a client-computed snapshot of a whole object; add an optimistic update wherever a click has visible latency.
13. Never fire mutations from effects, never copy props into state in effects, never `key=` a subtree on live content.
14. Every public Convex function appears in `tests/convex/authz-matrix.test.ts` for anonymous, outsider, player and GM. Tests assert `ConvexError.data.code`, never message text.
15. Work in tracer bullets in worktrees (`docs/workflow.md`): change only your tracer's `owns`, and run lint, typecheck and tests before handoff. New lint rules land as warnings and are raised to errors once they are clean.

### Convex function wrappers

Every client-callable Convex function is defined with `userQuery`,
`userMutation` or `userAction` (or `maybeUserQuery`, or a campaign wrapper
built on them) from `convex/lib/functions.ts`. Raw `query`, `mutation` and
`action` from `convex/_generated/server` are allowed only in
`convex/lib/functions.ts`, `convex/auth.ts` and `convex/http.ts`; ESLint
(`no-restricted-imports`) warns on them anywhere else. Fix that warning; do
not ignore it. `internalQuery`, `internalMutation` and `internalAction` are
exempt. (Rule CF1 in `docs/best-practices.md`.)

### Build plans: tracer bullets in worktrees

Every build plan is a list of tracer bullets, written and run as
`docs/workflow.md` describes:

- The plan lives in `.omc/plans/<plan>.yaml`; each tracer has a `goal`,
  `depends_on`, `owns`, `reads` and `acceptance`.
- Each tracer runs in its own git worktree, branched from `rebuild` (first
  step, before any edit: `git switch -C <worktree branch> rebuild`).
- A tracer changes only the files in its `owns` list
  (`pnpm tracer:guard <plan> <tracer>` checks this), runs lint, typecheck and
  tests, commits once on its branch and never pushes.
- Only the orchestrator merges tracers into `rebuild`: in dependency order,
  one squashed commit per tracer; then it regenerates `convex/_generated` and
  reruns the checks.

### Project rules

- **Commits:** the author is petar (the existing git config). Never add a
  `Co-Authored-By` trailer; Vercel Hobby blocks co-authored commits.
- **Pushing:** never push (git or `bd dolt push`) unless the user asks.
- **Task tracking:** use `bd` (beads) for all task tracking and `bd remember`
  for persistent knowledge. No TodoWrite, TaskCreate, markdown TODO lists or
  MEMORY.md files.
- **Subagents:** every subagent runs on Opus (pass `model: opus` on every
  Agent call).
- **Unspecified mechanics:** before designing any mechanic the user has not
  specified, ask whether it is core or frame-exclusive and how it works. Never
  guess.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Build & Test

```bash
pnpm install          # also installs the git hooks (prepare script)
pnpm lint
pnpm typecheck        # tsc --noEmit, includes convex/
pnpm test             # vitest: unit (jsdom) + convex (convex-test)
pnpm e2e:setup        # once per checkout: local e2e Convex backend
pnpm test:e2e         # Playwright; starts the local backend + e2e build
E2E_PORT=<port> E2E_CONVEX_PORT=<port> pnpm test:e2e   # non-default ports (worktrees: use the ports pnpm worktree:setup prints)
```

Pre-commit hook (`.beads/hooks/pre-commit` -> `scripts/pre-commit.sh`): ESLint
on staged files + typecheck; skip once with `git commit --no-verify`. CI:
`.github/workflows/ci.yml`. Details: `docs/testing.md`.

## Architecture, conventions and everything else

Read `AGENTS.md` before any task. It holds the project overview, the
source-of-truth hierarchy, the stack and Convex layout, architectural
boundaries, data and history rules, testing requirements, the agent workflow
and the definition of done. Its rules bind you as if they were written here.
