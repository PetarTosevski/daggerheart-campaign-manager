"use client";

import "./end-session.css";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { frameHasMechanic } from "@/lib/frames";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * Start / End helpers shared by the Journal header's live chip (JH) and the dashboard's Wither panel
 * (`src/app/(gm)/campaigns/[campaignId]/wither-panel.tsx`): the report lines of a Start or End, the End dialog's text
 * and its Wither choice. Moved here from the old Sessions live card (Journal JX2).
 */

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

/**
 * The End dialog's Wither choice (Witherwild only): turn the tokens into Fear as the book says (CB p.261), or keep them
 * on the sheets (user 2026-10-20). Preset from the campaign's house rule `witherPersists` each time the dialog opens.
 */
export function useWitherChoice(campaignId: Id<"campaigns">) {
  const campaign = useQuery(api.campaigns.get, { campaignId });
  const [choice, setChoice] = useState<boolean | null>(null);
  const applies = campaign ? frameHasMechanic(campaign.frameId, "witherTokens") : false;
  const convert = choice ?? !(campaign?.options.witherPersists ?? false);
  return {
    applies,
    convert,
    setConvert: setChoice,
    /** Back to the campaign's default (call when the dialog opens). */
    reset: () => setChoice(null),
    /** The End's argument: only where Wither exists. */
    args: applies ? { convertWither: convert } : {},
  };
}

export type WitherChoice = ReturnType<typeof useWitherChoice>;

/** The checkbox in an End dialog; nothing outside Witherwild. */
export function WitherChoiceField({ choice }: { choice: WitherChoice }) {
  if (!choice.applies) return null;
  return (
    <label className="jr-wither">
      <input type="checkbox" checked={choice.convert} onChange={(e) => choice.setConvert(e.target.checked)} />
      <span>Turn Wither tokens into Fear (CB p.261). Untick to keep them on the sheets.</span>
    </label>
  );
}

/** The End dialog's text, matching the Wither choice. */
export function endDialogText(choice: WitherChoice): string {
  // Session-bound features too (dcm-bxp.58): Slayer Dice become Hope, Tide tokens clear, the moon die ends.
  const features = "unspent Rally and Prayer Dice are cleared, Slayer Dice turn into Hope, Tide tokens clear and the moon die ends";
  if (!choice.applies) return `Session effects end, ${features}.`;
  return choice.convert
    ? `Session effects end, ${features}, and every Wither token on the PCs' sheets becomes GM Fear (up to 12).`
    : `Session effects end, ${features}. Wither tokens stay on the PCs' sheets.`;
}

/** What the Start told the GM: the session ended first (B6), the Prayer Dice rolled (B10), Luckbringer and the moon dice (U1, U6). */
export function startReportLines(r: StartResult): string[] {
  const previous = r.ended?.n !== undefined ? `Session ${r.ended.n} ended first.` : "The running session ended first.";
  const ended = r.ended ? endReportLines(r.ended).map((line, i) => (i === 0 ? line.replace("Session ended.", previous) : line)) : [];
  const notes = r.notes ?? [];
  return [...ended, notes.length > 0 ? `Session started. ${notes.join("; ")}.` : "Session started.", ...(r.features ?? []).map((line) => `${line}.`), ...(r.reminders ?? [])];
}
