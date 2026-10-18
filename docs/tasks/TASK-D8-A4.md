# TASK-D8-A4: Live encounter tracker

Status: Draft. Plan: `.omc/plans/d8.yaml`, tracer A4 (wave 3, depends on A2, A3).

## Goal
During a running encounter the GM marks damage by thresholds, HP and Stress, minion and horde rules, conditions, spotlights per GM turn and
Fear spending (which lowers the dashboard's GM Fear), and rolls adversary attacks into the hidden GM roll feed.

## Scope
- Pure `src/lib/domain/encounters/damage.ts` and `spotlight.ts`.
- `convex/encounterTracking.ts` (markHp, markStress, applyDamage, defeatMinions, toggleCondition, setTags, setNote, spotlight, endGmTurn, spendFear).
- `src/components/adversaries/tracker/`; attack/damage rolls through the existing `rolls.gmRoll`.
- Defaults from open questions 2-5 (Stress overflow marks HP, no Massive Damage, minion suggestion confirmed by the GM, spotlight warns, Fear never taken automatically).

## Book pages to re-check
CB p.91, p.92, p.99, p.102, p.148, p.153, p.154, p.160, p.178, p.193-195, p.199, p.201, p.208.

## Acceptance
See the A4 `acceptance` list in the plan.

## Verification
(Filled in by the tracer.)
