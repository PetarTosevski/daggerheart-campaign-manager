"use client";

import { useRef, type CSSProperties } from "react";

import { authorSuffix, BULLETS, bulletTip, glyphFor, isDimmed, isStruck, matches, toPlainText } from "@/lib/domain/notes";
import { isPendingRow } from "@/lib/optimistic/notes-entries";

import type { Id } from "../../../../convex/_generated/dataModel";
import type { EntryRow as Row } from "../../../../convex/notesEntries";
import { EntryText, MentionInput } from "../mentions";

export type RowActions = {
  cycle: (entryId: Id<"journalEntries">) => void;
  toggleStar: (entryId: Id<"journalEntries">) => void;
  moveUp: (entryId: Id<"journalEntries">) => void;
  remove: (entryId: Id<"journalEntries">) => void;
  saveText: (entryId: Id<"journalEntries">, text: string) => void;
};

type Props = {
  campaignId: Id<"campaigns">;
  row: Row;
  first: boolean;
  search: string;
  editing: boolean;
  onEdit: (entryId: Id<"journalEntries"> | null) => void;
  actions: RowActions;
};

/**
 * One entry (board Notes.dc.html l.139-157; B4): the bullet (click cycles, tooltip and aria label from N1 bulletTip),
 * ★ when starred, the text through the mentions slot, an added entry in the added colour ending ' - <author>' (Q3),
 * and ★ / ✎ / ↑ / × shown only when the caller's flag allows (D5). Double-click or ✎ edits; Enter or blur saves,
 * Escape cancels.
 */
export function EntryRowView({ campaignId, row, first, search, editing, onEdit, actions }: Props) {
  const spec = BULLETS[row.kind];
  const tip = bulletTip(row);
  const pending = isPendingRow(row);
  // One save per edit: Enter saves and closes the input, and the blur that follows must not save again.
  const saved = useRef(false);
  const hit = search.trim() !== "" && matches(toPlainText(row.text), search);
  const struck = isStruck(row);
  const textStyle: CSSProperties = {
    ...(struck ? { textDecoration: "line-through", textDecorationThickness: "2px" } : {}),
    ...(isDimmed(row) ? { opacity: struck ? 0.55 : 0.6 } : {}),
    ...(spec.textColor && !row.added ? { color: spec.textColor } : {}),
  };
  const hasActions = row.canStar || row.canEdit || row.canMove || row.canDelete;

  function startEdit() {
    if (!row.canEdit) return;
    saved.current = false;
    onEdit(row._id);
  }

  function save(text: string) {
    if (saved.current) return;
    saved.current = true;
    onEdit(null);
    const next = text.trim();
    if (next && next !== row.text) actions.saveText(row._id, next);
  }

  return (
    <li className={`bj-row${hit ? " bj-hit" : ""}`} data-pending={pending || undefined}>
      <button
        type="button"
        className="bj-bul"
        title={tip}
        aria-label={tip}
        aria-disabled={!row.canCycle || undefined}
        style={{ color: spec.color, ...(spec.glow ? { textShadow: spec.glow } : {}) }}
        onClick={() => row.canCycle && actions.cycle(row._id)}
      >
        {glyphFor(row)}
      </button>
      {editing ? (
        <span className="bj-edit-wrap">
          <MentionInput
            campaignId={campaignId}
            label="Edit entry"
            placeholder=""
            className="bj-edit"
            defaultValue={row.text}
            autoFocus
            onSubmit={save}
            onBlurText={save}
            onCancel={() => {
              saved.current = true;
              onEdit(null);
            }}
          />
        </span>
      ) : (
        <span className={`bj-text${row.added ? " bj-added" : ""}`} style={textStyle} onDoubleClick={startEdit}>
          {row.star && (
            <span className="bj-star" role="img" aria-label="Priority">
              ★
            </span>
          )}
          <EntryText campaignId={campaignId} text={row.text} />
          {row.added && row.authorLabel !== "" && <span className="bj-author">{authorSuffix(row.authorLabel)}</span>}
        </span>
      )}
      {hasActions && !editing && (
        <span className="bj-act">
          {row.canStar && (
            <button type="button" className="bj-ib" title="Priority" aria-label="Toggle priority" aria-pressed={row.star} onClick={() => actions.toggleStar(row._id)}>
              ★
            </button>
          )}
          {row.canEdit && (
            <button type="button" className="bj-ib" title="Edit (or double-click the text)" aria-label="Edit entry" onClick={startEdit}>
              ✎
            </button>
          )}
          {row.canMove && (
            <button type="button" className="bj-ib" title="Move up" aria-label="Move up" disabled={first} onClick={() => actions.moveUp(row._id)}>
              ↑
            </button>
          )}
          {row.canDelete && (
            <button type="button" className="bj-ib" title="Delete" aria-label="Delete entry" onClick={() => actions.remove(row._id)}>
              ×
            </button>
          )}
        </span>
      )}
    </li>
  );
}
