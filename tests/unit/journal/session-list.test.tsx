// Journal JS (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JS.md): the session list, '+ Plan session N',
// 'Campaign so far' and the session heading with the GM's inline edit and menu (Q11). convex/react returns the
// results held here; every mutation is a spy that records its function name and arguments.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../convex/sessionRecords";
import { dayMonth, fullSessionDate, headingLine, nextSessionNumber, shortSessionDate, startTime, wholeHours } from "../../../src/components/journal/session-list/format";

let results: Record<string, unknown> = {};
const calls = vi.hoisted(() => ({ list: [] as { name: string; args: Record<string, unknown> }[], fail: null as string | null }));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[getFunctionName(ref as never)]),
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const run = async (args: Record<string, unknown>) => {
      calls.list.push({ name, args });
      if (calls.fail === name) throw new Error("boom");
      return name === "sessionRecords:create" ? { sessionId: "s8", n: 8 } : null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

const { CampaignSoFar, PlanSessionButton, SessionList } = await import("@/components/journal/session-list");
const { SessionHeading } = await import("@/components/journal/session-head");

const campaignId = "c1" as Id<"campaigns">;
const sid = (n: number) => `s${n}` as Id<"sessions">;

function session(n: number, status: SessionListItem["status"], extra: Partial<SessionListItem> = {}): SessionListItem {
  return { _id: sid(n), n, status, title: `Title ${n}`, date: `2025-11-0${Math.min(n, 9)}`, ...extra };
}
const SESSIONS = [session(7, "planned"), session(6, "live", { startedAt: Date.UTC(2025, 10, 2, 19, 10) }), session(5, "played")];

beforeEach(() => {
  calls.list = [];
  calls.fail = null;
  results = {
    "sessionRecords:list": SESSIONS,
    "sessionRecords:summary": { sessionsPlayed: 4, hoursAtTable: 16.6, asOf: 0, live: true, partyLevel: 3 },
    "notesThreads:threads": [{ _id: "e1" }, { _id: "e2" }],
  };
});
afterEach(cleanup);

describe("format helpers", () => {
  it("shortSessionDate: weekday, day and month without the year; fallbacks", () => {
    expect(shortSessionDate("2025-11-02")).toBe("Sun 2 Nov");
    expect(shortSessionDate(undefined)).toBe("No date set");
    expect(shortSessionDate("someday")).toBe("someday");
  });

  it("dcm-z9rz.31: dates read day then month whatever the browser's locale", () => {
    const spy = vi.spyOn(Date.prototype, "toLocaleDateString").mockReturnValue("Sun, Nov 2");
    try {
      expect(shortSessionDate("2025-11-02")).toBe("Sun 2 Nov");
      expect(fullSessionDate("2025-11-02")).toBe("Sun 2 Nov 2025");
      expect(dayMonth(new Date(2025, 10, 2, 9, 5).getTime())).toBe("2 Nov");
      expect(startTime(new Date(2025, 10, 2, 9, 5).getTime())).toBe("09:05");
    } finally {
      spy.mockRestore();
    }
    expect(fullSessionDate(null)).toBe("No date set");
  });

  it("headingLine adds the start time only when known", () => {
    expect(headingLine({ n: 6, date: "2025-11-02" })).toBe("Session 6 · Sun 2 Nov");
    const at = new Date(2025, 10, 2, 19, 10).getTime();
    expect(headingLine({ n: 6, date: "2025-11-02", startedAt: at })).toBe("Session 6 · Sun 2 Nov · 19:10");
    expect(startTime(undefined)).toBeNull();
  });

  it("nextSessionNumber is the highest + 1; wholeHours rounds", () => {
    expect(nextSessionNumber([{ n: 2 }, { n: 7 }, { n: 5 }])).toBe(8);
    expect(nextSessionNumber([])).toBe(1);
    expect(wholeHours(16.6)).toBe(17);
    expect(wholeHours(0.2)).toBe(0);
  });
});

describe("SessionList", () => {
  it("lists every session newest first with chips; the selected one is current", () => {
    const onSelect = vi.fn();
    render(<SessionList campaignId={campaignId} isGm selectedId={sid(6)} onSelect={onSelect} />);
    const items = within(screen.getByRole("list", { name: "Sessions" })).getAllByRole("button");
    expect(items.map((b) => b.getAttribute("aria-label"))).toEqual([
      `Session 7: Title 7, ${shortSessionDate("2025-11-07")}, Planned`,
      `Session 6: Title 6, ${shortSessionDate("2025-11-06")}, Live`,
      `Session 5: Title 5, ${shortSessionDate("2025-11-05")}`,
    ]);
    expect(items.map((b) => b.textContent)).toEqual([
      `7Title 7${shortSessionDate("2025-11-07")}Planned`,
      `6Title 6${shortSessionDate("2025-11-06")}Live`,
      `5Title 5${shortSessionDate("2025-11-05")}`,
    ]);
    expect(items[1]).toHaveAttribute("aria-current", "true");
    expect(items[0]).not.toHaveAttribute("aria-current");
    fireEvent.click(items[0]!);
    expect(onSelect).toHaveBeenCalledWith(sid(7));
  });

  it("loading and empty states for the GM and players", () => {
    results["sessionRecords:list"] = undefined;
    render(<SessionList campaignId={campaignId} isGm selectedId={null} onSelect={vi.fn()} />);
    // The page's own status line announces the loading; the column's line is not a second live region.
    expect(screen.getByText("Loading sessions…")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    results["sessionRecords:list"] = [];
    render(<SessionList campaignId={campaignId} isGm selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/Plan the first one below/)).toBeInTheDocument();
    cleanup();
    render(<SessionList campaignId={campaignId} isGm={false} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/once the GM starts one/)).toBeInTheDocument();
  });
});

