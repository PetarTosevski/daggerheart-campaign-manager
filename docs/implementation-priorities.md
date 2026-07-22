# Implementation Priorities

## Status convention

- `Reported complete`: the owner indicates the feature exists.
- `Review`: implementation exists or is reported, but repository code, database
  migrations, tests, and documentation have not yet been verified together.
- `Ready`: approved to implement.
- `Blocked`: a named decision prevents implementation.
- `Planned`: not yet ready.

Repository reconciliation established the implemented Next.js application,
package manifest, Supabase migrations, generated types, and automated tests.
Tasks are marked complete only after their source, database behavior,
authorization, documentation, and required checks have been verified together.

## Reconciliation pass

Priority 0:

- [x] Inspect the current source tree and `package.json`
- [x] Record actual framework and dependency versions
- [x] Inspect Supabase migrations and generated types
- [x] Verify authentication method and RLS
- [x] Run lint, typecheck, unit tests, end-to-end tests, and build
- [x] Reconcile task statuses with evidence
- [x] Update `architecture.md` and `data-model.md` to match implementation

## Phase 1 — Campaign control surface

Status: In progress

- [x] Project bootstrap (Task 001 — Complete, verified 2026-07-18)
- [x] Authentication (Task 002 — Complete, verified 2026-07-18; live sign-in/sign-out e2e passed)
- [ ] Campaign shell and dashboard (Draft)
- [x] Phase 1 database schema (Task 003 — Complete, verified 2026-07-18; migrations applied, DB integration tests pass)
- [x] Fear tracker (Task 004 — Complete, verified 2026-07-19; 0–12 bounds,
  atomic history, idempotency, RLS, refresh persistence, and live e2e passed)
- [x] Countdown tracker (Task 005 — Complete, verified 2026-07-19; atomic
  creation and operations, idempotency, RLS, history, automatic completion,
  reopen behavior, and live e2e passed)
- [ ] Basic characters (Draft)

Missing or unclear task coverage:

- [ ] Add a dedicated campaign shell/dashboard task if one does not already
  exist in the repository.
- [ ] Add a dedicated basic-character task if one does not already exist.
- [ ] Verify recent activity behavior.

## Phase 2 — Campaign time and survival

Status: Blocked pending rule and workflow decisions

Recommended order:

1. [x] Operations and idempotency foundation (Task 006 — Complete, verified
  2026-07-19)
2. [x] Campaign-week and day/night-cycle tracker (Task 007 — Complete,
   verified 2026-07-19)
3. [ ] Week-advancement preview and commit
4. [ ] Food stores and manual transactions
5. [ ] Weekly food consumption
6. [ ] Spoilage
7. [ ] Inventory items and transfers
8. [ ] Correction and undo for compound operations

## Phase 3 — Character and campaign-frame mechanics

Status: Planned

- [ ] Expanded character resources
- [ ] Conditions and equipment
- [ ] Wither-token tracking
- [ ] Session-end Wither resolution
- [ ] Scars
- [ ] Settlement tracking
- [ ] Travel
- [ ] Projects

## Phase 4 — Reliability and optional expansion

Status: Planned

- [ ] Import and export
- [ ] Backup and recovery guidance
- [ ] Improved audit history
- [ ] Accessibility review
- [ ] Optional offline-read support
- [ ] Maps only after an explicit product-scope decision
- [ ] Analytics only after a concrete GM question is identified

## Next recommended task

The campaign-week and day/night-cycle tracker is complete. Do not begin Task
008 without explicit approval and resolution of its named food, spoilage, and
extended-downtime blockers. Generic undo eligibility remains open under
`OQ-PROD-005`.
