import { useSyncExternalStore } from "react";

import type { AttackReport } from "./model";

/**
 * The last attack's report (Hit / Miss / Defeated, the player's own damage total), shared by whoever opened the picker
 * (the interim button here, H3.4's action ring) and the line that shows it (`HudAttack`). A tiny external store read
 * through `useSyncExternalStore`, because the opener and the line live in different HUD regions. H4.1's result panel
 * replaces the line (and may read the same store).
 */

let last: AttackReport | null = null;
const listeners = new Set<() => void>();

export const attackReports = {
  get: (): AttackReport | null => last,
  set: (report: AttackReport | null): void => {
    last = report;
    for (const fn of listeners) fn();
  },
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/** The last report for this character (null: none yet, or another character's). */
export function useAttackReport(characterId: string | null): AttackReport | null {
  const report = useSyncExternalStore(attackReports.subscribe, attackReports.get, () => null);
  return report !== null && report.characterId === characterId ? report : null;
}
