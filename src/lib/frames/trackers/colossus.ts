// Colossus of the Drylands: hunts and interludes, the Siphoning Track and
// Kudamat's Power (Core Book pp.318, 327). Pure module: bundled into Convex,
// so no framework imports.

import { z } from "zod";

import { RuleError } from "../../errors/app-error";

/** "The Siphoning Track starts with one slot marked" (p.327); the sheet has 10 slots. */
export const SIPHON_SLOTS = 10;
/** "Once all nine colossi have been slain or his Power reaches 100, Kudamat emerges" (p.327). */
export const COLOSSI_TOTAL = 9;
export const EMERGENCE_POWER = 100;
/** Upper bound for a manual Power correction (the book sets none). */
export const MAX_POWER = 999;
/** How many siphon rolls the tracker keeps for the GM. */
export const SIPHON_LOG_SIZE = 5;

export const COLOSSUS_PHASES = ["hunt", "interlude"] as const;
export type ColossusPhase = (typeof COLOSSUS_PHASES)[number];
export type RestKind = "short" | "long";

export const siphonRollSchema = z.object({
  /** Why the shard was rolled: a colossus fell, or the track filled. */
  reason: z.enum(["defeat", "full"]),
  dice: z.array(z.number().int().min(1).max(12)),
  gained: z.number().int().min(0),
  powerAfter: z.number().int().min(0),
  at: z.number(),
});
export type SiphonRoll = z.infer<typeof siphonRollSchema>;

export const colossusStateSchema = z.object({
  phase: z.enum(COLOSSUS_PHASES),
  siphonMarked: z.number().int().min(1).max(SIPHON_SLOTS),
  kudamatPower: z.number().int().min(0),
  colossiDefeated: z.number().int().min(0).max(COLOSSI_TOTAL),
  log: z.array(siphonRollSchema),
});
export type ColossusState = z.infer<typeof colossusStateSchema>;

export const INITIAL_COLOSSUS: ColossusState = {
  phase: "hunt",
  siphonMarked: 1,
  kudamatPower: 0,
  colossiDefeated: 0,
  log: [],
};

/** Manual GM corrections; each field optional. */
export const colossusCorrectionSchema = z
  .object({
    siphonMarked: z.number().int().min(1).max(SIPHON_SLOTS).optional(),
    kudamatPower: z.number().int().min(0).max(MAX_POWER).optional(),
    colossiDefeated: z.number().int().min(0).max(COLOSSI_TOTAL).optional(),
  })
  .refine((c) => Object.values(c).some((v) => v !== undefined), "Nothing to correct.");
export type ColossusCorrection = z.infer<typeof colossusCorrectionSchema>;

/** Rolls `count` d12s. Injected so the server rolls and tests stay deterministic. */
export type RollD12s = (count: number) => number[];

export function hasEmerged(state: Pick<ColossusState, "kudamatPower" | "colossiDefeated">): boolean {
  return state.colossiDefeated >= COLOSSI_TOTAL || state.kudamatPower >= EMERGENCE_POWER;
}

/** Kudamat's thresholds: "Severe threshold equal to… Power and a Major threshold equal to half that value (rounded up)". */
export function kudamatThresholds(power: number): { major: number; severe: number } {
  return { major: Math.ceil(power / 2), severe: power };
}

/**
 * "roll as many d12s as marked slots… Increase Kudamat's Power by the highest
 * value rolled, then reset the Siphoning Track to 1."
 */
export function resolveSiphon(
  state: ColossusState,
  reason: SiphonRoll["reason"],
  roll: RollD12s,
  at: number,
): { state: ColossusState; roll: SiphonRoll } {
  const dice = roll(state.siphonMarked);
  if (dice.length !== state.siphonMarked || dice.some((d) => !Number.isInteger(d) || d < 1 || d > 12)) {
    throw new RuleError("TRACKER_RULE", "The siphon needs one d12 per marked slot.");
  }
  const gained = Math.max(...dice);
  const kudamatPower = state.kudamatPower + gained;
  const entry: SiphonRoll = { reason, dice, gained, powerAfter: kudamatPower, at };
  return {
    state: { ...state, kudamatPower, siphonMarked: 1, log: [entry, ...state.log].slice(0, SIPHON_LOG_SIZE) },
    roll: entry,
  };
}

/**
 * A rest during the hunt phase marks the track once (short) or twice (long).
 * Marks apply one at a time: when a mark fills the track it resolves at once
 * and any remaining mark lands on the reset track.
 */
export function markRest(
  state: ColossusState,
  kind: RestKind,
  roll: RollD12s,
  at: number,
): { state: ColossusState; rolls: SiphonRoll[] } {
  if (state.phase !== "hunt") throw new RuleError("TRACKER_RULE", "Rests mark the Siphoning Track only during the hunt phase.");
  let next = state;
  const rolls: SiphonRoll[] = [];
  for (let i = 0; i < (kind === "long" ? 2 : 1); i++) {
    next = { ...next, siphonMarked: Math.min(SIPHON_SLOTS, next.siphonMarked + 1) };
    if (next.siphonMarked === SIPHON_SLOTS) {
      const resolved = resolveSiphon(next, "full", roll, at);
      next = resolved.state;
      rolls.push(resolved.roll);
    }
  }
  return { state: next, rolls };
}

/** "Upon defeating each colossus, the soul shard in that location shatters and the PCs immediately level up" (p.327). */
export function levelUpNotice(colossiDefeated: number): string {
  return colossiDefeated >= COLOSSI_TOTAL
    ? "The last soul shard shatters: the party levels up to level 10 and Kudamat emerges from Godfell Mountain."
    : "The soul shard shatters: the party levels up.";
}

/** A colossus falls: the shard is rolled, the count rises and the interlude begins. */
export function defeatColossus(
  state: ColossusState,
  roll: RollD12s,
  at: number,
): { state: ColossusState; roll: SiphonRoll; notice: string } {
  if (state.colossiDefeated >= COLOSSI_TOTAL) throw new RuleError("TRACKER_RULE", "All nine colossi are already slain.");
  const resolved = resolveSiphon(state, "defeat", roll, at);
  const colossiDefeated = state.colossiDefeated + 1;
  return {
    state: { ...resolved.state, colossiDefeated, phase: "interlude" },
    roll: resolved.roll,
    notice: levelUpNotice(colossiDefeated),
  };
}

export function applyCorrection(state: ColossusState, correction: ColossusCorrection): ColossusState {
  return {
    ...state,
    siphonMarked: correction.siphonMarked ?? state.siphonMarked,
    kudamatPower: correction.kudamatPower ?? state.kudamatPower,
    colossiDefeated: correction.colossiDefeated ?? state.colossiDefeated,
  };
}
