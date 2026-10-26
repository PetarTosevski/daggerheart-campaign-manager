"use client";

import "./page.css";

import { useQuery } from "convex/react";
import { useId, useState } from "react";

import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import { sessionLogTitle } from "@/lib/domain/notes";
import { formatSessionDate } from "@/lib/domain/sessions/status";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** No session picked: the 'No session' option. */
const NONE = "none";

/**
 * The small session picker (Q5, D6): '＋ New session log' and a log page's 'Session' button open it. Lists the sessions
 * the caller may link (`sessionRecords.list`: every session for the GM, live and played ones for a player), newest
 * first, plus 'No session'. Preselects `current` when given, else the live session, else the newest one (D6). Native
 * <dialog> (CL12).
 */
export function SessionPicker({
  campaignId,
  open,
  title,
  confirmLabel,
  current,
  onClose,
  onPick,
}: {
  campaignId: Id<"campaigns">;
  open: boolean;
  title: string;
  confirmLabel: string;
  /** The page's linked session (null: none) when relinking; undefined for a new page (D6 preselection). */
  current?: Id<"sessions"> | null;
  onClose: () => void;
  /** Resolves when saved; a rejection shows its message in the dialog. */
  onPick: (sessionId: Id<"sessions"> | null) => Promise<void>;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} className="bj-picker-dialog">
      {open ? <PickerBody campaignId={campaignId} confirmLabel={confirmLabel} current={current} onPick={onPick} onClose={onClose} /> : null}
    </Modal>
  );
}

function PickerBody({
  campaignId,
  confirmLabel,
  current,
  onPick,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  confirmLabel: string;
  current?: Id<"sessions"> | null;
  onPick: (sessionId: Id<"sessions"> | null) => Promise<void>;
  onClose: () => void;
}) {
  const sessions = useQuery(api.sessionRecords.list, { campaignId });
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = useId();

  if (sessions === undefined) {
    return (
      <p role="status" className="bj-picker-muted">
        Loading sessions…
      </p>
    );
  }
  const preselected =
    current !== undefined ? (current ?? NONE) : (sessions.find((s) => s.status === "live") ?? sessions[0])?._id ?? NONE;
  const picked = choice ?? (current && !sessions.some((s) => s._id === current) ? NONE : preselected);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onPick(picked === NONE ? null : (picked as Id<"sessions">));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="bj-picker"
      onSubmit={(event) => {
        event.preventDefault();
        void confirm();
      }}
    >
      <fieldset className="bj-picker-list">
        <legend className="bj-picker-legend">Link the page to a session</legend>
        {sessions.map((s) => (
          <label key={s._id} className="bj-picker-option">
            <input type="radio" name={name} value={s._id} checked={picked === s._id} onChange={() => setChoice(s._id)} />
            <span className="bj-picker-text">
              <span className="bj-picker-title">{sessionLogTitle(s)}</span>
              <span className="bj-picker-meta">
                {formatSessionDate(s.date)}
                {s.status === "live" ? " · Live" : s.status === "planned" ? " · Planned" : ""}
              </span>
            </span>
          </label>
        ))}
        <label className="bj-picker-option">
          <input type="radio" name={name} value={NONE} checked={picked === NONE} onChange={() => setChoice(NONE)} />
          <span className="bj-picker-text">
            <span className="bj-picker-title">No session</span>
            <span className="bj-picker-meta">{sessions.length === 0 ? "There are no sessions yet." : "Not linked to a session"}</span>
          </span>
        </label>
      </fieldset>
      {error ? (
        <p role="alert" className="bj-picker-error">
          {error}
        </p>
      ) : null}
      <div className="bj-picker-actions">
        <button type="button" className="bj-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="bj-picker-confirm" disabled={busy}>
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}
