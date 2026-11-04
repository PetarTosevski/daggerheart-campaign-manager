"use client";

import "./session-list.css";

import { useQuery } from "convex/react";
import { Plus } from "lucide-react";

import { brandButton } from "@/components/brand/buttons";
import { formatSessionDate, sessionTitle } from "@/lib/domain/sessions";
import { useIntent } from "@/lib/use-intent";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../../convex/sessionRecords";
import type { CampaignSoFarProps, PlanSessionButtonProps, SessionListProps } from "../slots";
import { Card, Chip } from "../ui";
import { nextSessionNumber, shortSessionDate, wholeHours } from "./format";

/**
 * Session list slot (JS, contract: ../slots.ts; design reference/designs/journal/journal_views.jpg, left column):
 * - `SessionList`: every session the caller may see, newest first (`sessionRecords.list`; the server leaves planned
 *   sessions out for players, Q5): number badge, title, short date, a Planned / Live chip, the selected one ringed.
 * - `PlanSessionButton` (GM): '+ Plan session N' creates the next planned session; the page opens it on Plan.
 * - `CampaignSoFar`: sessions played, hours at the table, party level (`sessionRecords.summary`) and the caller's open
 *   threads (`notesThreads.threads`, Q1).
 */

export { headingLine, patchListed, shortSessionDate, startTime } from "./format";

/** The campaign's sessions newest first, as this caller may see them (players: live and played); `undefined` loading. */
export function useSessionList(campaignId: Id<"campaigns">): SessionListItem[] | undefined {
  return useQuery(api.sessionRecords.list, { campaignId });
}

/** The status chip of a list row: Planned (gold) or Live (green dot); a played session has none (design). */
function StatusChip({ status }: { status: SessionListItem["status"] }) {
  if (status === "planned") return <Chip tone="planned">Planned</Chip>;
  if (status === "live") return <Chip tone="live">Live</Chip>;
  return null;
}

/** A row's spoken name: 'Session 7: The chapel in the briar, Sun 9 Nov, Planned' (the parts are separate spans). */
function itemLabel(s: SessionListItem): string {
  const status = s.status === "played" ? "" : `, ${s.status === "live" ? "Live" : "Planned"}`;
  return `Session ${s.n}: ${sessionTitle(s.title)}, ${shortSessionDate(s.date)}${status}`;
}

/** Left column: the sessions, newest first; the selected one ringed (`aria-current`). */
export function SessionList({ campaignId, isGm, selectedId, onSelect }: SessionListProps) {
  const sessions = useSessionList(campaignId);
  // Loading: the page's own 'Loading sessions…' status already speaks for the column, so this line is not a second
  // live region.
  if (sessions === undefined) {
    return (
      <p className="jr-muted jr-m0" aria-busy="true">
        Loading sessions…
      </p>
    );
  }
  if (sessions.length === 0) {
    return (
      <p className="js-empty jr-muted jr-m0">
        {isGm ? "No sessions yet. Plan the first one below." : "No sessions yet. They show here once the GM starts one."}
      </p>
    );
  }
  return (
    <ul className="js-list" aria-label="Sessions">
      {sessions.map((s) => (
        <li key={s._id}>
          <button
            type="button"
            className="js-item"
            aria-current={s._id === selectedId ? "true" : undefined}
            aria-label={itemLabel(s)}
            data-status={s.status}
            onClick={() => onSelect(s._id)}
          >
            <span className="js-n">{s.n}</span>
            <span className="js-text">
              <span className="js-title">{sessionTitle(s.title)}</span>
              <span className="js-date" title={formatSessionDate(s.date)}>
                {shortSessionDate(s.date)}
              </span>
            </span>
            <StatusChip status={s.status} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Left column, under the list (GM): '+ Plan session N' (N = highest + 1); the page opens the new session on Plan. */
export function PlanSessionButton({ campaignId, isGm, onCreated }: PlanSessionButtonProps) {
  const sessions = useSessionList(campaignId);
  const create = useIntent(api.sessionRecords.create);
  if (!isGm || sessions === undefined) return null;
  const n = nextSessionNumber(sessions);
  async function onClick() {
    const result = await create.fire({ campaignId });
    if (result) onCreated(result.sessionId);
  }
  return (
    <div className="js-plan-wrap">
      <button
        type="button"
        className={cn(brandButton({ variant: "outline", size: "md" }), "js-plan")}
        disabled={create.pending}
        onClick={() => void onClick()}
      >
        <Plus aria-hidden="true" />
        Plan session {n}
      </button>
      {create.error ? (
        <p role="alert" className="js-error">
          {create.error}
        </p>
      ) : null}
    </div>
  );
}

/** One row of 'Campaign so far'; `value` undefined = still loading ('…', read as 'loading'). */
function SoFarRow({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="js-row">
      <dt>{label}</dt>
      <dd>
        {value === undefined ? (
          <>
            <span aria-hidden="true">…</span>
            <span className="sr-only">loading</span>
          </>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/** Left column, last: 'Campaign so far' (JD5 `summary` + the caller's open threads, Q1). */
export function CampaignSoFar({ campaignId }: CampaignSoFarProps) {
  const summary = useQuery(api.sessionRecords.summary, { campaignId });
  const threads = useQuery(api.notesThreads.threads, { campaignId });
  return (
    <Card heading="Campaign so far" kind="label" className="js-sofar">
      {/* Loading: each value shows '…' (aria-busy) instead of a second status line beside the page's. */}
      <dl className="js-rows" aria-busy={summary === undefined || threads === undefined}>
        <SoFarRow label="Sessions played" value={summary?.sessionsPlayed} />
        <SoFarRow label="Hours at the table" value={summary === undefined ? undefined : wholeHours(summary.hoursAtTable)} />
        <SoFarRow label="Party level" value={summary?.partyLevel} />
        <SoFarRow label="Open threads" value={threads?.length} />
      </dl>
    </Card>
  );
}
