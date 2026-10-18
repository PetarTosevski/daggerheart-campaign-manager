# TASK-D8-A3: Encounters and the Battle Points builder

Status: Draft. Plan: `.omc/plans/d8.yaml`, tracer A3 (wave 2, depends on A0, A1).

## Goal
The GM creates, renames, deletes and starts encounters, adds adversaries from the catalogue (count, minion group size, summoned) and sees
the Battle Points budget with adjustments in the Sessions board's builder look.

## Scope
- `convex/encounters.ts` (list, get, create, rename, setNotes, setBudget, start, end, remove, addAdversary, removeInstance, reorder), GM wrappers only.
- Pure `src/lib/domain/encounters/budget.ts` and `instances.ts`.
- `src/components/adversaries/builder/` including the "Add to encounter" action for the catalogue stat block.

## Book pages to re-check
CB p.197 (Battle Points formula, adjustments, costs; summoned adversaries not counted).

## Acceptance
See the A3 `acceptance` list in the plan.

## Verification
(Filled in by the tracer.)
