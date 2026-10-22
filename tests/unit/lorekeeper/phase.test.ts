import { describe, expect, it } from "vitest";

import { PHASE_TEXT } from "../../../src/lib/lorekeeper/copy";
import { nextStep, phaseForStep, streamsLive, type AnswerPhase } from "../../../src/lib/lorekeeper/flow";
import type { Verdict } from "../../../src/lib/lorekeeper/types";

// D13 L11 (user decision 2026-10-22): clear answers stream, uncertain ones wait for the final check while the answer
// row shows the process. The run (convex/lorekeeperRun.ts) starts in 'books', moves to `phaseForStep(nextStep(...))`
// after each pass and ends in 'done'. This replays that walk for each verdict path.

type Path = { primary: Verdict; retry?: Verdict; webSearch: boolean };

/** The phases the row shows and whether any text streams live, as the run walks the passes. */
function walk({ primary, retry, webSearch }: Path): { phases: AnswerPhase[]; live: boolean } {
  const phases: AnswerPhase[] = ["books"];
  const push = (phase: AnswerPhase) => {
    if (phases.at(-1) !== phase) phases.push(phase);
  };
  const live = streamsLive("primary", primary);
  let step = nextStep({ pass: "primary", verdict: primary, webSearch });
  push(phaseForStep(step));
  if (step === "retry") {
    expect(retry).toBeDefined();
    expect(streamsLive("retry", retry!)).toBe(false);
    step = nextStep({ pass: "retry", verdict: retry!, webSearch });
    push(phaseForStep(step));
    if (step === "web") push(phaseForStep(nextStep({ pass: "web", verdict: "none", webSearch })));
  }
  return { phases, live };
}

describe("answer phases per verdict path", () => {
  it("a first-pass 'rules' answer streams live and goes straight to done", () => {
    expect(walk({ primary: "rules", webSearch: true })).toEqual({ phases: ["books", "done"], live: true });
    expect(walk({ primary: "rules", webSearch: false })).toEqual({ phases: ["books", "done"], live: true });
  });

  it("'unclear' or 'none' holds the text: books -> retry -> done when the retry settles it or search is off", () => {
    expect(walk({ primary: "unclear", retry: "rules", webSearch: true })).toEqual({ phases: ["books", "retry", "done"], live: false });
    expect(walk({ primary: "none", retry: "rules", webSearch: false })).toEqual({ phases: ["books", "retry", "done"], live: false });
    expect(walk({ primary: "unclear", retry: "unclear", webSearch: false })).toEqual({ phases: ["books", "retry", "done"], live: false });
    expect(walk({ primary: "none", retry: "none", webSearch: false })).toEqual({ phases: ["books", "retry", "done"], live: false });
  });

  it("still unclear or none with search on: books -> retry -> web -> done", () => {
    expect(walk({ primary: "unclear", retry: "unclear", webSearch: true })).toEqual({ phases: ["books", "retry", "web", "done"], live: false });
    expect(walk({ primary: "none", retry: "none", webSearch: true })).toEqual({ phases: ["books", "retry", "web", "done"], live: false });
    expect(walk({ primary: "unclear", retry: "none", webSearch: true })).toEqual({ phases: ["books", "retry", "web", "done"], live: false });
  });

  it("only the first pass with a 'rules' verdict line streams; an unknown verdict waits", () => {
    expect(streamsLive("primary", "rules")).toBe(true);
    expect(streamsLive("primary", null)).toBe(false);
    expect(streamsLive("primary", "unclear")).toBe(false);
    expect(streamsLive("primary", "none")).toBe(false);
    expect(streamsLive("retry", "rules")).toBe(false);
    expect(streamsLive("web", "rules")).toBe(false);
  });

  it("each phase has its process text", () => {
    expect(PHASE_TEXT.books).toBe("Searching your books…");
    expect(PHASE_TEXT.retry).toBe("Checking again with a stronger model…");
    expect(PHASE_TEXT.web).toBe("Searching the internet…");
    expect(phaseForStep("booksOnlyMiss")).toBe("done");
    expect(phaseForStep("done")).toBe("done");
  });
});
