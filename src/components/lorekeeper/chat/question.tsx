"use client";

import { useState } from "react";

import { QUESTION_MAX, sendsOnKey } from "../composer/model";

type Props = {
  /** 'You', or the asker's name. */
  asker: string;
  text: string;
  /**
   * LK3: present on the caller's own question while it may be edited. Resolves false when the edit failed (edit mode
   * stays open with the draft). Saving is the only thing that asks again: nothing is sent while editing.
   */
  onEdit?: (question: string) => Promise<boolean>;
  /** Why Save waits right now (an answer on its way, a send, a cap), or null. */
  waiting: string | null;
};

/**
 * A question bubble. The asker's own question has an 'Edit' action (user 2026-10-29, like ChatGPT and Claude): the
 * text opens in place with Save / Cancel; Save replaces the question's answer and everything after it with a new
 * answer to the edited text (`lorekeeper.editQuestion`).
 */
export function QuestionBubble({ asker, text, onEdit, waiting }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editing = draft !== null;
  const trimmed = draft?.trim() ?? "";
  const canSave = editing && onEdit !== undefined && waiting === null && !saving && trimmed.length > 0 && trimmed.length <= QUESTION_MAX;

  const save = async () => {
    if (!canSave || !onEdit) return;
    // Unchanged text: nothing to ask again.
    if (trimmed === text.trim()) {
      setDraft(null);
      return;
    }
    setSaving(true);
    const ok = await onEdit(trimmed);
    setSaving(false);
    if (ok) setDraft(null);
  };

  if (editing) {
    return (
      <div className="lk-q lk-q-editing">
        <span className="lk-who">{asker}</span>
        <textarea
          className="lk-qedit"
          aria-label="Edit your question"
          maxLength={QUESTION_MAX}
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
              return;
            }
            if (!sendsOnKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return;
            event.preventDefault();
            void save();
          }}
        />
        {waiting !== null ? <p className="lk-qwait lk-muted">{waiting}</p> : null}
        <div className="lk-qactions">
          <button type="button" className="lk-act lk-act-dark" onClick={() => setDraft(null)}>
            Cancel
          </button>
          <button type="button" className="lk-act lk-qsave" disabled={!canSave} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lk-q">
      <span className="lk-who">{asker}</span>
      <div className="lk-qb">{text}</div>
      {onEdit ? (
        <button type="button" className="lk-act lk-act-dark lk-qeditbtn" aria-label="Edit question" onClick={() => setDraft(text)}>
          Edit
        </button>
      ) : null}
    </div>
  );
}
