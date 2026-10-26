"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useRef, useState } from "react";

import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import { CONVERSATIONS_LABEL, NEW_CONVERSATION_LABEL } from "@/lib/lorekeeper/copy";
import { removeConversationLocally } from "@/lib/optimistic/lorekeeper";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ConversationView } from "../../../../convex/lorekeeper";
import { resolveSelection, useSelection } from "../chat/selection";
import type { LorekeeperChatProps } from "../slots";
import { askerNames } from "./names";

/**
 * The 'Conversations' menu in the chat header (D13 L6): 'New conversation', the caller's own conversations (newest
 * first, each with Delete behind a confirm dialog, Q10) and the other members' public ones (Q3, read only, named from
 * the roster). Picking one shows it in the chat (shared selection, ../chat/selection.ts).
 */
export function ConversationsMenuView({ campaignId }: LorekeeperChatProps) {
  const lists = useQuery(api.lorekeeper.listConversations, { campaignId });
  const roster = useQuery(api.members.roster, { campaignId });
  const [selection, select] = useSelection(campaignId);
  const current = resolveSelection(selection, lists?.mine);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<ConversationView | null>(null);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  // Close on Escape or a click outside (no state is copied; this only listens while open).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const names = askerNames(roster);
  const pick = (id: Id<"lorekeeperConversations"> | "new") => {
    select(id);
    setOpen(false);
    toggle.current?.focus();
  };

  return (
    <div className="lk-convos" ref={root}>
      <button
        ref={toggle}
        type="button"
        className="lk-act lk-act-dark lk-convos-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        {CONVERSATIONS_LABEL}
        <span aria-hidden="true"> ▾</span>
      </button>
      <div id={panelId} className="lk-convos-panel" hidden={!open}>
        <button type="button" className="lk-convos-new" onClick={() => pick("new")}>
          ＋ {NEW_CONVERSATION_LABEL}
        </button>
        {lists === undefined ? (
          <p role="status" className="lk-muted">
            Loading…
          </p>
        ) : (
          <>
            <ConversationList
              label="Your conversations"
              rows={lists.mine}
              current={current}
              onPick={pick}
              onDelete={(row) => {
                setOpen(false);
                setDeleting(row);
              }}
              empty="No conversations yet."
            />
            {lists.shared.length > 0 ? (
              <ConversationList label="Shared in the campaign" rows={lists.shared} current={current} onPick={pick} names={names} />
            ) : null}
          </>
        )}
      </div>
      {deleting ? (
        <DeleteDialog
          campaignId={campaignId}
          conversation={deleting}
          onDone={(removed) => {
            if (removed && current === deleting._id) select(undefined);
            setDeleting(null);
            toggle.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

function ConversationList({
  label,
  rows,
  current,
  onPick,
  onDelete,
  names,
  empty,
}: {
  label: string;
  rows: ConversationView[];
  current: Id<"lorekeeperConversations"> | "new" | undefined;
  onPick: (id: Id<"lorekeeperConversations">) => void;
  onDelete?: (row: ConversationView) => void;
  names?: ReadonlyMap<string, string>;
  empty?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="lk-convos-group">
      <h2 id={headingId} className="lk-lbl">
        {label}
      </h2>
      {rows.length === 0 ? (
        <p className="lk-muted">{empty}</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row._id} className="lk-convos-row">
              <button type="button" className="lk-convos-pick" aria-current={row._id === current ? "true" : undefined} onClick={() => onPick(row._id)}>
                <span className="lk-convos-title">{row.title}</span>
                <span className="lk-convos-meta">
                  {names ? `Asked by ${names.get(row.userId) ?? "a player"}` : row.visibility === "private" ? "🔒 Private" : "Shared with the campaign"}
                </span>
              </button>
              {onDelete ? (
                <button type="button" className="lk-convos-del" aria-label={`Delete “${row.title}”`} onClick={() => onDelete(row)}>
                  <span aria-hidden="true">🗑</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Confirms deleting one of the caller's own conversations (Q10). */
function DeleteDialog({
  campaignId,
  conversation,
  onDone,
}: {
  campaignId: Id<"campaigns">;
  conversation: ConversationView;
  onDone: (removed: boolean) => void;
}) {
  const remove = useMutation(api.lorekeeper.removeConversation).withOptimisticUpdate((store, args) => removeConversationLocally(store, args));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open onClose={() => onDone(false)} title="Delete this conversation?" className="lk-dialog">
      <p className="lk-dialog-text">“{conversation.title}” and all its answers are deleted for everyone. This can’t be undone.</p>
      {error ? (
        <p role="alert" className="lk-alert">
          {error}
        </p>
      ) : null}
      <div className="lk-formacts">
        <button type="button" className="lk-act lk-act-dark" onClick={() => onDone(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="lk-send lk-danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await remove({ campaignId, conversationId: conversation._id });
              onDone(true);
            } catch (caught) {
              setError(errorMessage(caught));
              setBusy(false);
            }
          }}
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}
