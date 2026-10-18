# TASK-D8-A2: Catalogue browser and stat block

Status: Draft. Plan: `.omc/plans/d8.yaml`, tracer A2 (wave 2, depends on A0, A1). Board: `reference/designs/project/Adversaries.dc.html` lines 75-129.

## Goal
The GM browses, searches and filters the catalogue in the board's look and reads any stat block on parchment; H&F and Weredragon entries
follow the campaign.

## Scope
- Pure search/filter/group/paging in `src/lib/adversaries/catalogue.ts`.
- `src/components/adversaries/catalogue/` (list, chips, empty state, `stat-block.tsx` exported for A3-A5).
- Board bug not ported: the list scrolls so "Show more" is reachable. The board's per-name pip tracker is not ported (encounters hold HP/Stress).

## Acceptance
See the A2 `acceptance` list in the plan. Visual: board shots `adversaries:page/filters/list/statblock/empty` beside `tests/e2e/visual/A2.spec.ts` shots.

## Verification
(Filled in by the tracer.)
