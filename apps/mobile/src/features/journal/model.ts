import type { FunctionReturnType } from "convex/server";

import { isSessionDate, NO_DATE } from "../../../../../src/lib/domain/sessions";
import type { JournalLogIcon } from "../../../../../convex/journalLog";
import type { JournalTally } from "../../../../../convex/journalTally";
import type { SessionSceneState, SessionSceneType } from "../../../../../convex/lib/validators/sessions";
import type { SessionListItem } from "../../../../../convex/sessionRecords";
import type { SessionAfter } from "../../../../../convex/sessionWrap";
import type { api } from "../../convex";

/**
 * Pure pieces of the phone Journal. The website keeps these in its Journal component folders
 * (src/components/journal/{session-list/format.ts, header, end-session, log/model.ts, tally/model.ts, plan, recap,
 * ui}), files that import React, lucide-react, `@/` paths or `convex/browser`, which the phone cannot load. Until they
 * move into src/lib (framework-free), the phone states the same rules here; the wording matches the website's.
 */

export type Prep = FunctionReturnType<typeof api.sessionPrep.get>;
export type PrepScene = Prep["scenes"][number];
export type StartResult = FunctionReturnType<typeof api.sessions.start>;

// ---------------------------------------------------------------- sessions

/** 'Sun 2 Nov' (weekday, day, month; UTC so it never shifts a day). Missing: 'No date set'; unparsable: as written. */
export function shortSessionDate(date: string | null | undefined): string {
  if (!date) return NO_DATE;
  if (!isSessionDate(date)) return date;
  const at = Date.parse(`${date}T12:00:00Z`);
  return new Date(at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** The local clock time 'HH:MM'. */
export function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 'Session 6 · Sun 2 Nov · 19:10' (the time only when the caller can see when it started). */
export function sessionLine(session: Pick<SessionListItem, "n" | "date" | "startedAt">): string {
  const parts = [`Session ${session.n}`, shortSessionDate(session.date)];
  if (session.startedAt !== undefined) parts.push(clock(session.startedAt));
  return parts.join(" · ");
}

/** Session numbers are never reused (B1): the next one is the highest + 1. */
export function nextNumber(sessions: readonly Pick<SessionListItem, "n">[]): number {
  let highest = 0;
  for (const s of sessions) if (s.n > highest) highest = s.n;
  return highest + 1;
}

/** What Start starts: the selected planned session, else the newest planned one (the list is newest first). */
export function plannedTarget(sessions: readonly SessionListItem[], selectedId: string | null): SessionListItem | null {
  const planned = sessions.filter((s) => s.status === "planned");
  return planned.find((s) => s._id === selectedId) ?? planned[0] ?? null;
}

/** The spoken name of a list row: 'Session 7: The chapel, Sun 9 Nov, Planned'. */
export function rowLabel(session: SessionListItem, title: string): string {
  const status = session.status === "live" ? ", Live" : session.status === "planned" ? ", Planned" : "";
  return `Session ${session.n}: ${title}, ${shortSessionDate(session.date)}${status}`;
}

/** What the Start told the GM: the session that ended first, the Start's notes, the features given out. */
export function startLines(result: StartResult, endLines: (ended: NonNullable<StartResult["ended"]>) => string[]): string[] {
  const lines: string[] = [];
  if (result.ended) {
    const first = result.ended.n !== undefined ? `Session ${result.ended.n} ended first.` : "The running session ended first.";
    endLines(result.ended).forEach((line, i) => lines.push(i === 0 ? line.replace("Session ended.", first) : line));
  }
  const notes = result.notes ?? [];
  lines.push(notes.length > 0 ? `Session started. ${notes.join("; ")}.` : "Session started.");
  for (const feature of result.features ?? []) lines.push(`${feature}.`);
  lines.push(...(result.reminders ?? []));
  return lines;
}

// ---------------------------------------------------------------- plan

export const SCENE_TYPE_LABEL: Record<SessionSceneType, string> = {
  exploration: "Exploration",
  social: "Social",
  combat: "Combat",
  downtime: "Downtime",
};

/** Ids of scenes the server has not confirmed yet (optimistic Add scene). */
export const PENDING_SCENE = "pending:";

/** `setSceneState` as the server applies it: playing one scene makes the one that was playing Done. */
export function withSceneState(scenes: readonly PrepScene[], sceneId: string, state: SessionSceneState): PrepScene[] {
  return scenes.map((scene) => {
    if (scene.id === sceneId) return { ...scene, state: state === "planned" ? undefined : state };
    if (state === "playing" && scene.state === "playing") return { ...scene, state: "done" as const };
    return scene;
  });
}

/** The Combat scene whose Battle Points show: the playing one, else the first; 1-based number. */
export function battleScene(scenes: readonly PrepScene[]): { scene: PrepScene; number: number } | null {
  const confirmed = scenes.filter((s) => !s.id.startsWith(PENDING_SCENE));
  const combat = confirmed.filter((s) => s.type === "combat");
  const scene = combat.find((s) => s.state === "playing") ?? combat[0];
  return scene ? { scene, number: confirmed.indexOf(scene) + 1 } : null;
}

/** The GM prep note read as paper: runs of '- ' lines are bullet lists, other lines paragraphs, blanks dropped. */
export type PrepBlock = { kind: "list"; items: string[] } | { kind: "line"; text: string };

export function prepNote(text: string): PrepBlock[] {
  const out: PrepBlock[] = [];
  for (const line of text.split("\n").map((l) => l.trim())) {
    if (line === "") continue;
    const last = out[out.length - 1];
    if (!line.startsWith("- ")) out.push({ kind: "line", text: line });
    else if (last?.kind === "list") last.items.push(line.slice(2).trim());
    else out.push({ kind: "list", items: [line.slice(2).trim()] });
  }
  return out;
}

// ---------------------------------------------------------------- log, tally, after

export const LOG_KIND: Record<JournalLogIcon, string> = {
  roll: "Roll",
  gmRoll: "GM roll",
  feature: "Feature or spell",
  levelUp: "Level up",
  rest: "Rest",
  death: "Death move",
  wither: "Wither",
  session: "Session",
  import: "Import",
  countdown: "Countdown",
  combat: "Attack",
  adversary: "Adversary",
  rule: "Manual rule note",
  fear: "Fear",
  combatBegan: "Combat began",
  combatEnded: "Combat ended",
  start: "Session started",
  end: "Session ended",
  scene: "Scene",
  auto: "Automatic line",
  note: "GM note",
};

/** Prefix of a GM log line being added (no server id yet); its buttons stay disabled. */
export const PENDING_LINE = "optimistic-";

export type TallyKey = keyof Omit<JournalTally, "live" | "truncated">;

export const TALLY: readonly { key: TallyKey; label: string }[] = [
  { key: "fearGained", label: "Fear gained" },
  { key: "fearSpent", label: "Fear spent" },
  { key: "hopeSpent", label: "Hope spent" },
  { key: "hpMarked", label: "HP marked" },
  { key: "adversariesDefeated", label: "Adversaries defeated" },
  { key: "criticals", label: "Critical successes" },
];

/** A spotlight bar's share of the track (0..1), scaled to the highest count. */
export function barShare(count: number, max: number): number {
  return max > 0 ? Math.max(0, count) / max : 0;
}

/** 'Level-ups': the characters' names (a missing one shows its feed line), else 'None'. */
export function levelUps(rows: SessionAfter["levelUps"], names: ReadonlyMap<string, string>): string {
  return rows.length === 0 ? "None" : rows.map((row) => names.get(row.characterId) ?? row.summary).join(", ");
}
