"use client";

import "./detail.css";

import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { useState, type KeyboardEvent } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { formatSessionDate, sessionTitle, statusLabel } from "@/lib/domain/sessions";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../../convex/sessionRecords";
import { SESSION_TEXT_MAX } from "../../../../convex/lib/validators/sessions";
import { useSessionList } from "../list";
import type { NoSessionSelectedProps, PlayerSessionViewProps, SessionHeaderCardProps } from "../slots";

/**
 * Detail slot (D10 S2, board Sessions.dc.html l.80-87): the GM's session header card (title, date, played toggle,
 * delete asking twice), the player's read-only view (Q4) and the empty detail column. Both read the session from
 * `sessionRecords.list`, so a bad, deleted or (for a player) planned id shows "not available" instead of failing.
 */

/** Patches one session of the cached list (optimistic updates for the header card's intents). */
function patchListed(store: OptimisticLocalStore, campaignId: Id<"campaigns">, sessionId: string, patch: Partial<SessionListItem>) {
  const current = store.getQuery(api.sessionRecords.list, { campaignId });
  if (!current) return;
  store.setQuery(
    api.sessionRecords.list,
    { campaignId },
    current.map((s) => (s._id === sessionId ? { ...s, ...patch } : s)),
  );
}

function Unavailable({ isGm }: { isGm: boolean }) {
  return (
    <section className="ss-card ss-start" aria-label="Session">
      <p className="ss-muted ss-m0">
        {isGm ? "That session isn't in this campaign anymore. Pick another one on the left." : "That session isn't available. Pick one on the left."}
      </p>
    </section>
  );
}

const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") e.currentTarget.blur();
};

/** GM: 'Session n title', 'Date', 'Mark as played' / 'Mark as not played', 'Delete' -> 'Click again to delete' (B1). */
export function SessionHeaderCard({ campaignId, sessionId, onDeleted }: SessionHeaderCardProps) {
  const sessions = useSessionList(campaignId);
  const [error, setError] = useState<string | null>(null);
  // The title being typed (null: show the server's). Saved on blur / Enter, as one intent.
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  // The session whose Delete was pressed once; switching sessions cancels it without an effect.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const setTitle = useMutation(api.sessionRecords.setTitle).withOptimisticUpdate((store, args) =>
    patchListed(store, campaignId, args.sessionId, { title: args.title.trim() || undefined }),
  );
  const setDate = useMutation(api.sessionRecords.setDate).withOptimisticUpdate((store, args) =>
    patchListed(store, campaignId, args.sessionId, { date: args.date || undefined }),
  );
  const setPlayed = useMutation(api.sessionRecords.setPlayed).withOptimisticUpdate((store, args) =>
    patchListed(store, campaignId, args.sessionId, { status: args.played ? "played" : "planned" }),
  );
  const remove = useMutation(api.sessionRecords.remove);

  if (sessions === undefined) {
    return (
      <section className="ss-card" aria-label="Session">
        <p role="status" className="ss-muted ss-m0">
          Loading…
        </p>
      </section>
    );
  }
  const session = sessions.find((s) => s._id === sessionId);
  if (!session) return <Unavailable isGm />;

  function run(op: Promise<unknown>) {
    setError(null);
    op.catch((e: unknown) => setError(errorMessage(e)));
  }

  function saveTitle() {
    if (draft === null || draft.id !== session!._id) return;
    const text = draft.text;
    setDraft(null);
    if (text.trim() !== (session!.title ?? "")) run(setTitle({ campaignId, sessionId: session!._id, title: text }));
  }

  async function onDelete() {
    if (confirmId !== session!._id) {
      setConfirmId(session!._id);
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      await remove({ campaignId, sessionId: session!._id });
      setConfirmId(null);
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  }

  const titleId = `ss-title-${session._id}`;
  const dateId = `ss-date-${session._id}`;
  const live = session.status === "live";
  const played = session.status === "played";
  const confirming = confirmId === session._id;
  return (
    <section className="ss-card ss-head-card" aria-label="Session">
      <div className="ss-field ss-field-title">
        <label className="ss-lbl" htmlFor={titleId}>
          Session {session.n} title
        </label>
        <input
          id={titleId}
          className="ss-in ss-title-in"
          type="text"
          maxLength={SESSION_TEXT_MAX.title}
          placeholder="e.g. The Bridge at Dawn"
          value={draft?.id === session._id ? draft.text : (session.title ?? "")}
          onChange={(e) => setDraft({ id: session._id, text: e.target.value })}
          onBlur={saveTitle}
          onKeyDown={blurOnEnter}
        />
      </div>
      <div className="ss-field">
        <label className="ss-lbl" htmlFor={dateId}>
          Date
        </label>
        <input
          id={dateId}
          className="ss-in"
          type="date"
          value={session.date ?? ""}
          onChange={(e) => run(setDate({ campaignId, sessionId: session._id, date: e.target.value === "" ? null : e.target.value }))}
        />
      </div>
      <button
        type="button"
        className="ss-ghost ss-tall"
        disabled={live}
        title={live ? "End the session first" : undefined}
        onClick={() => run(setPlayed({ campaignId, sessionId: session._id, played: !played }))}
      >
        {played ? "Mark as not played" : "Mark as played"}
      </button>
      <button
        type="button"
        className="ss-ghost ss-danger ss-tall"
        disabled={live || deleting}
        title={live ? "End the session first" : undefined}
        onClick={onDelete}
        onBlur={() => setConfirmId(null)}
      >
        {confirming ? "Click again to delete" : "Delete"}
      </button>
      {error ? (
        <p role="alert" className="ss-head-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Player: the selected live or played session read-only: number, status, title, date and recap (Q4). */
export function PlayerSessionView({ campaignId, sessionId }: PlayerSessionViewProps) {
  const sessions = useSessionList(campaignId);
  if (sessions === undefined) {
    return (
      <section className="ss-card" aria-label="Session">
        <p role="status" className="ss-muted ss-m0">
          Loading…
        </p>
      </section>
    );
  }
  const session = sessions.find((s) => s._id === sessionId);
  if (!session) return <Unavailable isGm={false} />;
  const headingId = `ss-player-h-${session._id}`;
  return (
    <section className="ss-card" aria-label="Session">
      <div className="ss-item-top">
        <span className="ss-item-n">SESSION {session.n}</span>
        <span className="ss-chip" data-status={session.status}>
          {statusLabel(session.status)}
        </span>
      </div>
      <h2 id={headingId} className="ss-h">
        {sessionTitle(session.title)}
      </h2>
      <p className="ss-muted ss-m0">{formatSessionDate(session.date)}</p>
      <div className="ss-recap">
        <h3 className="ss-lbl ss-m0">Recap</h3>
        {session.recap ? (
          <p className="ss-recap-text">{session.recap}</p>
        ) : (
          <p className="ss-muted ss-m0">{session.status === "live" ? "This session is being played right now." : "No recap was written for this session."}</p>
        )}
      </div>
    </section>
  );
}

/** Nothing selected (board copy for the GM; players only read recaps). */
export function NoSessionSelected({ isGm }: NoSessionSelectedProps) {
  return (
    <section className="ss-card ss-start" aria-labelledby="ss-none-h">
      <h2 id="ss-none-h" className="ss-h">
        No session selected
      </h2>
      <p className="ss-muted ss-m0">
        {isGm
          ? "Pick a session on the left, or create a new one. Each session has three stages: Prep before you play, Play while at the table, and Wrap-up afterwards. The recap you write in Wrap-up appears on the dashboard."
          : "Pick a session on the left to read its recap."}
      </p>
    </section>
  );
}
