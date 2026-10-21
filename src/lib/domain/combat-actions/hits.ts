// Hit or miss per target for one attack roll (plan combat-actions, tracer CA1; rules R1, R9). Pure.
//
// CB p.96, "Attack Rolls": "If a spell or ability allows you to target multiple adversaries, roll once and apply that
//   result to all of the adversaries the attack can hit … The attack is successful against all targets for which the
//   attack roll result meets or exceeds their Difficulty."
// CB p.90, "Critical Successes": "A critical success counts as a roll with Hope, even if you would've otherwise failed
//   because the total is lower than the roll's Difficulty."
// CB p.104: "Regardless of the number of targets, you only make one attack roll and compare its result to the Difficulty
//   of each eligible target."
// The same comparison serves an adversary's roll against a PC's Evasion (AR1, CB p.160): pass the Evasion as `difficulty`.
//
// ```ts
// resolveHits(14, false, [{ id: "a", difficulty: 12 }, { id: "b", difficulty: 15 }]); // a hit, b miss
// resolveHits(5, true, [{ id: "b", difficulty: 15 }]);                                 // b hit (critical)
// ```

export interface HitTarget {
  readonly id: string;
  /** The target's Difficulty (an adversary) or Evasion (a PC). */
  readonly difficulty: number;
}

export interface HitResult {
  id: string;
  hit: boolean;
}

/** One roll against every target: hit when `total` meets or beats its Difficulty, or on a critical (R1, R9). */
export function resolveHits(total: number, critical: boolean, targets: readonly HitTarget[]): HitResult[] {
  return targets.map((t) => ({ id: t.id, hit: critical || total >= t.difficulty }));
}
