/**
 * Unshakable (Firbolg, CB p.59): "When you would mark a Stress, roll a d6. On a result of 6, don't mark it." User answer
 * 2026-10-30 (dcm-bxp.99.19.50 (1); plan drawer-answers DA10): whenever the PC would mark Stress through the server, the
 * server rolls a d6 for EACH Stress (Stress paid as a cost too) and skips that Stress on a 6; the roll shows in the log.
 * A manual tracker click on the sheet or the drawer does not roll (the player marks what they decide).
 *
 * This is the one helper every server Stress mark goes through:
 * - `markStressOn`: a direct mark (the Hand's Recall Cost, Flow State's "mark a Stress" to shift).
 * - `unshake`: a write that already marked `count` Stress (a hit, its riders, an adversary feature); the skipped marks
 *   are taken back, overflow HP included (CB p.92: "If you would mark Stress but your Stress is full, mark 1 Hit Point
 *   instead").
 * - `unshakePlan`: the same for a card or feature plan (`stressMarksIn`: its paid Stress costs and its Stress steps on
 *   that PC); `actorSheetAfter` (convex/lib/cardRunner.ts) runs it for the actor of every card and feature use.
 * - `unshakableText` / `logUnshakable`: the feed words (the d6 values and what was skipped), on the caller's row or as a
 *   public row in the caller's undo group (kind `feature`, so a player's undo of the action is not limited as a dice row).
 *
 * Undo: the skip is part of the sheet the caller saves, so undoing the caller's row (or group) reverts it.
 */
import type { RunPlan } from "../../src/lib/domain/card-effects/run";
import type { Rng } from "../../src/lib/domain/class-features/types";
import { markStress } from "../../src/lib/domain/characters/index";
import { owned, type OwnedSheet } from "../../src/lib/domain/feature-effects/owned";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { logAction } from "./actionLog";
import { rollDie } from "./dice";
import type { ActionKind } from "./validators/actionLog";

export const UNSHAKABLE_ID = "ancestry:firbolg:unshakable";
/** At most this many d6s for one write (a sheet's Stress track is at most 12; the rest is marked as is). */
const MAX_ROLLS = 20;

/** The d6s one write rolled: one per Stress the PC would mark, and how many were 6s (not marked). */
export type UnshakableRoll = { rolls: number[]; skipped: number };

type Tracks = { stress: number; stressMax: number; hp: number; hpMax: number };

/** Whether the sheet holds Unshakable (a Firbolg, or a mixed ancestry that took it). */
export function holdsUnshakable(sheet: OwnedSheet): boolean {
  return owned(sheet).some((f) => f.featureId === UNSHAKABLE_ID);
}

/** One d6 per Stress (at most `MAX_ROLLS`); each 6 skips that Stress. */
export function rollUnshakable(count: number, rng: Rng = rollDie): UnshakableRoll {
  const rolls = Array.from({ length: Math.max(0, Math.min(MAX_ROLLS, Math.trunc(count))) }, () => rng(6));
  return { rolls, skipped: rolls.filter((r) => r === 6).length };
}

/**
 * The sheet after `count` Stress marks made from `from` (the tracks before them) when `skipped` of them are not marked:
 * the difference between marking `count` and `count - skipped` from `from` is taken off `after`, overflow HP included.
 */
export function unmarkSkipped<S extends { stress: number; hp: number }>(from: Tracks, after: S, count: number, skipped: number): S {
  if (skipped <= 0 || count <= 0) return after;
  const all = markStress(from, count);
  const kept = markStress(from, count - Math.min(count, skipped));
  return { ...after, stress: Math.max(0, after.stress - (all.stress - kept.stress)), hp: Math.max(0, after.hp - (all.hp - kept.hp)) };
}

/**
 * For a write that marked `count` Stress on a PC (`before` → `after`): rolls Unshakable when the PC holds it and takes the
 * skipped marks back. `roll` is null when nothing was rolled (no Unshakable, no Stress).
 */
export function unshake<S extends OwnedSheet & Tracks>(before: S, after: S, count: number, rng: Rng = rollDie): { sheet: S; roll: UnshakableRoll | null } {
  if (count <= 0 || !holdsUnshakable(before)) return { sheet: after, roll: null };
  const roll = rollUnshakable(count, rng);
  return { sheet: unmarkSkipped(before, after, count, roll.skipped), roll };
}

/** A direct mark of `amount` Stress (CB p.92 overflow), each rolled for Unshakable. */
export function markStressOn<S extends OwnedSheet & Tracks>(sheet: S, amount: number, rng: Rng = rollDie): { sheet: S; roll: UnshakableRoll | null; marked: number } {
  const roll = amount > 0 && holdsUnshakable(sheet) ? rollUnshakable(amount, rng) : null;
  const marked = Math.max(0, amount - (roll?.skipped ?? 0));
  const next = marked > 0 ? markStress(sheet, marked) : { stress: sheet.stress, hp: sheet.hp };
  return { sheet: { ...sheet, stress: next.stress, hp: next.hp }, roll, marked };
}

/** The Stress a plan would mark on `who`: its paid Stress costs (the actor's) and its Stress steps on them. */
export function stressMarksIn(plan: Pick<RunPlan, "steps">, who: string, isActor: boolean): number {
  let n = 0;
  for (const s of plan.steps) {
    if (isActor && s.kind === "pay" && s.paid) n += s.costs.reduce((sum, c) => sum + (c.resource === "stress" && c.pool === undefined ? c.amount : 0), 0);
    else if (s.kind === "mark" && s.track === "stress" && s.targetId === who) n += s.amount;
  }
  return n;
}

/** `unshake` for the Stress a card or feature plan marked on `who` (`start` → `after`). */
export function unshakePlan<S extends OwnedSheet & Tracks>(start: S, after: S, plan: Pick<RunPlan, "steps">, who: string, isActor: boolean, rng: Rng = rollDie) {
  return unshake(start, after, stressMarksIn(plan, who, isActor), rng);
}

/** The feed words: "Unshakable d6: 3, 6 (1 Stress not marked)". */
export function unshakableText(roll: UnshakableRoll): string {
  const what = roll.skipped === 0 ? "marked" : roll.skipped === roll.rolls.length ? `${roll.skipped} Stress not marked` : `${roll.skipped} of ${roll.rolls.length} Stress not marked`;
  return `Unshakable d6: ${roll.rolls.join(", ")} (${what})`;
}

/**
 * A public row naming the d6s, in the caller's undo group (so the caller's undo takes it back with the sheet). Kind
 * `feature`: the row holds a roll, but it is not a dice row a player's undo window applies to.
 */
export async function logUnshakable(
  ctx: MutationCtx,
  entry: { campaignId: Id<"campaigns">; characterId: Id<"characters">; actorId: Id<"users">; name: string; groupId: string; kind?: ActionKind },
  roll: UnshakableRoll | null,
): Promise<void> {
  if (roll === null || roll.rolls.length === 0) return;
  await logAction(ctx, {
    campaignId: entry.campaignId,
    characterId: entry.characterId,
    actorId: entry.actorId,
    kind: entry.kind ?? "feature",
    visibility: "public",
    summary: `${entry.name}: ${unshakableText(roll)}`,
    roll: { kind: "free", dice: roll.rolls.map((value) => ({ sides: 6, value, role: "extra" as const })), modifier: 0, total: Math.max(...roll.rolls), outcome: "none", manual: false },
    groupId: entry.groupId,
    undoable: true,
  });
}
