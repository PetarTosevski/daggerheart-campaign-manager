import { ConvexError } from "convex/values";

import {
  ACTION_LABELS,
  BOOKS_ONLY_MISS,
  QUOTE_BOOK_ICON,
  RULING_ICON,
  STOPPED_EARLY_NOTE,
  VERDICT_COPY,
  WEB_MISS,
  WEB_UNAVAILABLE,
  copyText,
} from "../../../../../src/lib/lorekeeper/copy";
import type { Quote as ParsedQuote } from "../../../../../src/lib/lorekeeper/types";
import type { MessageView } from "../../../../../convex/lorekeeper";
import type { AnswerParts, Quote as StoredQuote, Verdict } from "../../../../../convex/lib/validators/lorekeeper";

export type AnswerAction = keyof typeof ACTION_LABELS;

export type BookTitles = ReadonlyMap<string, string>;

export function verdictTone(verdict: Verdict): "ok" | "amber" | "red" {
  return VERDICT_COPY[verdict].tone;
}

export function quoteChip(quote: StoredQuote, titles: BookTitles): string {
  if (quote.kind === "ruling") return `${RULING_ICON} Table ruling`;
  return `${QUOTE_BOOK_ICON} ${titles.get(quote.bookId) ?? "Rulebook"} · p.${quote.page}`;
}

export function quoteSection(quote: StoredQuote): string {
  return quote.kind === "ruling" ? quote.title : quote.section;
}

export function firstBookQuote(parts: AnswerParts | undefined): Extract<StoredQuote, { kind: "book" }> | undefined {
  for (const quote of parts?.quotes ?? []) if (quote.kind === "book") return quote;
  return undefined;
}

export function citesRange(parts: AnswerParts | undefined): boolean {
  return (parts?.quotes ?? []).some((quote) => quote.kind === "book" && /\branges?\b/i.test(quote.section));
}

export function isBooksOnlyMiss(answer: Pick<MessageView, "text" | "parts">): boolean {
  if (answer.parts === undefined) {
    return answer.text === BOOKS_ONLY_MISS || answer.text === WEB_MISS || answer.text === WEB_UNAVAILABLE;
  }
  return answer.parts.verdict === "none" && (answer.parts.web?.length ?? 0) === 0;
}

export function isStoppedEarly(answer: Pick<MessageView, "status" | "text">): boolean {
  return answer.status === "stopped" && answer.text === STOPPED_EARLY_NOTE;
}

export function isLocalMessage(id: string): boolean {
  return id.startsWith("optimistic-");
}

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

export function answerCopyText(answer: Pick<MessageView, "text" | "parts">, titles: BookTitles): string {
  const quotes: ParsedQuote[] = (answer.parts?.quotes ?? []).map((quote) =>
    quote.kind === "book"
      ? {
          kind: "book",
          text: quote.text,
          bookId: quote.bookId,
          book: titles.get(quote.bookId) ?? "Rulebook",
          page: quote.page,
          section: quote.section,
        }
      : {
          kind: "ruling",
          text: quote.text,
          book: "Table ruling",
          section: quote.title,
          ...(quote.rulingId ? { rulingId: quote.rulingId } : {}),
        },
  );
  return copyText({ prose: answer.text, quotes, call: answer.parts?.call, web: answer.parts?.web ?? [] });
}

export function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ConvexError)) return undefined;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function pinDraft(question: string, answer: Pick<MessageView, "text" | "parts">): { title: string; text: string } {
  const line = question.replace(/\s+/g, " ").trim();
  const title = line.length <= 80 ? line : `${line.slice(0, 79).trimEnd()}…`;
  const source = (answer.parts?.call ?? answer.text).trim();
  const text = source.length <= 600 ? source : `${source.slice(0, 599).trimEnd()}…`;
  return { title, text };
}
