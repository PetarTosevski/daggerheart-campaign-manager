# TASK-009A — Campaign Creation & Initialization

## Status

Complete — implemented and verified on 2026-07-22. Most of the work landed while
reconciling the post-reset empty-state dead end; this task formalizes it and
closed the remaining gaps: per-owner duplicate-name rejection
(`campaigns_owner_name_unique`), soft in-place refresh after creation (no full
page reload), onboarding empty-state wording ("No campaigns yet" — the misleading
"No active campaign" copy was removed from the timeline and character empty
states too), and an end-to-end flow that reaches the Characters page.

`pnpm lint`, `pnpm typecheck`, `pnpm test` (122 passed), and `pnpm build` pass.
Against live local Supabase: the migration applied via `supabase migration up`
(non-destructive), the DB integration suite passed with `RUN_SUPABASE_DB_E2E=1`,
and the full Playwright suite passed with `RUN_SUPABASE_E2E=1` (11 passed, 1
skipped by design).

Route note: the "Campaign page" in this codebase is `/dashboard` (the persistent
shell labels its nav item "Campaign"). There is no separate `/campaign` route;
after creation the dashboard is soft-refreshed in place so the timeline and
controls appear without a full reload. Multiple-campaign selection: the app loads
the earliest-created active campaign deterministically; a switcher is out of scope
(OQ-PROD-002).

## Objective

Implement the missing campaign lifecycle that bridges the gap between the persistent campaign shell (Task 009) and the character system (Task 010).

After this task, a freshly deployed or freshly reset application must be fully usable without relying on seeded campaign data.

This task establishes campaign creation, initialization, and first-run behavior only.

---

# Prerequisites

Before implementation:

* Read `AGENTS.md`.
* Read this task completely.
* Verify Tasks 001–009 have completed successfully.
* Verify the authenticated application shell from Task 009 is functioning.
* Verify no blockers exist in `open-questions.md`.

If prerequisites fail:

* Document the blocker.
* Stop.

---

# Problem Statement

The current application assumes an active campaign already exists.

After a fresh database reset:

* authentication works
* navigation works
* campaign shell loads

but the application cannot be used because no campaign exists and no workflow exists to create one.

The application must never depend on `seed.sql` to become usable.

---

# Scope

Implement:

* first campaign creation
* campaign initialization
* campaign ownership
* empty-state UX
* campaign loading
* campaign selection logic (single campaign only)
* validation
* authorization
* tests
* documentation

---

# Campaign Creation

Create a GM workflow for creating a campaign.

Minimum fields:

* Campaign Name

Requirements:

* required
* trimmed
* maximum length validation
* duplicate validation (same owner)

The authenticated GM automatically becomes the owner.

Do not allow owner selection.

---

# Initial Campaign State

Every newly created campaign must initialize with the canonical campaign state.

```ts
type CampaignTime = {
  currentWeek: 1;
  currentCycle: "DAY";
  currentCycleDay: 1;
};

fear = 0;
```

These values must be created by the server.

The client must not initialize campaign state.

---

# Empty State

If the authenticated GM owns zero campaigns:

Display an onboarding empty state instead of a dead end.

Example:

```text
No campaigns yet

Create your first campaign to begin managing your Witherwild campaign.

[ Create Campaign ]
```

Do not display:

```text
No active campaign
```

because no campaign exists yet.

---

# Existing Campaign

If the GM owns exactly one campaign:

Automatically load it.

No selection screen.

No additional interaction required.

---

# Multiple Campaigns

Future support for multiple campaigns is anticipated.

This task must prepare for that possibility.

However:

Do **not** build campaign switching.

If more than one campaign exists unexpectedly:

* load the most recently active campaign if supported by the existing model;
* otherwise load the oldest owned campaign deterministically.

Document the assumption.

---

# Seed Independence

The application must never require:

* seeded campaigns
* hard-coded UUIDs
* seeded owners
* manual SQL

A completely empty database must be a supported starting state.

`seed.sql` remains optional developer convenience.

---

# Database

Implement only what is required.

Examples:

* campaign creation function
* validation
* ownership enforcement
* timestamps
* indexes (if required)

Do not introduce future campaign features.

---

# Validation

Server-side validation must include:

* required name
* trimmed values
* maximum length
* duplicate campaign name for same owner
* authenticated owner only

Do not rely solely on client validation.

---

# Security

Implement:

* GM ownership
* campaign isolation
* RLS
* SECURITY DEFINER functions where appropriate
* server-side authorization

A GM must never create campaigns for another user.

---

# UI

Provide:

* Create Campaign button
* Create Campaign page or modal
* Loading states
* Error handling
* Success redirect

Integrate with the authenticated application shell.

---

# Navigation

After creation:

Redirect to:

```
/campaign
```

The persistent campaign timeline should immediately display:

* Week 1
* Day
* Day 1
* Fear 0

without requiring a page refresh.

---

# Out of Scope

Do **not** implement:

* campaign deletion
* campaign archive
* campaign switching
* invitations
* player accounts
* campaign sharing
* import/export
* backup
* templates
* assets

---

# Architecture

Business rules belong in the domain layer.

UI components remain presentation-only.

Do not duplicate business logic in React components.

---

# Testing

Add tests covering:

## Unit

* validation
* duplicate detection
* initialization values

## Database

* campaign creation
* ownership
* duplicate rejection
* RLS
* cross-user isolation

## Integration

* first login
* no campaigns
* create campaign
* redirect
* timeline initialization

## E2E

Fresh database:

```
Login
↓

No campaigns
↓

Create campaign
↓

Campaign page
↓

Timeline visible
↓

Characters accessible
```

---

# Documentation

Update:

* architecture
* data model
* task roadmap (mark Task 009A complete when finished)
* any campaign lifecycle documentation

Do not modify unrelated documentation.

---

# Acceptance Criteria

* A fresh database is usable without seed data.
* A new authenticated GM can create their first campaign.
* Campaigns are initialized with the canonical campaign state.
* The authenticated shell transitions cleanly from onboarding to campaign management.
* No hard-coded UUIDs or seeded campaign dependencies exist.
* Server-side validation and authorization are enforced.
* All tests pass.

---

# Verification

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If local Supabase is available:

* Apply migrations.
* Run database integration tests.
* Run Playwright end-to-end tests.

---

# Completion Report

When finished, provide:

1. Summary of implementation
2. Files changed
3. Database migrations
4. Domain functions added
5. RLS changes
6. UI components/routes added
7. Tests added
8. Verification results
9. Blockers encountered
10. Deferred work

Stop after Task 009A.

Do **not** begin Task 010 or any later task.
