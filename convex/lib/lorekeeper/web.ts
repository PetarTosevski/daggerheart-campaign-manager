import type { StreamUsage } from "../claude";
import type { WebResult } from "../validators/lorekeeper";
import type { ContextRuling } from "./context";

/**
 * The internet pass (Q2, L8): runs in the answer action only after Sonnet and the Opus retry both found nothing and
 * the conversation's toggle is on; a Messages API call with the web search server tool, whose results fill the
 * answer's internet block. L0 stub with the final signature (`WebPass`): L8 replaces the body.
 */

export type WebPassResult = {
  /** A short note for the answer's prose. */
  prose: string;
  /** At most 3, plain text. */
  web: WebResult[];
  usage: StreamUsage;
  model: string;
};

/** The web pass for `question`, rulings offered first; null when it found nothing usable. `signal` is Stop. */
export type WebPass = (question: string, rulings: ContextRuling[], signal?: AbortSignal) => Promise<WebPassResult | null>;

/** Stub: always null (the books-only miss). */
export const webPass: WebPass = async () => null;
