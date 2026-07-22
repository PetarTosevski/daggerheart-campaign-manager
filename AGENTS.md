# AGENTS.md

## Project overview

This repository contains a private web application used by one Game Master to
run a Daggerheart campaign using the official **Witherwild** campaign frame.

The application is a campaign operations tool. It is not a virtual tabletop, a
rules compendium, or a replacement for the Daggerheart rulebook.

Primary capabilities:

- Track campaign weeks and the Witherwild weekly day/night cycle.
- Track current Fear and its history.
- Create and operate countdowns.
- Store player-character records and tracked resources.
- Manage character and shared-party inventory.
- Track food stores, consumption, spoilage, and shortages.
- Track Wither tokens and other confirmed campaign-specific mechanics.
- Preserve an auditable history of important state changes.
- Work effectively on a tablet or laptop during live play.

## Source-of-truth hierarchy

For every task, use this precedence:

1. The user's explicit current task instructions.
2. Existing implemented behavior and committed database migrations.
3. An approved task specification in `docs/tasks/`.
4. `docs/campaign-house-rules.md` for explicit mechanical overrides.
5. `docs/game-interpretation.md` for application behavior derived from rules.
6. `docs/product-spec.md` for product scope and user workflows.
7. `docs/architecture.md` and `docs/data-model.md` for technical design.
8. `docs/witherwild-notes.md` for campaign-specific context.
9. The official SRD indexed by `docs/rules-index.md`.

Existing code is not automatically correct. When implementation conflicts with
documentation, identify the conflict before changing either side. Do not silently
rewrite requirements to match accidental implementation details.

Files inside `.reference-private/` are optional local references. They must
never be required by builds, tests, CI, deployment, or another developer.

## Required context for a task

Before planning or implementing:

1. Read this file.
2. Read the relevant task file in `docs/tasks/`.
3. Read only the relevant sections of:
   - `docs/product-spec.md`
   - `docs/architecture.md`
   - `docs/data-model.md`
   - `docs/game-interpretation.md`
   - `docs/campaign-house-rules.md`
   - `docs/witherwild-notes.md`
   - `docs/open-questions.md`
4. Inspect the existing code, migrations, tests, and package scripts.
5. Compare the task against the implementation before proposing changes.

Do not load every document or the entire SRD for unrelated work.

If no task file exists for a non-trivial change, create or update one before
implementation.

## Rules-source policy

The authoritative public rules reference is:

- `reference/daggerheart-srd.pdf`

The project-maintained index and interpretations are:

- `docs/rules-index.md`
- `docs/game-interpretation.md`
- `docs/campaign-house-rules.md`
- `docs/witherwild-notes.md`

The optional private rulebook may exist at:

- `.reference-private/daggerheart-core-rulebook.pdf`

Use the SRD as the primary source for standard mechanics and terminology.
House rules override official rules only where the override is explicit.

Before implementing a game mechanic:

1. Locate it in `docs/rules-index.md`.
2. Verify the cited SRD section.
3. Check `docs/campaign-house-rules.md`.
4. Check `docs/witherwild-notes.md`.
5. Record the application interpretation in `docs/game-interpretation.md`.
6. Express the behavior as acceptance criteria and tests.
7. Implement only the confirmed behavior.

When a material rule is unclear:

- Do not guess.
- Add or update an item in `docs/open-questions.md`.
- Make the behavior configurable only when that is a deliberate product choice.
- Continue only with unaffected work.

Do not reproduce substantial rulebook text, protected art, card layouts, or
protected narrative content in source code or application assets.

## Product principles

1. Optimize for one GM during live play.
2. Common actions should require no more than one or two primary interactions.
3. Current campaign state must be visible at a glance.
4. Important changes must be recoverable or correctable.
5. Historical events must not silently disappear.
6. Preview compound effects before commitment where practical.
7. Prefer complete vertical slices over broad partial implementation.
8. Do not build multiplayer collaboration unless explicitly requested.
9. Do not build a general-purpose virtual tabletop.
10. Never invent game rules.

## Approved technology stack

Unless an approved task explicitly changes it, use:

- Next.js App Router
- TypeScript in strict mode
- React Server Components by default
- Client Components only for required browser interaction
- Tailwind CSS
- shadcn/ui primitives
- Supabase PostgreSQL
- Supabase Authentication
- Supabase Row-Level Security
- Zod
- Vitest
- Playwright
- pnpm

Do not introduce another ORM, backend framework, state-management library,
component library, form library, or paid service without documenting the need
and obtaining approval.

The installed package versions and scripts in `package.json` are authoritative.
Do not assume versions from this document.

## Repository layout

Expected documentation layout:

```text
AGENTS.md
docs/
  architecture.md
  campaign-house-rules.md
  data-model.md
  game-interpretation.md
  glossary.md
  implementation-priorities.md
  open-questions.md
  product-spec.md
  rules-index.md
  witherwild-notes.md
  tasks/
reference/
  daggerheart-srd.pdf
.reference-private/
  daggerheart-core-rulebook.pdf
```

