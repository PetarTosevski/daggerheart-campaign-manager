"use client";

import "./feed.css";

import { useQuery } from "convex/react";
import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { HudPartProps } from "../state";
import { FEED_ROWS, feedDetail, feedIcon, type FeedIcon } from "./model";

/**
 * "Just now" bottom-left on the player view (plan combat-hud H4.3; Main `.me`; HANDOFF "Feed"): the newest public rows
 * of `feed.list`, live. The GM's left column holds the request queue and Resolutions with Undo instead (H5.1), so the
 * GM view shows nothing here. Players read only public rows (the server decides).
 */
export function HudFeed({ state }: HudPartProps): ReactNode {
  if (state.role === "gm") return null;
  return <JustNow campaignId={state.campaignId} />;
}

function JustNow({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const titleId = useId();
  const page = useQuery(api.feed.list, { campaignId, paginationOpts: { numItems: FEED_ROWS, cursor: null } });
  return (
    <section className="hud-feed" aria-labelledby={titleId} data-testid="hud-feed">
      <h2 id={titleId}>Just now</h2>
      {page === undefined ? (
        <p role="status" className="hud-feed-note">
          Loading the feed…
        </p>
      ) : page.page.length === 0 ? (
        <p className="hud-feed-note">Nothing yet.</p>
      ) : (
        <ul className="hud-feed-list" aria-live="polite" aria-relevant="additions">
          {page.page.map((row) => {
            const detail = feedDetail(row);
            return (
              <li key={row._id} className={cn(row.undone && "hud-feed-undone")} data-kind={row.kind}>
                <span className="hud-feed-i">{ICONS[feedIcon(row)]}</span>
                <span>
                  <b>{row.summary}</b>
                  {detail ? <span> {detail}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// The board's icons (Main `.feed .fi`), 16 px, in the feed's gold.
const ICONS: Record<FeedIcon, ReactNode> = {
  hit: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.5 1.5l-1 3.5-6 6-2-2 6-6zM3.2 9.3l3.5 3.5M2 14l2.4-2.4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  ),
  dice: (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5.5" cy="5.5" r="1.1" />
      <circle cx="10.5" cy="10.5" r="1.1" />
      <circle cx="8" cy="8" r="1.1" />
    </svg>
  ),
  fear: (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 1c1.5 3 4.5 4.5 4.5 8.2A4.5 4.5 0 0 1 3.5 9.2C3.5 7 5 6 5.5 4.5 6.5 6 7 6.2 7.3 6 7.6 4 8 2.5 8 1z" />
    </svg>
  ),
  death: (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 1.5c-3.3 0-5.5 2.3-5.5 5.2 0 1.8.9 3.1 2 3.9V13a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.4c1.1-.8 2-2.1 2-3.9 0-2.9-2.2-5.2-5.5-5.2zM5.8 6.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zm4.4 0a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM7 10.5h2l-1 1.6z" />
    </svg>
  ),
  note: (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <circle cx="8" cy="8" r="2.2" />
    </svg>
  ),
};
