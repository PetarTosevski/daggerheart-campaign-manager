import { useConvex } from "convex/react";
import { useState } from "react";
import { Pressable, Share, Text } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import type { ExportPage } from "../../../../../src/lib/domain/notes";
import { api } from "../../convex";
import { fetchAllChunks, journalFileName, journalMarkdown } from "./export-download";
import type { NotesSlotProps } from "./slots";
import { notesStyles } from "./styles";
import { useJournal } from "./use-journal";

export function DownloadJournalButton({ campaignId }: NotesSlotProps) {
  const convex = useConvex();
  const view = useJournal();
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
                (t): ExportPage => ({
                  id: `template-${t.template}`,
                  kind: t.kind,
                  title: t.title,
                  createdAt: Date.now(),
                  session: t.session ?? null,
                }),
              ),
              entries: [],
            }
          : await fetchAllChunks((cursor) => convex.query(api.notesThreads.exportPage, { campaignId, cursor }));
      const text = journalMarkdown(view.whoName, pages, entries);
      const name = journalFileName(view.whoName);
      await Share.share({ message: text, title: name });
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy }}
        disabled={view === undefined || busy}
        onPress={() => void download()}
      >
        <Text style={notesStyles.chip}>{busy ? "Preparing…" : "Download my journal"}</Text>
      </Pressable>
      {error !== null ? (
        <Text accessibilityRole="alert" style={notesStyles.error}>
          {error}
        </Text>
      ) : null}
    </>
  );
}
