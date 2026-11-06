"use client";

import "./threads.css";

import { useQuery } from "convex/react";
import { NotebookPen } from "lucide-react";

import { BrandButton } from "@/components/brand/buttons";
import { EntryText } from "@/components/notes/mentions";
import { glyphFor } from "@/lib/domain/notes";

import { api } from "../../../../convex/_generated/api";
import type { RaisedThread } from "../../../../convex/journalThreads";
import type { ThreadsRaisedProps } from "../slots";
import { Card } from "../ui";

/**
 * Threads raised (JTh, contract: ../slots.ts; design reference/designs/journal/journal_views.jpg, Log & recap, right
 * column). User Q2: the caller's own open threads (open tasks and unresolved Fears) on their Notes pages linked to the
 * session, from `journalThreads.raised` (per viewer, so a player sees their own pages only). Each row: the bullet glyph
 * (read only here; the bullet cycles in Notes), the text with its @mentions (EntryText), and 'In Notes', which opens the
 * page in the Notes sub-tab (`onOpenPage` -> `?tab=notes&page=<pageId>`).
 */

export const THREADS_RAISED_COPY = {
  heading: "Threads raised",
  loading: "Loading threads…",
  empty: "No threads raised on this session's pages.",
  open: "In Notes",
} as const;

/** What the bullet means, for screen readers (the glyph itself is decorative). */
export function threadKindLabel(row: Pick<RaisedThread, "kind">): string {
  return row.kind === "fear" ? "Looming Fear" : "Open task";
}

function ThreadRow({ campaignId, row, onOpen }: { campaignId: ThreadsRaisedProps["campaignId"]; row: RaisedThread; onOpen: () => void }) {
  return (
    <li className="jrth-row" data-kind={row.kind}>
      <span className="jrth-bul" aria-hidden="true">
        {glyphFor(row)}
      </span>
      <span className="jrth-text">
        <span className="sr-only">{threadKindLabel(row)}: </span>
        <EntryText campaignId={campaignId} text={row.text} />
      </span>
      <BrandButton
        variant="neutral"
        size="sm"
        className="flex-none"
        title={`Open “${row.pageTitle}” in Notes`}
        aria-label={`${THREADS_RAISED_COPY.open}: ${row.pageTitle}`}
        onClick={onOpen}
      >
        <NotebookPen aria-hidden="true" />
        {THREADS_RAISED_COPY.open}
      </BrandButton>
    </li>
  );
}

/** Log & recap, right: the open threads on the caller's Notes pages linked to this session. */
export function ThreadsRaised({ campaignId, sessionId, onOpenPage }: ThreadsRaisedProps) {
  const threads = useQuery(api.journalThreads.raised, { campaignId, sessionId });
  return (
    <Card heading={THREADS_RAISED_COPY.heading} kind="label" className="jrth">
      {threads === undefined ? (
        <p role="status" className="jr-muted jr-m0">
          {THREADS_RAISED_COPY.loading}
        </p>
      ) : threads.length === 0 ? (
        <p className="jr-muted jr-m0">{THREADS_RAISED_COPY.empty}</p>
      ) : (
        <ul className="jrth-list">
          {threads.map((row) => (
            <ThreadRow key={row.entryId} campaignId={campaignId} row={row} onOpen={() => onOpenPage(row.pageId)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

