// Shared types of the Lorekeeper pure domain (D13 L1). Structural on purpose: L0's validators and L2-L5's Convex
// code map their rows onto these shapes; nothing here imports Convex.

/** The answer kinds of the board's "How I answer" legend. */
export type Verdict = "rules" | "unclear" | "none";

export const VERDICTS: readonly Verdict[] = ["rules", "unclear", "none"];

/** A retrieved book excerpt sent to the model as one document (L2 retrieve() result, mapped). */
export type PromptChunk = {
  /** Opaque book reference passed through to quotes (L2: the lorekeeperBooks id). */
  bookId: string;
  /** Book display name, e.g. "Core Rulebook". */
  bookTitle: string;
  /** Printed page. */
  page: number;
  /** Section path, e.g. "Core Mechanics → Critical Success" ("" when unknown). */
  section: string;
  /** The chunk text. */
  text: string;
};

/** A pinned table ruling (L4). */
export type PromptRuling = {
  /** Opaque ruling reference passed through to quotes (L4: the lorekeeperRulings id). */
  id?: string;
  title: string;
  text: string;
};

/** One of the asker's own characters (L4 buildContext; only characters the asker may edit). */
export type PromptCharacter = {
  name: string;
  className?: string;
  subclass?: string;
  level?: number;
  /** Ancestry and community names. */
  heritage?: string[];
  domainCards?: string[];
  features?: string[];
};

/** One party member's class line, visible to every member on the Party page. */
export type PromptPartyMember = {
  className: string;
  subclass?: string;
};

/** The permitted campaign context (analysis 5.4, Q4). Never holds GM-only data. */
export type PromptContext = {
  frame?: { id: string; name: string } | null;
  characters: PromptCharacter[];
  party: PromptPartyMember[];
};

/** A previous message of this conversation (plain text, no old documents). */
export type HistoryTurn = {
  role: "question" | "answer";
  text: string;
};

/** What a request's document_index points at (requestBody's `sources`, same order as the documents). */
export type CitationSource =
  | { kind: "book"; bookId: string; bookTitle: string; page: number; section: string }
  | { kind: "rulings"; rulings: { id?: string; title: string }[] };

/** One quote shown under an answer (analysis 2: parts.quotes). */
export type Quote = {
  kind: "book" | "ruling";
  /** Cited text, at most QUOTE_MAX_CHARS. */
  text: string;
  /** Book reference (book quotes). */
  bookId?: string;
  /** Book display name, or "Table ruling". */
  book: string;
  /** Printed page (book quotes). */
  page?: number;
  /** Section path, or the ruling's title. */
  section: string;
  /** Ruling reference (ruling quotes). */
  rulingId?: string;
};

/** One internet result of the unofficial block (analysis 2: parts.web). */
export type WebResult = {
  title: string;
  /** Host name without "www.", e.g. "reddit.com". */
  site: string;
  url: string;
  /** Cited text, at most QUOTE_MAX_CHARS ("" when the model cited nothing from it). */
  snippet: string;
};

/** The parsed answer (analysis 5.2). */
export type ParsedAnswer = {
  verdict: Verdict;
  /** True when the model wrote a valid VERDICT line; false when the fallback chose the verdict. */
  verdictFromModel: boolean;
  /** The answer prose, plain text. */
  prose: string;
  /** The "GM CALL:" tail, when present. */
  call?: string;
  /** At most MAX_QUOTES quotes, duplicates merged. */
  quotes: Quote[];
  /** At most MAX_WEB_RESULTS internet results. */
  web: WebResult[];
};
