import { journalToMarkdown, type ExportEntry, type ExportPage } from "@/lib/domain/notes";

/**
 * 'Download my journal' (Q9) without React: fetch every chunk of the caller's own pages, build one Markdown document
 * with N1 `journalToMarkdown` and save it as a normal browser download. Kept apart from the button so the RTL test
 * drives it with fake chunks.
 */

/** One `notesThreads.exportPage` answer (structurally). */
export type ExportChunkLike = {
  pages: readonly ExportPage[];
  entries: readonly ExportEntry[];
  continueCursor: string | null;
};

/** At most this many chunks (EXPORT_PAGES pages each): 200 pages need 20; the rest guards against a cursor loop. */
const MAX_CHUNKS = 40;

/** Every chunk, following the cursor from null. */
export async function fetchAllChunks(fetchChunk: (cursor: string | null) => Promise<ExportChunkLike>) {
  const pages: ExportPage[] = [];
  const entries: ExportEntry[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const chunk: ExportChunkLike = await fetchChunk(cursor);
    pages.push(...chunk.pages);
    entries.push(...chunk.entries);
    cursor = chunk.continueCursor;
    if (cursor === null) break;
  }
  return { pages, entries };
}

/** '<whoName> journal.md', without the characters file systems refuse. */
export function journalFileName(whoName: string): string {
  const safe = whoName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim();
  return `${safe || "My"} journal.md`;
}

/** The Markdown file of the caller's journal. */
export function journalFile(whoName: string, pages: readonly ExportPage[], entries: readonly ExportEntry[]): { name: string; blob: Blob } {
  const text = journalToMarkdown({ whoName, pages, entries });
  return { name: journalFileName(whoName), blob: new Blob([text], { type: "text/markdown;charset=utf-8" }) };
}

/** Saves a blob as a download (a temporary object URL on a clicked `<a download>`), then frees the URL. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke once the browser has surely started reading the blob (some revoke-too-early races cancel the download).
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
