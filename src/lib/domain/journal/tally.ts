// The Journal tally's counting rules (dcm-z9rz.26, .27). Pure module, shared by Convex and tests.
//
// ```ts
// hopePaid({ hope: 6, scars: 0 }, { hope: 5, scars: 1 }, 0); // 0: the scar closed the slot the Hope sat in
// defeatsInWindows([{ startedAt: 5, instances: [...] }], snapshots, [{ from: 10, to: 20, open: false }]);
// ```

import { hopeMax } from "../characters";
import type { LiveWindow } from "./windows";

// ---------------------------------------------------------------- Hope spent (dcm-z9rz.27)

/** The sheet fields the Hope count reads. */
export type HopeCounts = { hope: number; scars: number; hopeSlotBonus?: number };

/**
 * The Hope one sheet save counts as spent (user 2026-11-05: "only Hope a player pays counts as spent"): the larger of
 * the Hope a paying path declared (`declared`) and the net drop, where Hope lost because a scar closed the slot it sat
 * in (fewer Hope slots than the Hope held) is not a drop. Never negative.
 */
export function hopePaid(before: HopeCounts, after: HopeCounts, declared: number): number {
  const slotsAfter = hopeMax(after.scars, after.hopeSlotBonus ?? 0);
  const closed = slotsAfter < hopeMax(before.scars, before.hopeSlotBonus ?? 0) ? Math.max(0, before.hope - slotsAfter) : 0;
  return Math.max(0, declared, before.hope - after.hope - closed);
}

// ---------------------------------------------------------------- Adversaries defeated (dcm-z9rz.26)

/** An adversary instance's tracks at one moment: now (the stored row) or just before an action (`adversaryBefore`). */
export type InstanceState = { hp: number; defeated: boolean };

/** One instance as the count reads it: its group size (`minionCount`), `hpMax` and its state now. */
export type TallyInstance = InstanceState & { id: string; minionCount?: number; hpMax: number };

/** One encounter with its instances; `startedAt` / `endedAt` as stored (a restart sets a newer `startedAt`). */
export type TallyEncounter = { startedAt?: number; endedAt?: number; instances: readonly TallyInstance[] };

/** An instance's state just before an action at `at` (the action log's `adversaryBefore`). */
export type InstanceSnapshot = InstanceState & { instanceId: string; at: number };

/**
 * Adversaries one state counts as defeated: a Minion group its defeated Minions (one HP each, CB p.201: its marked HP,
 * the whole group when defeated), anyone else 1 when defeated.
 */
export function defeatedIn(instance: Pick<TallyInstance, "minionCount" | "hpMax">, state: InstanceState): number {
  if (instance.minionCount === undefined) return state.defeated ? 1 : 0;
  return state.defeated ? instance.hpMax : Math.max(0, Math.min(state.hp, instance.hpMax));
}

/** Whether the encounter ran at some time in [w.from, w.to]: started by `w.to` and not ended before `w.from`. */
function ranIn(encounter: TallyEncounter, w: LiveWindow): boolean {
  const { startedAt, endedAt } = encounter;
  if (startedAt === undefined || startedAt > w.to) return false;
  const running = endedAt === undefined || endedAt < startedAt;
  return running || endedAt >= w.from;
}

/**
 * Adversaries defeated during the windows (user 2026-11-05: "every adversary defeated during the session, also in fights
 * started earlier"). Per window and instance of an encounter that ran in it: defeated at the window's end minus
 * defeated at its start, never below 0.
 *
 * - At the start: nothing, for an encounter started in the window; else the instance's first snapshot in the window,
 *   or (no logged action touched it) its state at the end, so it adds nothing.
 * - At the end: the open window's is the state now; a closed window's is the first snapshot after it, else the state
 *   now.
 *
 * `snapshots` are the action log's `adversaryBefore` entries (oldest first is not required). Changes no action logged
 * (the GM's tracker in a fight started before the session) are not seen in such a fight; in a fight started during
 * the session every defeat counts.
 */
export function defeatsInWindows(encounters: readonly TallyEncounter[], snapshots: readonly InstanceSnapshot[], windows: readonly LiveWindow[]): number {
  const byInstance = new Map<string, InstanceSnapshot[]>();
  for (const s of snapshots) {
    const list = byInstance.get(s.instanceId);
    if (list === undefined) byInstance.set(s.instanceId, [s]);
    else list.push(s);
  }
  for (const list of byInstance.values()) list.sort((a, b) => a.at - b.at);

  let total = 0;
  for (const w of windows) {
    for (const encounter of encounters) {
      if (!ranIn(encounter, w)) continue;
      const startedInWindow = encounter.startedAt !== undefined && encounter.startedAt >= w.from;
      for (const instance of encounter.instances) {
        const list = byInstance.get(instance.id) ?? [];
        const end: InstanceState = w.open ? instance : (list.find((s) => s.at > w.to) ?? instance);
        const start: InstanceState | null = startedInWindow ? null : (list.find((s) => s.at >= w.from && s.at <= w.to) ?? end);
        const before = start === null ? 0 : defeatedIn(instance, start);
        total += Math.max(0, defeatedIn(instance, end) - before);
      }
    }
  }
  return total;
}
