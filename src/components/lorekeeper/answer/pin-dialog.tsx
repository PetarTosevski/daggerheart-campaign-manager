"use client";

import { useMutation } from "convex/react";
import { useId, useState } from "react";

import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { LOREKEEPER_LIMITS } from "../../../../convex/lib/validators/lorekeeper";
import { ACTION_LABELS } from "@/lib/lorekeeper/copy";

/**
 * 'Pin as table ruling' (Q14, GM only): a dialog prefilled from the question (title) and the GM call or prose
 * (text); Pin calls `lorekeeperRulings.pin` with the answer as `fromMessageId`. Mounted only while open, so the
 * fields start from the draft each time.
 */
export function PinDialog({
  campaignId,
  answerId,
  draft,
  onClose,
}: {
  campaignId: Id<"campaigns">;
  answerId: Id<"lorekeeperMessages">;
  draft: { title: string; text: string };
  onClose: () => void;
}) {
  const pin = useMutation(api.lorekeeperRulings.pin);
  const [title, setTitle] = useState(draft.title);
  const [text, setText] = useState(draft.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const textId = useId();
  const valid = title.trim().length > 0 && text.trim().length > 0;

  return (
    <Modal open onClose={onClose} title={ACTION_LABELS.pinRuling} className="lk-dialog">
      <form
        className="lk-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          setError(null);
          try {
            await pin({ campaignId, title: title.trim(), text: text.trim(), fromMessageId: answerId });
            onClose();
          } catch (caught) {
            setError(errorMessage(caught));
            setBusy(false);
          }
        }}
      >
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
            Pin ruling
          </button>
        </div>
      </form>
    </Modal>
  );
}
