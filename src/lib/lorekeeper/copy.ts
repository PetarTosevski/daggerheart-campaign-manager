// The Lorekeeper's copy text (D13 L1). Strings marked "board" are verbatim from
// reference/designs/project/Lorekeeper.dc.html; the others fill states the board lacks (analysis 1.4) or come from
// the user's answers (Q2 retry note). Pure module: L6 / L7 render these, copyText builds the Copy action's text.

import type { ParsedAnswer, Verdict } from "./types";

/** board: chat header. */
export const LOREKEEPER_NAME = "The Lorekeeper";
export const LOREKEEPER_SHORT = "Lorekeeper";
export const LOREKEEPER_SUBTITLE = "Keeper of your rulebooks · answers rule questions";

export type VerdictCopy = {
  /** Pill text and legend label. */
  label: string;
  /** Pill icon (aria-hidden). */
  icon: string;
  /** Colour family: ok = green, amber, red. */
  tone: "ok" | "amber" | "red";
  /** "How I answer" legend description. */
  legend: string;
};

/** board: verdict pills and the "How I answer" legend, in legend order. */
export const VERDICT_COPY: Record<Verdict, VerdictCopy> = {
  rules: {
    label: "From the rules",
    icon: "✓",
    tone: "ok",
    legend: "Quoted from your books, with the book and section.",
  },
  unclear: {
    label: "Rules unclear",
    icon: "?",
    tone: "amber",
    legend: "The books touch on it but don’t settle it. You get what they say and a suggested GM call.",
  },
  none: {
    label: "Not in your books",
    icon: "✕",
    tone: "red",
    legend: "Nothing found. Results from the internet follow, clearly marked as unofficial.",
  },
};

/** board: sidebar card titles and copy. */
export const LEGEND_TITLE = "How I answer";
export const LIBRARY_TITLE = "Library";
export const LIBRARY_COPY = "The Lorekeeper only answers from these books. Turn one off to leave it out.";
export const ADD_PDF_LABEL = "＋ Add PDF";
export const BOOK_INDEXED = "Indexed";
export const BOOK_OFF = "Off";
export const RULINGS_TITLE = "Table rulings";
export const RULINGS_COPY = "Calls your GM pinned. The Lorekeeper quotes these before the internet.";
/** Not on the board (analysis 1.4). */
export const RULINGS_EMPTY = "No rulings yet.";
export const LIBRARY_EMPTY = "No books yet";

/** board: "2 pinned". */
export function pinnedLabel(n: number): string {
  return `${n} pinned`;
}

/** board: "3 books indexed" (header pill). */
export function booksIndexedLabel(n: number): string {
  return `${n} ${n === 1 ? "book" : "books"} indexed`;
}

/** board: "Pinned by the GM · Session 4"; without a session "Pinned by the GM". */
export function rulingMeta(session?: number | null): string {
  return typeof session === "number" ? `Pinned by the GM · Session ${session}` : "Pinned by the GM";
}

/** board: answer card parts. */
export const QUOTE_BOOK_ICON = "📖";
export const RULING_ICON = "📌";
export const GM_CALL_LABEL = "Suggested GM call";
export const WEB_DISCLAIMER_TITLE = "From the internet · unofficial.";
export const WEB_DISCLAIMER =
  "These are other people’s readings and house rules found online, not text from Daggerheart. Your GM decides.";

/** board: the books-only miss (web search off, nothing in the books). */
export const BOOKS_ONLY_MISS =
  "I couldn’t find this in your books, and internet search is off. Ask your GM, or turn on “Search the internet too”.";

/** Q2: shown on an answer that came from the automatic Opus retry. */
export const RETRIED_NOTE = "Checked again with a stronger model";

/** board: thinking row. */
export const THINKING_TEXT = "Searching your books…";
/** board: the asker's own name on question bubbles. */
export const YOU_LABEL = "You";

