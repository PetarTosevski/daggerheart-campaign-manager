// Which pass runs next (D13 L1; user answer Q2, binding). Pure module for L3's run action and L8's web pass.
//
// Q2: Sonnet 5.5 answers first. When its verdict is 'none' ("Not in your books") or 'unclear' ("Rules unclear"),
// the server retries once with Opus 5.5 (shown as "Checked again with a stronger model"). L10 (D1): when the
// conversation's toggle is "Search the internet too", the internet pass runs after the Opus retry when its verdict is
// 'unclear' or 'none'; 'rules' never searches. With the toggle on "Books only" an 'unclear' answer stands and a
// 'none' ends as the books-only miss.
//
// ```ts
// nextStep({ pass: "primary", verdict: "unclear", webSearch: true });  // "retry"
// nextStep({ pass: "retry", verdict: "unclear", webSearch: true });    // "web" (the book answer is kept, web added)
// nextStep({ pass: "retry", verdict: "unclear", webSearch: false });   // "done" (keep Opus's answer and GM call)
// nextStep({ pass: "retry", verdict: "none", webSearch: true });       // "web"
// nextStep({ pass: "retry", verdict: "none", webSearch: false });      // "booksOnlyMiss"
// modelForPass("retry");                                               // "claude-opus-5-5"
// ```
//
// L11 (user decision 2026-10-22, binding): clear answers stream, uncertain ones wait for the final check and the
// reader sees the process. Only the first pass with the verdict 'rules' streams (`streamsLive`); every other pass is
// written once, when the run knows it is the answer it keeps. Meanwhile the answer row carries a phase:
//
// ```ts
// streamsLive("primary", "rules");     // true: shown as it arrives (a 'rules' answer is never retried)
// streamsLive("primary", "unclear");   // false: hidden; the row shows phaseForStep("retry")
// phaseForStep("retry");               // "retry" ('Checking again with a stronger model…')
// phaseForStep("web");                 // "web"   ('Searching the internet…')
// phaseForStep("booksOnlyMiss");       // "done"
// ```

import { PRIMARY_MODEL, RETRY_MODEL } from "./pricing";
import type { Verdict } from "./types";

/** L11: where an answer is while it runs (convex/lib/validators/lorekeeper.ts `answerPhaseValidator`). */
export type AnswerPhase = "books" | "retry" | "web" | "done";

/** L11: a pass is shown while it streams only when it is the first pass and its verdict is 'rules'. */
export function streamsLive(pass: Pass, verdict: Verdict | null): boolean {
  return pass === "primary" && verdict === "rules";
}

/** L11: the phase the row shows for the step that comes next. */
export function phaseForStep(step: NextStep): AnswerPhase {
  if (step === "retry") return "retry";
  if (step === "web") return "web";
  return "done";
}

/** primary = Sonnet's answer, retry = the Opus re-check, web = the internet pass. */
export type Pass = "primary" | "retry" | "web";

export type NextStep = "done" | "retry" | "web" | "booksOnlyMiss";

export function nextStep(input: { pass: Pass; verdict: Verdict; webSearch: boolean }): NextStep {
  const { pass, verdict, webSearch } = input;
  if (pass === "web") return "done";
  if (pass === "primary") return verdict === "rules" ? "done" : "retry";
  if (verdict === "rules") return "done";
  if (webSearch) return "web";
  return verdict === "none" ? "booksOnlyMiss" : "done";
}

/**
 * The model of a pass. `override` is an env model (LOREKEEPER_MODEL) replacing the primary model; the retry always
 * uses RETRY_MODEL, and the web pass the primary model (analysis 8).
 */
export function modelForPass(pass: Pass, override?: string | null): string {
  if (pass === "retry") return RETRY_MODEL;
  return override && override.trim().length > 0 ? override.trim() : PRIMARY_MODEL;
}
