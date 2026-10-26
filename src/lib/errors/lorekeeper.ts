/**
 * Errors of the Lorekeeper (D13, plan `.omc/plans/d13-lorekeeper.yaml`). Contract: see `actionLog.ts`; add this
 * domain's codes here only. Every D13 tracer throws only these codes (plus the common ones: UNAUTHENTICATED,
 * NOT_FOUND, FORBIDDEN, INVALID, RATE_LIMITED); a code missing here means stop and ask the orchestrator.
 * `LOREKEEPER_FAILED`, `LOREKEEPER_REFUSED`, `LOREKEEPER_TIMEOUT` and `LOREKEEPER_UNAVAILABLE` are also stored as an
 * answer's `errorCode` (validators/lorekeeper.ts).
 */
export const lorekeeperMessages = {
  /** No ANTHROPIC_API_KEY on the deployment (and no e2e fake model). */
  LOREKEEPER_UNAVAILABLE: "The Lorekeeper isn't set up on this server.",
  /** An empty question or one over 1,000 characters. */
  LOREKEEPER_QUESTION_INVALID: "Ask a question of at most 1,000 characters.",
  /** The caller already has an answer on its way in this campaign. */
  LOREKEEPER_BUSY: "The Lorekeeper is still answering your last question.",
  /** 40 questions per person per day (Q9; LOREKEEPER_DAILY_QUESTIONS). */
  LOREKEEPER_CAP_USER: "You've asked today's questions. The Lorekeeper is back tomorrow.",
  /** The campaign's monthly budget (Q9; LOREKEEPER_CAMPAIGN_MONTHLY_USD). */
  LOREKEEPER_CAP_CAMPAIGN: "This campaign has used the Lorekeeper's budget for this month.",
  /** The server-wide monthly budget (Q9; LOREKEEPER_MONTHLY_USD). */
  LOREKEEPER_CAP_DEPLOYMENT: "The Lorekeeper has used this month's budget for the whole server.",
  /** A conversation or message the caller may not read (another user's private one, or gone). */
  LOREKEEPER_NOT_FOUND: "That conversation isn't there anymore.",
  /** The model call failed (network, HTTP error, unusable reply). */
  LOREKEEPER_FAILED: "The Lorekeeper couldn't answer just now. Try again.",
  /** The model declined (stop_reason refusal). */
  LOREKEEPER_REFUSED: "The Lorekeeper can't answer that one. Try asking another way.",
  /** The answer took longer than the time limit, or got stuck. */
  LOREKEEPER_TIMEOUT: "The Lorekeeper took too long to answer. Try again.",
  /** A book that is not in the library, or switched off for this campaign. */
  LOREKEEPER_BOOK_NOT_FOUND: "That book isn't in this campaign's library.",
  /** 50 pinned rulings per campaign. */
  LOREKEEPER_RULING_LIMIT: "This campaign already has 50 table rulings. Unpin one first.",
  LOREKEEPER_RULING_NOT_FOUND: "That ruling isn't there anymore.",
  LOREKEEPER_ASK_NOT_FOUND: "That request isn't there anymore.",
  /** One open Ask-the-GM per answer (Q8). */
  LOREKEEPER_ASK_EXISTS: "This answer was already sent to the GM.",
  LOREKEEPER_CONVERSATION_FULL: "This conversation is full. Start a new conversation.",
} as const satisfies Record<string, string>;
