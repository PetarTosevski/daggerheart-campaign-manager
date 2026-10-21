import { ConvexError } from "convex/values";

import type { MessageView } from "../../../../convex/lorekeeper";
import type { AnswerParts, Quote as StoredQuote, Verdict } from "../../../../convex/lib/validators/lorekeeper";
import { ACTION_LABELS, BOOKS_ONLY_MISS, QUOTE_BOOK_ICON, RULING_ICON, VERDICT_COPY, copyText } from "@/lib/lorekeeper/copy";
import type { Quote as ParsedQuote } from "@/lib/lorekeeper/types";

/**
 * Pure helpers of the answer card (D13 L6): which board actions an answer gets, the quote chips' text, the Copy text
 * and the error code of a thrown Convex error. Unit-tested in tests/unit/lorekeeper-ui.
 */

export type AnswerAction = keyof typeof ACTION_LABELS;

/** The verdict pill's classes (board: `lk-verdict lk-v-ok | lk-v-amber | lk-v-red`). */
export function verdictClass(verdict: Verdict): string {
  return `lk-verdict lk-v-${VERDICT_COPY[verdict].tone}`;
}

/** Book titles by id (from `lorekeeperLibrary.list`). */
export type BookTitles = ReadonlyMap<string, string>;

/** A book quote's chip: '📖 <book> · p.<page>'; a ruling quote's: '📌 Table ruling'. */
export function quoteChip(quote: StoredQuote, titles: BookTitles): string {
  if (quote.kind === "ruling") return `${RULING_ICON} Table ruling`;
  return `${QUOTE_BOOK_ICON} ${titles.get(quote.bookId) ?? "Rulebook"} · p.${quote.page}`;
}

/** The section under a quote: the book's section path, or the ruling's title. */
export function quoteSection(quote: StoredQuote): string {
  return quote.kind === "ruling" ? quote.title : quote.section;
}

/** The first book quote (what 'Open in the book' opens), if any. */
export function firstBookQuote(parts: AnswerParts | undefined): Extract<StoredQuote, { kind: "book" }> | undefined {
  for (const quote of parts?.quotes ?? []) if (quote.kind === "book") return quote;
  return undefined;
}

/** A quote cites the book's range section (board: 'Show on Combat Map' only then). */
export function citesRange(parts: AnswerParts | undefined): boolean {
  return (parts?.quotes ?? []).some((quote) => quote.kind === "book" && /\branges?\b/i.test(quote.section));
}

/** The books-only miss: nothing in the books and no internet results (toggle off, or the web pass found nothing). */
export function isBooksOnlyMiss(answer: Pick<MessageView, "text" | "parts">): boolean {
  if (answer.parts === undefined) return answer.text === BOOKS_ONLY_MISS;
  return answer.parts.verdict === "none" && (answer.parts.web?.length ?? 0) === 0;
}

/**
 * The actions under a finished answer, in the board's order:
 * - books-only miss: only 'Ask the GM';
 * - from the rules citing the range section: 'Show on Combat Map', 'Copy';
 * - from the rules: 'Open in the book' (when a book is quoted), 'Pin as table ruling', 'Copy';
 * - unclear or internet: 'Ask the GM', 'Pin as table ruling', 'Copy'.
 * 'Pin as table ruling' is the GM's, on their own answers and on answers a player sent them ('Ask the GM', which
 * `lorekeeperRulings.pin` accepts); 'Ask the GM' the players', on their own answers.
 */
export function answerActions(
  answer: Pick<MessageView, "text" | "parts">,
  who: { isGm: boolean; mine: boolean; askedOfGm?: boolean },
): AnswerAction[] {
  const askGm = !who.isGm && who.mine;
  const pin = who.isGm && (who.mine || who.askedOfGm === true);
  if (isBooksOnlyMiss(answer)) return askGm ? ["askGm"] : [];
  const verdict = answer.parts?.verdict ?? "rules";
  const actions: AnswerAction[] = [];
  if (verdict === "rules") {
    if (citesRange(answer.parts)) return ["showOnMap", "copy"];
    if (firstBookQuote(answer.parts)) actions.push("openInBook");
  } else if (askGm) {
    actions.push("askGm");
  }
  if (pin) actions.push("pinRuling");
  actions.push("copy");
  return actions;
}

/** The Copy action's text (L1 `copyText`), with book titles resolved. */
export function answerCopyText(answer: Pick<MessageView, "text" | "parts">, titles: BookTitles): string {
  const quotes: ParsedQuote[] = (answer.parts?.quotes ?? []).map((quote) =>
    quote.kind === "book"
      ? { kind: "book", text: quote.text, bookId: quote.bookId, book: titles.get(quote.bookId) ?? "Rulebook", page: quote.page, section: quote.section }
      : { kind: "ruling", text: quote.text, book: "Table ruling", section: quote.title, ...(quote.rulingId ? { rulingId: quote.rulingId } : {}) },
  );
  return copyText({ prose: answer.text, quotes, call: answer.parts?.call, web: answer.parts?.web ?? [] });
}

/** Only http(s) links become anchors; anything else stays plain text. */
export function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** The `code` of a thrown `ConvexError<AppError>`, if any. */
export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ConvexError)) return undefined;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** The pin dialog's starting title (the question, one line, at most 80) and text (the GM call, else the prose). */
export function pinDraft(question: string, answer: Pick<MessageView, "text" | "parts">): { title: string; text: string } {
  const line = question.replace(/\s+/g, " ").trim();
  const title = line.length <= 80 ? line : `${line.slice(0, 79).trimEnd()}…`;
  const source = (answer.parts?.call ?? answer.text).trim();
  const text = source.length <= 600 ? source : `${source.slice(0, 599).trimEnd()}…`;
  return { title, text };
}
