# TASK SD-ST: Martial stances rule data

Plan `.omc/plans/sheet-drawer.yaml`, tracer SD-ST (wave 1, no dependencies). Bead `dcm-bxp.99.19`. Status: Review.

## User answer implemented (Q5)

- (a) "add all 16 martial stances as rule data, a Focus track, fully automated later." This tracer adds the data only;
  the effects are SD-FE-stances, and the Focus track on the sheet belongs to the drawer tracers.

## Source

Hope & Fear p.12 (Martial Stances: Stances, Focus, Shifting into Stances, Dropping out of Stances, Stance Features),
checked against the Martial Stances sheet (HF p.13 and p.183) and the Martial Artist page (HF p.11). The sheet and the
page text match word for word. Only the rule text the mechanic needs is stored (AGENTS.md).

## What changed

| File | What |
|------|------|
| `src/lib/srd/stances.ts` | `STANCES`: 16 `{id, name, tier, text}` entries in book order, 4 per tier, text transcribed from HF p.12. `StanceId`, `StanceTier`, `StanceDef` types (local to this file; `types.ts` is not in the tracer's `owns`). Constants: `FOCUS_MAX = 6`, `SHIFT_FOCUS_COST = 1`, `STARTING_STANCES = 2`, `STANCES_PER_LEVEL = 1`, `REFOCUS` (once per rest in calm, clear the track, Instinct d6s, keep the highest), `STANCE_DROP_TRIGGERS` (shift, Severe damage, last Hit Point, scene end). Helpers `stanceById`, `stancesUpToTier`. |
| `tests/unit/stances.test.ts` | 7 tests: count 16, 4 per tier, the book's names per tier, unique ids and names, entry shape, lookups, the Focus constants, and that the Martial Artist foundation (Stance Fighter) still names the Martial Stances sheet. |

`src/lib/srd/index.ts` does not re-export the module (not owned); consumers import `@/lib/srd/stances` directly.
No Convex function, validator, schema field or migration.

## Tests

- `tests/unit/stances.test.ts` (7 new).

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 292 files, 7763 passed, 1 expected fail.
- `pnpm tracer:guard .omc/plans/sheet-drawer.yaml SD-ST`: OK.
