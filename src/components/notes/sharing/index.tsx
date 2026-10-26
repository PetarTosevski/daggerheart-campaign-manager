"use client";

import "./sharing.css";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";

import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import { allowedVisibilities, visibilityLabel, type Visibility } from "@/lib/domain/notes";
import { addRecipientLocally, removeRecipientLocally, setVisibilityLocally } from "@/lib/optimistic/notes-sharing";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { PageRef } from "../../../../convex/lib/validators/notes";
import type { RecipientRow } from "../../../../convex/notesSharing";
import { pageRef, selectedPage, useJournal } from "../page/use-journal";
import type { NotesSlotProps } from "../slots";

/** What a player's option means, under its label in the dialog (A3, A4, D4). */
const PLAYER_HINT: Record<Visibility, string> = {
  gm: "Only you and the GM.",
  private: "Only you. Stays private even if your character leaves the story.",
  players: "The other players. The GM can't read it.",
  everyone: "The GM and every player.",
  chosen: "Only the people you tick below. The GM reads it only if ticked.",
};

/** What a GM's option means (A4, A5). */
const GM_HINT: Partial<Record<Visibility, string>> = {
  private: "Only you.",
  everyone: "Every player, under 'Shared by GM'.",
  chosen: "Only the players you tick below.",
};

/** The chip's text (Q14): the visibility's label; a chosen page names its readers. */
export function chipText(visibility: Visibility, isGm: boolean, recipients: readonly RecipientRow[] | undefined): string {
  const label = visibilityLabel(visibility, isGm);
  if (visibility !== "chosen" || recipients === undefined) return label;
  const names = recipients.filter((r) => r.chosen).map((r) => r.name);
  return `${label} · ${names.length > 0 ? names.join(", ") : "nobody yet"}`;
}

/**
 * The sharing chip in the page toolbar (Q14): who can read the page, alone enough to tell (a chosen page names its
 * readers). It opens the sharing dialog (A3-A5, Q4). Only on the caller's own pages; the server refuses anyone else.
 */
export function SharingChip({ campaignId, pageId, access }: NotesSlotProps) {
  const view = useJournal(campaignId);
  const page = view === undefined ? null : selectedPage(view, pageId);
  const [open, setOpen] = useState(false);
  const ref = page === null ? null : pageRef(page);
  const chosen = page?.visibility === "chosen";
  const recipients = useQuery(api.notesSharing.recipients, ref !== null && (chosen || open) ? { campaignId, page: ref } : "skip");
  if (page === null || ref === null) return null;
  const text = chipText(page.visibility, access.isGm, recipients);
  return (
    <>
      <button
        type="button"
        className="bj-chip bj-share-chip"
        aria-haspopup="dialog"
        aria-label={`Sharing: ${text}`}
        title="Who can read this page"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">{page.visibility === "private" ? "🔒" : "👁"}</span>
        <span className="bj-share-chip-text">{text}</span>
      </button>
      <SharingDialog
        open={open}
        onClose={() => setOpen(false)}
        campaignId={campaignId}
        page={ref}
        visibility={page.visibility}
        isGm={access.isGm}
        recipients={recipients}
      />
    </>
  );
}

/**
 * The sharing dialog (native <dialog>): the owner's allowed options as radios and, for 'Chosen players', one checkbox
 * per eligible member. Every click is one intent with an optimistic update (src/lib/optimistic/notes-sharing.ts).
 */
function SharingDialog({
  open,
  onClose,
  campaignId,
  page,
  visibility,
  isGm,
  recipients,
}: {
  open: boolean;
  onClose: () => void;
  campaignId: Id<"campaigns">;
  page: PageRef;
  visibility: Visibility;
  isGm: boolean;
  recipients: RecipientRow[] | undefined;
}) {
  const setVisibility = useMutation(api.notesSharing.setVisibility).withOptimisticUpdate(setVisibilityLocally);
  const addRecipient = useMutation(api.notesSharing.addRecipient).withOptimisticUpdate(addRecipientLocally);
  const removeRecipient = useMutation(api.notesSharing.removeRecipient).withOptimisticUpdate(removeRecipientLocally);
  const [error, setError] = useState<string | null>(null);
  const name = useId();

  function run(promise: Promise<unknown>) {
    setError(null);
    promise.catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <Modal open={open} onClose={onClose} title="Share this page" className="bj-share-dialog">
      <fieldset className="bj-share-set">
        <legend className="bj-lbl">Who can read this page</legend>
        {allowedVisibilities(isGm).map((value) => (
          <label key={value} className="bj-share-option" data-checked={value === visibility}>
            <input
              type="radio"
              name={name}
              value={value}
              checked={value === visibility}
              onChange={() => run(setVisibility({ campaignId, page, visibility: value }))}
            />
            <span>
              <span className="bj-share-label">{visibilityLabel(value, isGm)}</span>
              <span className="bj-share-hint">{(isGm ? GM_HINT[value] : undefined) ?? PLAYER_HINT[value]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {visibility === "chosen" ? (
        <fieldset className="bj-share-set">
          <legend className="bj-lbl">Chosen players</legend>
          {recipients === undefined ? (
            <p role="status" className="bj-muted">
              Loading the players…
            </p>
          ) : recipients.length === 0 ? (
            <p className="bj-muted">Nobody else is in this campaign yet.</p>
          ) : (
            recipients.map((r) => (
              <label key={r.userId} className="bj-share-option bj-share-person">
                <input
                  type="checkbox"
                  checked={r.chosen}
                  onChange={(event) =>
                    run(
                      event.target.checked
                        ? addRecipient({ campaignId, page, userId: r.userId })
                        : removeRecipient({ campaignId, page, userId: r.userId }),
                    )
                  }
                />
                <span className="bj-share-label">{r.name}</span>
              </label>
            ))
          )}
        </fieldset>
      ) : null}
      {error ? (
        <p role="alert" className="bj-share-error">
          {error}
        </p>
      ) : null}
      <div className="bj-share-foot">
        <button type="button" className="bj-ghost" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
