// dcm-bxp.110: the journal view's page meta shows the linked session's date (D6), as the own page does, and the
// creation date for an unlinked page. convex/react is replaced (useQuery answers the journal view); N3's entries slot
// and N7's tear-out button are stubbed, they are not under test here.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("convex/react", () => ({ useQuery: () => data, useMutation: () => Object.assign(async () => null, { withOptimisticUpdate: () => async () => null }) }));
vi.mock("@/components/notes/entries", () => ({ Entries: () => null }));
vi.mock("@/components/notes/bin", () => ({ TearOutButton: () => null }));

const { JournalView } = await import("@/components/notes/journals");

function slot(pageId: string): NotesSlotProps {
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
