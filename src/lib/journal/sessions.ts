import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { RaisedThread } from "../../../convex/journalThreads";
import type { SessionSceneType } from "../../../convex/lib/validators/sessions";
import type { SessionListItem } from "../../../convex/sessionRecords";
import type { SessionAfter } from "../../../convex/sessionWrap";
import { dayMonth, shortSessionDate, startTime } from "../dates";

/**
 * The Journal's session words, shared by the website (src/components/journal) and the phone (apps/mobile
 * src/features/journal, dcm-gdzi.46): the list and heading lines, which session Start starts, the Start / End reports
 * and the End dialog, the After-the-session lines, the thread and scene-type labels. Framework-free (no React, no
 * `@/` paths), so both apps import it.
 */

// ---------------------------------------------------------------- list and heading

/** 'Session 6 · Sun 2 Nov · 19:10' (the time only when the caller can see when it started). */
export function headingLine(session: Pick<SessionListItem, "n" | "date" | "startedAt">): string {
  const time = startTime(session.startedAt);
  return [`Session ${session.n}`, shortSessionDate(session.date), ...(time ? [time] : [])].join(" · ");
}

/** The number '+ Plan session N' names: the highest session number + 1 (B1: numbers are never reused). */
export function nextSessionNumber(sessions: readonly Pick<SessionListItem, "n">[]): number {
  return sessions.reduce((max, s) => Math.max(max, s.n), 0) + 1;
}

/** Hours at the table as the panel shows them: whole hours, rounded. */
export function wholeHours(hours: number): number {
  return Math.max(0, Math.round(hours));
}

/** Patches one session of the cached `sessionRecords.list` (the heading's optimistic updates). */
export function patchListed(
  store: OptimisticLocalStore,
  campaignId: Id<"campaigns">,
  sessionId: string,
  patch: Partial<SessionListItem>,
) {
  const current = store.getQuery(api.sessionRecords.list, { campaignId });
  if (current === undefined) return;
  store.setQuery(
    api.sessionRecords.list,
    { campaignId },
    current.map((s) => (s._id === sessionId ? { ...s, ...patch } : s)),
  );
}

// ---------------------------------------------------------------- Start and End

/** Who may start which session: the selected planned one, else the newest planned (the list is newest first). */
export function startTarget(sessions: readonly SessionListItem[], selectedId: string | null): SessionListItem | null {
  const selected = sessions.find((s) => s._id === selectedId && s.status === "planned");
  return selected ?? sessions.find((s) => s.status === "planned") ?? null;
}

/** The number 'Start session N' names: the target's, else the one the server will create (highest + 1). */
export function startNumber(sessions: readonly SessionListItem[], target: SessionListItem | null): number {
  return target?.n ?? sessions.reduce((max, s) => Math.max(max, s.n), 0) + 1;
}

type StartResult = FunctionReturnType<typeof api.sessions.start>;
type EndResult = FunctionReturnType<typeof api.sessions.end>;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * What the End told the GM (as the dashboard card): the Wither → Fear conversion (CB 261), dice lost, the session
 * features cleared (Slayer Dice for Hope, Tide tokens, the moon die; session-features U8), journeys that end (CB 106).
 */
export function endReportLines(r: EndResult): string[] {
  const first = r.tokens > 0 ? `Session ended. ${plural(r.tokens, "Wither token")} → +${r.fearGained} Fear${r.fearLost > 0 ? `, ${r.fearLost} Fear lost` : ""}.` : "Session ended.";
  return [
    first,
    ...(r.witherKept ? [`${plural(r.witherKept, "Wither token")} stay on the sheets.`] : []),
    ...(r.lostDice?.length ? [`${r.lostDice.join("; ")}.`] : []),
    ...(r.features ?? []).map((line) => `${line}.`),
    ...(r.journeyEnds.length > 0 ? [`Journey ends: ${r.journeyEnds.map((c) => c.name).join(", ")}.`] : []),
    ...(r.reminders ?? []),
  ];
}

/** What the Start told the GM: the session ended first (B6), the Prayer Dice rolled (B10), Luckbringer and the moon dice (U1, U6). */
export function startReportLines(r: StartResult): string[] {
  const previous = r.ended?.n !== undefined ? `Session ${r.ended.n} ended first.` : "The running session ended first.";
  const ended = r.ended ? endReportLines(r.ended).map((line, i) => (i === 0 ? line.replace("Session ended.", previous) : line)) : [];
  const notes = r.notes ?? [];
  return [...ended, notes.length > 0 ? `Session started. ${notes.join("; ")}.` : "Session started.", ...(r.features ?? []).map((line) => `${line}.`), ...(r.reminders ?? [])];
}

/**
 * The End dialog's text, matching the Wither choice: `applies` where the frame has Wither tokens (Witherwild), `convert`
 * when they turn into Fear (CB p.261) rather than stay on the sheets.
 */
export function endDialogText(choice: { applies: boolean; convert: boolean }): string {
  // Session-bound features too (dcm-bxp.58): Slayer Dice become Hope, Tide tokens clear, the moon die ends.
  const features = "unspent Rally and Prayer Dice are cleared, Slayer Dice turn into Hope, Tide tokens clear and the moon die ends";
  if (!choice.applies) return `Session effects end, ${features}.`;
  return choice.convert
    ? `Session effects end, ${features}, and every Wither token on the PCs' sheets becomes GM Fear (up to 12).`
    : `Session effects end, ${features}. Wither tokens stay on the PCs' sheets.`;
}

// ---------------------------------------------------------------- After the session, threads, scene types

/** 'Level-ups': the characters' names joined with ', ', else 'None'. A character missing from the party shows its feed line. */
export function levelUpLine(levelUps: SessionAfter["levelUps"], names: ReadonlyMap<string, string>): string {
  if (levelUps.length === 0) return "None";
  return levelUps.map((l) => names.get(l.characterId) ?? l.summary).join(", ");
}

/** The milestone line's text: 'Reached 2 Nov', else 'Not yet'. */
export function milestoneLine(milestoneAt: number | null): string {
  return milestoneAt === null ? "Not yet" : `Reached ${dayMonth(milestoneAt)}`;
}

/** What a raised thread's bullet means, for screen readers (the glyph itself is decorative). */
export function threadKindLabel(row: Pick<RaisedThread, "kind">): string {
  return row.kind === "fear" ? "Looming Fear" : "Open task";
}

/** A scene type's label (design: Exploration green, Social blue, Combat red, Downtime amber; the website adds icons). */
export const SCENE_TYPE_LABEL: Record<SessionSceneType, string> = {
  exploration: "Exploration",
  social: "Social",
  combat: "Combat",
  downtime: "Downtime",
};
