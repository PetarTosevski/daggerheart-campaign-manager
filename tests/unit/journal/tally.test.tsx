// Journal JT (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JT.md): the six tally tiles ('-' before the session
// was live, a floor note when truncated) and the Spotlight bars (scaled to the highest count, Reset optimistic, the
// least-spotlight line, no tap to add: Q9). The tiles are GM only (Q5); the bars reach players when
// `journalTally.spotlight` returns them (config JO3).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { JournalTally } from "../../../convex/journalTally";
import type { SpotlightEntry } from "../../../convex/sessionPlay";

const state = vi.hoisted(() => ({
  results: {} as Record<string, unknown>,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  fail: {} as Record<string, Error>,
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : state.results[getFunctionName(ref as never)]),
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const run = async (args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      if (state.fail[name]) throw state.fail[name];
      return null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

const { SessionTally, Spotlight } = await import("../../../src/components/journal/tally");
const model = await import("../../../src/components/journal/tally/model");

const CAMPAIGN = "c1" as Id<"campaigns">;
const SESSION = "s6" as Id<"sessions">;

const TALLY: JournalTally = { fearGained: 4, fearSpent: 3, hopeSpent: 9, hpMarked: 7, adversariesDefeated: 2, criticals: 2, live: true, truncated: false };
const NULL_TALLY: JournalTally = { fearGained: null, fearSpent: null, hopeSpent: null, hpMarked: null, adversariesDefeated: null, criticals: null, live: false, truncated: false };

const entry = (id: string, name: string, count: number, due = false): SpotlightEntry => ({ characterId: id as Id<"characters">, name, count, due });
const SPOT = [entry("moss", "Moss", 6), entry("brannoc", "Brannoc", 5), entry("vex", "Vex", 3), entry("oriel", "Oriel", 2, true)];

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  state.calls = [];
  state.fail = {};
  state.results = { "journalTally:tally": TALLY, "journalTally:spotlight": SPOT, "charactersReads:partySummary": [] };
});
afterEach(cleanup);

describe("SessionTally", () => {
  it("shows the six tiles in the design's order", () => {
    render(<SessionTally campaignId={CAMPAIGN} sessionId={SESSION} isGm />);
    expect(screen.getByRole("heading", { name: "Session tally" })).toBeTruthy();
    const tiles = within(screen.getByRole("list", { name: "Session tally counts" })).getAllByRole("listitem");
    expect(tiles.map((t) => t.textContent)).toEqual(["4 Fear gained", "3 Fear spent", "9 Hope spent", "7 HP marked", "2 Adversaries defeated", "2 Critical successes"]);
  });

  it("shows '-' before the session was live, with a note", () => {
    state.results["journalTally:tally"] = NULL_TALLY;
    render(<SessionTally campaignId={CAMPAIGN} sessionId={SESSION} isGm />);
    const tiles = within(screen.getByRole("list", { name: "Session tally counts" })).getAllByRole("listitem");
    expect(tiles[0]!.textContent).toBe("-none yet Fear gained");
    expect(screen.getByText("Counts itself once the session starts.")).toBeTruthy();
  });

  it("notes a floor when truncated", () => {
    state.results["journalTally:tally"] = { ...TALLY, truncated: true };
    render(<SessionTally campaignId={CAMPAIGN} sessionId={SESSION} isGm />);
    expect(screen.getByText(/at least the counts shown/)).toBeTruthy();
  });

  it("shows a loading line, and nothing for players", () => {
    state.results["journalTally:tally"] = undefined;
    const { unmount } = render(<SessionTally campaignId={CAMPAIGN} sessionId={SESSION} isGm />);
    expect(screen.getByRole("status").textContent).toBe("Loading the tally…");
    unmount();
    const { container } = render(<SessionTally campaignId={CAMPAIGN} sessionId={SESSION} isGm={false} />);
    expect(container.textContent).toBe("");
  });
});

describe("Spotlight", () => {
  it("draws a bar per PC scaled to the highest count, and the least-spotlight line", () => {
    const { container } = render(<Spotlight campaignId={CAMPAIGN} sessionId={SESSION} isGm />);
    const rows = within(screen.getByRole("list", { name: "Spotlight per character" })).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Moss: 6 spotlight moments",
      "Brannoc: 5 spotlight moments",
      "Vex: 3 spotlight moments",
      "Oriel: 2 spotlight moments",
    ]);
    const widths = [...container.querySelectorAll<HTMLElement>(".jt-fill")].map((f) => f.style.width);
    expect(widths).toEqual(["100%", "83%", "50%", "33%"]);
    expect(screen.getByText("Oriel has had the least spotlight this session.")).toBeTruthy();
  });

  it("has no tap to add (Q9): the bars are not buttons", () => {
    render(<Spotlight campaignId={CAMPAIGN} sessionId={SESSION} isGm />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Reset"]);
  });

  it("Reset sends the intent; a failure shows an alert", async () => {
    render(<Spotlight campaignId={CAMPAIGN} sessionId={SESSION} isGm />);
    state.fail["sessionPlay:resetSpotlight"] = new Error("Nope");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await flush();
    expect(state.calls).toEqual([{ name: "sessionPlay:resetSpotlight", args: { campaignId: CAMPAIGN, sessionId: SESSION } }]);
    expect(screen.getByRole("alert").textContent).toContain("try again");
  });

  it("names every PC when everyone ties (dcm-nvq4); Reset disabled at zero", () => {
    state.results["journalTally:spotlight"] = SPOT.map((e) => ({ ...e, count: 0, due: true }));
    const { container } = render(<Spotlight campaignId={CAMPAIGN} sessionId={SESSION} isGm />);
    expect(screen.getByText("Moss, Brannoc, Vex and Oriel have had the least spotlight this session.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement).disabled).toBe(true);
    expect([...container.querySelectorAll<HTMLElement>(".jt-fill")].every((f) => f.style.width === "0%")).toBe(true);
  });

  it("loading and empty party", () => {
    state.results["journalTally:spotlight"] = undefined;
    const first = render(<Spotlight campaignId={CAMPAIGN} sessionId={SESSION} isGm />);
    expect(screen.getByRole("status").textContent).toBe("Loading the spotlight…");
    first.unmount();
    state.results["journalTally:spotlight"] = [];
    render(<Spotlight campaignId={CAMPAIGN} sessionId={SESSION} isGm />);
    expect(screen.getByText("No active characters in the party yet.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  // Config JO3 (Q5 a): a player sees the bars and the least-spotlight line when the read returns them (setting on),
  // never Reset; with the setting off the read returns null and nothing renders (nor while it loads).
  it("a player with the setting on sees the bars and the line, without Reset", () => {
    render(<Spotlight campaignId={CAMPAIGN} sessionId={SESSION} isGm={false} />);
    expect(within(screen.getByRole("list", { name: "Spotlight per character" })).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Oriel has had the least spotlight this session.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a player with the setting off (null) or while loading sees nothing", () => {
    state.results["journalTally:spotlight"] = null;
    const first = render(<Spotlight campaignId={CAMPAIGN} sessionId={SESSION} isGm={false} />);
    expect(first.container.textContent).toBe("");
    first.unmount();
    state.results["journalTally:spotlight"] = undefined;
    const { container } = render(<Spotlight campaignId={CAMPAIGN} sessionId={SESSION} isGm={false} />);
    expect(container.textContent).toBe("");
  });
});

describe("model", () => {
  it("barPercent scales to the highest count", () => {
    expect(model.barPercent(3, 6)).toBe(50);
    expect(model.barPercent(6, 6)).toBe(100);
    expect(model.barPercent(0, 0)).toBe(0);
  });

  it("resetPending zeroes the cached counts and marks everyone due", () => {
    const cache = new Map<string, unknown>([["journalTally:spotlight", SPOT]]);
    const store = {
      getQuery: (ref: unknown) => cache.get(getFunctionName(ref as never)),
      setQuery: (ref: unknown, _args: unknown, value: unknown) => cache.set(getFunctionName(ref as never), value),
    };
    model.resetPending(store as never, { campaignId: CAMPAIGN, sessionId: SESSION });
    expect(cache.get("journalTally:spotlight")).toEqual(SPOT.map((e) => ({ ...e, count: 0, due: true })));
  });

  it("lists six tiles", () => {
    expect(model.TALLY_TILES.map((t) => t.key)).toEqual(["fearGained", "fearSpent", "hopeSpent", "hpMarked", "adversariesDefeated", "criticals"]);
  });
});
