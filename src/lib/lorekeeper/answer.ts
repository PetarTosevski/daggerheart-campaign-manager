// Answer and citation parser (D13 L1; analysis 5.2 and 5.3). Pure module: L3's run action feeds the stream's text
// deltas and citations into a parser, patches snapshot() into the answer row while it streams, and stores finish()
// as the row's parts. L8 feeds the web pass the same way.
//
// Contract with the model (prompt.ts SYSTEM_PROMPT): first line "VERDICT: rules | unclear | none", then plain
// prose, then for 'unclear' a final "GM CALL: …" line. Quotes come from the API's citations, never from the text:
//   content_block_location / char_location / page_location -> sources[document_index] -> book, page, section
//   web_search_result_location                              -> the unofficial block (url, title, site, snippet)
// A missing or garbled verdict line falls back to 'rules' when any book or ruling was cited, else 'unclear'.
//
// ```ts
// const parser = createAnswerParser(sources);           // sources from requestBody
// parser.pushText("VERDICT: ru"); parser.snapshot();    // { verdict: null, prose: "", … } (partial line hidden)
// parser.pushText("les\nYes. On a crit…");               // verdict "rules", prose "Yes. On a crit…"
// parser.pushCitation({ type: "content_block_location", document_index: 0, cited_text: "…", … });
// parser.finish();                                      // ParsedAnswer
// ```

import type { CitationSource, ParsedAnswer, Quote, Verdict, WebResult } from "./types";
import { VERDICTS } from "./types";

/** Quote and snippet length limit (analysis 2). */
export const QUOTE_MAX_CHARS = 300;
/** Quotes shown per answer, as on the board. */
export const MAX_QUOTES = 3;
/** Internet results per answer (plan L8). */
export const MAX_WEB_RESULTS = 3;
/** The book label of a ruling quote. */
export const RULING_BOOK_LABEL = "Table ruling";

/** A citation as the Messages API sends it (in a text block's `citations` or a `citations_delta`). */
export type ApiCitation =
  | {
      type: "content_block_location";
      cited_text: string;
      document_index: number;
      document_title?: string | null;
      start_block_index: number;
      end_block_index: number;
    }
  | {
      type: "char_location";
      cited_text: string;
      document_index: number;
      document_title?: string | null;
      start_char_index?: number;
      end_char_index?: number;
    }
  | {
      type: "page_location";
      cited_text: string;
      document_index: number;
      document_title?: string | null;
      start_page_number?: number;
      end_page_number?: number;
    }
  | {
      type: "web_search_result_location";
      cited_text: string;
      url: string;
      title?: string | null;
      encrypted_index?: string;
    };

/** The state while streaming: the verdict is null until its line is complete. */
export type AnswerSnapshot = {
  verdict: Verdict | null;
  prose: string;
  call: string | null;
  quotes: Quote[];
  web: WebResult[];
};

export type AnswerParser = {
  /** Append a text delta (text_delta.text). */
  pushText(delta: string): void;
  /** Add a citation (citations_delta.citation, or each entry of a finished text block's citations). */
  pushCitation(citation: ApiCitation): void;
  /** Add search results of a web_search_tool_result block (shown even if the model cites nothing from them). */
  pushWebResults(results: readonly { url: string; title?: string | null }[]): void;
  /** The current display state. */
  snapshot(): AnswerSnapshot;
  /** The final parts, with the verdict fallback applied. */
  finish(): ParsedAnswer;
  /** The raw text received so far. */
  rawText(): string;
};

