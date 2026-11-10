"use client";

import "./end-session.css";

import { useQuery } from "convex/react";
import { useState } from "react";

import { frameHasMechanic } from "@/lib/frames";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * Start / End helpers shared by the Journal header's live chip (JH) and the dashboard's Wither panel
 * (`src/app/(gm)/campaigns/[campaignId]/wither-panel.tsx`): the End dialog's Wither choice. The report lines and the
 * End dialog's text are framework-free in `src/lib/journal/sessions.ts` (shared with the phone, dcm-gdzi.46).
 */

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