Expected application layout is documented in `docs/architecture.md`. Inspect the
actual repository before creating or moving directories.

## Architectural boundaries

- Keep presentation, domain logic, validation, and database access separate.
- Use Server Components for initial reads and protected rendering by default.
- Use named Server Actions or route handlers for mutations.
- Authenticate, authorize, and validate every mutation on the server.
- Enforce campaign ownership with Row-Level Security.
- Keep service-role credentials out of browser code.
- Do not scatter direct database calls through presentation components.
- Do not duplicate authoritative game calculations in client and server code.
- Do not add a global client-state library without a demonstrated need.

## Database and history rules

- Commit every schema change as a Supabase migration.
- Never edit a migration already applied to a shared or production database.
- Update `docs/data-model.md` whenever the implemented schema changes.
- Use database constraints for persistent invariants.
- Use explicit transactional database functions for compound domain operations
  unless an approved architecture decision says otherwise.
- Protect retryable compound operations with idempotency keys.
- Preserve event or transaction history for Fear, countdowns, weeks, inventory,
  food, and undo/correction operations.
- Current totals may be cached, but must be changed atomically with their
  corresponding history record.
- Prefer compensating events and archival state over silent history edits.
- Prefer storing canonical state rather than presentation values.
    Example:

    Store

      - cycle = DAY
      - cycle_day = 4

    instead of

      - "Forenoon"

- Presentation strings should be derived whenever practical.

## Testing requirements

Every feature must include tests appropriate to its risk:

- Unit tests for pure domain rules and Zod schemas.
- Integration tests for database functions, constraints, RLS, transactions, and
  idempotency.
- Playwright tests for critical user workflows.

At minimum, verify:

- Fear cannot become negative.
- A Fear adjustment creates one event and one total change.
- Countdown boundaries and status transitions are enforced.
- Countdown completion effects cannot apply twice.
- Week advancement is atomic and idempotent.
- Inventory and food transfers preserve quantity.
- Unauthorized users cannot access another campaign.
- Undo or correction preserves an audit trail.

Do not claim a command passed unless it was executed successfully.

## Standard commands

Use the scripts that actually exist in `package.json`. Expected commands are:

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Before declaring implementation complete, run all applicable checks. If a
listed script does not exist, report that discrepancy rather than inventing a
result.

## Agent workflow

For every non-trivial task:

1. Read the applicable context.
2. Inspect existing implementation and migrations.
3. Reconcile task status with actual code and tests.
4. State the intended change and acceptance criteria.
5. Identify schema, authorization, and migration implications.
6. Implement the smallest coherent vertical slice.
7. Add or update tests.
8. Run relevant checks.
9. Review the diff for unrelated changes.
10. Update affected documentation and task status.
11. Report files changed, commands run, results, and unresolved questions.

Do not redesign unrelated areas during a feature task.

## Task-status rules

Task status must reflect evidence:

- `Draft`: not approved for implementation.
- `Ready`: acceptance criteria are approved.
- `In progress`: implementation has begun.
- `Blocked`: a named decision or dependency prevents progress.
- `Review`: implementation is reported or present but has not passed the full
  verification checklist.
- `Complete`: acceptance criteria, documentation, and required checks have been
  verified.

A checkmark in `implementation-priorities.md` is not sufficient evidence by
itself. Reconcile it with code, migrations, and test results.

## Change boundaries

Agents may add application code, tests, migrations, and documentation directly
related to an approved task.

Agents must not, without explicit approval:

- Replace the selected framework or Supabase.
- introduce a paid service.
- Disable authentication or RLS.
- Perform a destructive production migration.
- Remove event history.
- Add public registration, player editing, or multiplayer support.
- Add arbitrary executable custom mechanics.
- Copy protected rules text or artwork into the application.
- Expand the project into a public SaaS product.
- Redesign unrelated pages.

## Definition of done

A feature is complete only when:

- Acceptance criteria are satisfied.
- Implementation matches current migrations and documentation.
- Authorization and validation are enforced.
- Loading, empty, failure, and accessibility states are handled.
- Required unit, integration, and end-to-end tests pass.
- Linting, type checking, and production build pass.
- Relevant documentation and task status are updated.
- No unrelated changes are included.

## Task Boundary Rule

Implement only the requirements defined in the currently assigned task.

Do not implement requirements from future task documents, even when:

- placeholder UI already exists,
- database fields suggest later functionality,
- TODO comments reference future work,
- implementing a future feature would simplify the current task.

When future functionality affects the current design, create only the minimum extension point required for the current task. Document the deferred work clearly and leave implementation to its assigned task.

Do not begin the next task automatically. Stop after completing and verifying the assigned task.

## Task Document Authority

For implementation work:

1. Read `AGENTS.md`.
2. Read the assigned task document in full.
3. Treat the assigned task document as the scope contract.
4. Follow repository conventions where the task document is silent.
5. Report contradictions or blockers instead of guessing.
