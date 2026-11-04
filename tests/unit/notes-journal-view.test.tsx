// dcm-bxp.110: the journal view's page meta shows the linked session's date (D6), as the own page does, and the
// creation date for an unlinked page. convex/react is replaced (useQuery answers the journal view); N3's entries slot
// and N7's tear-out button are stubbed, they are not under test here.
import { fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import type { JournalViewData, JournalViewPage } from "../../convex/notesJournals";
import type { NotesSlotProps } from "../../src/components/notes/slots";
import { pageMeta } from "../../src/lib/domain/notes";

const CAMPAIGN = "c1" as Id<"campaigns">;
const CREATED = Date.UTC(2026, 9, 1, 12);

function page(id: string, extra: Partial<JournalViewPage> = {}): JournalViewPage {
  return {
    _id: id as Id<"journalPages">,
    title: id,
    kind: "log",
    tape: 1,
    createdAt: CREATED,
    entryCount: 0,
    openCount: 0,
    chip: "Everyone",
    canAdd: false,
    canBin: false,
    ...extra,
  };
}

const data: JournalViewData = {
  journalId: "j1" as Id<"journals">,
  title: "Ash’s Journal",
  ownerName: "Ash",
  ownerIsGm: false,
  own: false,
  departed: false,
  pages: [
    page("dated", { session: { n: 3, date: "2026-10-24" } }),
    page("undated", { session: { n: 4 } }),
    page("unlinked", { kind: "collection" }),
  ],
};

// Each test may answer the queries differently (WritingAs reads notes.journal and notesJournals.playerJournals).
let answer: (name: string, args: unknown) => unknown = () => data;
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => (args === "skip" ? undefined : answer(getFunctionName(ref), args)),
  useMutation: () => Object.assign(async () => null, { withOptimisticUpdate: () => async () => null }) }));
vi.mock("@/components/notes/entries", () => ({ Entries: () => null }));
vi.mock("@/components/notes/bin", () => ({ TearOutButton: () => null }));

const { JournalView } = await import("@/components/notes/journals");
const { WritingAs, chipInitials } = await import("@/components/notes/header");

function slot(pageId: string, extra: Partial<NotesSlotProps> = {}): NotesSlotProps {
  return {
    campaignId: CAMPAIGN,
    access: { isGm: true },
    journalId: "j1",
    pageId: pageId as Id<"journalPages">,
    view: "journal",
    search: "",
    matchingPageIds: null,
    onPage: () => {},
    onView: () => {},
    onSearch: () => {},
    ...extra,
  };
}

const meta = () => document.querySelector(".bj-page-meta")?.textContent;

describe("JournalView page meta (dcm-bxp.110)", () => {
  it("a page linked to a dated session shows the session's date, not the creation date", () => {
    render(<JournalView {...slot("dated")} />);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("dated");
    expect(meta()).toBe(pageMeta({ kind: "log", createdAt: CREATED }, { date: "2026-10-24" }));
    expect(meta()).not.toBe(pageMeta({ kind: "log", createdAt: CREATED }));
  });

  it("a page linked to a session without a date says so", () => {
    render(<JournalView {...slot("undated")} />);
    expect(meta()).toBe(pageMeta({ kind: "log", createdAt: CREATED }, {}));
    expect(meta()).toMatch(/No date set/i);
  });

  it("an unlinked page shows its creation date", () => {
    render(<JournalView {...slot("unlinked")} />);
    expect(meta()).toBe(pageMeta({ kind: "collection", createdAt: CREATED }));
  });
});

// Journal JN2 (user Q12 default): 'Writing as' chips. The GM: 'Game Master' plus each present player journal; a player:
// one chip, their own. Picking a player's chip opens the journal view; the own chip goes back to the own page.
describe("WritingAs chips (Journal JN2, Q12)", () => {
  const gmJournal = { isGm: true, whoName: "Game Master", whoSub: "GM journal · private to the GM", journal: null, templates: [] };
  const playerJournal = { isGm: false, whoName: "Moss", whoSub: "Player journal · Ranger", journal: null, templates: [] };
  const players = [
    { journalId: "jb", name: "Brannoc", sub: "Player journal · Guardian", pageCount: 2 },
    { journalId: "jm", name: "Moss", sub: "Player journal · Ranger", pageCount: 1 },
  ];
  const queries: string[] = [];

  function answers(own: unknown, list: unknown) {
    answer = (name) => {
      queries.push(name);
      return name === "notes:journal" ? own : name === "notesJournals:playerJournals" ? list : undefined;
    };
  }
  const chipNames = () => screen.getAllByRole("button").map((b) => b.textContent);
  const pressed = (name: string) => screen.getByRole("button", { name: new RegExp(name) }).getAttribute("aria-pressed");

  afterEach(() => {
    answer = () => data;
    queries.length = 0;
  });

  it("the GM sees 'Game Master' and each player journal, labelled 'Writing as'", () => {
    answers(gmJournal, players);
    render(<WritingAs {...slot("", { view: "page", journalId: null })} />);
    expect(screen.getByRole("group", { name: "Writing as" })).toBeTruthy();
    expect(chipNames()).toEqual(["GMGame Master", "BRBrannoc", "MOMoss"]);
    expect(pressed("Game Master")).toBe("true");
    expect(pressed("Brannoc")).toBe("false");
  });

  it("picking a player's chip opens their journal; the GM chip goes back to the own page", () => {
    answers(gmJournal, players);
    const onView = vi.fn();
    const onPage = vi.fn();
    render(<WritingAs {...slot("", { view: "journal", journalId: "jb", onView, onPage })} />);
    expect(pressed("Brannoc")).toBe("true");
    expect(pressed("Game Master")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /Moss/ }));
    expect(onView).toHaveBeenCalledWith("journal", "jm");
    fireEvent.click(screen.getByRole("button", { name: /Game Master/ }));
    expect(onPage).toHaveBeenCalledWith(null, "page");
  });

  it("a player sees one chip, their own, and never asks for the players' journals", () => {
    answers(playerJournal, players);
    render(<WritingAs {...slot("", { access: { isGm: false }, view: "page", journalId: null })} />);
    expect(chipNames()).toEqual(["MOMoss"]);
    expect(pressed("Moss")).toBe("true");
    expect(queries).not.toContain("notesJournals:playerJournals");
  });

  it("shows a loading line until both queries answer", () => {
    answers(gmJournal, undefined);
    render(<WritingAs {...slot("", { view: "page", journalId: null })} />);
    expect(screen.getByRole("status").textContent).toMatch(/Loading journals/);
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("initials: GM, first and last word, or the first two letters", () => {
    expect(chipInitials("Game Master", true)).toBe("GM");
    expect(chipInitials("Oriel Ashveil", false)).toBe("OA");
    expect(chipInitials("vex", false)).toBe("VE");
    expect(chipInitials("  ", false)).toBe("?");
  });
});
