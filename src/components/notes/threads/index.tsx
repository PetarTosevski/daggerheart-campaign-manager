"use client";

import "./threads.css";

import { useMutation, useQuery } from "convex/react";
import type { CSSProperties } from "react";

import { authorSuffix, BULLETS, bulletTip, glyphFor, isDimmed, isStruck, THREADS_COPY, threadPageLink, threadsButtonLabel } from "@/lib/domain/notes";
import { threadsCycleUpdate } from "@/lib/optimistic/notes-threads";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ThreadRow } from "../../../../convex/notesThreads";
import { EntryText } from "../mentions";
import type { NotesSlotProps } from "../slots";

/** The caller's open threads (`notesThreads.threads`); the button and the view share this one subscription. */
function useThreads(campaignId: Id<"campaigns">) {
  return useQuery(api.notesThreads.threads, { campaignId });
}

/**
 * Hero action '🧵 Open threads · N' (B1): toggles the threads view; pressed (accent fill) while it shows. N counts the
 * open tasks and unresolved Fears of the caller's own pages (Q13), '…' while loading.
 */
export function ThreadsButton({ campaignId, view, onView }: NotesSlotProps) {
  const threads = useThreads(campaignId);
  const on = view === "threads";
  return (
    <button type="button" className="bj-threads" aria-pressed={on} onClick={() => onView(on ? "page" : "threads")}>
      {threads === undefined ? "🧵 Open threads · …" : threadsButtonLabel(threads.length)}
    </button>
  );
}

/**
 * One thread (board l.116-118): the bullet (click cycles, B4), the text (no ★, as on the board), and '<page title> →'
 * opening the page.
 */
function ThreadRowView({ campaignId, row, onCycle, onOpen }: { campaignId: Id<"campaigns">; row: ThreadRow; onCycle: () => void; onOpen: () => void }) {
  const spec = BULLETS[row.kind];
  const tip = bulletTip(row);
  const struck = isStruck(row);
  const textStyle: CSSProperties = {
    ...(struck ? { textDecoration: "line-through", textDecorationThickness: "2px" } : {}),
    ...(isDimmed(row) ? { opacity: struck ? 0.55 : 0.6 } : {}),
    ...(spec.textColor && !row.added ? { color: spec.textColor } : {}),
  };
  return (
    <li className="bj-row">
      <button type="button" className="bj-bul" title={tip} aria-label={tip} style={{ color: spec.color, ...(spec.glow ? { textShadow: spec.glow } : {}) }} onClick={onCycle}>
        {glyphFor(row)}
      </button>
      <span className={`bj-text${row.added ? " bj-added" : ""}`} style={textStyle}>
        <EntryText campaignId={campaignId} text={row.text} />
        {row.added && row.authorLabel !== "" && <span className="bj-thread-author">{authorSuffix(row.authorLabel)}</span>}
      </span>
      <button type="button" className="bj-ghost bj-thread-page" title={`Open “${row.pageTitle}”`} onClick={onOpen}>
        {threadPageLink(row.pageTitle)}
      </button>
    </li>
  );
}

/**
 * The threads view (B5, board l.111-120): the violet 'Open threads' tape, the intro line, every open task and
 * unresolved Fear of the caller's own pages (added entries included, D5) with a link to its page, or 'Nothing
 * dangling. Suspicious…'. A bullet click cycles the entry (N3 `cycle`, optimistic): a completed one leaves the list.
 */
export function ThreadsView({ campaignId, onPage }: NotesSlotProps) {
  const threads = useThreads(campaignId);
  const cycle = useMutation(api.notesEntries.cycle).withOptimisticUpdate(threadsCycleUpdate);
  return (
    <article className="bj-paper" aria-label={THREADS_COPY.title}>
      <div className="bj-tape bj-tape-4">{THREADS_COPY.title}</div>
      <p className="bj-intro">{THREADS_COPY.intro}</p>
      {threads === undefined ? (
        <p role="status" className="bj-muted">
          Loading …
        </p>
      ) : threads.length === 0 ? (
        <p className="bj-line">{THREADS_COPY.empty}</p>
      ) : (
        <ul className="bj-thread-list">
          {threads.map((row) => (
            <ThreadRowView
              key={row._id}
              campaignId={campaignId}
              row={row}
              onCycle={() => void cycle({ campaignId, entryId: row._id })}
              onOpen={() => onPage(row.pageId, "page")}
            />
          ))}
        </ul>
      )}
    </article>
  );
}
