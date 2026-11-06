"use client";

import { useMutation, useQuery } from "convex/react";
import { Upload } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import { PDF_CONTENT_TYPE, PDF_MAX_FIRST_PAGE } from "../../../../convex/lib/pdf/config";
import { bookHint, codeText, LIBRARY, wholeNumber } from "./text";
import { fileProblem, uploadWithProgress } from "./upload";

/** Longest title (convex/adminLibrary.ts TITLE_MAX). */
export const TITLE_MAX = 120;

/** Which form is open: a replacement of one book, or a new book. */
type Open = { kind: "replace"; bookKey: string; title: string } | { kind: "new" } | null;

/**
 * Book library (AD8's `adminLibrary`; Q23 b, N6 b, N8 a): the shared books with their pages and each one's last upload
 * status (running / failed), Replace per book and 'Upload a book' for a key that has no book yet. The form takes the
 * PDF, an optional title and the printed page number of the PDF's first page; the file goes to an owner-only,
 * rate-limited upload URL with a progress bar, then `ingest` starts the server's read and the row shows its status.
 */
export function LibraryCard() {
  const library = useQuery(api.adminLibrary.list, {});
  const [open, setOpen] = useState<Open>(null);

  return (
    <section className="adm-card" aria-labelledby="admk-lib-h">
      <div className="adm-card-h">
        <h3 id="admk-lib-h">{LIBRARY.title}</h3>
        <p>{LIBRARY.hint}</p>
      </div>
      {library === undefined ? (
        <p role="status" className="adm-muted admk-pad">
          Loading …
        </p>
      ) : (
        <>
          {library.books.map((book) => (
            <div key={book.bookId} className="admk-book">
              <div className="adm-row">
                <div className="adm-row-t">
                  <b>{book.title}</b>
                  <span>{bookHint(book)}</span>
                  <IngestLine bookKey={book.key} />
                </div>
                <BrandButton
                  variant="neutral"
                  size="sm"
                  aria-label={`${LIBRARY.replace}: ${book.title}`}
                  aria-expanded={open?.kind === "replace" && open.bookKey === book.key}
                  onClick={() => setOpen({ kind: "replace", bookKey: book.key, title: book.title })}
                >
                  {LIBRARY.replace}
                </BrandButton>
              </div>
              {open?.kind === "replace" && open.bookKey === book.key ? (
                <UploadForm keys={[{ key: book.key, title: book.title }]} replacing={book.title} onDone={() => setOpen(null)} />
              ) : null}
            </div>
          ))}
          {open?.kind === "new" ? (
            <UploadForm keys={library.available} onDone={() => setOpen(null)} />
          ) : (
            <div className="admk-add">
              <BrandButton variant="neutral" className="admk-addb" disabled={library.available.length === 0} onClick={() => setOpen({ kind: "new" })}>
                <Upload aria-hidden="true" />
                {LIBRARY.upload}
              </BrandButton>
              <span className="adm-muted">{library.available.length === 0 ? LIBRARY.allUploaded : LIBRARY.uploadHint}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The book's last upload while it runs or after it failed (done: the row's pages already say it). */
function IngestLine({ bookKey }: { bookKey: string }) {
  const status = useQuery(api.adminLibrary.ingestStatus, { bookKey });
  if (!status) return null;
  if (status.status === "running") {
    return (
      <span role="status" className="admk-ingest">
        {LIBRARY.reading}
      </span>
    );
  }
  if (status.status === "failed" && status.result && !status.result.ok) {
    return (
      <span role="alert" className="admk-ingest admk-ingest-bad">
        Last upload failed: {codeText(status.result.code)}
      </span>
    );
  }
  return null;
}

type Phase = { step: "idle" } | { step: "uploading"; share: number } | { step: "starting" };

function UploadForm({ keys, replacing, onDone }: { keys: readonly { key: string; title: string }[]; replacing?: string; onDone: () => void }) {
  const getUrl = useMutation(api.adminLibrary.uploadUrl);
  const ingest = useMutation(api.adminLibrary.ingest);
  const [bookKey, setBookKey] = useState(keys[0]?.key ?? "");
  const [title, setTitle] = useState("");
  const [firstPage, setFirstPage] = useState("1");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const ids = { key: useId(), title: useId(), page: useId(), file: useId(), hint: useId() };
  const busy = phase.step !== "idle";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const page = wholeNumber(firstPage, PDF_MAX_FIRST_PAGE);
    if (page === null) return setError(`The first page number is a whole number from 0 to ${PDF_MAX_FIRST_PAGE}.`);
    if (file === null) return setError("Choose a PDF file.");
    const problem = fileProblem(file);
    if (problem !== null) return setError(codeText(problem));
    try {
      setPhase({ step: "uploading", share: 0 });
      const url = await getUrl({});
      const storageId = await uploadWithProgress(url, file, (share) => setPhase({ step: "uploading", share }));
      setPhase({ step: "starting" });
      const result = await ingest({ storageId, bookKey, firstPrintedPage: page, ...(title.trim() ? { title: title.trim() } : {}) });
      if (!result.ok) {
        setPhase({ step: "idle" });
        setError(codeText(result.code));
        return;
      }
      onDone();
    } catch (e) {
      setPhase({ step: "idle" });
      setError(e instanceof Error && !("data" in e) ? e.message : errorMessage(e));
    }
  }

  const label = replacing ? `${LIBRARY.replace}: ${replacing}` : LIBRARY.upload;
  return (
    <form className="admk-up" aria-label={label} onSubmit={submit}>
      {replacing ? null : (
        <div className="admk-field">
          <label htmlFor={ids.key}>{LIBRARY.book}</label>
          <select id={ids.key} className="admk-inp" value={bookKey} disabled={busy} onChange={(e) => setBookKey(e.target.value)}>
            {keys.map((k) => (
              <option key={k.key} value={k.key}>
                {k.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="admk-field">
        <label htmlFor={ids.title}>{LIBRARY.bookTitle}</label>
        <input
          id={ids.title}
          className="admk-inp"
          value={title}
          maxLength={TITLE_MAX}
          placeholder={replacing ?? keys.find((k) => k.key === bookKey)?.title}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="admk-field">
        <label htmlFor={ids.page}>{LIBRARY.firstPage}</label>
        <input
          id={ids.page}
          className="admk-inp admk-inp-n"
          inputMode="numeric"
          value={firstPage}
          disabled={busy}
          onChange={(e) => setFirstPage(e.target.value)}
        />
      </div>
      <div className="admk-field">
        <label htmlFor={ids.file}>{LIBRARY.file}</label>
        <input
          id={ids.file}
          type="file"
          accept={`${PDF_CONTENT_TYPE},.pdf`}
          aria-describedby={ids.hint}
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <span id={ids.hint} className="adm-muted">
          {LIBRARY.uploadHint}
        </span>
      </div>
      {phase.step === "uploading" ? (
        <div className="admk-prog">
          <progress max={100} value={Math.round(phase.share * 100)} aria-label={LIBRARY.uploading} />
          <span role="status">
            {LIBRARY.uploading} {Math.round(phase.share * 100)} %
          </span>
        </div>
      ) : phase.step === "starting" ? (
        <p role="status" className="adm-muted">
          {LIBRARY.starting}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="admk-err">
          {error}
        </p>
      ) : null}
      <div className="admk-acts">
        <BrandButton type="button" variant="cancel" size="sm" disabled={busy} onClick={onDone}>
          {LIBRARY.cancel}
        </BrandButton>
        <BrandButton type="submit" variant="confirm" size="sm" disabled={busy || keys.length === 0}>
          {LIBRARY.send}
        </BrandButton>
      </div>
    </form>
  );
}
