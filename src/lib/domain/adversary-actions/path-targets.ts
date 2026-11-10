// Plan rule-switches WF (user 2026-11-10): the destination pick of an adversary feature that moves and hits everyone in
// its path (Rampaging Fury, CB p.210: "Move the Ogre to a point within Close range and deal 2d6+3 direct physical damage
// to all targets in their path"; Trample, Charging Bull, Swooping Attack, Rampage, Power Slide…). The GM clicks the
// destination square within the move's range; the token goes there and everyone whose squares the straight line from
// start to destination crosses starts picked (the GM can still change the list). Pure; relative imports only.
//
// ```ts
// pathMoveRange(rampagingFury);                                   // "close"
// crossedBy({ x: 0, y: 0, size: 1 }, { x: 4, y: 0 }, tokens);     // the ids of the tokens on squares (1..4, 0)
// ```

import type { Range } from "../card-effects/types";

type Footprint = { x: number; y: number; size: number };
type AnyStep = { kind: string; to?: unknown; range?: unknown; steps?: unknown };

/**
 * The range of the move a "path" feature makes (its targets are `area: "path"` and a step moves the adversary itself),
 * or null when the use is not one. A move without a Defined Range reads as Close.
 */
export function pathMoveRange(use: { targets?: unknown; steps: readonly AnyStep[] }): Range | null {
  const targets = use.targets as { area?: string } | undefined;
  if (targets?.area !== "path") return null;
  const find = (steps: readonly AnyStep[]): AnyStep | undefined => {
    for (const s of steps) {
      if (s.kind === "move" && (s.to === undefined || s.to === "self")) return s;
      const nested = Array.isArray(s.steps) ? find(s.steps as AnyStep[]) : undefined;
      if (nested) return nested;
    }
    return undefined;
  };
  const move = find(use.steps);
  if (!move) return null;
  const range = move.range;
  return range === "melee" || range === "veryClose" || range === "close" || range === "far" || range === "veryFar" ? range : "close";
}

/** The squares a token of `from.size` covers while it slides in a straight line from its square to `to` (both ends included). */
export function pathSquares(from: Footprint, to: { x: number; y: number }): Set<string> {
  const out = new Set<string>();
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Four samples per square of travel: no square the footprint's centre line passes through is skipped.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // The footprint's top-left at this point, rounded to the square its centre is in.
    const x = Math.round(from.x + dx * t);
    const y = Math.round(from.y + dy * t);
    for (let a = 0; a < from.size; a++) for (let b = 0; b < from.size; b++) out.add(`${x + a},${y + b}`);
  }
  return out;
}

/** The ids of the tokens (other than the mover) with a square on the mover's path (`pathSquares`), nearest first. */
export function crossedBy<T extends Footprint & { id: string }>(from: Footprint & { id?: string }, to: { x: number; y: number }, tokens: readonly T[]): string[] {
  const path = pathSquares(from, to);
  const hits: { id: string; d: number }[] = [];
  for (const t of tokens) {
    if (from.id !== undefined && t.id === from.id) continue;
    let on = false;
    for (let a = 0; a < t.size && !on; a++) for (let b = 0; b < t.size && !on; b++) on = path.has(`${t.x + a},${t.y + b}`);
    if (on) hits.push({ id: t.id, d: Math.hypot(t.x - from.x, t.y - from.y) });
  }
  return hits.sort((p, q) => p.d - q.d).map((h) => h.id);
}