describe("PlanSessionButton", () => {
  it("names the next number, creates it and opens it", async () => {
    const onCreated = vi.fn();
    render(<PlanSessionButton campaignId={campaignId} isGm onCreated={onCreated} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Plan session 8" })));
    expect(calls.list).toEqual([{ name: "sessionRecords:create", args: { campaignId, idempotencyKey: expect.any(String) } }]);
    expect(onCreated).toHaveBeenCalledWith("s8");
  });

  it("renders nothing for players", () => {
    const { container } = render(<PlanSessionButton campaignId={campaignId} isGm={false} onCreated={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CampaignSoFar", () => {
  it("shows the summary and the caller's open threads", () => {
    render(<CampaignSoFar campaignId={campaignId} isGm />);
    const card = screen.getByRole("region", { name: "Campaign so far" });
    const rows = within(card).getAllByRole("term").map((t) => `${t.textContent}=${t.nextElementSibling?.textContent}`);
    expect(rows).toEqual(["Sessions played=4", "Hours at the table=17", "Party level=3", "Open threads=2"]);
  });

  it("shows '…' for each value still loading (no second status line)", () => {
    results["sessionRecords:summary"] = undefined;
    render(<CampaignSoFar campaignId={campaignId} isGm={false} />);
    const list = screen.getByRole("region", { name: "Campaign so far" }).querySelector("dl")!;
    expect(list).toHaveAttribute("aria-busy", "true");
    expect(within(list).getAllByText("loading")).toHaveLength(3);
    expect(list.textContent).toContain("Open threads2");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("SessionHeading", () => {
  const heading = (props: { isGm?: boolean; sessionId?: Id<"sessions">; onDeleted?: () => void } = {}) =>
    render(<SessionHeading campaignId={campaignId} isGm={props.isGm ?? true} sessionId={props.sessionId ?? sid(7)} onDeleted={props.onDeleted ?? vi.fn()} />);

  it("GM: renames on Enter, Escape cancels, an unchanged title sends nothing", () => {
    heading();
    expect(screen.getByRole("heading", { level: 2, name: "Title 7" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Title 7" }));
    const input = screen.getByRole("textbox", { name: "Session 7 title" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "The chapel in the briar" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(calls.list).toEqual([{ name: "sessionRecords:setTitle", args: { campaignId, sessionId: sid(7), title: "The chapel in the briar" } }]);

    calls.list = [];
    fireEvent.click(screen.getByRole("button", { name: "Title 7" }));
    const again = screen.getByRole("textbox", { name: "Session 7 title" });
    fireEvent.change(again, { target: { value: "Nope" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Title 7" }));
    fireEvent.blur(screen.getByRole("textbox", { name: "Session 7 title" }));
    expect(calls.list).toEqual([]);
  });

  it("GM: changes and clears the date", () => {
    heading();
    fireEvent.click(screen.getByRole("button", { name: shortSessionDate("2025-11-07") }));
    const input = screen.getByLabelText("Session 7 date");
    fireEvent.change(input, { target: { value: "2025-11-09" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: shortSessionDate("2025-11-07") }));
    const cleared = screen.getByLabelText("Session 7 date");
    fireEvent.change(cleared, { target: { value: "" } });
    fireEvent.blur(cleared);
    expect(calls.list).toEqual([
      { name: "sessionRecords:setDate", args: { campaignId, sessionId: sid(7), date: "2025-11-09" } },
      { name: "sessionRecords:setDate", args: { campaignId, sessionId: sid(7), date: null } },
    ]);
  });

  it("GM menu: mark as played, delete asks twice", async () => {
    const onDeleted = vi.fn();
    heading({ onDeleted });
    const menu = screen.getByRole("button", { name: "Session menu" });
    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Mark as played" }));
    expect(calls.list).toEqual([{ name: "sessionRecords:setPlayed", args: { campaignId, sessionId: sid(7), played: true } }]);
    expect(menu).toHaveAttribute("aria-expanded", "false");

    calls.list = [];
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    expect(calls.list).toEqual([]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Click again to delete" })));
    expect(calls.list).toEqual([{ name: "sessionRecords:remove", args: { campaignId, sessionId: sid(7) } }]);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("GM menu: Escape closes it and cancels a pending delete; a failure shows an alert", async () => {
    heading();
    fireEvent.click(screen.getByRole("button", { name: "Session menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Session menu" }));
    expect(screen.getByRole("button", { name: "Delete session" })).toBeInTheDocument();

    calls.fail = "sessionRecords:remove";
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Click again to delete" })));
    expect(screen.getByRole("alert")).toHaveTextContent(/went wrong/);
  });

  it("GM: the live session shows Live and its menu actions are disabled", () => {
    heading({ sessionId: sid(6) });
    expect(screen.getByText("Live")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Session menu" }));
    expect(screen.getByRole("button", { name: "Mark as played" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete session" })).toBeDisabled();
    expect(screen.getByText(/End the session first/)).toBeInTheDocument();
  });

  it("GM: a played session offers 'Mark as not played'", () => {
    heading({ sessionId: sid(5) });
    fireEvent.click(screen.getByRole("button", { name: "Session menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as not played" }));
    expect(calls.list).toEqual([{ name: "sessionRecords:setPlayed", args: { campaignId, sessionId: sid(5), played: false } }]);
  });

  it("player: read only, no menu", () => {
    heading({ isGm: false, sessionId: sid(6) });
    expect(screen.getByRole("heading", { level: 2, name: "Title 6" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an unknown id and the loading state", () => {
    heading({ sessionId: sid(99) });
    expect(screen.getByText(/isn't in this campaign anymore/)).toBeInTheDocument();
    cleanup();
    results["sessionRecords:list"] = undefined;
    heading();
    expect(screen.getByRole("status")).toHaveTextContent("Loading the session…");
  });
});
