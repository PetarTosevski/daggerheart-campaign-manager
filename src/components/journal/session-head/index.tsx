"use client";

import "./session-head.css";

import { useMutation } from "convex/react";
import { Ellipsis } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";
import { fullSessionDate, shortSessionDate, startTime } from "@/lib/dates";
import { sessionTitle } from "@/lib/domain/sessions";
import { patchListed } from "@/lib/journal/sessions";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../../convex/sessionRecords";
import { SESSION_TEXT_MAX } from "../../../../convex/lib/validators/sessions";
import { useSessionList } from "../session-list";
import type { SessionHeadingProps } from "../slots";
import { Chip } from "../ui";

/**
 * Session heading slot (JS, contract: ../slots.ts; design reference/designs/journal/journal_views.jpg, session area
 * top left): 'Session 6 · Sun 2 Nov · 19:10', the title in serif and the status chip. The GM (Q11 default) clicks the
 * title or the date to edit it in place (saved on Enter or blur, Escape cancels; optimistic on the cached list) and
 * has a '⋯' menu with 'Mark as played' / 'Mark as not played' and 'Delete session' (asks twice); both are disabled
 * while the session is live (End it first). Players read it only. The session comes from `sessionRecords.list`, so a
 * bad, deleted or (for a player) planned id shows 'not available' instead of failing.
 */

type Editing = { id: string; field: "title" | "date"; text: string };

function StatusChip({ status }: { status: SessionListItem["status"] }) {
  if (status === "live") return <Chip tone="live">Live</Chip>;
  if (status === "planned") return <Chip tone="planned">Planned</Chip>;
  return <Chip tone="played">Played</Chip>;
}

/** The GM's '⋯' menu: Mark as played / not played and Delete session (asks twice). Disabled while live. */
function SessionMenu({
  campaignId,
  session,
  onDeleted,
  onError,
}: {
  campaignId: Id<"campaigns">;
  session: SessionListItem;
  onDeleted: () => void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // The session whose Delete was pressed once; closing the menu or switching sessions cancels it without an effect.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const setPlayed = useMutation(api.sessionRecords.setPlayed).withOptimisticUpdate((store, args) =>
    patchListed(store, campaignId, args.sessionId, { status: args.played ? "played" : "planned" }),
  );
  const remove = useMutation(api.sessionRecords.remove);

  function close() {
    setOpen(false);
    setConfirmId(null);
  }

  // Close on a click outside or Escape (listeners only while open; no state is copied).
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
        setConfirmId(null);
      }
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setConfirmId(null);
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const live = session.status === "live";
  const played = session.status === "played";
  const confirming = confirmId === session._id;

  function togglePlayed() {
    onError(null);
    close();
    setPlayed({ campaignId, sessionId: session._id, played: !played }).catch((e: unknown) => onError(errorMessage(e)));
  }

  async function onDelete() {
    if (!confirming) {
      setConfirmId(session._id);
      return;
    }
    onError(null);
    setDeleting(true);
    try {
      await remove({ campaignId, sessionId: session._id });
      close();
      onDeleted();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div ref={root} className="js-menu">
      <BrandButton
        variant="neutral"
        icon
        round
        aria-label="Session menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Ellipsis aria-hidden="true" />
      </BrandButton>
      <div id={panelId} className="js-menu-panel" hidden={!open}>
        <BrandButton variant="neutral" size="sm" className="w-full" disabled={live} onClick={togglePlayed}>
          {played ? "Mark as not played" : "Mark as played"}
        </BrandButton>
        <BrandButton variant="danger" size="sm" className="w-full" disabled={live || deleting} aria-live="polite" onClick={() => void onDelete()}>
          {confirming ? "Click again to delete" : "Delete session"}
        </BrandButton>
        {live ? <p className="js-menu-note">End the session first to mark it or delete it.</p> : null}
      </div>
    </div>
  );
}

