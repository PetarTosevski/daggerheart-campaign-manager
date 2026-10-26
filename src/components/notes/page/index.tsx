"use client";

import "./page.css";

import { useMutation } from "convex/react";
import { useState, type KeyboardEvent } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { isValidTitle, normalizeTitle, NOTE_LIMITS, pageMeta } from "@/lib/domain/notes";
import { cycleTapeLocally, renamePageLocally } from "@/lib/optimistic/notes-pages";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { TearOutButton } from "../bin";
import { Entries, MigrateButton } from "../entries";
import { SharingChip } from "../sharing";
import type { NotesSlotProps } from "../slots";
import { SessionPicker } from "./session-picker";
import { pageParam, pageRef, selectedPage, useJournal, type OwnPage } from "./use-journal";

/**
 * The paper for one own page (B3): washi tape with the title, the title input (saved on Enter or blur, 1-80
 * characters), the meta '<kind> · <date>' (a linked session's date, live, D6), '🎀 Tape', a log page's 'Session' link
 * (Q5), the toolbar slots (`MigrateButton`, `SharingChip`, `TearOutButton`) and `Entries`. The slots get the page's
 * effective `?page=` value (the first page when the URL names none), so they never pick a default themselves.
 */
export function JournalPage(props: NotesSlotProps) {
  const view = useJournal(props.campaignId);
  if (view === undefined) {
    return (
      <article className="bj-paper" aria-label="Page">
        <p role="status" className="bj-line">
          Loading the page…
        </p>
      </article>
    );
  }
  const page = selectedPage(view, props.pageId);
  if (page === null) {
    return (
      <article className="bj-paper" aria-label="Page">
        <div className="bj-tape bj-tape-2">Missing page</div>
        <p className="bj-line">This page is not in your journal. Pick one in the index.</p>
      </article>
    );
  }
  return <PagePaper {...props} page={page} />;
}

function PagePaper({ page, ...props }: NotesSlotProps & { page: OwnPage }) {
  const { campaignId } = props;
  const ref = pageRef(page);
  const rename = useMutation(api.notes.renamePage).withOptimisticUpdate(renamePageLocally);
  const cycleTape = useMutation(api.notes.cycleTape).withOptimisticUpdate(cycleTapeLocally);
  const setSession = useMutation(api.notes.setSession);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // A default page before the first write has no creation date yet: it is created now.
  const [now] = useState(() => Date.now());

  function run(promise: Promise<unknown>) {
    setError(null);
    promise.catch((e: unknown) => setError(errorMessage(e)));
  }

  function commitTitle(text: string) {
    setDraft(null);
    if (!isValidTitle(text) || normalizeTitle(text) === page.title) return;
    run(rename({ campaignId, page: ref, title: text }));
  }

  function onTitleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      setDraft(page.title);
      event.currentTarget.value = page.title;
      event.currentTarget.blur();
    }
  }

  const slot: NotesSlotProps = { ...props, pageId: pageParam(page) };
  const createdAt = "createdAt" in page ? page.createdAt : now;

  return (
    <article className="bj-paper" aria-label="Page">
      <div className={`bj-tape bj-tape-${page.tape}`} data-testid="page-tape">
        {page.title}
      </div>
      <div className="bj-toolbar">
        <input
          type="text"
          className="bj-page-title"
          aria-label="Page title"
          maxLength={NOTE_LIMITS.TITLE_MAX}
          value={draft ?? page.title}
          onFocus={() => setDraft(page.title)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commitTitle(event.target.value)}
          onKeyDown={onTitleKey}
        />
        <span className="bj-page-meta">{pageMeta({ kind: page.kind, createdAt }, page.session ?? null)}</span>
        <button
          type="button"
          className="bj-ghost bj-paper-btn"
          title="Change the washi tape"
          onClick={() => run(cycleTape({ campaignId, page: ref }))}
        >
          🎀 Tape
        </button>
        {page.kind === "log" ? (
          <button type="button" className="bj-ghost bj-paper-btn" title="Link this page to a session" onClick={() => setPicking(true)}>
            🔗 Session
          </button>
        ) : null}
        <MigrateButton {...slot} />
        <SharingChip {...slot} />
        <TearOutButton {...slot} />
      </div>
      {error ? (
        <p role="alert" className="bj-page-error">
          {error}
        </p>
      ) : null}
      <Entries {...slot} />
      <SessionPicker
        campaignId={campaignId}
        open={picking}
        title="Link a session"
        confirmLabel="Link session"
        current={page.sessionId ?? null}
        onClose={() => setPicking(false)}
        onPick={async (sessionId: Id<"sessions"> | null) => {
          await setSession({ campaignId, page: ref, sessionId });
        }}
      />
    </article>
  );
}
