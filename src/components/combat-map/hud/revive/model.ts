import type { Id } from "../../../../../convex/_generated/dataModel";
import { isDefeatedRow } from "../spotlight/model";

/**
 * Revive a defeated adversary (bead dcm-6c2o, user 2026-11-04): who may be revived, what the box starts at and says, and
 * the GM's optimistic updates. Pure; `index.tsx` renders it. The server's rule is `encounterTracking.reviveInstance`.
 */

/** The adversary the GM is reviving: its map token, its encounter instance and its name. */
export type ReviveTarget = { tokenId: Id<"combatTokens">; instanceId: Id<"encounterAdversaries">; name: string };

type TokenLike = {
  kind: string;
  instanceId?: Id<"encounterAdversaries">;
  /** The encounter is running, so the tracker (and revive) accepts changes. */
  tracked?: boolean;
  stats: { hp: number; hpMax: number; down: boolean } | null;
};

/**
 * Whether the GM may revive this token's adversary: an adversary token of a running encounter (`tracked`) whose instance
 * is defeated (`isDefeatedRow`: marked defeated, or every HP marked, as the server's `adversaryDefeated`).
 */
export function canRevive(token: TokenLike): boolean {
  return token.kind === "adversary" && token.instanceId !== undefined && token.tracked === true && isDefeatedRow(token.stats);
}

/** The box's opening marks (user 2026-11-04): full health, 0 HP and 0 Stress marked. */
export const FULL_HEALTH = { hp: 0, stress: 0 } as const;

/** The highest HP mark a revive may leave: one short of every HP marked (else it would still be defeated). */
export function hpCap(hpMax: number): number {
  return Math.max(0, hpMax - 1);
}

/** A step of one mark, kept within 0..cap. */
export function stepMarks(value: number, delta: -1 | 1, cap: number): number {
  return Math.max(0, Math.min(cap, value + delta));
}

/** The box's summary line: what comes back ("3 of 4 Minions standing", "Full health: no HP or Stress marked"). */
export function reviveLine(marks: { hp: number; stress: number }, stats: { hpMax: number; stressMax: number }, minions: boolean): string {
  if (minions) return `${stats.hpMax - marks.hp} of ${stats.hpMax} Minions standing`;
  if (marks.hp === 0 && marks.stress === 0) return "Full health: no HP or Stress marked";
  const stress = stats.stressMax > 0 ? `, ${marks.stress} of ${stats.stressMax} Stress marked` : "";
  return `${marks.hp} of ${stats.hpMax} HP marked${stress}`;
}

type TokenRow = { instanceId?: Id<"encounterAdversaries">; stats: { hp: number; stress: number; down: boolean } | null };

/** The map's tokens right after a revive (the GM's optimistic update on `combatTokensReads.list`): its marks set, not down. */
export function afterReviveTokens<T extends TokenRow>(tokens: readonly T[], instanceId: Id<"encounterAdversaries">, marks: { hp: number; stress: number }): T[] {
  return tokens.map((t) => (t.instanceId === instanceId && t.stats ? { ...t, stats: { ...t.stats, hp: marks.hp, stress: marks.stress, down: false } } : t));
}

type InstanceRow = { _id: Id<"encounterAdversaries">; hp: number; stress: number; defeated: boolean };

/** The encounter's instances right after a revive (the optimistic update on `encounters.get`). */
export function afterReviveInstances<T extends InstanceRow>(instances: readonly T[], instanceId: Id<"encounterAdversaries">, marks: { hp: number; stress: number }): T[] {
  return instances.map((i) => (i._id === instanceId ? { ...i, hp: marks.hp, stress: marks.stress, defeated: false } : i));
}
