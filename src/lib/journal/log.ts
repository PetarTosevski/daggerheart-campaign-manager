import type { OptimisticLocalStore } from "convex/browser";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { JournalLog, JournalLogIcon, JournalLogLine } from "../../../convex/journalLog";

/**
 * Pure pieces of the session log (JL), shared by the website and the phone (dcm-gdzi.46): the label per line kind, the
 * clock, and the optimistic updates of `journalLog.list` for add, remove, hide, unhide and re-word (rule 12: a click
 * with visible latency shows at once). The website pairs each kind with an icon (src/components/journal/log/model.ts).
 */

/** What each line kind and roll type is called (the icon's accessible label on the website, the kind on the phone). */
export const LOG_LABELS: Record<JournalLogIcon, string> = {
  roll: "Roll",
  reactionRoll: "Reaction roll",
  damageRoll: "Damage roll",
  attackRoll: "Attack roll",
  socialRoll: "Social roll",
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

/** 'HH:MM' in local time (24-hour). */
export { clockTime as clock } from "../dates";

/** Prefix of a line being added (its id is not known yet); its buttons stay disabled. */
export const OPTIMISTIC = "optimistic-";

export function isPending(line: Pick<JournalLogLine, "sourceId">): boolean {
  return line.sourceId.startsWith(OPTIMISTIC);
}

type ListArgs = { campaignId: Id<"campaigns">; sessionId: string };

/** Applies `change` to the cached log of one session, if it is loaded. */
function patchLog(store: OptimisticLocalStore, args: ListArgs, change: (log: JournalLog) => JournalLog) {
  const key = { campaignId: args.campaignId, sessionId: args.sessionId };
  const current = store.getQuery(api.journalLog.list, key);
  if (current === undefined) return;
  store.setQuery(api.journalLog.list, key, change(current));
}

function patchLine(log: JournalLog, source: string, sourceId: string, change: (line: JournalLogLine) => JournalLogLine): JournalLog {
  return { ...log, lines: log.lines.map((l) => (l.source === source && l.sourceId === sourceId ? change(l) : l)) };
}

/** A GM line being added shows at the end (the log is oldest first) until the server's row replaces it. */
export function addPending(store: OptimisticLocalStore, a: ListArgs & { text: string; idempotencyKey: string }) {
  const sourceId = `${OPTIMISTIC}${a.idempotencyKey}`;
  const line: JournalLogLine = {
    key: `gm:${sourceId}`,
    source: "gm",
    sourceId,
    at: Date.now(),
    title: a.text.trim(),
    icon: "note",
    hidden: false,
    edited: false,
    removable: true,
  };
  patchLog(store, a, (log) => ({ ...log, lines: [...log.lines, line] }));
}

/** A GM line deleted (`sessionPlay.removeLog`) leaves the list at once. */
export function removePending(store: OptimisticLocalStore, a: ListArgs & { logId: string }) {
  patchLog(store, a, (log) => ({ ...log, lines: log.lines.filter((l) => !(l.source === "gm" && l.sourceId === a.logId)) }));
}

/** `hide` / `unhide`: flips the line's `hidden` flag. */
export function hiddenPending(hidden: boolean) {
  return (store: OptimisticLocalStore, a: ListArgs & { source: string; sourceId: string }) =>
    patchLog(store, a, (log) => patchLine(log, a.source, a.sourceId, (l) => ({ ...l, hidden })));
}

/**
 * `setText`: shows the new title. An empty text on a feed / Fear / encounter / automatic line drops the re-wording; the
 * generated title is not known here, so the line keeps its title until the server answers.
 */
export function textPending(store: OptimisticLocalStore, a: ListArgs & { source: string; sourceId: string; text: string }) {
  const text = a.text.trim();
  if (text === "") return;
  patchLog(store, a, (log) => patchLine(log, a.source, a.sourceId, (l) => ({ ...l, title: text, edited: true })));
}
