import { applyResourceDelta } from "@/lib/domain/characters";

import type { Drawer } from "../list/model";

export type TrackerResource = "hp" | "stress" | "hope" | "armor";
export type Trackers = Drawer["trackers"];

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

/**
 * The trackers after a +1 / -1 click, as the server's `characters.adjustResource` computes them (the sheet's own limits:
 * a track stops at its slots, Hope at its maximum, and marking Stress past full marks a Hit Point, CB p.106). Used for the
 * optimistic update (rule 12); the server's answer replaces it.
 */
export function applyTrackerDelta(t: Trackers, resource: TrackerResource, delta: number): Trackers {
  if (resource === "armor") return { ...t, armor: { ...t.armor, marked: clamp(t.armor.marked + delta, t.armor.max) } };
  if (resource === "hope") return { ...t, hope: { ...t.hope, value: clamp(t.hope.value + delta, t.hope.max) } };
  const next = applyResourceDelta({ hp: t.hp.marked, hpMax: t.hp.max, stress: t.stress.marked, stressMax: t.stress.max, hope: 0, scars: 0 }, resource, delta);
  return { ...t, hp: { ...t.hp, marked: next.hp }, stress: { ...t.stress, marked: next.stress } };
}

export const TRACKER_LABELS: Record<TrackerResource, { name: string; one: string }> = {
  hp: { name: "Hit Points", one: "Hit Point" },
  stress: { name: "Stress", one: "Stress" },
  hope: { name: "Hope", one: "Hope" },
  armor: { name: "Armor", one: "Armor Slot" },
};

/** "3 / 6 marked" for the marked tracks, "2 / 6" for Hope (which counts what is held). */
export function trackerText(t: Trackers, resource: TrackerResource): string {
  if (resource === "hope") return `${t.hope.value} / ${t.hope.max}`;
  const track = t[resource];
  return `${track.marked} / ${track.max} marked`;
}
