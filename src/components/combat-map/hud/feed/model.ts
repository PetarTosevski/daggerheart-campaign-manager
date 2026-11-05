/**
 * The "Just now" feed's pure helpers (plan combat-hud H4.3; Main `.me .feed`): which icon a row gets and its grey
 * detail line. The row's text is the server's own summary (`feed.list`); nothing here invents an event.
 * Unit tests: tests/unit/hud/death-feed.test.tsx, tests/unit/config/rule-notes-feed.test.tsx.
 */
import { ruleDef } from "@/lib/rules";

/** How many rows "Just now" shows (the board shows three to five). */
export const FEED_ROWS = 5;

export type FeedIcon = "hit" | "dice" | "fear" | "death" | "note";

/** A feed row as `feed.list` gives it (the fields read here). */
export type FeedRow = {
  kind: string;
  roll?: { total: number; outcome: string; kind: string };
  fearDelta?: number;
  undone: boolean;
  /** A Manual rule's note (kind `rule`, GM-only): the registry id of its rule. */
  ruleId?: string;
};

/** The tag on a Manual rule's note (plan rule-switches RU). */
export const MANUAL_TAG = "Manual";

/**
 * A Manual rule's note (kind `rule`, plan rule-switches RS0's `postRuleNote`): the 'Manual' tag and the rule's title
 * from the registry ('Hope and Fear from rolls'), or null for any other row. An unknown id keeps the tag, no title.
 */
export function ruleNoteTag(row: Pick<FeedRow, "kind" | "ruleId">): { tag: string; title: string | null } | null {
  if (row.kind !== "rule") return null;
  return { tag: MANUAL_TAG, title: row.ruleId === undefined ? null : (ruleDef(row.ruleId)?.title ?? null) };
}

export function feedIcon(row: Pick<FeedRow, "kind" | "roll" | "fearDelta">): FeedIcon {
  if (row.kind === "death") return "death";
  if (row.kind === "combat" || row.kind === "adversary") return "hit";
  if (row.fearDelta !== undefined && row.fearDelta !== 0 && row.roll === undefined) return "fear";
  if (row.roll !== undefined) return "dice";
  return "note";
}

const OUTCOMES: Record<string, string> = {
  critical: "Critical success",
  successHope: "Success with Hope",
  successFear: "Success with Fear",
  failHope: "Failure with Hope",
  failFear: "Failure with Fear",
};

/**
 * The grey line under the summary (the board's "15 with Hope · Hit · 7"): the roll's total and outcome, the GM's Fear
 * gained, and "undone". Empty when the summary says it all. A death move's roll is not shown: its summary has the dice.
 */
export function feedDetail(row: FeedRow): string {
  const parts: string[] = [];
  if (row.roll && row.kind !== "death" && row.roll.kind !== "damage" && row.roll.total > 0) {
    const outcome = OUTCOMES[row.roll.outcome];
    parts.push(outcome ? `${row.roll.total} · ${outcome}` : String(row.roll.total));
  } else if (row.roll && row.roll.kind === "damage") {
    parts.push(`${row.roll.total} damage`);
  }
  if (row.fearDelta !== undefined && row.fearDelta > 0) parts.push(`GM gains ${row.fearDelta} Fear`);
  if (row.fearDelta !== undefined && row.fearDelta < 0) parts.push(`GM spends ${-row.fearDelta} Fear`);
  if (row.undone) parts.push("undone");
  return parts.join(" · ");
}
