# TASK-D8-A0: D8 foundation

Status: Draft. Plan: `.omc/plans/d8.yaml`, tracer A0 (wave 1, no dependencies). Analysis: `.omc/autopilot/d8-analysis.md`.

## Goal
The encounter tables exist and go with their campaign's purge; the Fear spend helper and the encounter error codes are wired; the GM opens
`/campaigns/<id>/adversaries` to a board-look page with Catalogue and Encounters tabs (stubs); players see no nav item and a GM-only panel.

## Scope
- `convex/tables/encounters.ts`, `convex/lib/validators/encounters.ts`, `convex/lib/encounters.ts` (loaders, caps), `convex/schema.ts`, `convex/cleanup.ts`.
- `spendFear` in `convex/lib/fear.ts` (history action `spend`, `FEAR_EMPTY`), CB p.154.
- `src/lib/errors/encounters.ts` wired into `AppErrorCode` and `src/lib/convex-errors.ts`.
- Route shell, `adversaries.css` tokens, `slots.ts`, four stub folders; `gmOnly` nav for players.
- Visual tooling: `openAdversaries` helper, `scripts/board-shots.mjs adversaries:<region>`.

## Acceptance
See the A0 `acceptance` list in the plan and the rules for every tracer in its header.

## Book pages to re-check
CB p.154 (Fear spending, maximum 12).

## Verification
(Filled in by the tracer: commands run, test results, screenshot paths.)
