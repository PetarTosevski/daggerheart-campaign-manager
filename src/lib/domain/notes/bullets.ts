// Bullets, states, open threads and the KEY legend (D11 N1; board rules B4, B5; Q7). Pure module.
//
// B4: "task • / event ○ / note – / idea ! / Hope ✦ / Fear ☠ with the board's tooltips; task open -> done (×) -> migrated
// (>) -> scheduled (<) -> struck -> open; others open <-> resolved".
// B5: "Open thread = open task or unresolved Fear."
// Q7: "Hope / Fear bullets are labels only (they never touch party Hope or GM Fear)." Nothing here reads or writes Hope
// or Fear; the two kinds differ from the others only in glyph, colour and (for Fear) counting as an open thread.
//
// ```ts
// glyphFor({ kind: "task", state: "migrated" });   // ">"
// nextState("task", "struck");                     // "open"
// nextState("fear", "open");                       // "done"
// bulletTip({ kind: "idea", state: "done" });      // "Idea (resolved). Click to reopen."
// isOpenThread({ kind: "fear", state: "open" });   // true
// ```

import type { BulletInput, EntryKind, EntryState } from "./types";

export type BulletSpec = {
  /** The bullet glyph (an open task's; a task in another state shows its state glyph, see glyphFor). */
  glyph: string;
  /** The bullet colour on the paper (board l.212). */
  color: string;
  /** The chip label: Task, Event, Note, Idea, Hope, Fear. */
  label: string;
  /** The chip's title (board l.212). */
  tip: string;
  /** The bullet's glow (CSS text-shadow), Hope and Fear only (board l.241). */
  glow?: string;
  /** The entry text colour, Hope and Fear only (board l.245). */
  textColor?: string;
};

/** The six kinds as the board draws them (Notes.dc.html l.212). */
export const BULLETS: Record<EntryKind, BulletSpec> = {
  task: {
    glyph: "•",
    color: "#2a1f14",
    label: "Task",
    tip: "Something to do. Click its bullet to complete, migrate or schedule it.",
  },
  event: { glyph: "○", color: "#2a1f14", label: "Event", tip: "Something that happened or will happen." },
  note: { glyph: "–", color: "#2a1f14", label: "Note", tip: "A fact, quote or observation." },
  idea: { glyph: "!", color: "#8e2b2b", label: "Idea", tip: "Inspiration for later." },
  hope: {
    glyph: "✦",
    color: "#9a6b10",
    label: "Hope",
    tip: "A boon, ally or lucky break for the party.",
    glow: "0 0 6px rgba(230, 180, 60, 0.5)",
    textColor: "#6a4a08",
  },
  fear: {
    glyph: "☠",
    color: "#6b3fae",
    label: "Fear",
    tip: "A threat brewing against the party. Counts as an open thread.",
    glow: "0 0 6px rgba(140, 80, 220, 0.45)",
    textColor: "#4a2a7a",
  },
};

/** The task cycle (board l.214 STATES). */
export const TASK_CYCLE: readonly EntryState[] = ["open", "done", "migrated", "scheduled", "struck"];

const TASK_STATE_GLYPH: Partial<Record<EntryState, string>> = { done: "×", migrated: ">", scheduled: "<" };

/** How a task's state reads in its bullet tooltip (board l.242). */
export const TASK_STATE_LABEL: Record<EntryState, string> = {
  open: "open",
  done: "done",
  migrated: "migrated",
  scheduled: "scheduled",
  struck: "no longer relevant",
};

/** The bullet glyph: a task shows × / > / < for done / migrated / scheduled, else • (struck too); other kinds their own. */
export function glyphFor(entry: BulletInput): string {
  if (entry.kind === "task") return TASK_STATE_GLYPH[entry.state] ?? BULLETS.task.glyph;
  return BULLETS[entry.kind].glyph;
}

/**
 * The state after a click on the bullet: a task advances open -> done -> migrated -> scheduled -> struck -> open; any
 * other kind toggles open <-> done (a non-task in a task-only state reopens).
 */
export function nextState(kind: EntryKind, state: EntryState): EntryState {
  if (kind === "task") return TASK_CYCLE[(TASK_CYCLE.indexOf(state) + 1) % TASK_CYCLE.length]!;
  return state === "open" ? "done" : "open";
}

/** Struck through: a struck task, or a resolved non-task (board l.238). */
export function isStruck(entry: BulletInput): boolean {
  return entry.state === "struck" || (entry.kind !== "task" && entry.state === "done");
}

/** Shown faded: a done, migrated or scheduled task, and every struck line (board l.245). */
export function isDimmed(entry: BulletInput): boolean {
  return isStruck(entry) || (entry.kind === "task" && entry.state !== "open");
}

/** The bullet's tooltip and aria label (board l.242). */
export function bulletTip(entry: BulletInput): string {
  if (entry.kind === "task") return `Task: ${TASK_STATE_LABEL[entry.state]}. Click to change.`;
  const label = BULLETS[entry.kind].label;
  return isStruck(entry) ? `${label} (resolved). Click to reopen.` : `${label}. Click to mark resolved.`;
}

/**
 * An open thread: an open task or an unresolved Fear (B5). This is the stored `journalEntries.open` flag, kept equal to
 * isOpenThread on every write; the `by_journal_open` index and the counters read it.
 */
export function isOpenThread(entry: BulletInput): boolean {
  return (entry.kind === "task" && entry.state === "open") || (entry.kind === "fear" && entry.state !== "done");
}

/** The entries that are open threads, in the given order. */
export function openThreads<T extends BulletInput>(entries: readonly T[]): T[] {
  return entries.filter(isOpenThread);
}

/** The add row's placeholder: 'Write a <kind> and press Enter… (@ to link)' (board l.336). */
export function addPlaceholder(kind: EntryKind): string {
  return `Write a ${BULLETS[kind].label.toLowerCase()} and press Enter… (@ to link)`;
}

/** The KEY legend under each page (board l.160), with the board's colours for Hope and Fear. */
export const KEY_LEGEND: readonly { text: string; color?: string }[] = [
  { text: "• task" },
  { text: "× done" },
  { text: "> migrated" },
  { text: "< scheduled" },
  { text: "○ event" },
  { text: "– note" },
  { text: "! idea" },
  { text: "✦ Hope · a boon", color: "#9a6b10" },
  { text: "☠ Fear · a threat", color: "#6b3fae" },
  { text: "★ priority" },
];
