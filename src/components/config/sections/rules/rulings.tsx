"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import { glassButtonClass } from "@/components/brand/glass-button";
import { unpinLocally, updateRulingLocally } from "@/components/lorekeeper/side/optimistic";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { LOREKEEPER_LIMITS } from "../../../../../convex/lib/validators/lorekeeper";
import { RULES_TEXT, rulingOrigin } from "./text";

type Ruling = {
  _id: Id<"lorekeeperRulings">;
  title: string;
  text: string;
  sessionN: number | null;
  fromMessageId: Id<"lorekeeperMessages"> | null;
};

type Draft = { title: string; text: string };

/**
 * The table rulings (`lorekeeperRulings.list`, newest first) with their origin line, each with Edit (inline form,
 * only changed fields go to `update`, optimistic) and Unpin (an inline confirm, then `unpin`, optimistic). 'Add a house
 * rule' opens an inline form that calls `pin` without `fromMessageId` or a session. Titles are at most 80 and texts at
 * most 600 characters, as the server enforces; at 50 rulings Add is off and the server's limit text shows.
 */
export function Rulings({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const rulings = useQuery(api.lorekeeperRulings.list, { campaignId });
  const pin = useMutation(api.lorekeeperRulings.pin);
  const update = useMutation(api.lorekeeperRulings.update).withOptimisticUpdate(updateRulingLocally);
  const unpin = useMutation(api.lorekeeperRulings.unpin).withOptimisticUpdate(unpinLocally);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Id<"lorekeeperRulings"> | null>(null);
  const [confirming, setConfirming] = useState<Id<"lorekeeperRulings"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (rulings === undefined) {
    return (
      <p role="status" className="cfg-muted cfg-rules-gap">
        Loading …
      </p>
    );
  }
  const full = rulings.length >= LOREKEEPER_LIMITS.rulingsPerCampaign;

  async function remove(ruling: Ruling) {
    setConfirming(null);
    setError(null);
    try {
      await unpin({ campaignId, rulingId: ruling._id });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="cfg-rules-gap">
      {rulings.length === 0 ? (
        <p className="cfg-muted">{RULES_TEXT.empty}</p>
      ) : (
        <ul className="cfg-rules-list" aria-label={RULES_TEXT.rulingsLabel}>
          {rulings.map((ruling) =>
            editing === ruling._id ? (
              <li key={ruling._id} className="cfg-row cfg-col">
                <RulingForm
                  legend={`Edit ${ruling.title}`}
                  initial={{ title: ruling.title, text: ruling.text }}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={async ({ title, text }) => {
                    const changes = {
                      ...(title.trim() !== ruling.title ? { title } : {}),
                      ...(text.trim() !== ruling.text ? { text } : {}),
                    };
                    if (Object.keys(changes).length > 0) await update({ campaignId, rulingId: ruling._id, ...changes });
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={ruling._id} className="cfg-row cfg-rule">
                <div className="cfg-row-t">
                  <b>{ruling.title}</b>
                  <span className="cfg-rule-text">{ruling.text}</span>
                  <em>{rulingOrigin(ruling)}</em>
                </div>
                {confirming === ruling._id ? (
                  <div className="cfg-rule-acts" role="group" aria-label={`Unpin ${ruling.title}?`}>
                    <span className="cfg-muted">Unpin?</span>
                    <button type="button" className={glassButtonClass({ role: "danger", size: "sm" })} onClick={() => void remove(ruling)}>
                      Unpin
                    </button>
                    <button type="button" className={glassButtonClass({ role: "cancel", size: "sm" })} onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="cfg-rule-acts">
                    <button
                      type="button"
                      className={glassButtonClass({ role: "neutral", size: "sm" })}
                      aria-label={`Edit ${ruling.title}`}
                      onClick={() => {
                        setError(null);
                        setEditing(ruling._id);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={glassButtonClass({ role: "danger", size: "sm" })}
                      aria-label={`Unpin ${ruling.title}`}
                      onClick={() => setConfirming(ruling._id)}
                    >
                      Unpin
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {adding ? (
        <div className="cfg-row cfg-col cfg-rule-new">
          <RulingForm
            legend={RULES_TEXT.add}
            initial={{ title: "", text: "" }}
            submitLabel="Add rule"
            onCancel={() => setAdding(false)}
            onSubmit={async ({ title, text }) => {
              await pin({ campaignId, title: title.trim(), text: text.trim() });
              setAdding(false);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className={`${glassButtonClass({ role: "neutral" })} cfg-rules-add`}
          disabled={full}
          onClick={() => {
            setError(null);
            setAdding(true);
          }}
        >
          <Plus size={16} aria-hidden="true" />
          {RULES_TEXT.add}
        </button>
      )}
      {full ? <p className="cfg-muted cfg-rules-gap">{RULES_TEXT.limit}</p> : null}
      <p aria-live="polite" className="cfg-muted cfg-rules-err">
        {error}
      </p>
    </div>
  );
}

/** Title and text fields with the server's limits; its own error line; Escape cancels the form, not the panel. */
function RulingForm({
  legend,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  legend: string;
  initial: Draft;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [text, setText] = useState(initial.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const textId = useId();
  const valid = title.trim().length > 0 && text.trim().length > 0;

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    // Escape closes the form, not the settings dialog around it.
    event.stopPropagation();
    event.preventDefault();
    onCancel();
  }

  return (
    <form
      className="cfg-rule-form"
      aria-label={legend}
      onKeyDown={onKeyDown}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!valid || busy) return;
        setBusy(true);
        setError(null);
        try {
          await onSubmit({ title, text });
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <label htmlFor={titleId} className="cfg-lbl">
        Title
      </label>
      <input
        id={titleId}
        className="cfg-rule-field"
        value={title}
        maxLength={LOREKEEPER_LIMITS.rulingTitle}
        autoFocus
        onChange={(event) => setTitle(event.target.value)}
      />
      <label htmlFor={textId} className="cfg-lbl">
        Ruling
      </label>
      <textarea
        id={textId}
        className="cfg-rule-field"
        rows={4}
        value={text}
        maxLength={LOREKEEPER_LIMITS.rulingText}
        onChange={(event) => setText(event.target.value)}
      />
      <span className="cfg-muted cfg-rule-count">
        {text.length} / {LOREKEEPER_LIMITS.rulingText}
      </span>
      <p aria-live="polite" className="cfg-muted cfg-rules-err">
        {error}
      </p>
      <div className="cfg-rule-acts">
        <button type="button" className={glassButtonClass({ role: "cancel", size: "sm" })} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={glassButtonClass({ role: "confirm", size: "sm" })} disabled={!valid || busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
