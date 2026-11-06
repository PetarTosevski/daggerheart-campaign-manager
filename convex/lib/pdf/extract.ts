"use node";

import { extractText, getDocumentProxy } from "unpdf";

/**
 * Reads a PDF's text page by page with `unpdf` (Mozilla's PDF.js, serverless build; user answer N8 a). Node runtime
 * only: imported by the "use node" action `convex/pdfIngest.ts`.
 *
 * The page count is checked before any text is read, so an oversized book costs one parse of its page tree.
 */

export type PdfPages =
  | { kind: "ok"; pages: string[] }
  | { kind: "tooManyPages"; numPages: number }
  /** PDF.js could not open or read it: damaged, encrypted with a password, or not a PDF after all. */
  | { kind: "unreadable" };

export async function readPdfPages(bytes: Uint8Array, maxPages: number): Promise<PdfPages> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // PDF.js may detach the buffer it is given, so it gets a copy.
    pdf = await getDocumentProxy(new Uint8Array(bytes), { stopAtErrors: true });
  } catch {
    return { kind: "unreadable" };
  }
  try {
    if (pdf.numPages > maxPages) return { kind: "tooManyPages", numPages: pdf.numPages };
    const { text } = await extractText(pdf, { mergePages: false });
    return { kind: "ok", pages: text };
  } catch {
    return { kind: "unreadable" };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
