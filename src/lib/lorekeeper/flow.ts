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
// reader sees the process. L12 (user answers 2026-10-22, binding): a pass streams live whenever its text is known to
// be the text the run keeps, and the phase names the pass that is really running.
//
// - A book pass (Sonnet, then the Opus retry) streams once its verdict line says the run ends with it
//   (`nextStep(...) === "done"`): a first-pass 'rules'; a retry 'rules', or a retry 'unclear' with internet search
//   off. A retry 'none' with search off ends as the books-only miss and a retry 'unclear'/'none' with search on goes
//   to the web pass, so those stay hidden: no text is ever shown and later replaced.
// - The web pass always streams (it is the last pass) once it has a web result (lorekeeperRun.ts); before that a
//   web miss is still possible, and a miss stores WEB_MISS.
// - The phase is set when a pass starts (`phaseForPass`): 'books' while Sonnet runs (whatever its verdict line says),
//   'retry' only once the Opus pass starts, 'web' only once the internet pass starts, 'done' at the end.
//
// ```ts
// streamsLive("primary", "rules", true);     // true: shown as it arrives (a 'rules' answer is never retried)
// streamsLive("primary", "unclear", true);   // false: hidden; the row keeps 'Searching your books…'
// streamsLive("retry", "unclear", false);    // true: search is off, the retry's answer is final
// streamsLive("retry", "unclear", true);     // false: the web pass follows
// streamsLive("retry", "none", false);       // false: the books-only miss replaces it
// phaseForPass("retry");                     // "retry" ('Checking again with a stronger model…')
// phaseForPass("web");                       // "web"   ('Searching the internet…')
// ```

import { PRIMARY_MODEL, RETRY_MODEL } from "./pricing";
import type { Verdict } from "./types";

/** L11: where an answer is while it runs (convex/lib/validators/lorekeeper.ts `answerPhaseValidator`). */
export type AnswerPhase = "books" | "retry" | "web" | "done";

/**
 * L12: a book pass is shown while it streams once its verdict is known and the run ends with this pass's text. The
 * web pass is never decided by a verdict (the run shows it once it has a web result), so it answers false here.
 */
export function streamsLive(pass: Pass, verdict: Verdict | null, webSearch: boolean): boolean {
  if (pass === "web" || verdict === null) return false;
  return nextStep({ pass, verdict, webSearch }) === "done";
}

/** L12: the phase the row shows while `pass` runs; set when the pass starts, never earlier. */
export function phaseForPass(pass: Pass): AnswerPhase {
  if (pass === "retry") return "retry";
  if (pass === "web") return "web";
  return "books";
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
