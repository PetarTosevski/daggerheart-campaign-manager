import { journalToMarkdown, type ExportEntry, type ExportPage } from "../../../../../src/lib/domain/notes";

export type ExportChunkLike = {
  pages: readonly ExportPage[];
  entries: readonly ExportEntry[];
  continueCursor: string | null;
};

const MAX_CHUNKS = 40;

export async function fetchAllChunks(fetchChunk: (cursor: string | null) => Promise<ExportChunkLike>) {
  const pages: ExportPage[] = [];
  const entries: ExportEntry[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const chunk = await fetchChunk(cursor);
    pages.push(...chunk.pages);
    entries.push(...chunk.entries);
    cursor = chunk.continueCursor;
    if (cursor === null) break;
  }
  return { pages, entries };
}

export function journalFileName(whoName: string): string {
  const safe = whoName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim();
  return `${safe || "My"} journal.md`;
}

export function journalMarkdown(whoName: string, pages: readonly ExportPage[], entries: readonly ExportEntry[]): string {
  return journalToMarkdown({ whoName, pages, entries });
}
