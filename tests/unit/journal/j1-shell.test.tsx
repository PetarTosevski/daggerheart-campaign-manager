// Journal J1 (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-J1.md): the page shell's URL state (tab, s, sv;
// the Notes params kept), the default session (live, else newest), the header frame, the sub-tab counts and the
// GM-only Plan / Log & recap toggle. convex/react returns the results held here; next/navigation is a fake router.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../convex/sessionRecords";
import { defaultSessionId, journalHref, parseSessionView, parseTab } from "../../../src/components/journal/slots";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
const who = vi.hoisted(() => ({ role: "gm" as "gm" | "player" }));
let results: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[getFunctionName(ref as never)]),
  useMutation: () => Object.assign(async () => null, { withOptimisticUpdate: () => async () => null }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/campaigns/c1/journal",
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The Notes sub-tab is a slot (JN renders the Notes UI there, with a next/font face jsdom cannot load): a stub here.
vi.mock("@/components/journal/notes-tab", () => ({ NotesTab: () => null }));
vi.mock("@/app/(gm)/campaigns/[campaignId]/campaign-shell", () => ({
  useCampaign: () => ({ _id: "c1", name: "Ashes", frameId: "witherwild", role: who.role }),
}));

const { default: JournalPage } = await import("@/app/(gm)/campaigns/[campaignId]/journal/page");

function session(n: number, status: SessionListItem["status"]): SessionListItem {
  return { _id: `s${n}` as Id<"sessions">, n, status };
}
const SESSIONS = [session(7, "planned"), session(6, "live"), session(5, "played")];

beforeEach(() => {
  nav.search = "";
  who.role = "gm";
  results = {
    "sessionRecords:list": SESSIONS,
    "notes:journal": { isGm: true, whoName: "GM", whoSub: "", journal: { _id: "j1", pageCount: 11, entryCount: 0, openCount: 0 }, pages: [] },
  };
});
afterEach(() => {
  cleanup();
  nav.replace.mockReset();
});

describe("URL helpers", () => {
  it("parseTab falls back to sessions", () => {
    expect(parseTab("notes")).toBe("notes");
    expect(parseTab("sessions")).toBe("sessions");
    expect(parseTab("bogus")).toBe("sessions");
    expect(parseTab(null)).toBe("sessions");
  });

  it("parseSessionView: plan by default for the GM, always log for players (Q5)", () => {
    expect(parseSessionView(null, true)).toBe("plan");
    expect(parseSessionView("log", true)).toBe("log");
    expect(parseSessionView("wrap", true)).toBe("plan");
    expect(parseSessionView("plan", false)).toBe("log");
    expect(parseSessionView(null, false)).toBe("log");
  });

  it("defaultSessionId: the live session, else the newest; undefined loading, null for none", () => {
    expect(defaultSessionId(undefined)).toBeUndefined();
    expect(defaultSessionId([])).toBeNull();
    expect(defaultSessionId(SESSIONS)).toBe("s6");
    expect(defaultSessionId([session(3, "planned"), session(2, "played")])).toBe("s3");
  });

  it("journalHref builds the Journal link", () => {
    expect(journalHref("c1")).toBe("/campaigns/c1/journal");
    expect(journalHref("c1", { tab: "notes", page: "p1" })).toBe("/campaigns/c1/journal?tab=notes&page=p1");
    expect(journalHref("c1", { s: "s6", sv: "log" })).toBe("/campaigns/c1/journal?s=s6&sv=log");
  });
});

describe("Journal page", () => {
  it("GM: header frame, sub-tab counts, Plan selected, the Combat Map link", () => {
    render(<JournalPage />);
    expect(screen.getByText("The Witherwild")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Journal" })).toBeTruthy();
    expect(screen.getByText("Every session and every note, in one place.")).toBeTruthy();

    const tabs = within(screen.getByRole("tablist", { name: "Journal" }));
    expect(tabs.getByRole("tab", { name: "Sessions 3" }).getAttribute("aria-selected")).toBe("true");
    expect(tabs.getByRole("tab", { name: "Notes 11 pages" }).getAttribute("aria-selected")).toBe("false");

    const toggle = within(screen.getByRole("tablist", { name: "Session view" }));
    expect(toggle.getByRole("tab", { name: "Plan" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("link", { name: "Play on the Combat Map" }).getAttribute("href")).toBe("/campaigns/c1/combat-map");
    expect(screen.getByRole("complementary", { name: "All sessions" })).toBeTruthy();
  });

  it("switching the view keeps the selected session; switching the sub-tab keeps the other params", () => {
    nav.search = "view=threads&page=p1";
    render(<JournalPage />);
    fireEvent.click(screen.getByRole("tab", { name: "Log & recap" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/campaigns/c1/journal?view=threads&page=p1&s=s6&sv=log", { scroll: false });
    fireEvent.click(screen.getByRole("tab", { name: /^Notes/ }));
    expect(nav.replace).toHaveBeenLastCalledWith("/campaigns/c1/journal?view=threads&page=p1&tab=notes", { scroll: false });
  });

  it("arrow keys move between the sub-tabs", () => {
    render(<JournalPage />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Sessions 3" }), { key: "ArrowRight" });
    expect(nav.replace).toHaveBeenLastCalledWith("/campaigns/c1/journal?tab=notes", { scroll: false });
  });

  it("?tab=notes shows the Notes panel; a bad tab or view falls back", () => {
    nav.search = "tab=notes";
    render(<JournalPage />);
    expect(screen.getByRole("tab", { name: "Notes 11 pages" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("complementary", { name: "All sessions" })).toBeNull();
    cleanup();

    nav.search = "tab=nope&sv=nope";
    render(<JournalPage />);
    expect(screen.getByRole("tab", { name: "Sessions 3" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Plan" }).getAttribute("aria-selected")).toBe("true");
  });

  it("player: no view toggle, even with ?sv=plan; the Combat Map link stays", () => {
    who.role = "player";
    nav.search = "sv=plan";
    results["sessionRecords:list"] = [session(6, "live")];
    render(<JournalPage />);
    expect(screen.queryByRole("tablist", { name: "Session view" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Sessions 1" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Play on the Combat Map" })).toBeTruthy();
  });

  it("loading and empty states", () => {
    results["sessionRecords:list"] = undefined;
    results["notes:journal"] = undefined;
    render(<JournalPage />);
    expect(screen.getByRole("status").textContent).toBe("Loading sessions…");
    expect(screen.getByRole("tab", { name: "Sessions" })).toBeTruthy();
    cleanup();

    results["sessionRecords:list"] = [];
    render(<JournalPage />);
    expect(screen.getByRole("heading", { name: "No sessions yet" })).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Session view" })).toBeNull();
  });

  it("the Notes count uses the default pages before the journal exists", () => {
    results["notes:journal"] = { isGm: true, whoName: "GM", whoSub: "", journal: null, templates: [{}, {}, {}] };
    render(<JournalPage />);
    expect(screen.getByRole("tab", { name: "Notes 3 pages" })).toBeTruthy();
  });
});
