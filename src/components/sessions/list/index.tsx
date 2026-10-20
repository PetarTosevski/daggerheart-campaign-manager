"use client";

import "./list.css";

import { useQuery } from "convex/react";

import { formatSessionDate, headerLine, sessionTitle, statusLabel } from "@/lib/domain/sessions";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../../convex/sessionRecords";
import type { DefaultSessionArgs, NewSessionButtonProps, SessionHeaderLineProps, SessionListProps } from "../slots";

/**
 * List slot (D10 S2, board Sessions.dc.html l.52-71): the header line, '+ New session' and the sessions column, all
 * from `sessionRecords.list` (one subscription; the server leaves planned sessions out for players, Q4).
 */

/** The campaign's sessions newest first, as this caller may see them; `undefined` while loading. */
export function useSessionList(campaignId: Id<"campaigns">): SessionListItem[] | undefined {
  return useQuery(api.sessionRecords.list, { campaignId });
}

/** The session shown when the URL names none: the newest one the caller may see. `undefined` loading, null for none. */
export function useDefaultSessionId({ campaignId }: DefaultSessionArgs): Id<"sessions"> | null | undefined {
  const sessions = useSessionList(campaignId);
  return sessions === undefined ? undefined : (sessions[0]?._id ?? null);
}

/** Header line (B1): 'N sessions · M played · Next: <date>'. Players see no planned sessions, so no 'Next'. */
export function SessionHeaderLine({ campaignId }: SessionHeaderLineProps) {
  const sessions = useSessionList(campaignId);
  if (sessions === undefined) return <span role="status">Loading…</span>;
  return <>{headerLine(sessions)}</>;
}

/** '+ New session' (GM, B1): creates the next planned session; the page opens it on Prep. */
export function NewSessionButton({ campaignId, isGm, onCreated }: NewSessionButtonProps) {
  const create = useIntent(api.sessionRecords.create);
  if (!isGm) return null;
  async function onClick() {
    const result = await create.fire({ campaignId });
    if (result) onCreated(result.sessionId);
  }
  return (
    <div className="ss-new">
      <button type="button" className="ss-primary" disabled={create.pending} onClick={onClick}>
        + New session
      </button>
      {create.error ? (
        <p role="alert" className="ss-new-error">
          {create.error}
        </p>
      ) : null}
    </div>
  );
}

/** Left column (B1): 'SESSION n', status chip, title or 'Untitled session', formatted date; newest first; current ringed. */
export function SessionList({ campaignId, isGm, selectedId, onSelect }: SessionListProps) {
  const sessions = useSessionList(campaignId);
  if (sessions === undefined) {
    return (
      <p role="status" className="ss-muted ss-m0">
        Loading sessions…
      </p>
    );
  }
  if (sessions.length === 0) {
    return <div className="ss-empty">{isGm ? "No sessions yet. Create one to start prepping." : "No sessions played yet."}</div>;
  }
  return (
    <ul className="ss-list">
      {sessions.map((s) => (
        <li key={s._id}>
          <button type="button" className="ss-item" aria-current={s._id === selectedId ? "true" : "false"} onClick={() => onSelect(s._id)}>
            <span className="ss-item-top">
              <span className="ss-item-n">SESSION {s.n}</span>
              <span className="ss-chip" data-status={s.status}>
                {statusLabel(s.status)}
              </span>
            </span>
            <span className="ss-item-title">{sessionTitle(s.title)}</span>
            <span className="ss-item-date">{formatSessionDate(s.date)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
