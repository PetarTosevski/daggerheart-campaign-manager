// A session's live windows (Journal J0). Pure module, shared by Convex (`liveWindows` in convex/lib/sessions.ts) and tests.
//
// D10 B7: a played session can start again, so one session may have several live windows. Each Start / End writes an
// auto `sessionLog` line; since Journal J0 the line carries `event: 'start' | 'end'`, older ones are matched by their
// text ('Session started.' / 'Session ended. …'). Only auto lines count: a GM-typed line with the same words is not a
// mark (risk 'Restarted sessions' in .omc/plans/journal-briefs.md).
//
// ```ts
// windowsFromMarks([{ at: 10, kind: "start" }, { at: 20, kind: "end" }, { at: 30, kind: "start" }],
//   { status: "live", startedAt: 30 }, 40);
// // [{ from: 10, to: 20, open: false }, { from: 30, to: 40, open: true }]
// ```

/** One `sessionLog` row as this module reads it. */
export type LogMarkRow = { at: number; text: string; auto: boolean; event?: "start" | "end" | "scene" };

export type WindowMark = { at: number; kind: "start" | "end" };

/** The session fields the windows fall back on. */
export type WindowSession = { status: "planned" | "live" | "played"; startedAt?: number; endedAt?: number };

/** A live window [from, to]; `open` is the running window of a live session, whose `to` is `now`. */
export type LiveWindow = { from: number; to: number; open: boolean };

/**
 * How far a mark may sit from the session's `startedAt` and still be that start (a stamp is written in the same
 * mutation, so it is normally equal).
 */
const SAME_START_MS = 60_000;

/** The start / end mark of one log row, or null: event-tagged auto lines, else legacy auto lines by their text. */
export function logMark(row: LogMarkRow): WindowMark | null {
  if (!row.auto) return null;
  if (row.event === "start" || row.event === "end") return { at: row.at, kind: row.event };
  if (row.event !== undefined) return null;
  if (row.text.startsWith("Session started")) return { at: row.at, kind: "start" };
  if (row.text.startsWith("Session ended")) return { at: row.at, kind: "end" };
  return null;
}

/**
 * The session's live windows, oldest first. Marks pair start → end (a second start while a window is open and an end
 * without an open window are ignored). A window left open closes at `endedAt` (a played session whose end stamp is
 * missing, e.g. a full log) or at `now` (live). The latest start (`startedAt`) is always covered, so a session
 * without marks reads as [startedAt, endedAt ?? now]. A planned session never started has no windows.
 */
export function windowsFromMarks(marks: readonly WindowMark[], session: WindowSession, now: number): LiveWindow[] {
  const sorted = [...marks].sort((a, b) => a.at - b.at);
  const windows: LiveWindow[] = [];
  let open: number | null = null;
  for (const mark of sorted) {
    if (mark.kind === "start") {
      if (open === null) open = mark.at;
    } else if (open !== null) {
      windows.push({ from: open, to: Math.max(open, mark.at), open: false });
      open = null;
    }
  }
  const close = (from: number): LiveWindow =>
    session.status === "live" ? { from, to: Math.max(from, now), open: true } : { from, to: Math.max(from, session.endedAt ?? now), open: false };
  if (open !== null) windows.push(close(open));

  const started = session.startedAt;
  if (started !== undefined && !windows.some((w) => Math.abs(w.from - started) <= SAME_START_MS)) {
    // The latest start has no start mark (no stamp, or a full log): add it, ending at the session's end when that
    // came after it.
    const end = session.endedAt !== undefined && session.endedAt >= started && session.status !== "live" ? session.endedAt : undefined;
    windows.push(end === undefined ? close(started) : { from: started, to: end, open: false });
    windows.sort((a, b) => a.from - b.from);
  }
  return mergeOverlaps(windows);
}

/** Overlapping windows (only possible from the fallback) joined into one. */
function mergeOverlaps(windows: LiveWindow[]): LiveWindow[] {
  const out: LiveWindow[] = [];
  for (const w of windows) {
    const last = out.at(-1);
    if (last !== undefined && w.from <= last.to) {
      last.to = Math.max(last.to, w.to);
      last.open = last.open || w.open;
    } else out.push({ ...w });
  }
  return out;
}

/** Whether `at` falls inside one of the windows (bounds included). */
export function inWindows(windows: readonly LiveWindow[], at: number): boolean {
  return windows.some((w) => w.from <= at && at <= w.to);
}
