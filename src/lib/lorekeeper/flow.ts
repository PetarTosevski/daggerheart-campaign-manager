// Which pass runs next (D13 L1; user answer Q2, binding). Pure module for L3's run action and L8's web pass.
//
// Q2: Sonnet 5.5 answers first. When its verdict is 'none' ("Not in your books") or 'unclear' ("Rules unclear"),
// the server retries once with Opus 5.5 (shown as "Checked again with a stronger model"). The internet pass runs
// only after Opus also finds nothing ('none'), and only when the conversation's toggle is "Search the internet too";
// with the toggle on "Books only" the answer is the books-only miss.
//
// ```ts
// nextStep({ pass: "primary", verdict: "unclear", webSearch: true });  // "retry"
// nextStep({ pass: "retry", verdict: "unclear", webSearch: true });    // "done" (keep Opus's answer and GM call)
// nextStep({ pass: "retry", verdict: "none", webSearch: true });       // "web"
// nextStep({ pass: "retry", verdict: "none", webSearch: false });      // "booksOnlyMiss"
// modelForPass("retry");                                               // "claude-opus-5-5"
// ```

import { PRIMARY_MODEL, RETRY_MODEL } from "./pricing";
import type { Verdict } from "./types";

/** primary = Sonnet's answer, retry = the Opus re-check, web = the internet pass. */
export type Pass = "primary" | "retry" | "web";

export type NextStep = "done" | "retry" | "web" | "booksOnlyMiss";

export function nextStep(input: { pass: Pass; verdict: Verdict; webSearch: boolean }): NextStep {
  const { pass, verdict, webSearch } = input;
  if (pass === "web") return "done";
  if (pass === "primary") return verdict === "rules" ? "done" : "retry";
  if (verdict !== "none") return "done";
  return webSearch ? "web" : "booksOnlyMiss";
}

/**
 * The model of a pass. `override` is an env model (LOREKEEPER_MODEL) replacing the primary model; the retry always
 * uses RETRY_MODEL, and the web pass the primary model (analysis 8).
 */
export function modelForPass(pass: Pass, override?: string | null): string {
  if (pass === "retry") return RETRY_MODEL;
  return override && override.trim().length > 0 ? override.trim() : PRIMARY_MODEL;
}