/** board: answer actions. */
export const ACTION_LABELS = {
  openInBook: "Open in the book",
  pinRuling: "Pin as table ruling",
  copy: "Copy",
  askGm: "Ask the GM",
  showOnMap: "Show on Combat Map",
} as const;
/** Not on the board: after "Ask the GM" was sent (plan L6). */
export const ASK_GM_SENT = "Sent to the GM";

/** board: composer. */
export const COMPOSER_PLACEHOLDER = "Ask The Lorekeeper a rules question…";
export const COMPOSER_LABEL = "Your question";
export const ASK_LABEL = "Ask";
/** Q11: replaces "Ask" while an answer streams. */
export const STOP_LABEL = "Stop";
export const WEB_TOGGLE_LABEL = "If the books don’t say";
export const WEB_TOGGLE_GROUP_LABEL = "Internet search";
export const WEB_TOGGLE_ON = "Search the internet too";
export const WEB_TOGGLE_OFF = "Books only";

export type Suggestion = { key: "crit" | "range" | "hex" | "breath"; label: string; question: string };

/** board: suggestion chips with the questions they ask, in board order. */
export const SUGGESTIONS: readonly Suggestion[] = [
  { key: "crit", label: "Critical hits", question: "If my Hope and Fear dice match on an attack, do I deal extra damage?" },
  { key: "range", label: "How far is Close?", question: "How far away is Close range?" },
  { key: "hex", label: "Do Hexes stack?", question: "Two of us are Witches. Do our Hexes stack on the same bandit?" },
  { key: "breath", label: "Holding breath", question: "How long can my character hold their breath underwater?" },
];

/** States the board lacks (analysis 1.4). */
export const EMPTY_INTRO = "Ask me anything about the rules in your books.";
export const ERROR_TEXT = "The Lorekeeper couldn’t answer just now. Try again.";
export const TRY_AGAIN_LABEL = "Try again";
export const NOT_SET_UP = "The Lorekeeper isn't set up on this server.";
export const CONVERSATIONS_LABEL = "Conversations";
export const NEW_CONVERSATION_LABEL = "New conversation";
/** Q3: conversations are public to the campaign by default; the asker can make one private. */
export const VISIBILITY_PUBLIC = "Everyone in the campaign can read this";
export const VISIBILITY_PRIVATE = "Only you can read this";
export const OPEN_FAB_LABEL = "The Lorekeeper is open";

/** Composer notice under a cap (L5 usage.mine). */
export function questionsLeftLabel(n: number): string {
  return `${n} ${n === 1 ? "question" : "questions"} left today`;
}
export const CAP_USER_TEXT = "You’ve asked the most questions allowed today. Try again tomorrow.";
export const CAP_CAMPAIGN_TEXT = "This campaign has used this month’s Lorekeeper budget.";
export const CAP_DEPLOYMENT_TEXT = "The Lorekeeper has used this month’s budget for this server.";
export const RATE_LIMITED_TEXT = "Too many questions in a short time. Wait a moment and ask again.";

/**
 * The Copy action's text: the prose, each quote as `“…” — <Book> p.<page>` (rulings `— Table ruling`), the GM call,
 * and the internet block with its disclaimer. Plain text, blank lines between parts.
 */
export function copyText(answer: Pick<ParsedAnswer, "prose" | "quotes" | "call" | "web">): string {
  const parts: string[] = [];
  if (answer.prose.trim()) parts.push(answer.prose.trim());
  if (answer.quotes.length > 0) {
    parts.push(
      answer.quotes
        .map((q) => {
          const where = q.kind === "book" && typeof q.page === "number" ? `${q.book} p.${q.page}` : q.book;
          return `“${q.text}” — ${where}`;
        })
        .join("\n"),
    );
  }
  if (answer.call?.trim()) parts.push(`${GM_CALL_LABEL}: ${answer.call.trim()}`);
  if (answer.web.length > 0) {
    const lines = [`${WEB_DISCLAIMER_TITLE} ${WEB_DISCLAIMER}`];
    for (const w of answer.web) {
      lines.push(`- ${w.title} (${w.site}) ${w.url}${w.snippet ? `: ${w.snippet}` : ""}`);
    }
    parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}
