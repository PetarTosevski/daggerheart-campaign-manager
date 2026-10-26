// The combat engine (plan combat-actions, tracer CA1): range, line of sight, hit or miss, damage after resistance, HP and
// Stress marks, numbers of the card vocabulary. Pure and framework-free. The card runner is card-effects/run.ts and the
// once-per checks are card-effects/availability.ts. API: docs/tasks/TASK-CA-CA1.md.

export { RANGE_ORDER, bandOf, rangeCheck, rangeFromWeapon, tokenDistance, withinRange, type Footprint, type RangeCheck } from "./distance";
export { lineOfSight, type SightResult } from "./sight";
export { resolveHits, type HitResult, type HitTarget } from "./hits";
export {
  applyDamageTo,
  applyHpTo,
  applyStressTo,
  clearTrack,
  resistanceAgainst,
  type Combatant,
  type DamageOptions,
  type DamageResult,
  type MarkResult,
  type ResistanceLevel,
  type Thresholds,
} from "./damage";
export { resolveDice, resolveNumber, rollDice, type MarkedTracks, type NumberEnv, type ResolvedDice } from "./numbers";
