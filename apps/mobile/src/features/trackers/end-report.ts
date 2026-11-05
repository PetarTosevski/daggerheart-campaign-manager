import type { FunctionReturnType } from "convex/server";

import { api } from "../../convex";

type EndResult = FunctionReturnType<typeof api.sessions.end>;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The End report on the website (`endReportLines` in `src/components/sessions/live`).
 * That module imports React and Next, so the phone keeps the same lines here.
 */
export function endReportLines(result: EndResult): string[] {
  const first =
    result.tokens > 0
      ? `Session ended. ${plural(result.tokens, "Wither token")} → +${result.fearGained} Fear${result.fearLost > 0 ? `, ${result.fearLost} Fear lost` : ""}.`
      : "Session ended.";
  return [
    first,
    ...(result.witherKept ? [`${plural(result.witherKept, "Wither token")} stay on the sheets.`] : []),
    ...(result.lostDice?.length ? [`${result.lostDice.join("; ")}.`] : []),
    ...(result.features ?? []).map((line) => `${line}.`),
    ...(result.journeyEnds.length > 0 ? [`Journey ends: ${result.journeyEnds.map((c) => c.name).join(", ")}.`] : []),
    ...(result.reminders ?? []),
  ];
}

/** The End dialog's text, matching the website's `endDialogText` for a Witherwild campaign. */
export function witherEndDialogText(convert: boolean): string {
  const features =
    "unspent Rally and Prayer Dice are cleared, Slayer Dice turn into Hope, Tide tokens clear and the moon die ends";
  return convert
    ? `Session effects end, ${features}, and every Wither token on the PCs' sheets becomes GM Fear (up to 12).`
    : `Session effects end, ${features}. Wither tokens stay on the PCs' sheets.`;
}
