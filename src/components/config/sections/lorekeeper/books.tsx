"use client";

import "./books/books.css";

import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, useQuery } from "convex/react";
import { Upload } from "lucide-react";
import { useState, type ReactNode } from "react";

import { codeText } from "@/components/admin/lorekeeper/text";
import { BrandButton } from "@/components/brand/buttons";
import { glassButtonClass } from "@/components/brand/glass-button";
import { setEnabledLocally } from "@/components/lorekeeper/side/optimistic";
import { SlotBoundary } from "@/components/party/session/boundary";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { CampaignBookRow } from "../../../../../convex/campaignBooks";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { SettingsSectionProps } from "../../slots";
import { BOOKS_TEXT, pagesHint } from "./books/text";
import { UploadForm } from "./books/upload-form";

/** `campaignBooks.remove`: the book leaves this list and the campaign's library at once. */
export function removeBookLocally(store: OptimisticLocalStore, args: { campaignId: Id<"campaigns">; bookId: Id<"lorekeeperBooks"> }): void {
  const own = store.getQuery(api.campaignBooks.list, { campaignId: args.campaignId });
  if (own !== undefined) {
    store.setQuery(api.campaignBooks.list, { campaignId: args.campaignId }, { ...own, books: own.books.filter((b) => b.bookId !== args.bookId) });
  }
  const library = store.getQuery(api.lorekeeperLibrary.list, { campaignId: args.campaignId });
  if (library !== undefined) {
    const books = library.books.filter((b) => b.bookId !== args.bookId);
    store.setQuery(api.lorekeeperLibrary.list, { campaignId: args.campaignId }, { books, indexedCount: books.filter((b) => b.enabled).length });
  }
}

/**
 * The GM's own campaign books (config AU8; Q24 b, N6 b, N7 a, N8 a; server LB1's `campaignBooks`), under 'Sources it
 * may search'. Each book is the board's 'Your Witherwild notes · Uploaded by you' row: its title, '<pages> pages · This
 * campaign only' and the Indexed / Off pill with its switch (`lorekeeperLibrary.setEnabled`, the same optimistic
 * update as the shared books), 'Reading the book…' while the server reads it, or 'Couldn't be read'. Remove asks first
 * (glass danger) and is optimistic. Then the count (no book limit, N6 b), 'Upload a book' (`UploadForm`) and the
 * uploads whose PDF could not be read since the last upload. Its own error boundary (rule 11).
 */
export function LorekeeperCampaignBooks(props: SettingsSectionProps): ReactNode {
  return (
    <SlotBoundary
      fallback={
        <p role="alert" className="cfg-muted">
          Your books failed to load.
        </p>
      }
    >
      <Books campaignId={props.campaign._id} />
    </SlotBoundary>
  );
}

function Books({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const own = useQuery(api.campaignBooks.list, { campaignId });
  const library = useQuery(api.lorekeeperLibrary.list, { campaignId });
  const setEnabled = useMutation(api.lorekeeperLibrary.setEnabled).withOptimisticUpdate(setEnabledLocally);
  const remove = useMutation(api.campaignBooks.remove).withOptimisticUpdate(removeBookLocally);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While it loads, the shared list above already shows the section's 'Loading …' line.
  if (own === undefined) return null;

  const run = (write: Promise<unknown>) => {
    setError(null);
    write.catch((e: unknown) => setError(errorMessage(e)));
  };
  const enabledOf = (bookId: Id<"lorekeeperBooks">) => library?.books.find((b) => b.bookId === bookId)?.enabled;

  return (
    <div data-testid="settings-lorekeeper-books">
      {own.books.map((book) => (
        <BookRow
          key={book.bookId}
          book={book}
          enabled={enabledOf(book.bookId)}
          onToggle={(enabled) => run(setEnabled({ campaignId, bookId: book.bookId, enabled }))}
          onRemove={() => run(remove({ campaignId, bookId: book.bookId }))}
        />
      ))}
      {own.failures.map((failure) => (
        <div key={`${failure.title}-${failure.finishedAt}`} className="cfg-row">
          <div className="cfg-row-t">
            <b>{BOOKS_TEXT.lastFailed(failure.title)}</b>
            <span className="cfg-bk-bad">{codeText(failure.code)}</span>
          </div>
        </div>
      ))}
      {uploading ? (
        <UploadForm campaignId={campaignId} onDone={() => setUploading(false)} />
      ) : (
        <div className="cfg-row">
          <div className="cfg-row-t">
            <b>{BOOKS_TEXT.upload}</b>
            <span>{BOOKS_TEXT.uploadHint}</span>
            <span>{BOOKS_TEXT.count(own.books.length)}</span>
          </div>
          <BrandButton variant="neutral" size="sm" onClick={() => setUploading(true)}>
            <Upload size={16} aria-hidden="true" />
            {BOOKS_TEXT.upload}
          </BrandButton>
        </div>
      )}
      {error ? (
        <p role="alert" className="cfg-bk-err">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function BookRow({
  book,
  enabled,
  onToggle,
  onRemove,
}: {
  book: CampaignBookRow;
  /** The library switch; undefined while the library loads. */
  enabled: boolean | undefined;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const reading = book.status === "reading";

  if (confirming) {
    return (
      <div className="cfg-row cfg-bk-confirm" role="group" aria-label={BOOKS_TEXT.removeQuestion(book.title)}>
        <span className="cfg-bk-q">{BOOKS_TEXT.removeQuestion(book.title)}</span>
        <button
          type="button"
          className={glassButtonClass({ role: "danger", size: "sm", wrap: true })}
          onClick={() => {
            setConfirming(false);
            onRemove();
          }}
        >
          {BOOKS_TEXT.remove}
        </button>
        <button type="button" className={glassButtonClass({ role: "cancel", size: "sm", wrap: true })} onClick={() => setConfirming(false)}>
          {BOOKS_TEXT.cancel}
        </button>
      </div>
    );
  }

  return (
    <div className="cfg-row" data-status={book.status}>
      <div className="cfg-row-t">
        <b>{book.title}</b>
        <span>{book.status === "ready" ? `${BOOKS_TEXT.uploadedByYou} · ${pagesHint(book.pages)}` : BOOKS_TEXT.uploadedByYou}</span>
        {reading ? (
          <span role="status" className="cfg-lk-pill cfg-bk-reading">
            {BOOKS_TEXT.reading}
          </span>
        ) : book.status === "failed" ? (
          <span className="cfg-bk-bad">
            {BOOKS_TEXT.failed} · {BOOKS_TEXT.failedHint}
          </span>
        ) : enabled !== undefined ? (
          <span className="cfg-lk-pill" data-on={enabled}>
            {enabled ? BOOKS_TEXT.indexed : BOOKS_TEXT.off}
          </span>
        ) : null}
      </div>
      {book.status === "ready" && enabled !== undefined ? (
        <button type="button" role="switch" aria-checked={enabled} aria-label={book.title} className="cfg-sw" onClick={() => onToggle(!enabled)}>
          <i />
        </button>
      ) : null}
      <button
        type="button"
        className={glassButtonClass({ role: "danger", size: "sm", wrap: true })}
        aria-label={`${BOOKS_TEXT.remove}: ${book.title}`}
        disabled={reading}
        onClick={() => setConfirming(true)}
      >
        {BOOKS_TEXT.remove}
      </button>
    </div>
  );
}
