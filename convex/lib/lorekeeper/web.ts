import { createAnswerParser, webResultsFromToolContent, type ApiCitation } from "../../../src/lib/lorekeeper/answer";
import { requestBody, WEB_BLOCKED_DOMAINS, WEB_SEARCH_MAX_USES } from "../../../src/lib/lorekeeper/prompt";
import type { PromptContext } from "../../../src/lib/lorekeeper/types";
import { ClaudeFailure, messagesStream, modelFor, type StreamResult, type StreamUsage } from "../claude";
import type { WebResult } from "../validators/lorekeeper";
import type { ContextRuling } from "./context";

/**
 * The internet pass (Q2, L8): runs in the answer action only after Sonnet and the Opus retry both found nothing and
 * the conversation's toggle is on; a Messages API call with the web search server tool (`web_search_20260209`,
 * max_uses 3, piracy / PDF hosts blocked), whose results fill the answer's internet block.
 *
 * What it sends: the question and the table rulings (offered as a document before any web result), nothing else.
 * No book excerpts (the book passes already used them), no history, no characters, no party, no frame: the campaign-data block
 * is the empty one. The model writes its own search queries, so this keeps campaign details out of them.
 *
 * Results: the cited results first, then the rest of the tool's results, at most 3, http(s) only, snippets cut to
 * 300 chars, all plain text (L1's answer parser). A `web_search_tool_result_error` (HTTP 200) yields no results.
 *
 * Contract with L3's run (lorekeeperRun.ts, the only caller since dcm-bxp.82.2):
 * - a result with at least one web result → `WebPassResult` (the run settles `usage` / `model`);
 * - a call that completed but gave no usable result → `ClaudeFailure("no answer")` carrying the whole reply, so the
 *   run settles the pass's real cost (web searches included) and keeps the unclear answer or stores the web miss;
 * - a failed call (timeout, HTTP error, Stop) → the `ClaudeFailure` of `messagesStream`, with its partial usage;
 * - null only when nothing was sent (a blank question).
 * Anything else is a programming error and is left to throw (rule 9).
 */

export type WebPassResult = {
  /** A short note for the answer's prose. */
  prose: string;
  /** At most 3, plain text. */
  web: WebResult[];
  usage: StreamUsage;
  model: string;
};

/** The pass so far, as `onProgress` gets it: the prose and the web results the parser has (cited ones first). */
export type WebProgress = { prose: string; web: WebResult[] };

/**
 * The web pass for `question`, rulings offered first; null when nothing was sent. `signal` is Stop; `books` is what
 * the book passes found (the prompt says the books had nothing, or were unclear). `onProgress` (dcm-bxp.82.2) gets
 * the pass so far after every text delta and citation, so the run can stream it (L12: shown once `web` is non-empty).
 */
export type WebPass = (
  question: string,
  rulings: ContextRuling[],
  signal?: AbortSignal,
  books?: "none" | "unclear",
  onProgress?: (progress: WebProgress) => void,
) => Promise<WebPassResult | null>;

/** The campaign-data block of the web pass: empty on purpose (see above). */
const NO_CAMPAIGN_DATA: PromptContext = { frame: null, characters: [], party: [] };

export const webPass: WebPass = async (question, rulings, signal, books = "none", onProgress) => {
  if (question.trim().length === 0) return null;
  const model = modelFor("web");
  const { body, sources } = requestBody(question, [], rulings, NO_CAMPAIGN_DATA, [], {
    model,
    web: { maxUses: WEB_SEARCH_MAX_USES, blockedDomains: WEB_BLOCKED_DOMAINS, books },
  });
  const parser = createAnswerParser(sources);
  const progress = () => {
    if (onProgress === undefined) return;
    const snapshot = parser.snapshot();
    onProgress({ prose: snapshot.prose, web: snapshot.web });
  };
  const result = await messagesStream(
    body,
    (delta) => {
      parser.pushText(delta);
      progress();
    },
    (citation) => {
      parser.pushCitation(citation as ApiCitation);
      progress();
    },
    signal,
  );
  // Cited results were added while streaming; the tool's other results fill the remaining places.
  for (const block of result.blocks) {
    if (block?.type === "other" && block.blockType === "web_search_tool_result") {
      parser.pushWebResults(webResultsFromToolContent(block.raw.content));
    }
  }
  const answer = parser.finish();
  if (answer.web.length === 0) throw new ClaudeFailure("no answer", result);
  return { prose: answer.prose.trim(), web: answer.web, usage: usageOf(result), model: result.model || model };
};

function usageOf(result: StreamResult): StreamUsage {
  return { ...result.usage };
}
