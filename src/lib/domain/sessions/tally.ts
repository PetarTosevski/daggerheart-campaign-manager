// Session tally (D10 S1, board rule B4, decision Q3 (a)). Pure module.
//
// Q3 (a): "automatic and read-only: Fear gained / spent from the Fear history between the session's start and end
// (increases = gained, decreases = spent; an 'undo' row cancels the change it undoes), short / long rests from the
// FINISHED rests in that window ... Restarting a played session (B7) adds the new window to the stored counts."
// K1 (CB p.154): "Fear carries over between sessions" — the tally only counts, it never touches GM Fear.
//
// Fear history rows (convex/tables/history.ts, kind "fear") carry `action` and `before`/`after`. Actions written today:
// "adjust", "set" (convex/fear.ts), "gain", "spend", "undo" (convex/lib/fear.ts). An "undo" row (revertFear) does not
// name the row it reverts, so it cancels by direction: a decrease takes back Fear gained, an increase gives back Fear
// spent; neither count goes below 0 (an undo of a change from before the window cancels nothing in it).
//
// ```ts
// const fear = [
//   { action: "gain", before: 3, after: 5, at: 10 },  // gained 2
//   { action: "undo", before: 5, after: 4, at: 11 },  // takes back 1 of it
//   { action: "spend", before: 4, after: 3, at: 12 }, // spent 1
// ];
// windowTally(fear, [{ kind: "short", status: "finished", startedAt: 13 }]);
// // { fearGained: 1, fearSpent: 1, shortRests: 1, longRests: 0 }
// ```

/** The counts stored on `sessions.tally` (S0). */
export type SessionTally = { fearGained: number; fearSpent: number; shortRests: number; longRests: number };

/** One history row as the tally reads it. `kind` is optional; a row of another kind than "fear" is ignored. */
export type FearHistoryRow = { kind?: string; action: string; before: number; after: number; at: number };

/** One `rests` row as the tally reads it. */
export type RestRow = { kind: "short" | "long"; status: "open" | "finished" | "interrupted"; startedAt: number };

/** A live window: `from` = the session's startedAt, `to` = its end (omitted while live). Both inclusive. */
export type TallyWindow = { from: number; to?: number };

export const EMPTY_TALLY: SessionTally = { fearGained: 0, fearSpent: 0, shortRests: 0, longRests: 0 };

const inWindow = (at: number, w?: TallyWindow) => !w || (at >= w.from && (w.to === undefined || at <= w.to));

/**
 * The tally of one live window. Fear rows are applied in time order (`at`); rests count when finished (open and
 * interrupted rests do not). With `window`, only rows inside it count (Fear rows by `at`, rests by `startedAt`, the
 * index S0's tallyRows reads); without it, every row passed counts.
 */
export function windowTally(
  fearRows: readonly FearHistoryRow[],
  restRows: readonly RestRow[],
  window?: TallyWindow,
): SessionTally {
  let fearGained = 0;
  let fearSpent = 0;
  const fear = fearRows.filter((r) => (r.kind === undefined || r.kind === "fear") && inWindow(r.at, window));
  for (const r of [...fear].sort((a, b) => a.at - b.at)) {
    const delta = r.after - r.before;
    if (delta === 0) continue;
    if (r.action === "undo") {
      if (delta < 0) fearGained = Math.max(0, fearGained + delta);
      else fearSpent = Math.max(0, fearSpent - delta);
    } else if (delta > 0) fearGained += delta;
    else fearSpent -= delta;
  }
  let shortRests = 0;
  let longRests = 0;
  for (const r of restRows) {
    if (r.status !== "finished" || !inWindow(r.startedAt, window)) continue;
    if (r.kind === "short") shortRests += 1;
    else longRests += 1;
  }
  return { fearGained, fearSpent, shortRests, longRests };
}

/** Field-wise sum: the stored tally of finished windows plus the current one (B7 restart, a live session's view). */
export function addTally(stored: SessionTally | null | undefined, current: SessionTally): SessionTally {
  const s = stored ?? EMPTY_TALLY;
  return {
    fearGained: s.fearGained + current.fearGained,
    fearSpent: s.fearSpent + current.fearSpent,
    shortRests: s.shortRests + current.shortRests,
    longRests: s.longRests + current.longRests,
  };
}

/** The four rows of the Session tally card, in the board's order. */
export const TALLY_ROWS: readonly { key: keyof SessionTally; label: string }[] = [
  { key: "fearGained", label: "Fear gained" },
  { key: "fearSpent", label: "Fear spent" },
  { key: "shortRests", label: "Short rests" },
  { key: "longRests", label: "Long rests" },
];
