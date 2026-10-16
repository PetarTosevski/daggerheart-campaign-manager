# AGENTS.md

## Project overview

This repository contains a private web application that one Game Master uses to
run Daggerheart campaigns during live play. It is being rebuilt (branch
`rebuild`); the previous Witherwild-only app is preserved at tag
`witherwild-final`.

The application is a **live-play GM console**. It is not a virtual tabletop, a
rules compendium, or a replacement for the Daggerheart rulebook.

Flow: sign in, pick a **campaign frame**, pick or create a **campaign** in that
frame, land on the campaign's live table view.

### Frames and mechanics

- Frames ship in code (currently Witherwild and "Core only"). New frames are
  development tasks, not in-app content.
- Every mechanic is either **core** (available in every campaign) or
  **frame-exclusive** (switched on by the campaign's frame).
- Core: Fear, countdowns, rests and downtime moves (frames may add their own
  moves), session log, adversaries and encounters.
- Witherwild-exclusive: campaign time (weeks and the DAY/NIGHT cycle of 7 named
  phases each).
- **Before designing any mechanic the user has not specified, ask the user
  whether it is core or frame-exclusive and how it works.** Never assume.

The approved plan is `.omc/plans/campaign-manager-rebuild.md`; each phase has a
task document in `docs/tasks/`.

## Source-of-truth hierarchy

For every task, use this precedence:

1. The user's explicit current task instructions.
2. The approved task document in `docs/tasks/`.
3. Existing implemented behaviour and the Convex schema in `convex/`.
4. `docs/game-interpretation.md` for application behaviour derived from rules,
   including explicit house-rule overrides.
5. `docs/data-model.md` for the Convex schema (once created).
6. The official SRD indexed by `docs/rules-index.md`; terminology in
   `docs/glossary.md`.

Existing code is not automatically correct. When implementation conflicts with
documentation, identify the conflict before changing either side.

`reference/legacy-sql/` holds the old Postgres functions as read-only reference
for porting behaviour. They are not executed and are deleted once the Convex
port matches them in tests.

## Required context for a task

1. Read this file.
2. Read the assigned task document in `docs/tasks/` in full.
3. Read only the relevant sections of `docs/game-interpretation.md`,
   `docs/rules-index.md`, `docs/glossary.md`, `docs/data-model.md` and
   `docs/open-questions.md`.
4. Inspect the existing code, tests and package scripts.

If no task document exists for a non-trivial change, create one before
implementation.

## Rules-source policy

- Authoritative public rules reference: `reference/daggerheart-srd.pdf`.
- Project index and interpretations: `docs/rules-index.md`,
  `docs/game-interpretation.md`.
- `.reference-private/` files are optional local references and must never be
  required by builds, tests, CI or deployment.

Before implementing a game mechanic: locate it in `docs/rules-index.md`, verify
the SRD section, record the application interpretation in
`docs/game-interpretation.md`, express it as acceptance criteria and tests, and
implement only the confirmed behaviour.

When a material rule is unclear: do not guess, add an entry to
`docs/open-questions.md`, and continue only with unaffected work.

Do not reproduce substantial rulebook text, protected art, card layouts or
protected narrative content in code or assets.

## Product principles

1. Optimise for one GM during live play on a tablet or laptop.
2. Common actions take no more than one or two primary interactions.
3. Current campaign state is visible at a glance.
4. Important changes are recoverable or correctable.
5. Historical events never silently disappear.
6. Prefer complete vertical slices over broad partial implementation.
7. Single GM account; do not build multiplayer, player access or public
   sign-up unless explicitly requested. Keep every record owned so that a later
   multi-user version is not blocked.
8. Never invent game rules.

## Approved technology stack

- Next.js App Router, TypeScript strict mode
- Convex (database, queries, mutations, live updates)
- Convex Auth with Google sign-in, locked to the GM's allowlisted, verified
  email
- Tailwind CSS and shadcn/ui primitives
- Zod for input validation
- Vitest (unit, and convex-test for Convex functions), Playwright (e2e)
- pnpm; hosting on Vercel

Phase 1 of the plan adds the Convex packages; until then the app is a
placeholder. Do not introduce another backend, ORM, state-management library,
component library, form library or paid service without approval. The versions
and scripts in `package.json` are authoritative.

### Server vs. client components

- Server Components for layout, the auth gate and static shells.
- Client Components with Convex `useQuery`/`useMutation` for live mechanic
  panels (needed for live updates across devices).

## Architectural boundaries

- Keep presentation, domain logic, validation and data access separate.
- Pure game rules live in `src/lib/domain/*` and validation in
  `src/lib/validation/*`. These modules must not import React, Next or
  `@/components`; Convex functions call them.
- Authenticate and authorise every Convex query and mutation on the server
  (`requireGm` plus ownership checks). Middleware is only a UX redirect.
- Do not duplicate authoritative game calculations in client and server code.
- Keep deploy keys and secrets out of browser code.

## Data and history rules (Convex)

- Every schema change goes in `convex/schema.ts` and is documented in
  `docs/data-model.md`.
- Compound domain operations run inside a single Convex mutation, which is
  transactional.
- Retryable operations are protected by idempotency keys stored in the
  `operations` table; a replay with a different request is rejected.
- Preserve event history for Fear, countdowns, campaign time and corrections.
  Cached totals change in the same mutation as their history record.
- Prefer compensating events over silent history edits.
- Store canonical state, not presentation values (store `cycle = DAY`,
  `cycleDay = 4`, never "Forenoon"); derive display strings.

## Testing requirements

- Unit tests for pure domain rules and Zod schemas.
- Convex function tests (convex-test) for atomicity, idempotency,
  authorisation and campaign isolation.
- Playwright tests for critical workflows, run against a throwaway local Convex
  backend.

At minimum verify: Fear stays within 0–12; one Fear adjustment creates one
event and one total change; countdown boundaries and status transitions;
countdown completion cannot apply twice; week advancement is atomic and
idempotent; one campaign's data never appears in another; corrections preserve
the audit trail.

Do not claim a command passed unless it was executed successfully.

## Standard commands

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

If a listed script does not exist, report the discrepancy rather than inventing
a result.

## Agent workflow

1. Read the applicable context.
2. Inspect the existing implementation.
3. State the intended change and acceptance criteria.
4. Implement the smallest coherent vertical slice.
5. Add or update tests and run the checks.
6. Review the diff for unrelated changes.
7. Update affected documentation and task status.
8. Report files changed, commands run, results and unresolved questions.

## Task-status rules

- `Draft`: not approved.
- `Ready`: acceptance criteria approved.
- `In progress`: implementation has begun.
- `Blocked`: a named decision or dependency prevents progress.
- `Review`: implemented but not fully verified.
- `Complete`: acceptance criteria, documentation and required checks verified.

## Change boundaries

Agents must not, without explicit approval:

- Replace Next.js or Convex.
- Introduce a paid service.
- Disable authentication or authorisation checks.
- Remove event history.
- Add public registration, player editing or multiplayer support.
- Add arbitrary executable custom mechanics.
- Copy protected rules text or artwork into the application.
- Redesign unrelated pages. Visual design is pending the user's references;
  keep UI minimal and replaceable until then.

## Definition of done

A feature is complete only when acceptance criteria are satisfied,
authorisation and validation are enforced, loading/empty/failure/accessibility
states are handled, required tests, lint, typecheck and build pass,
documentation and task status are updated, and no unrelated changes are
included.

## Task boundary rule

Implement only the requirements of the currently assigned task. Do not
implement future tasks, even when placeholders or schema fields suggest them.
Stop after completing and verifying the assigned task.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:46cd31e7 -->
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
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
