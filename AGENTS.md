# AGENTS.md

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

- Frames ship in code (`src/lib/frames/`): the 10 published frames plus a
  GM-written Custom frame. New frames are development tasks, not in-app content.
- Every mechanic is either **core** (available in every campaign) or
  **frame-exclusive** (switched on by the campaign's frame).
- Core: Fear, countdowns, rests and downtime moves (frames may add their own
  moves), session log, adversaries and encounters.
- Witherwild-exclusive: campaign time (weeks and the DAY/NIGHT cycle of 7 named
  phases each).
- **Before designing any mechanic the user has not specified, ask the user
  whether it is core or frame-exclusive and how it works.** Never assume.

The active plan is `docs/design-port-roadmap.md` (a phased port of the Claude
Design boards in `reference/designs/`; it supersedes Phases 2–7 of
`.omc/plans/campaign-manager-rebuild.md`). Each phase has a task document in
`docs/tasks/`. Design images live in `public/design-assets/`; after adding any,
run `node scripts/design-assets-manifest.mjs`.

## Source-of-truth hierarchy

For every task, use this precedence:

1. The user's explicit current task instructions.
2. The approved task document in `docs/tasks/`.
3. Existing implemented behaviour and the Convex schema in `convex/`.
4. `docs/game-interpretation.md` for application behaviour derived from rules,
   including explicit house-rule overrides.
5. `docs/data-model.md` for the Convex schema.
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
protected narrative content in code or assets, except the frame lore, tomes and
art from the Claude Design boards, which the user approved for this private app
(2026-10-17, `docs/design-port-roadmap.md`).

## Product principles

1. Optimise for one GM during live play on a tablet or laptop.
2. Common actions take no more than one or two primary interactions.
3. Current campaign state is visible at a glance.
4. Important changes are recoverable or correctable.
5. Historical events never silently disappear.
6. Prefer complete vertical slices over broad partial implementation.
7. Multi-user (user decision 2026-10-17): roles are per campaign. A campaign's
   creator is its GM; players join by email invite or join code. Anything
   hidden from players is enforced on the server, never only in the UI.
   Sign-up stays limited to the env allowlist until the user opens it.
8. Never invent game rules.

## Approved technology stack

- Next.js App Router, TypeScript strict mode
- Convex (database, queries, mutations, live updates)
- Convex Auth with Google and email + password sign-in, both limited to the
  env allowlist
- Tailwind CSS and shadcn/ui primitives
- Zod for input validation
- Vitest (unit, and convex-test for Convex functions), Playwright (e2e)
- pnpm; hosting on Vercel

Do not introduce another backend, ORM, state-management library, component
library, form library or paid service without approval. The versions and
scripts in `package.json` are authoritative. Respect the pnpm
`minimumReleaseAge` policy: pick an older version rather than adding an
exclusion.

### Convex layout

- `convex/schema.ts`: the schema (includes Convex Auth's `authTables`).
- `convex/auth.ts`: Convex Auth. Google (with a `profile()` override that
  keeps `email_verified`), email + password (`password`), and the local-only
  e2e provider; `createOrUpdateUser` (`convex/lib/users.ts`) applies the
  allowlist and refuses a new password account for an email that already has
  a user.
- `convex/lib/allowlist.ts`: pure sign-in policy (allowlist =
  `ALLOWED_EMAILS` ∪ legacy `GM_EMAILS` ∪ `SEED_ACCOUNTS` emails, verified
  email for OAuth, local-only e2e sign-in). Unit-tested.
- `convex/lib/functions.ts`: the auth wrappers. Every client-callable function is
  `userQuery` / `userMutation` / `userAction` or a campaign/GM wrapper built on
  them; they put `user` (and `campaign`, `permission`) on `ctx`.
- `convex/lib/permissions.ts`: `permissionFor` — the single authorization model
  (campaign role plus `grants`); wrappers and entry-scoped functions use it.
- `convex/accounts.ts`: `accounts:seed` creates the `SEED_ACCOUNTS` test
  logins (`npx convex run accounts:seed`).
- Convex functions import shared code from `src/lib/{domain,validation}` with
  relative paths; ESLint forbids `@/`, React and Next imports there.

### Deployments and environments

- Production: a cloud deployment, deployed by Vercel with
  `npx convex deploy --cmd 'pnpm build'`. Env vars on Convex: `AUTH_GOOGLE_ID`,
  `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAILS` (or the legacy `GM_EMAILS`),
  optional `SEED_ACCOUNTS`, `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS`.
- Everyday development (`pnpm dev`, `.env.local`): the GM's personal cloud dev
  deployment.
- Tests: the project's local, account-free backend (`.convex/local`,
  `.env.e2e.local`), set up with `pnpm e2e:setup`. The test-only sign-in exists
  only there; it needs a localhost backend and `E2E_AUTH_ENABLED=true`.
- The e2e build goes to `.next-e2e`; never deploy a locally built output.

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
  (`requireUser` plus the campaign role check). Middleware is only a UX redirect.
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

## Build & Test

```bash
pnpm install        # also points git at the tracked hooks (.beads/hooks)
pnpm dev            # Next.js; run `npx convex dev` alongside it
pnpm lint
pnpm typecheck      # also typechecks convex/
pnpm test           # vitest projects: unit (jsdom) and convex (convex-test)
pnpm e2e:setup      # once: configure the local e2e Convex backend
pnpm test:e2e       # starts the local backend and an e2e build itself
pnpm build
```

`pnpm test:e2e` needs Playwright's Chromium and its system libraries
(`pnpm exec playwright install chromium`, then
`sudo pnpm exec playwright install-deps chromium`). It refuses to start when
its ports are taken (stale servers); run on other ports with
`E2E_PORT=3100 E2E_CONVEX_PORT=3312 pnpm test:e2e`. The pre-commit hook runs
ESLint on staged files plus `pnpm typecheck` (never e2e). CI
(`.github/workflows/ci.yml`) runs lint, typecheck, test and e2e. Details:
`docs/testing.md`.

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
- Open sign-up beyond the allowlist without the user's go-ahead.
- Add arbitrary executable custom mechanics.
- Copy protected rules text or artwork into the application beyond what the
  user approved (frame lore, tomes and design art; rule text needed to run a
  mechanic). Never commit the rulebook PDFs (`.reference-private/`).
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

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
