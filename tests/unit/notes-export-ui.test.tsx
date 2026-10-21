// D11 N4: 'Download my journal' (src/components/notes/export). convex/react is replaced: `useQuery` answers the
// journal view (the hero name) and `useConvex().query` answers `exportPage` chunks of fake data, so the test sees the
// one Markdown blob the browser would save.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import type { JournalView } from "../../convex/notes";
import type { ExportChunk } from "../../convex/notesThreads";
import type { NotesSlotProps } from "../../src/components/notes/slots";

const CAMPAIGN = "c1" as Id<"campaigns">;
const P1 = "page1" as Id<"journalPages">;
const P2 = "page2" as Id<"journalPages">;

const view: JournalView = {
  isGm: false,
  whoName: "Ash",
  whoSub: "Player journal · Ranger",
  journal: { _id: "j1" as Id<"journals">, pageCount: 2, entryCount: 3, openCount: 1 },
  pages: [],
};

/** Two chunks: page 1 with two entries (one added by the GM), then page 2 with one struck note. */
const chunks: Record<string, ExportChunk> = {
  first: {
    pages: [{ id: P1, kind: "log", title: "Session 1", createdAt: Date.UTC(2026, 9, 1), session: { date: "2026-10-01" } }],
    entries: [
      { pageId: P1, kind: "task", state: "open", star: true, text: "find the ferryman", order: 0 },
      { pageId: P1, kind: "fear", state: "open", star: false, text: "the ferryman lies", order: 1, addedBy: "GM" },
    ],
    continueCursor: "c2",
  },
  c2: {
    pages: [{ id: P2, kind: "collection", title: "People we met", createdAt: Date.UTC(2026, 9, 2) }],
    entries: [{ pageId: P2, kind: "note", state: "done", star: false, text: "met @[Marlow](codex1) at the inn", order: 0 }],
    continueCursor: null,
  },
};

const queryCalls: unknown[] = [];

vi.mock("convex/react", () => ({
  useQuery: () => view,
  useConvex: () => ({
    query: async (_ref: unknown, args: { cursor: string | null }) => {
      queryCalls.push(args);
      return chunks[args.cursor ?? "first"];
    },
  }),
}));

const { DownloadJournalButton } = await import("@/components/notes/export");

const slot: NotesSlotProps = {
  campaignId: CAMPAIGN,
  access: { isGm: false },
  journalId: null,
  pageId: null,
  view: "page",
  search: "",
  matchingPageIds: null,
  onPage: () => {},
  onView: () => {},
  onSearch: () => {},
};

describe("Download my journal", () => {
  const blobs: Blob[] = [];
  const downloads: string[] = [];
  let click: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    blobs.length = 0;
    downloads.length = 0;
    queryCalls.length = 0;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:fake/${blobs.length}`;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
  });

  afterEach(() => {
    click.mockRestore();
  });

  it("produces one Markdown blob from two pages of fake data, saved as '<whoName> journal.md'", async () => {
    render(<DownloadJournalButton {...slot} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download my journal" }));
    });
    await waitFor(() => expect(downloads).toEqual(["Ash journal.md"]));

    expect(queryCalls).toEqual([
      { campaignId: CAMPAIGN, cursor: null },
      { campaignId: CAMPAIGN, cursor: "c2" },
    ]);
    expect(blobs).toHaveLength(1);
    const blob = blobs[0]!;
    expect(blob.type).toBe("text/markdown;charset=utf-8");
    const text = await blob.text();
    expect(text.startsWith("# Ash’s Journal\n")).toBe(true);
    expect(text).toContain("## Session 1");
    expect(text).toContain("## People we met");
    expect(text).toContain("- ★ • find the ferryman");
    expect(text).toContain("the ferryman lies - GM");
    // Mentions are plain names; a resolved note is struck.
    expect(text).toContain("~~met Marlow at the inn~~");
    expect(text).not.toContain("codex1");
    expect(text.indexOf("## Session 1")).toBeLessThan(text.indexOf("## People we met"));
    expect(screen.getByRole("button", { name: "Download my journal" })).toBeEnabled();
  });
});
