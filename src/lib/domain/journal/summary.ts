// The Journal's "Campaign so far" and Spotlight texts (Journal J0; JD5, JS and JT use these). Pure module.
//
// ```ts
// leastSpotlightLine([{ name: "Vex", count: 3 }, { name: "Oriel", count: 1 }]); // "Oriel has had the least spotlight this session."
// hoursAtTable([{ status: "played", playedMs: 3 * 3_600_000 }]); // 3
// ```

const HOUR_MS = 3_600_000;

/**
 * The line under the Spotlight bars: who has had the least spotlight this session. Several PCs tied at the lowest
 * count are named together ('Oriel and Vex have had …'), and when every PC has the same count (all zero too) every PC
 * is named (user 2026-11-04, dcm-nvq4; J0 hid the line then). Null with fewer than two PCs (nobody to compare with).
 */
export function leastSpotlightLine(entries: readonly { name: string; count: number }[]): string | null {
  if (entries.length < 2) return null;
  const min = Math.min(...entries.map((e) => e.count));
  const least = entries.filter((e) => e.count === min).map((e) => e.name);
  const names = least.length === 1 ? least[0] : `${least.slice(0, -1).join(", ")} and ${least.at(-1)}`;
  return `${names} ${least.length === 1 ? "has" : "have"} had the least spotlight this session.`;
}

/** A session as `hoursAtTable` reads it. */
export type PlayedSession = {
  status: "planned" | "live" | "played";
  playedMs?: number;
  startedAt?: number;
  endedAt?: number;
};

/**
 * Hours at the table (Q3, user: automatic from live time): each session's `playedMs` (every finished window since
 * Journal J0); a session ended before J0 counts its last start → end; a live session adds its running window up to
 * `now`. Not rounded: the UI rounds.
 */
export function hoursAtTable(sessions: readonly PlayedSession[], now: number = Date.now()): number {
  let ms = 0;
  for (const s of sessions) {
    if (s.playedMs !== undefined) ms += s.playedMs;
    else if (s.status === "played" && s.startedAt !== undefined && s.endedAt !== undefined) ms += Math.max(0, s.endedAt - s.startedAt);
    if (s.status === "live" && s.startedAt !== undefined) ms += Math.max(0, now - s.startedAt);
  }
  return ms / HOUR_MS;
}
