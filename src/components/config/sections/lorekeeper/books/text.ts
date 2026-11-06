import { PDF_MAX_BYTES, PDF_MAX_FIRST_PAGE, PDF_MAX_PAGES } from "../../../../../../convex/lib/pdf/config";

/**
 * Campaign settings > Lorekeeper, the GM's own books (config AU8): the words (the board's 'Your Witherwild notes ·
 * Uploaded by you' row, N6 b's limits, N8 a's first page) and the small pure helpers the rows and their tests share.
 */

const MB = Math.round(PDF_MAX_BYTES / (1024 * 1024));

export const BOOKS_TEXT = {
  uploadedByYou: "Uploaded by you",
  thisCampaignOnly: "This campaign only",
  reading: "Reading the book…",
  indexed: "Indexed",
  off: "Off",
  failed: "Couldn’t be read",
  failedHint: "Remove it and upload the PDF again.",
  remove: "Remove",
  removeQuestion: (title: string) => `Remove ${title}?`,
  cancel: "Cancel",
  upload: "Upload a book",
  uploadHint: `PDF · Up to ${MB} MB and ${PDF_MAX_PAGES} pages`,
  count: (n: number) => `${n === 1 ? "1 book" : `${n} books`} uploaded · No limit on the number of books`,
  title: "Title",
  firstPage: "Printed page number of the PDF’s first page",
  firstPageHint: "So the Lorekeeper cites the book’s own page numbers.",
  file: "PDF file",
  send: "Upload",
  uploading: "Uploading",
  starting: "Starting to read the PDF…",
  needTitle: "Give the book a title.",
  needFile: "Choose a PDF file.",
  badPage: `The first page number is a whole number from 0 to ${PDF_MAX_FIRST_PAGE}.`,
  lastFailed: (title: string) => `${title} couldn’t be read`,
} as const;

/** '<pages> pages · This campaign only'. */
export function pagesHint(pages: number): string {
  return `${pages === 1 ? "1 page" : `${pages} pages`} · ${BOOKS_TEXT.thisCampaignOnly}`;
}

/** A file name without its '.pdf', as a title suggestion. */
export function titleFromFile(name: string): string {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/_+/g, " ")
    .trim();
}
