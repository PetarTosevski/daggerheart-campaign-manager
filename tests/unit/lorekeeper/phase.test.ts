import { describe, expect, it } from "vitest";

import { PHASE_TEXT, STOPPED_EARLY_NOTE } from "../../../src/lib/lorekeeper/copy";
import { nextStep, phaseForPass, streamsLive, type AnswerPhase, type Pass } from "../../../src/lib/lorekeeper/flow";
import type { Verdict } from "../../../src/lib/lorekeeper/types";

// D13 L11 + L12 (user answers 2026-10-22, binding): the phase names the pass really running, set when the pass
// starts ('retry' only once the Opus pass starts), and a pass streams live whenever the run keeps its text. This
// replays the run's walk (convex/lorekeeperRun.ts) for each verdict path: the event list is what the reader sees in
// order ('books', 'retry', 'web' phases; 'live:<pass>' when that pass writes out; 'done').

type Path = { primary: Verdict; retry?: Verdict; webSearch: boolean; webFinds?: boolean };

function walk({ primary, retry, webSearch, webFinds = true }: Path): string[] {
  const events: string[] = [];
  const phase = (p: AnswerPhase) => {
    if (events.at(-1) !== p) events.push(p);
  };
  const run = (pass: Pass, verdict: Verdict) => {
    phase(phaseForPass(pass));
    if (streamsLive(pass, verdict, webSearch)) events.push(`live:${pass}`);
  };
  run("primary", primary);
  let step = nextStep({ pass: "primary", verdict: primary, webSearch });
  if (step === "retry") {
    // The first verdict line said unclear/none: the phase stays 'books' until the retry starts.
    expect(events.at(-1)).toBe("books");
    run("retry", retry!);
    step = nextStep({ pass: "retry", verdict: retry!, webSearch });
  }
  if (step === "web") {
    phase(phaseForPass("web"));
    if (retry === "unclear") events.push("show:book");
    if (webFinds) events.push("live:web");
  }
  events.push("done");
  return events;
}

describe("answer phases per verdict path (L12)", () => {
  it("a first-pass 'rules' answer streams live under 'books' and ends", () => {
    expect(walk({ primary: "rules", webSearch: true })).toEqual(["books", "live:primary", "done"]);
    expect(walk({ primary: "rules", webSearch: false })).toEqual(["books", "live:primary", "done"]);
  });

  it("'retry' starts with the Opus pass; a retry 'rules' or a retry 'unclear' with search off writes out live", () => {
    expect(walk({ primary: "unclear", retry: "rules", webSearch: true })).toEqual(["books", "retry", "live:retry", "done"]);
    expect(walk({ primary: "none", retry: "rules", webSearch: false })).toEqual(["books", "retry", "live:retry", "done"]);
    expect(walk({ primary: "unclear", retry: "unclear", webSearch: false })).toEqual(["books", "retry", "live:retry", "done"]);
  });

  it("a retry 'none' with search off stays hidden: the books-only miss is stored instead", () => {
    expect(walk({ primary: "none", retry: "none", webSearch: false })).toEqual(["books", "retry", "done"]);
  });

  it("still unclear or none with search on: the retry stays hidden, the web pass writes out", () => {
    // unclear + web: the kept book answer shows when the web pass starts, then the web part writes out under it.
    expect(walk({ primary: "unclear", retry: "unclear", webSearch: true })).toEqual(["books", "retry", "web", "show:book", "live:web", "done"]);
    // none + web: the web answer writes out.
    expect(walk({ primary: "none", retry: "none", webSearch: true })).toEqual(["books", "retry", "web", "live:web", "done"]);
    expect(walk({ primary: "unclear", retry: "none", webSearch: true })).toEqual(["books", "retry", "web", "live:web", "done"]);
    // A web miss shows nothing before WEB_MISS.
    expect(walk({ primary: "none", retry: "none", webSearch: true, webFinds: false })).toEqual(["books", "retry", "web", "done"]);
  });

  it("streamsLive: a book pass the run ends with streams; an unknown verdict waits; the web pass is decided by its results", () => {
    expect(streamsLive("primary", "rules", true)).toBe(true);
    expect(streamsLive("primary", null, true)).toBe(false);
    expect(streamsLive("primary", "unclear", false)).toBe(false);
    expect(streamsLive("primary", "none", false)).toBe(false);
    expect(streamsLive("retry", "rules", true)).toBe(true);
    expect(streamsLive("retry", "unclear", false)).toBe(true);
    expect(streamsLive("retry", "unclear", true)).toBe(false);
    expect(streamsLive("retry", "none", true)).toBe(false);
    expect(streamsLive("retry", "none", false)).toBe(false);
    expect(streamsLive("retry", null, false)).toBe(false);
    expect(streamsLive("web", "rules", true)).toBe(false);
  });

  it("each pass has its phase and process text, and the early-Stop note", () => {
    expect([phaseForPass("primary"), phaseForPass("retry"), phaseForPass("web")]).toEqual(["books", "retry", "web"]);
    expect(PHASE_TEXT.books).toBe("Searching your books…");
    expect(PHASE_TEXT.retry).toBe("Checking again with a stronger model…");
    expect(PHASE_TEXT.web).toBe("Searching the internet…");
    expect(STOPPED_EARLY_NOTE).toBe("Stopped before an answer was ready. Ask again to get one.");
  });
});
