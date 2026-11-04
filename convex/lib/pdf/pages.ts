import { printedPageForBlock } from "../../../src/lib/lorekeeper/chunk";
import { PDF_MIN_PAGE_CHARS } from "./config";

/**
 * Pure helpers of the PDF ingest (PDF0): the magic-byte check, the page-text threshold and the page-tagged text the
 * Lorekeeper chunker (src/lib/lorekeeper/chunk.ts) reads. No PDF library here, so these run in any runtime and in
 * unit tests.
 */

/** How many leading bytes `isPdfHeader` reads. */
export const PDF_SNIFF_BYTES = 5;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * Whether a file starts with the PDF magic bytes "%PDF-". Strict: no preamble, so a file that only embeds a PDF after
 * another format's header (a PNG / PDF polyglot) is refused.
 */
export function isPdfHeader(head: Uint8Array): boolean {
  return PDF_MAGIC.every((b, i) => head[i] === b);
}

/** Whether one page's extracted text counts as text (a scanned page has none). */
export function pageHasText(text: string): boolean {
  return text.replace(/\s+/g, "").length >= PDF_MIN_PAGE_CHARS;
}

/** Whether a book's text is readable: at least half its pages have text (PDF0). */
export function enoughText(pages: readonly string[]): boolean {
  if (pages.length === 0) return false;
  const withText = pages.filter(pageHasText).length;
  return withText * 2 >= pages.length;
}

/** The printed page number of PDF page `index` (0-based), given the printed number of the first page (N8 a). */
export function printedPage(index: number, firstPrintedPage: number): number {
  return firstPrintedPage + index;
}

/** The chunker's marker block for a printed page: block N holds printed page N-1 (chunk.ts). */
function blockFor(printed: number): number {
  const block = printed + 1;
  // Keep the chunker's mapping the single source: if it changes, this fails loudly instead of misnumbering pages.
  if (printedPageForBlock(block) !== printed) throw new Error("chunk.ts changed its block-to-page mapping");
  return block;
}

/** A line inside the PDF's own text that looks like the chunker's page marker; dropped so it can't fake a page. */
const MARKER_LIKE = /^[ \t]*=====\s*PAGE\s+\d+\s*=====[ \t]*$/gim;

/**
 * The page-tagged text for chunkBook: one "===== PAGE <block> =====" block per PDF page, numbered so the chunker's
 * printed page is the uploader's numbering (`firstPrintedPage` for the PDF's first page). A footer page number close
 * to that (chunk.ts FOOTER_TOLERANCE) still wins, as it does for the script's text files.
 */
export function pageTaggedText(pages: readonly string[], firstPrintedPage: number): string {
  return pages
    .map((text, i) => `===== PAGE ${blockFor(printedPage(i, firstPrintedPage))} =====\n${text.replace(MARKER_LIKE, "")}`)
    .join("\n");
}
