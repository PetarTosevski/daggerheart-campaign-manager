# TASK-D8-A5: Custom adversaries

Status: Draft, built only if the user answers open question 6 "yes". Plan: `.omc/plans/d8.yaml`, tracer A5 (wave 3, depends on A2, A3).

## Goal
The GM duplicates any SRD stat block or starts a blank one (improvised statistics by tier prefilled), edits it, finds it under a "Custom"
book chip and adds it to encounters.

## Scope
- `convex/customAdversaries.ts` (list, create, update, remove), GM wrappers only; table from A0.
- Pure `src/lib/adversaries/custom.ts`; `src/components/adversaries/custom/`; `C/adversaries/page.tsx` passes customs to the catalogue.

## Book pages to re-check
CB p.208 (Improvised Statistics by Tier).

## Acceptance
See the A5 `acceptance` list in the plan.

## Verification
(Filled in by the tracer.)
