import { describe, expect, it } from "vitest";

import {
  hoursAtTable,
  inWindows,
  leastSpotlightLine,
  logMark,
  mergeLog,
  nextSceneId,
  sceneEncounterId,
  windowsFromMarks,
  type JournalScene,
} from "@/lib/domain/journal";

// Journal J0: the pure helpers the Journal's server and UI tracers share.

const H = 3_600_000;

describe("mergeLog", () => {
  it("sorts the lines of every source by time, stable by source then position", () => {
    const feed = [{ at: 2, id: "f1" }, { at: 5, id: "f2" }];
    const gm = [{ at: 1, id: "g1" }, { at: 2, id: "g2" }, { at: 2, id: "g3" }];
    const fear = [{ at: 2, id: "x1" }];
    expect(mergeLog([feed, gm, fear]).map((l) => l.id)).toEqual(["g1", "f1", "g2", "g3", "x1", "f2"]);
  });

  it("returns an empty list for no sources or empty sources", () => {
    expect(mergeLog([])).toEqual([]);
    expect(mergeLog([[], []])).toEqual([]);
  });
});

describe("nextSceneId", () => {
  it("is the first scene after the playing one that is not done", () => {
    expect(nextSceneId([{ id: "a", state: "done" }, { id: "b", state: "playing" }, { id: "c", state: "done" }, { id: "d" }])).toBe("d");
  });

  it("without a playing scene, is the first scene that is not done", () => {
    expect(nextSceneId([{ id: "a", state: "done" }, { id: "b" }, { id: "c", state: "planned" }])).toBe("b");
  });

  it("is null when nothing is left after the playing scene", () => {
    expect(nextSceneId([{ id: "a" }, { id: "b", state: "playing" }])).toBeNull();
    expect(nextSceneId([])).toBeNull();
  });
});

describe("sceneEncounterId (Q6)", () => {
  const scenes: JournalScene[] = [
    { id: "s1", type: "social" },
    { id: "s2", type: "combat" },
    { id: "s3", type: "combat" },
    { id: "s4", type: "combat", encounterId: "own" },
  ];
  const prep = { scenes, encounterId: "legacy" };

  it("puts the legacy session encounter on the first Combat scene only", () => {
    expect(scenes.map((s, i) => sceneEncounterId(s, i, prep))).toEqual([undefined, "legacy", undefined, "own"]);
  });

  it("prefers the scene's own encounter, and has none without a legacy link", () => {
    const own: JournalScene = { id: "s2", type: "combat", encounterId: "mine" };
    expect(sceneEncounterId(own, 1, prep)).toBe("mine");
    expect(sceneEncounterId(scenes[1]!, 1, { scenes })).toBeUndefined();
  });
});

describe("leastSpotlightLine", () => {
  it("names the PC with the least spotlight", () => {
    expect(leastSpotlightLine([{ name: "Moss", count: 3 }, { name: "Oriel", count: 1 }, { name: "Vex", count: 2 }])).toBe(
      "Oriel has had the least spotlight this session.",
    );
  });

  it("names several tied PCs together", () => {
    expect(leastSpotlightLine([{ name: "Brannoc", count: 0 }, { name: "Moss", count: 3 }, { name: "Oriel", count: 0 }, { name: "Vex", count: 0 }])).toBe(
      "Brannoc, Oriel and Vex have had the least spotlight this session.",
    );
  });

  it("names every PC when all have the same count, all zero too (dcm-nvq4)", () => {
    expect(leastSpotlightLine([{ name: "Moss", count: 2 }, { name: "Vex", count: 2 }])).toBe("Moss and Vex have had the least spotlight this session.");
    expect(leastSpotlightLine([{ name: "Moss", count: 0 }, { name: "Oriel", count: 0 }, { name: "Vex", count: 0 }])).toBe(
      "Moss, Oriel and Vex have had the least spotlight this session.",
    );
  });

  it("is null with no PCs or a single PC", () => {
    expect(leastSpotlightLine([])).toBeNull();
    expect(leastSpotlightLine([{ name: "Vex", count: 0 }])).toBeNull();
  });
});

describe("hoursAtTable (Q3)", () => {
  it("sums playedMs, counts an older played session's last window and a live session's running window", () => {
    const now = 100 * H;
    expect(
      hoursAtTable(
        [
          { status: "played", playedMs: 3 * H },
          { status: "played", startedAt: 10 * H, endedAt: 12 * H },
          { status: "live", playedMs: H, startedAt: now - H / 2 },
          { status: "planned" },
        ],
        now,
      ),
    ).toBe(6.5);
  });

  it("ignores a played session with no times and is 0 for none", () => {
    expect(hoursAtTable([{ status: "played" }], 0)).toBe(0);
    expect(hoursAtTable([], 0)).toBe(0);
  });
});

describe("live windows", () => {
  it("logMark reads event-tagged and legacy auto lines and skips GM lines and scene lines", () => {
    expect(logMark({ at: 1, text: "anything", auto: true, event: "start" })).toEqual({ at: 1, kind: "start" });
    expect(logMark({ at: 2, text: "Session ended. Ash lost 2 unspent dice.", auto: true })).toEqual({ at: 2, kind: "end" });
    expect(logMark({ at: 3, text: "Session started.", auto: false })).toBeNull();
    expect(logMark({ at: 4, text: "Session started.", auto: true, event: "scene" })).toBeNull();
    expect(logMark({ at: 5, text: "Scene 1 began", auto: true })).toBeNull();
  });

  it("pairs starts with ends and leaves a live session's last window open until now", () => {
    const marks = [
      { at: 10, kind: "start" as const },
      { at: 20, kind: "end" as const },
      { at: 30, kind: "start" as const },
    ];
    expect(windowsFromMarks(marks, { status: "live", startedAt: 30 }, 40)).toEqual([
      { from: 10, to: 20, open: false },
      { from: 30, to: 40, open: true },
    ]);
  });

  it("ignores a second start and an end without a start", () => {
    const marks = [
      { at: 5, kind: "end" as const },
      { at: 10, kind: "start" as const },
      { at: 12, kind: "start" as const },
      { at: 20, kind: "end" as const },
    ];
    expect(windowsFromMarks(marks, { status: "played", startedAt: 10, endedAt: 20 }, 99)).toEqual([{ from: 10, to: 20, open: false }]);
  });

  it("falls back on startedAt / endedAt without marks, and has no window when never started", () => {
    expect(windowsFromMarks([], { status: "played", startedAt: 10 * H, endedAt: 11 * H }, 99 * H)).toEqual([{ from: 10 * H, to: 11 * H, open: false }]);
    expect(windowsFromMarks([], { status: "live", startedAt: 10 * H }, 12 * H)).toEqual([{ from: 10 * H, to: 12 * H, open: true }]);
    expect(windowsFromMarks([], { status: "planned" }, 99)).toEqual([]);
  });

  it("closes a played session's unmatched start at endedAt", () => {
    expect(windowsFromMarks([{ at: 10 * H, kind: "start" }], { status: "played", startedAt: 10 * H, endedAt: 13 * H }, 99 * H)).toEqual([
      { from: 10 * H, to: 13 * H, open: false },
    ]);
  });

  it("inWindows includes the bounds", () => {
    const w = [{ from: 10, to: 20, open: false }];
    expect([9, 10, 20, 21].map((at) => inWindows(w, at))).toEqual([false, true, true, false]);
  });
});
