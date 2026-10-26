// Page chunker for extracted rulebook text (D13 L1; analysis 2 and 3a). Pure module: L2's ingest script turns a
// book's extracted text into page-tagged chunks with it, then sends them to an internal mutation.
//
// Input format (the extractor writes one block per PDF page, usually as a single line):
//
//   ===== PAGE 93 =====
//   STRESS  Stress represents the mental ...  92   Chapter 2: Core Mechanics
//
// - Block N holds printed page N-1 (the PDF's first page is the cover). A footer ("92   Chapter 2: Core Mechanics",
//   "4 Introduction") overrides that when its number is within FOOTER_TOLERANCE of N-1, and names the chapter.
// - Runs of two or more spaces (and newlines) separate the extractor's text lines ("segments"). A segment without
//   lowercase letters is a heading ("CRITICAL SUCCESS"); adjacent heading segments merge ("STEP 1: PICK A TRAIT").
// - Each page splits at its headings into chunks of at most `maxChars` (4,000) characters. A chunk's section path is
//   "<Chapter> → <Heading>" in title case ("Core Mechanics → Critical Success"). Chapter and heading carry over to
//   the next page until a new one appears.
//
// ```ts
// const chunks = chunkBook(text);                     // BookChunk[]
// chunks[0];  // { ord: 0, block: 93, page: 92, chapter: "Core Mechanics", section: "Core Mechanics → Stress", text: "STRESS Stress represents ..." }
// chunkBook(text, { pages: { from: 254, to: 261 } }); // a frame's page range of the core book (L2 --pages)
// ```

/** The chunk size limit (analysis 2: lorekeeperChunks.text ≤ 4,000 chars). */
export const MAX_CHUNK_CHARS = 4000;

/**
 * Sections shorter than this merge into the next section of the same page (keeping the first one's section path),
 * so stat-block fragments ("ATK:") and short steps do not become chunks of their own.
 */
export const MIN_CHUNK_CHARS = 400;

/** How far a footer's page number may differ from block N-1 and still count as the printed page. */
export const FOOTER_TOLERANCE = 3;

/** Bumped when the chunking output changes, so L2 can tell that a stored book needs a re-ingest. */
export const CHUNK_FORMAT_VERSION = 1;

/** The separator in section paths. */
export const SECTION_SEPARATOR = " → ";

/** One extracted page. */
export type ExtractedPage = {
  /** The extractor's block number ("===== PAGE N ====="), 1-based. */
  block: number;
  /** The printed page number (footer, else block - 1). */
  page: number;
  /** The chapter named by this page's footer, if any (not carried over). */
  chapter?: string;
  /** The page text with the footer removed, whitespace kept as the extractor wrote it. */
  text: string;
};

/** One chunk, ready for lorekeeperChunks. */
export type BookChunk = {
  /** Order within the book, 0-based and gap-free. */
  ord: number;
  /** The extractor's block number. */
  block: number;
  /** The printed page number. */
  page: number;
  /** The chapter in effect (footer of this or an earlier page), title case. */
  chapter?: string;
  /** "<Chapter> → <Heading>", or whichever of the two exists, or "" when neither does. */
  section: string;
  /** The chunk text: the page's segments joined by single spaces, at most maxChars. */
  text: string;
};

export type ChunkOptions = {
  /** Upper bound for a chunk's text (default MAX_CHUNK_CHARS). */
  maxChars?: number;
  /** Merge sections shorter than this into the next one on the page (default MIN_CHUNK_CHARS; 0 = never). */
  minChars?: number;
  /** Keep only printed pages in this inclusive range (frame books cut from the core book). */
  pages?: { from: number; to: number };
};

const PAGE_MARKER = /^[ \t]*=====\s*PAGE\s+(\d+)\s*=====[ \t]*$/gm;

/** The printed page a block holds when no footer says otherwise. */
export function printedPageForBlock(block: number): number {
  return block - 1;
}

/** Split extracted text into pages. Text before the first marker is ignored. */
export function parsePages(text: string): ExtractedPage[] {
  const markers = [...text.matchAll(PAGE_MARKER)];
  const pages: ExtractedPage[] = [];
  markers.forEach((m, i) => {
    const block = Number(m[1]);
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < markers.length ? (markers[i + 1]?.index ?? text.length) : text.length;
    const raw = text.slice(start, end).replace(/^\r?\n/, "");
    const expected = printedPageForBlock(block);
    const footer = findFooter(segmentsOf(raw), expected);
    const page: ExtractedPage = {
      block,
      page: footer?.page ?? expected,
      text: footer ? footer.rest.join("  ") : raw.trim(),
    };
    if (footer?.chapter) page.chapter = footer.chapter;
    pages.push(page);
  });
  return pages;
}

