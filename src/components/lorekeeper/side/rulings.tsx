"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";

import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import { RULINGS_COPY, RULINGS_EMPTY, RULINGS_TITLE, pinnedLabel } from "@/lib/lorekeeper/copy";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { LOREKEEPER_LIMITS } from "../../../../convex/lib/validators/lorekeeper";
import type { LorekeeperSideProps } from "../slots";
import { resolveLocally, unpinLocally, updateRulingLocally } from "./optimistic";

type Ruling = { _id: Id<"lorekeeperRulings">; title: string; text: string; meta: string };
type OpenAsk = { _id: Id<"lorekeeperAsks">; messageId: Id<"lorekeeperMessages">; askerName: string; characterName: string | null; question: string; call: string | null };

/** One line, cut to `max` characters with an ellipsis (the pin dialog's starting values). */
function clip(raw: string, max: number): string {
  const line = raw.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The Table rulings card (board Lorekeeper.dc.html; Q8, Q14): '<N> pinned', the board's copy, and a card per ruling
 * (title, text, 'Pinned by the GM · Session N'). Only the GM edits and unpins, and only the GM sees the open
 * Ask-the-GM requests ('Asked by <name>') with 'Pin a ruling' (pins, then resolves the ask as pinned) and 'Dismiss'
 * (resolves it as dismissed).
 */
export function RulingsCard({ campaignId, access }: LorekeeperSideProps) {
  const rulings = useQuery(api.lorekeeperRulings.list, { campaignId });
  const asks = useQuery(api.lorekeeperAsks.listOpen, access.isGm ? { campaignId } : "skip");
  const [editing, setEditing] = useState<Ruling | null>(null);
  const [pinning, setPinning] = useState<OpenAsk | null>(null);
  const [unpinning, setUnpinning] = useState<Ruling | null>(null);

  return (
    <section className="lk-card" aria-label={RULINGS_TITLE}>
      <div className="lk-cardhead">
        <h2 className="lk-h">{RULINGS_TITLE}</h2>
        {rulings !== undefined ? <span className="lk-muted lk-count">{pinnedLabel(rulings.length)}</span> : null}
      </div>
      <span className="lk-muted">{RULINGS_COPY}</span>
      {access.isGm && asks !== undefined && asks.length > 0 ? (
        <AskList campaignId={campaignId} asks={asks} onPin={setPinning} />
      ) : null}
      {rulings === undefined ? (
        <span role="status" className="lk-muted">
          Loading…
        </span>
      ) : rulings.length === 0 ? (
        <span className="lk-muted">{RULINGS_EMPTY}</span>
      ) : (
        <ul className="lk-rulings">
          {rulings.map((ruling) => (
            <li key={ruling._id} className="lk-ruling">
              <strong>{ruling.title}</strong>
              <span className="lk-muted lk-rulingtext">{ruling.text}</span>
              <span className="lk-lbl lk-rulingmeta">{ruling.meta}</span>
              {access.isGm ? (
                <span className="lk-rulingacts">
                  <button type="button" className="lk-act lk-act-dark" aria-label={`Edit ${ruling.title}`} onClick={() => setEditing(ruling)}>
                    Edit
                  </button>
                  <button type="button" className="lk-act lk-act-dark" aria-label={`Unpin ${ruling.title}`} onClick={() => setUnpinning(ruling)}>
                    Unpin
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <RulingDialog
          key={editing._id}
          campaignId={campaignId}
          mode={{ kind: "edit", ruling: editing }}
          draft={{ title: editing.title, text: editing.text }}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {pinning ? (
        <RulingDialog
          key={pinning._id}
          campaignId={campaignId}
          mode={{ kind: "ask", ask: pinning }}
          draft={{ title: clip(pinning.question, LOREKEEPER_LIMITS.rulingTitle), text: clip(pinning.call ?? "", LOREKEEPER_LIMITS.rulingText) }}
          onClose={() => setPinning(null)}
        />
      ) : null}
      {unpinning ? <UnpinDialog campaignId={campaignId} ruling={unpinning} onClose={() => setUnpinning(null)} /> : null}
    </section>
  );
}

/** The GM's open Ask-the-GM requests, oldest first. */
function AskList({ campaignId, asks, onPin }: { campaignId: Id<"campaigns">; asks: OpenAsk[]; onPin: (ask: OpenAsk) => void }) {
  const resolve = useMutation(api.lorekeeperAsks.resolve).withOptimisticUpdate(resolveLocally);
  const [error, setError] = useState<string | null>(null);

  async function dismiss(ask: OpenAsk) {
    setError(null);
    try {
      await resolve({ campaignId, askId: ask._id });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="lk-asks">
      <span className="lk-lbl">Asked of you</span>
      <ul className="lk-rulings" aria-label="Questions for the GM">
        {asks.map((ask) => (
          <li key={ask._id} className="lk-ask">
            <span className="lk-who">Asked by {ask.characterName ?? ask.askerName}</span>
            <span className="lk-askq">{ask.question || "A rules question"}</span>
            {ask.call ? <span className="lk-muted lk-rulingtext">Suggested: {ask.call}</span> : null}
            <span className="lk-rulingacts">
              <button type="button" className="lk-act lk-act-gold" onClick={() => onPin(ask)}>
                Pin a ruling
              </button>
              <button type="button" className="lk-act lk-act-dark" onClick={() => void dismiss(ask)}>
                Dismiss
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="lk-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type DialogMode = { kind: "edit"; ruling: Ruling } | { kind: "ask"; ask: OpenAsk };

/**
 * Edit a ruling (only the changed fields go to lorekeeperRulings.update) or pin one for an ask (lorekeeperRulings.pin
 * from the asked answer, in the live session when there is one, then lorekeeperAsks.resolve with the new ruling).
 * Mounted only while open, so the fields start from the draft.
 */
function RulingDialog({
  campaignId,
  mode,
  draft,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  mode: DialogMode;
  draft: { title: string; text: string };
  onClose: () => void;
}) {
  const update = useMutation(api.lorekeeperRulings.update).withOptimisticUpdate(updateRulingLocally);
  const pin = useMutation(api.lorekeeperRulings.pin);
  const resolve = useMutation(api.lorekeeperAsks.resolve).withOptimisticUpdate(resolveLocally);
  const sessions = useQuery(api.sessionWrap.dashboard, mode.kind === "ask" ? { campaignId } : "skip");
  const [title, setTitle] = useState(draft.title);
  const [text, setText] = useState(draft.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const textId = useId();
  const valid = title.trim().length > 0 && text.trim().length > 0;

  async function save() {
    if (mode.kind === "edit") {
      const changes = {
        ...(title.trim() !== mode.ruling.title ? { title } : {}),
        ...(text.trim() !== mode.ruling.text ? { text } : {}),
      };
      if (Object.keys(changes).length > 0) await update({ campaignId, rulingId: mode.ruling._id, ...changes });
      return;
    }
    const live = sessions?.live?.sessionId;
    const rulingId = await pin({
      campaignId,
      title: title.trim(),
      text: text.trim(),
      fromMessageId: mode.ask.messageId,
      ...(live !== undefined ? { sessionId: live } : {}),
    });
    await resolve({ campaignId, askId: mode.ask._id, rulingId });
  }

  return (
    <Modal open onClose={onClose} title={mode.kind === "edit" ? "Edit ruling" : "Pin a ruling"} className="lk-dialog">
      <form
        className="lk-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          setError(null);
          try {
            await save();
            onClose();
          } catch (caught) {
            setError(errorMessage(caught));
            setBusy(false);
          }
        }}
      >
        {mode.kind === "ask" ? (
          <p className="lk-dialog-text">
            Asked by {mode.ask.characterName ?? mode.ask.askerName}: {mode.ask.question}
          </p>
        ) : null}
        <label htmlFor={titleId} className="lk-lbl">
          Title
        </label>
        <input id={titleId} className="lk-field" value={title} maxLength={LOREKEEPER_LIMITS.rulingTitle} onChange={(event) => setTitle(event.target.value)} />
        <label htmlFor={textId} className="lk-lbl">
          Ruling
        </label>
        <textarea id={textId} className="lk-field" rows={5} value={text} maxLength={LOREKEEPER_LIMITS.rulingText} onChange={(event) => setText(event.target.value)} />
        {error ? (
          <p role="alert" className="lk-alert">
            {error}
          </p>
        ) : null}
        <div className="lk-formacts">
          <button type="button" className="lk-act lk-act-dark" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="lk-send" disabled={!valid || busy}>
            {mode.kind === "edit" ? "Save" : "Pin ruling"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Confirm before unpinning: the ruling is deleted and the Lorekeeper stops quoting it. */
function UnpinDialog({ campaignId, ruling, onClose }: { campaignId: Id<"campaigns">; ruling: Ruling; onClose: () => void }) {
  const unpin = useMutation(api.lorekeeperRulings.unpin).withOptimisticUpdate(unpinLocally);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="Unpin this ruling?" className="lk-dialog">
      <p className="lk-dialog-text">
        “{ruling.title}” is removed from the table rulings, and the Lorekeeper stops quoting it.
      </p>
      {error ? (
        <p role="alert" className="lk-alert">
          {error}
        </p>
      ) : null}
      <div className="lk-formacts">
        <button type="button" className="lk-act lk-act-dark" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="lk-act lk-danger"
          onClick={async () => {
            setError(null);
            try {
              await unpin({ campaignId, rulingId: ruling._id });
              onClose();
            } catch (caught) {
              setError(errorMessage(caught));
            }
          }}
        >
          Unpin
        </button>
      </div>
    </Modal>
  );
}
