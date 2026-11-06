import type { OptimisticLocalStore } from "convex/browser";
import {
  ArrowUpCircle,
  BookmarkPlus,
  Compass,
  Crosshair,
  Dices,
  Download,
  Droplet,
  Flag,
  HeartCrack,
  Hourglass,
  Leaf,
  Moon,
  PenLine,
  Play,
  Shield,
  ShieldHalf,
  Skull,
  Sparkles,
  Speech,
  Square,
  Swords,
  Sword,
  type LucideIcon,
} from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { JournalLog, JournalLogIcon, JournalLogLine } from "../../../../convex/journalLog";

/**
 * Pure pieces of the session log (JL): the icon per source / kind, the clock, and the optimistic updates of
 * `journalLog.list` for add, remove, hide, unhide and re-word (rule 12: a click with visible latency shows at once).
 */

/** One icon per line kind and roll type (design: scene compass, roll, combat, spell, Fear, hit, defeat; dcm-z9rz.28). */
export const LOG_ICONS: Record<JournalLogIcon, { Icon: LucideIcon; label: string }> = {
  roll: { Icon: Dices, label: "Roll" },
  reactionRoll: { Icon: ShieldHalf, label: "Reaction roll" },
  damageRoll: { Icon: HeartCrack, label: "Damage roll" },
  attackRoll: { Icon: Crosshair, label: "Attack roll" },
  // Journal JF2 (dcm-z9rz.28): lucide has no mouth; Speech (a speaking head) is the closest.
  socialRoll: { Icon: Speech, label: "Social roll" },
  gmRoll: { Icon: Dices, label: "GM roll" },
  feature: { Icon: Sparkles, label: "Feature or spell" },
  levelUp: { Icon: ArrowUpCircle, label: "Level up" },
  rest: { Icon: Moon, label: "Rest" },
  death: { Icon: Skull, label: "Death move" },
  wither: { Icon: Leaf, label: "Wither" },
  session: { Icon: BookmarkPlus, label: "Session" },
  import: { Icon: Download, label: "Import" },
  countdown: { Icon: Hourglass, label: "Countdown" },
  combat: { Icon: Sword, label: "Attack" },
  adversary: { Icon: Shield, label: "Adversary" },
  rule: { Icon: PenLine, label: "Manual rule note" },
  fear: { Icon: Droplet, label: "Fear" },
  combatBegan: { Icon: Swords, label: "Combat began" },
  combatEnded: { Icon: Flag, label: "Combat ended" },
  start: { Icon: Play, label: "Session started" },
  end: { Icon: Square, label: "Session ended" },
  scene: { Icon: Compass, label: "Scene" },
  auto: { Icon: BookmarkPlus, label: "Automatic line" },
  note: { Icon: PenLine, label: "GM note" },
};

/** 'HH:MM' in local time. */
export function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

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