/** Turn a book's extracted text into page-tagged chunks. */
export function chunkBook(text: string, options: ChunkOptions = {}): BookChunk[] {
  const maxChars = Math.max(200, options.maxChars ?? MAX_CHUNK_CHARS);
  const minChars = Math.max(0, options.minChars ?? MIN_CHUNK_CHARS);
  const chunks: BookChunk[] = [];
  let chapter: string | undefined;
  let heading: string | undefined;
  for (const page of parsePages(text)) {
    if (page.chapter) {
      if (page.chapter !== chapter) heading = undefined;
      chapter = page.chapter;
    }
    const inRange = !options.pages || (page.page >= options.pages.from && page.page <= options.pages.to);
    // Sections of this page: a heading run starts a new one.
    let current: { heading?: string; parts: string[]; hasBody: boolean } = { heading, parts: [], hasBody: false };
    const sections: (typeof current)[] = [current];
    let headingRun: string[] = [];
    const closeHeadingRun = () => {
      if (headingRun.length === 0) return;
      const title = titleCase(headingRun.join(" "));
      current = { heading: title, parts: [...headingRun], hasBody: false };
      sections.push(current);
      heading = title;
      headingRun = [];
    };
    for (const seg of segmentsOf(page.text)) {
      if (isHeading(seg)) {
        headingRun.push(seg);
      } else {
        closeHeadingRun();
        current.parts.push(seg);
        current.hasBody = true;
      }
    }
    // A heading at the very end of the page has no body here; it carries over to the next page.
    if (headingRun.length > 0) heading = titleCase(headingRun.join(" "));
    if (!inRange) continue;
    for (const s of mergeShort(sections, minChars, maxChars)) {
      const section = sectionPath(chapter, s.heading);
      for (const piece of splitText(s.text, maxChars)) {
        const chunk: BookChunk = { ord: chunks.length, block: page.block, page: page.page, section, text: piece };
        if (chapter) chunk.chapter = chapter;
        chunks.push(chunk);
      }
    }
  }
  return chunks;
}

/** "<Chapter> → <Heading>", either alone, or "". */
export function sectionPath(chapter: string | undefined, heading: string | undefined): string {
  return [chapter, heading].filter((s): s is string => !!s && s.length > 0).join(SECTION_SEPARATOR);
}

/** Title case for ALL-CAPS headings: "RANGE ON A GRID" -> "Range on a Grid". Mixed-case input is kept. */
export function titleCase(s: string): string {
  const clean = s.replace(/\s+/g, " ").trim().replace(/[.:,;]+$/, "");
  if (/[a-z]/.test(clean)) return clean;
  const small = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
  return clean
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && small.has(w) ? w : w.replace(/^(\P{L}*)(\p{L})/u, (_, p: string, c: string) => p + c.toUpperCase())))
    .join(" ");
}

// ---------------------------------------------------------------------------------------------------------------

/** Join each section's parts and merge short ones forward (same page only). */
function mergeShort(
  sections: { heading?: string; parts: string[]; hasBody: boolean }[],
  minChars: number,
  maxChars: number,
): { heading?: string; text: string }[] {
  const out: { heading?: string; text: string }[] = [];
  let acc: { heading?: string; text: string } | undefined;
  for (const s of sections) {
    if (!s.hasBody) continue;
    const next = { heading: s.heading, text: s.parts.join(" ") };
    if (acc && acc.text.length < minChars && acc.text.length + 1 + next.text.length <= maxChars) {
      acc.text = `${acc.text} ${next.text}`;
      continue;
    }
    if (acc) out.push(acc);
    acc = next;
  }
  if (acc) out.push(acc);
  return out;
}

function segmentsOf(text: string): string[] {
  return text
    .split(/\r?\n| {2,}|\t+/)
    .map((s) => s.replace(/^#+\s*/, "").trim())
    .filter((s) => s.length > 0);
}

function isHeading(seg: string): boolean {
  if (seg.length > 80) return false;
  if (/\p{Ll}/u.test(seg)) return false;
  const letters = seg.match(/\p{Lu}/gu)?.length ?? 0;
  return letters >= 3;
}

function near(n: number, expected: number): boolean {
  return Math.abs(n - expected) <= FOOTER_TOLERANCE;
}

function chapterName(s: string): string {
  return titleCase(s.replace(/^Chapter\s+\d+\s*:\s*/i, "").trim());
}

type Footer = { page: number; chapter?: string; rest: string[] };

/** Find a footer: "<n> Chapter N: Title" anywhere, else "<n> Title" / "<n>" in the last two segments. */
function findFooter(segs: string[], expected: number): Footer | undefined {
  const without = (from: number, count: number) => [...segs.slice(0, from), ...segs.slice(from + count)];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i] ?? "";
    const inline = /^(\d{1,4})\s+(Chapter\s+\d+\s*:\s*.+)$/i.exec(seg);
    if (inline && near(Number(inline[1]), expected)) {
      return { page: Number(inline[1]), chapter: chapterName(inline[2] ?? ""), rest: without(i, 1) };
    }
    if (/^Chapter\s+\d+\s*:\s*\S/i.test(seg)) {
      const prev = segs[i - 1];
      if (prev && /^\d{1,4}$/.test(prev) && near(Number(prev), expected)) {
        return { page: Number(prev), chapter: chapterName(seg), rest: without(i - 1, 2) };
      }
    }
  }
  const n = segs.length;
  const last = segs[n - 1];
  const prev = segs[n - 2];
  if (last) {
    const titled = /^(\d{1,4})\s+(\p{Lu}[^\d]{0,59})$/u.exec(last);
    if (titled && near(Number(titled[1]), expected)) {
      return { page: Number(titled[1]), chapter: chapterName(titled[2] ?? ""), rest: segs.slice(0, n - 1) };
    }
    if (prev && /^\d{1,4}$/.test(prev) && near(Number(prev), expected) && /^\p{Lu}[^\d]{0,59}$/u.test(last)) {
      return { page: Number(prev), chapter: chapterName(last), rest: segs.slice(0, n - 2) };
    }
    if (/^\d{1,4}$/.test(last) && near(Number(last), expected)) {
      return { page: Number(last), rest: segs.slice(0, n - 1) };
    }
  }
  return undefined;
}

/** Split text into pieces of at most max chars, preferring sentence ends, then spaces. */
function splitText(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
    if (cut >= max / 2) cut += 1;
    else {
      cut = window.lastIndexOf(" ");
      if (cut < max / 2) cut = max;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) out.push(rest);
  return out;
}
