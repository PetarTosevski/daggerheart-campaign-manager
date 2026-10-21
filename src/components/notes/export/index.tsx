"use client";

import { useConvex } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import type { ExportPage } from "@/lib/domain/notes";

import { api } from "../../../../convex/_generated/api";
import { useJournal } from "../page/use-journal";
import type { NotesSlotProps } from "../slots";
import { fetchAllChunks, journalFile, saveBlob } from "./download";

/**
 * Hero action 'Download my journal' (Q9): on click, reads the caller's own pages (not torn out) with their entries
 * chunk by chunk (`notesThreads.exportPage`), builds one Markdown file in the browser (N1 `journalToMarkdown`) and
 * saves it as '<whoName> journal.md'. Never another person's page: the server answers with the caller's journal only.
 * Before the first write the file holds the default pages (empty).
 */
export function DownloadJournalButton({ campaignId }: NotesSlotProps) {
  const convex = useConvex();
  const view = useJournal(campaignId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (view === undefined || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { pages, entries } =
        view.journal === null
          ? {
              pages: view.templates.map(
                (t): ExportPage => ({ id: `template-${t.template}`, kind: t.kind, title: t.title, createdAt: Date.now(), session: t.session ?? null }),
              ),
              entries: [],
            }
          : await fetchAllChunks((cursor) => convex.query(api.notesThreads.exportPage, { campaignId, cursor }));
      const file = journalFile(view.whoName, pages, entries);
      saveBlob(file.blob, file.name);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="bj-threads" disabled={view === undefined || busy} aria-busy={busy || undefined} onClick={() => void download()}>
        {busy ? "Preparing…" : "Download my journal"}
      </button>
      {error !== null && (
        <span role="alert" className="bj-alert">
          {error}
        </span>
      )}
    </>
  );
}