const VERDICT_LINE = /^[\s*_#>`]*verdict\s*[:\-–]\s*[*_`]*\s*(rules|unclear|none)\b[*_`]*[ \t]*/i;
const CALL_LINE = /(^|\n)[ \t*_#>`]*GM[ \t]+CALL[ \t]*:[*_`]*[ \t]*/i;

export function createAnswerParser(sources: readonly CitationSource[]): AnswerParser {
  let text = "";
  const quotes: Quote[] = [];
  const quoteKeys: string[] = [];
  const web: WebResult[] = [];

  function addQuote(key: string, quote: Quote) {
    const i = quoteKeys.indexOf(key);
    if (i >= 0) {
      const old = quotes[i];
      if (old) quotes[i] = { ...old, text: mergeTexts(old.text, quote.text) };
      return;
    }
    if (quotes.length >= MAX_QUOTES) return;
    quoteKeys.push(key);
    quotes.push(quote);
  }

  function addWeb(url: string, title: string, snippet: string) {
    const existing = web.find((w) => w.url === url);
    if (existing) {
      if (snippet) existing.snippet = mergeTexts(existing.snippet, cutText(snippet));
      if (!existing.title && title) existing.title = title;
      return;
    }
    if (web.length >= MAX_WEB_RESULTS || !isHttpUrl(url)) return;
    web.push({ title: oneLine(title) || siteOf(url), site: siteOf(url), url, snippet: snippet ? cutText(snippet) : "" });
  }

  return {
    pushText(delta) {
      text += delta;
    },
    pushCitation(c) {
      const cited = oneLine(c.cited_text ?? "");
      if (c.type === "web_search_result_location") {
        addWeb(c.url, c.title ?? "", cited);
        return;
      }
      if (!cited) return;
      const source = sources[c.document_index];
      if (!source) return;
      if (source.kind === "book") {
        addQuote(`book|${source.bookId}|${source.page}|${source.section}`, {
          kind: "book",
          text: cutText(cited),
          bookId: source.bookId,
          book: source.bookTitle,
          page: source.page,
          section: source.section,
        });
        return;
      }
      const blockIndex = c.type === "content_block_location" ? c.start_block_index : 0;
      const ruling = source.rulings[blockIndex] ?? source.rulings[0];
      if (!ruling) return;
      const quote: Quote = { kind: "ruling", text: cutText(cited), book: RULING_BOOK_LABEL, section: ruling.title };
      if (ruling.id) quote.rulingId = ruling.id;
      addQuote(`ruling|${ruling.id ?? ruling.title}`, quote);
    },
    pushWebResults(results) {
      for (const r of results) addWeb(r.url, r.title ?? "", "");
    },
    snapshot() {
      const s = splitText(text, false);
      return { verdict: s.verdict, prose: s.prose, call: s.call, quotes: quotes.map((q) => ({ ...q })), web: web.map((w) => ({ ...w })) };
    },
    finish() {
      const s = splitText(text, true);
      const verdict: Verdict = s.verdict ?? (quotes.length > 0 ? "rules" : "unclear");
      const answer: ParsedAnswer = {
        verdict,
        verdictFromModel: s.verdict !== null,
        prose: s.prose,
        quotes: quotes.map((q) => ({ ...q })),
        web: web.map((w) => ({ ...w })),
      };
      if (s.call) answer.call = s.call;
      return answer;
    },
    rawText() {
      return text;
    },
  };
}

/** Parse a complete reply in one go (tests, replays, the e2e fake model). */
export function parseAnswer(
  text: string,
  citations: readonly ApiCitation[],
  sources: readonly CitationSource[],
): ParsedAnswer {
  const p = createAnswerParser(sources);
  p.pushText(text);
  for (const c of citations) p.pushCitation(c);
  return p.finish();
}

/**
 * The results of a web_search_tool_result block's `content`: a list of results on success, an error object
 * (HTTP 200, `{ type: "web_search_tool_result_error", error_code }`) on failure, which yields [].
 */
export function webResultsFromToolContent(content: unknown): { url: string; title: string }[] {
  if (!Array.isArray(content)) return [];
  const out: { url: string; title: string }[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as { type?: unknown; url?: unknown; title?: unknown };
    if (r.type !== "web_search_result" || typeof r.url !== "string") continue;
    out.push({ url: r.url, title: typeof r.title === "string" ? r.title : "" });
  }
  return out;
}

/** "https://www.reddit.com/r/x" -> "reddit.com"; "" for an unparsable url. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Cut to QUOTE_MAX_CHARS at a word boundary, with "…" (the result never exceeds the limit). */
export function cutText(s: string, max: number = QUOTE_MAX_CHARS): string {
  const clean = oneLine(s);
  if (clean.length <= max) return clean;
  const window = clean.slice(0, max - 1);
  // A word that ends exactly at the window's end is kept whole.
  const space = clean[max - 1] === " " ? window.length : window.lastIndexOf(" ");
  const base = space >= max * 0.6 ? window.slice(0, space) : window;
  return `${base.replace(/[\s,;:.]+$/, "")}…`;
}

// ---------------------------------------------------------------------------------------------------------------

type Split = { verdict: Verdict | null; prose: string; call: string | null };

/**
 * Split the text into verdict, prose and GM call. While streaming (`final` false) a first line that may still
 * become a verdict line, and a last line that may still become "GM CALL:", are held back so they never flash up.
 */
function splitText(raw: string, final: boolean): Split {
  let verdict: Verdict | null = null;
  const text = raw.replace(/^(?:[ \t]*\r?\n)+/, "");
  let body = text;
  const nl = text.indexOf("\n");
  const firstLine = nl >= 0 ? text.slice(0, nl) : text;
  const m = VERDICT_LINE.exec(firstLine);
  if (m && (nl >= 0 || final || m[0].length < firstLine.length)) {
    const word = (m[1] ?? "").toLowerCase();
    verdict = (VERDICTS as readonly string[]).includes(word) ? (word as Verdict) : null;
    body = firstLine.slice(m[0].length).replace(/^[\s.:;,\-–—]+/, "") + (nl >= 0 ? text.slice(nl) : "");
  } else if (looksLikeVerdictStart(firstLine)) {
    if (nl < 0 && !final) return { verdict: null, prose: "", call: null };
    // A complete but garbled verdict line ("VERDICT: maybe") is dropped; the fallback picks the verdict.
    body = nl >= 0 ? text.slice(nl + 1) : "";
  }

  if (!final) body = holdBackPartialCall(body);
  const c = CALL_LINE.exec(body);
  if (!c) return { verdict, prose: tidy(body), call: null };
  const prose = tidy(body.slice(0, c.index));
  const call = tidy(body.slice(c.index + c[0].length));
  return { verdict, prose, call: call.length > 0 ? call : null };
}

function looksLikeVerdictStart(line: string): boolean {
  const head = line.replace(/^[\s*_#>`]+/, "").toLowerCase();
  if (head.length === 0) return true;
  if (/^verdict\s*[:\-–]/.test(head)) return true;
  return "verdict".startsWith(head.replace(/\s+/g, ""));
}

function holdBackPartialCall(body: string): string {
  const nl = body.lastIndexOf("\n");
  const last = body.slice(nl + 1).replace(/^[ \t*_#>`]+/, "");
  if (last.length === 0) return body;
  const squashed = last.toUpperCase().replace(/\s+/g, " ");
  if ("GM CALL:".startsWith(squashed) && !CALL_LINE.test(body)) return body.slice(0, nl + 1);
  return body;
}

function tidy(s: string): string {
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function mergeTexts(a: string, b: string): string {
  if (a.includes(b.replace(/…$/, ""))) return a;
  if (b.includes(a.replace(/…$/, ""))) return cutText(b);
  return cutText(`${a.replace(/…$/, "")} … ${b}`);
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
