"use client";

import { useQuery } from "convex/react";

import { Modal } from "@/components/brand/modal";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ChatBoundary } from "../chat/boundary";

export type BookPage = { bookId: Id<"lorekeeperBooks">; page: number; title: string };

/**
 * 'Open in the book' (Q5): the indexed text of the quoted page (`lorekeeperLibrary.pageText`) in a dialog, as plain
 * text. A book switched off meanwhile shows the server's 'That book isn't in this campaign's library.'.
 */
export function BookDialog({ campaignId, page, onClose }: { campaignId: Id<"campaigns">; page: BookPage | null; onClose: () => void }) {
  return (
    <Modal open={page !== null} onClose={onClose} title={page ? `${page.title} · p.${page.page}` : "The book"} className="lk-dialog">
      {page ? (
        <ChatBoundary key={`${page.bookId}:${page.page}`} label="The book page" action={{ label: "Close", run: onClose }}>
          <PageText campaignId={campaignId} page={page} />
        </ChatBoundary>
      ) : null}
    </Modal>
  );
}

function PageText({ campaignId, page }: { campaignId: Id<"campaigns">; page: BookPage }) {
  const text = useQuery(api.lorekeeperLibrary.pageText, { campaignId, bookId: page.bookId, page: page.page });
  if (text === undefined) {
    return (
      <p role="status" className="lk-muted">
        Loading…
      </p>
    );
  }
  return (
    <div className="lk-pagetext">
      {text.sections.map((section, index) => (
        <section key={`${index}:${section.section}`} aria-label={section.section}>
          <h3 className="lk-lbl">{section.section}</h3>
          <p>{section.text}</p>
        </section>
      ))}
    </div>
  );
}
