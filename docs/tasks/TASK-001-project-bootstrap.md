# Task 001 — Project Bootstrap

## Status

Complete

## Verification status

Implemented and verified on 2026-07-18. The repository previously contained
documentation only. The project was bootstrapped in a temporary directory and
generated application files were copied in without overwriting `AGENTS.md`,
`docs/`, `reference/`, or `.reference-private/`.

All acceptance-criteria checks passed on re-verification:

- `pnpm install --frozen-lockfile` — exit 0 (lockfile in sync)
- `pnpm lint` — exit 0
- `pnpm typecheck` — exit 0
- `pnpm test` — 2 passed
- `pnpm build` — exit 0
- `pnpm test:e2e` — 1 passed
- Git repository metadata was initialized on 2026-07-19, and
  `git check-ignore -v .reference-private` confirmed the private-reference
  directory is ignored by the committed rule.

No Task 001 follow-up remains open.

## Goal

Initialize the application repository with the approved stack and a clean,
testable structure.

## User story

As the project owner, I need a reproducible development environment so that
features can be added without accumulating hidden setup assumptions.

## Included behavior

- Initialize Next.js with TypeScript and App Router.
- Enable TypeScript strict mode.
- Configure pnpm.
- Configure Tailwind CSS.
- Add shadcn/ui initialization without adding unnecessary components.
- Add Vitest.
- Add Playwright.
- Initialize Supabase local configuration.
- Add `.env.example`.
- Add baseline lint, typecheck, test, and build scripts.
- Create the documented source directories.
- Add a basic unauthenticated landing or placeholder page.
- Add a CI-ready command sequence.

## Excluded behavior

- Authentication implementation
- Database tables
- Campaign features
- Fear tracking
- Countdown tracking
- Production deployment
- Visual design beyond a minimal shell

## Dependencies

- `AGENTS.md`
- `docs/architecture.md`
- `docs/product-spec.md`

## Data-model changes

None.

## Authorization

None in this task.

## Validation

No domain validation is required.

## Acceptance criteria

- `pnpm install` completes successfully.
- `pnpm dev` starts the application.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm build` passes.
- Playwright can launch against the local application.
- Supabase local configuration exists.
- `.env.example` contains variable names but no secret values.
- `.reference-private/` is ignored by Git.

## Unit tests

Add at least one baseline test confirming the test runner is configured.

## Integration tests

None required.

## End-to-end tests

Add one smoke test that opens the application and confirms the initial page
renders.

## Documentation updates

- Update `architecture.md` if generated structure differs from the planned
  structure.
- Record setup commands in the repository README if one is added.

## Open questions

- Confirm the exact Next.js version selected by the current initializer.
- Confirm whether authentication begins immediately in Task 002.

## Completion report

Report:

- Files added
- Commands executed
- Test results
- Any deviations from `architecture.md`