/** Session area, top left: the line, the title and the chip; the GM's inline edit and menu (Q11). */
export function SessionHeading({ campaignId, isGm, sessionId, onDeleted }: SessionHeadingProps) {
  const sessions = useSessionList(campaignId);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Escape cancels: the input's blur (fired as it unmounts) must not save.
  const cancelled = useRef(false);
  const lineId = useId();

  const setTitle = useMutation(api.sessionRecords.setTitle).withOptimisticUpdate((store, args) =>
    patchListed(store, campaignId, args.sessionId, { title: args.title.trim() || undefined }),
  );
  const setDate = useMutation(api.sessionRecords.setDate).withOptimisticUpdate((store, args) =>
    patchListed(store, campaignId, args.sessionId, { date: args.date || undefined }),
  );

  if (sessions === undefined) {
    return (
      <p role="status" className="jr-muted jr-m0">
        Loading the session…
      </p>
    );
  }
  const session = sessions.find((s) => s._id === sessionId);
  if (!session) {
    return (
      <p className="js-unavailable jr-muted jr-m0">
        {isGm ? "That session isn't in this campaign anymore. Pick another one on the left." : "That session isn't available. Pick one on the left."}
      </p>
    );
  }

  const current = editing?.id === session._id ? editing : null;
  const title = sessionTitle(session.title);
  const date = shortSessionDate(session.date);
  const time = startTime(session.startedAt);

  function run(op: Promise<unknown>) {
    op.catch((e: unknown) => setError(errorMessage(e)));
  }

  function begin(field: Editing["field"]) {
    cancelled.current = false;
    setError(null);
    setEditing({ id: session!._id, field, text: field === "title" ? (session!.title ?? "") : (session!.date ?? "") });
  }

  function save() {
    const draft = current;
    setEditing(null);
    if (draft === null || cancelled.current) return;
    if (draft.field === "title") {
      if (draft.text.trim() !== (session!.title ?? "")) run(setTitle({ campaignId, sessionId: session!._id, title: draft.text }));
    } else if (draft.text !== (session!.date ?? "")) {
      run(setDate({ campaignId, sessionId: session!._id, date: draft.text === "" ? null : draft.text }));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      cancelled.current = true;
      setEditing(null);
    }
  }

  const dateText = (
    <span className="js-head-date" title={fullSessionDate(session.date)}>
      {date}
    </span>
  );

  return (
    <div className="js-head" data-status={session.status}>
      <div className="js-head-line" id={lineId}>
        <span>Session {session.n}</span>
        <span aria-hidden="true">·</span>
        {!isGm ? (
          dateText
        ) : current?.field === "date" ? (
          <input
            className="js-head-date-in"
            type="date"
            aria-label={`Session ${session.n} date`}
            autoFocus
            value={current.text}
            onChange={(e) => setEditing({ ...current, text: e.target.value })}
            onBlur={save}
            onKeyDown={onKeyDown}
          />
        ) : (
          <button
            type="button"
            className="js-head-edit js-head-date-btn"
            title={`Change the date (${fullSessionDate(session.date)})`}
            onClick={() => begin("date")}
          >
            {date}
          </button>
        )}
        {time ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{time}</span>
          </>
        ) : null}
      </div>
      <div className="js-head-row">
        {isGm && current?.field === "title" ? (
          <input
            className="js-head-title-in"
            type="text"
            aria-label={`Session ${session.n} title`}
            autoFocus
            maxLength={SESSION_TEXT_MAX.title}
            placeholder="e.g. The Bridge at Dawn"
            value={current.text}
            onChange={(e) => setEditing({ ...current, text: e.target.value })}
            onBlur={save}
            onKeyDown={onKeyDown}
          />
        ) : (
          <h2 className="js-head-title" aria-describedby={lineId}>
            {isGm ? (
              <button type="button" className="js-head-edit" title="Rename the session" onClick={() => begin("title")}>
                {title}
              </button>
            ) : (
              title
            )}
          </h2>
        )}
        <StatusChip status={session.status} />
        {isGm ? <SessionMenu key={session._id} campaignId={campaignId} session={session} onDeleted={onDeleted} onError={setError} /> : null}
      </div>
      {error ? (
        <p role="alert" className="js-head-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
