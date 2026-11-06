"use client";

import { useMutation } from "convex/react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { codeText, wholeNumber } from "@/components/admin/lorekeeper/text";
import { fileProblem, uploadWithProgress } from "@/components/admin/lorekeeper/upload";
import { BrandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { PDF_CONTENT_TYPE, PDF_MAX_FIRST_PAGE } from "../../../../../../convex/lib/pdf/config";
import { BOOKS_TEXT, titleFromFile } from "./text";

/** convex/adminLibrary.ts TITLE_MAX (campaignBooks.add checks it again). */
export const TITLE_MAX = 120;

type Phase = { step: "idle" } | { step: "uploading"; share: number } | { step: "starting" };

/**
 * 'Upload a book' (config AU8, LB1's `campaignBooks`; N6 b, N7 a, N8 a): the title, the printed page number of the
 * PDF's first page and the file. A first look at the type and size here (AU3's `fileProblem`), then the file goes to
 * the GM-only, rate-limited `uploadUrl` with a progress bar (AU3's `uploadWithProgress`) and `add` starts the server's
 * read; the server checks everything again (rule 10). A refusal shows inline; on success the form closes and the book's
 * row says 'Reading the book…' from `list`.
 */
export function UploadForm({ campaignId, onDone }: { campaignId: Id<"campaigns">; onDone: () => void }): ReactNode {
  const getUrl = useMutation(api.campaignBooks.uploadUrl);
  const add = useMutation(api.campaignBooks.add);
  const [title, setTitle] = useState("");
  const [firstPage, setFirstPage] = useState("1");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const ids = { title: useId(), page: useId(), pageHint: useId(), file: useId(), hint: useId() };
  const busy = phase.step !== "idle";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const bookTitle = title.trim();
    if (bookTitle === "") return setError(BOOKS_TEXT.needTitle);
    const page = wholeNumber(firstPage, PDF_MAX_FIRST_PAGE);
    if (page === null) return setError(BOOKS_TEXT.badPage);
    if (file === null) return setError(BOOKS_TEXT.needFile);
    const problem = fileProblem(file);
    if (problem !== null) return setError(codeText(problem));
    try {
      setPhase({ step: "uploading", share: 0 });
      const url = await getUrl({ campaignId });
      const storageId = await uploadWithProgress(url, file, (share) => setPhase({ step: "uploading", share }));
      setPhase({ step: "starting" });
      const result = await add({ campaignId, storageId, title: bookTitle, firstPrintedPage: page });
      if (!result.ok) {
        setPhase({ step: "idle" });
        setError(codeText(result.code));
        return;
      }
      onDone();
    } catch (e) {
      setPhase({ step: "idle" });
      // The XHR's own errors carry a plain message; Convex errors carry a code.
      setError(e instanceof Error && !("data" in e) ? e.message : errorMessage(e));
    }
  }

  const share = phase.step === "uploading" ? Math.round(phase.share * 100) : 0;
  return (
    <form className="cfg-row cfg-col cfg-bk-form" aria-label={BOOKS_TEXT.upload} onSubmit={submit}>
      <div className="cfg-row-t">
        <b>{BOOKS_TEXT.upload}</b>
        <span id={ids.hint}>{BOOKS_TEXT.uploadHint}</span>
      </div>
      <label className="cfg-bk-field" htmlFor={ids.file}>
        {BOOKS_TEXT.file}
      </label>
      <input
        id={ids.file}
        type="file"
        accept={`${PDF_CONTENT_TYPE},.pdf`}
        aria-describedby={ids.hint}
        disabled={busy}
        onChange={(e) => {
          const chosen = e.target.files?.[0] ?? null;
          setFile(chosen);
          if (chosen && title.trim() === "") setTitle(titleFromFile(chosen.name).slice(0, TITLE_MAX));
        }}
      />
      <label className="cfg-bk-field" htmlFor={ids.title}>
        {BOOKS_TEXT.title}
      </label>
      <input id={ids.title} className="cfg-bk-inp" value={title} maxLength={TITLE_MAX} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
      <label className="cfg-bk-field" htmlFor={ids.page}>
        {BOOKS_TEXT.firstPage}
      </label>
      <input
        id={ids.page}
        className="cfg-bk-inp cfg-bk-inp-n"
        inputMode="numeric"
        value={firstPage}
        aria-describedby={ids.pageHint}
        disabled={busy}
        onChange={(e) => setFirstPage(e.target.value)}
      />
      <span id={ids.pageHint} className="cfg-muted cfg-bk-small">
        {BOOKS_TEXT.firstPageHint}
      </span>
      {phase.step === "uploading" ? (
        <div className="cfg-bk-prog">
          <progress max={100} value={share} aria-label={BOOKS_TEXT.uploading} />
          <span role="status">
            {BOOKS_TEXT.uploading} {share} %
          </span>
        </div>
      ) : phase.step === "starting" ? (
        <p role="status" className="cfg-muted">
          {BOOKS_TEXT.starting}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="cfg-bk-err">
          {error}
        </p>
      ) : null}
      <div className="cfg-bk-acts">
        <BrandButton type="button" variant="cancel" size="sm" disabled={busy} onClick={onDone}>
          {BOOKS_TEXT.cancel}
        </BrandButton>
        <BrandButton type="submit" variant="confirm" size="sm" disabled={busy}>
          {BOOKS_TEXT.send}
        </BrandButton>
      </div>
    </form>
  );
}
