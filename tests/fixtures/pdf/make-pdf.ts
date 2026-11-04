/**
 * A tiny PDF writer for the PDF ingest tests (PDF0): each page is a list of text lines in Helvetica, or an empty list
 * for a page with no text (what a scanned page looks like to a text reader). Written by hand so the fixtures hold our
 * own text only, never rulebook text.
 *
 * `sample.pdf` next to this file is `buildPdf(SAMPLE_PAGES)`; regenerate it with
 * `node tests/fixtures/pdf/make-pdf.ts` (the test checks that the committed file still matches).
 */

export const SAMPLE_PAGES: string[][] = [
  ["LANTERN KEEPING", "A lantern keeper trims the wick at dusk and logs the hour in the tower book."],
  [
    "TIDE CHARTS",
    "The harbour master posts the tide chart each morning beside the customs door.",
    "Ships that miss the high water wait at the outer buoy until the next tide.",
    "12   Chapter 2: Harbour Life",
  ],
  ["MARKET DAYS", "Stalls open on the third bell; the cheese sellers always take the shaded row.", "13"],
];

function escapeText(line: string): string {
  return line.replace(/[\\()]/g, (c) => `\\${c}`);
}

function contentStream(lines: string[]): string {
  return lines.map((line, i) => `BT /F1 11 Tf 56 ${760 - i * 18} Td (${escapeText(line)}) Tj ET`).join("\n");
}

/** A valid PDF 1.4 file with one page per entry of `pages`. */
export function buildPdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1: catalog, 2: pages, 3: font, then a page and its content stream per page.
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = contentStream(lines);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

// `node tests/fixtures/pdf/make-pdf.ts` writes sample.pdf.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("make-pdf.ts")) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(new URL("./sample.pdf", import.meta.url), buildPdf(SAMPLE_PAGES));
}
