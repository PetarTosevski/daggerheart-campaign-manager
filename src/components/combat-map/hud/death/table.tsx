"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Popup } from "../ui";
import { nextOutcome, tableOutcomes } from "./model";
import { DEATH_FEED_ROWS, SKULL_ICON } from "./own";

/**
 * The death-move outcome for the rest of the table (user answer 2026-11-02, TASK-HUD-H4.3): every player sees the
 * popup when another character's move is confirmed (or made), not only the chooser (`OwnDeath`) and the GM (the
 * confirm card). Read from the move's own public feed row (`feed.list`); an outcome already on the page when the view
 * loads is history and not shown, unless it is under `RECENT_MS` old (it landed while the view was loading). "Got it"
 * moves on to the next one; an undone move drops out.
 */
const RECENT_MS = 30_000;

export function TableDeath({ campaignId, names, own }: { campaignId: Id<"campaigns">; names: ReadonlyMap<string, string>; own: ReadonlySet<string> }) {
  const feed = useQuery(api.feed.list, { campaignId, paginationOpts: { numItems: DEATH_FEED_ROWS, cursor: null } });
  // The newest outcome shown or already there on load: `undefined` until the feed first loads (React's "information
  // from previous renders" pattern, no effect).
  const [seen, setSeen] = useState<string | null | undefined>(undefined);
  // When this view started: an outcome on the first page that is older than `RECENT_MS` before it is history; a newer
  // one landed while the feed was still loading and shows.
  const [since] = useState(() => Date.now() - RECENT_MS);
  if (feed === undefined) return null;
  const outcomes = tableOutcomes(feed.page, own);
  if (seen === undefined) {
    setSeen(outcomes.find((r) => (r.at ?? 0) < since)?._id ?? null);
    return null;
  }
  const row = nextOutcome(outcomes, seen);
  if (row === null) return null;
  const name = names.get(row.characterId ?? "") ?? "A character";
  return (
    <Popup icon={SKULL_ICON} tone="red" title={`${name}’s death move`} sub="Confirmed by the GM" testId="hud-death-table" primary={{ label: "Got it", onClick: () => setSeen(row._id) }}>
      <p role="status">{row.summary}</p>
    </Popup>
  );
}
