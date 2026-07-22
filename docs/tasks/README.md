# Tasks

This directory contains implementation-sized specifications.

Each task should describe one coherent vertical slice small enough to implement,
test, and review without redesigning unrelated parts of the application.

## Naming convention

```text
001-project-bootstrap.md
002-authentication.md
003-phase-one-schema.md
004-fear-tracker.md
005-countdown-tracker.md
006-operations-foundation.md
```

Use three-digit numeric prefixes.

## Status values

- `Draft`
- `Ready`
- `In progress`
- `Blocked`
- `Review`
- `Complete`

Use `Complete` only after implementation, migrations, documentation, and
required checks have been verified.

## Required task sections

Every non-trivial task should include:

- Status
- Evidence or verification status
- Goal
- User story
- Included behavior
- Excluded behavior
- Dependencies
- Rules references
- Data-model changes
- Authorization
- Validation
- Normal flow
- Empty state
- Loading state
- Failure state
- History and audit behavior
- Undo or correction behavior
- Acceptance criteria
- Unit tests
- Integration tests
- End-to-end tests
- Documentation updates
- Open questions
- Completion report requirements

## Reconciliation rule

When a feature already exists but its task remains Draft, set it to `Review`,
inspect the implementation, and add a verification record. Do not mark it
Complete from a checklist or owner report alone.
