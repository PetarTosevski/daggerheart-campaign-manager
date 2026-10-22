// G2 (followups-6): the GM's 'About books' note (dcm-bxp.82.4) and 'not set up' said once (dcm-bxp.82.10), as a user
// sees them. convex/react is replaced by stubs that answer per function name: no server.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import { ABOUT_BOOKS_NOTE, EMPTY_INTRO, NOT_SET_UP } from "@/lib/lorekeeper/copy";

const answers = new Map<string, unknown>();
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : answers.get(functionName(ref))),
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: () => {} }),
  useMutation: () => {
    const run = async () => null;
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

const { LibraryCard } = await import("@/components/lorekeeper/side/library");
const { ChatView } = await import("@/components/lorekeeper/chat/chat");

const CAMPAIGN = "c1" as Id<"campaigns">;
const USAGE = { questionsLeft: 40, campaignCapReached: false, deploymentCapReached: false };

beforeAll(() => {
  // jsdom has no showModal/close; model the browser: close() drops `open` and fires the dialog's close event.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  answers.clear();
  answers.set("lorekeeperLibrary:list", { books: [], indexedCount: 0 });
  answers.set("lorekeeper:listConversations", { mine: [], shared: [] });
  answers.set("lorekeeperUsage:mine", USAGE);
  answers.set("lorekeeperAsks:mine", []);
  answers.delete("members:roster");
});

describe("About books (dcm-bxp.82.4)", () => {
  it("gives every GM the plain note, with no ingest command", async () => {
    render(<LibraryCard campaignId={CAMPAIGN} access={{ isGm: true }} />);
    expect(screen.queryByRole("button", { name: /Add PDF/ })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "About books" })));
    const dialog = screen.getByRole("dialog", { name: "About books" });
    expect(within(dialog).getByText(ABOUT_BOOKS_NOTE)).toBeTruthy();
    expect(dialog.textContent).not.toContain("pnpm");
    expect(dialog.textContent).not.toContain("--prod");
  });

  it("shows players no About books button", () => {
    render(<LibraryCard campaignId={CAMPAIGN} access={{ isGm: false }} />);
    expect(screen.queryByRole("button", { name: "About books" })).toBeNull();
  });
});

describe("'not set up' once (dcm-bxp.82.10)", () => {
  it("says it only in the composer's notice; the empty intro has no text", () => {
    answers.set("lorekeeper:available", false);
    render(<ChatView campaignId={CAMPAIGN} access={{ isGm: false }} variant="page" />);
    expect(screen.getAllByText(NOT_SET_UP)).toHaveLength(1);
    const composer = screen.getByRole("group", { name: "Ask the Lorekeeper" });
    expect(within(composer).getByRole("alert").textContent).toBe(NOT_SET_UP);
    expect(screen.queryByText(EMPTY_INTRO)).toBeNull();
  });

  it("keeps the intro when the Lorekeeper is available", () => {
    answers.set("lorekeeper:available", true);
    render(<ChatView campaignId={CAMPAIGN} access={{ isGm: false }} variant="page" />);
    expect(screen.getByText(EMPTY_INTRO)).toBeTruthy();
    expect(screen.queryByText(NOT_SET_UP)).toBeNull();
  });
});
