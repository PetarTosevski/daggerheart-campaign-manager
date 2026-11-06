// Journal JTh (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JTh.md): Threads raised, the caller's open threads
// on the Notes pages linked to the session (user Q2), each with 'In Notes'. convex/react returns the results held here.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";

let results: Record<string, unknown> = {};
const seen = vi.hoisted(() => ({ args: [] as { name: string; args: unknown }[] }));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    const name = getFunctionName(ref as never);
    seen.args.push({ name, args });
    return args === "skip" ? undefined : results[name];
  },
  useMutation: () => Object.assign(async () => null, { withOptimisticUpdate: () => async () => null }),
}));

const { ThreadsRaised, THREADS_RAISED_COPY, threadKindLabel } = await import("../../../src/components/journal/threads");

const campaignId = "c1" as Id<"campaigns">;
const sessionId = "s6" as Id<"sessions">;
const NPC = "k1";
const PAGE = "Session 6 · Forest Camp";

const ROWS = [
  { entryId: "e1", pageId: "p6", pageTitle: PAGE, kind: "task", state: "open", text: "The Sniper escaped toward the chapel" },
  { entryId: "e2", pageId: "p7", pageTitle: "Rumours", kind: "fear", state: "open", text: `Ask @[Tamsin](${NPC}) about her axe` },
];

beforeEach(() => {
  seen.args = [];
  results = {
    "journalThreads:raised": ROWS,
    "codex:list": { role: "gm", entries: [{ _id: NPC, kind: "character", name: "Tamsin", role: "Woodcutter" }] },
  };
});
afterEach(cleanup);

function renderIt(isGm = true) {
  const onOpenPage = vi.fn();
  render(<ThreadsRaised campaignId={campaignId} sessionId={sessionId} isGm={isGm} onOpenPage={onOpenPage} />);
  return onOpenPage;
}

describe("ThreadsRaised", () => {
  it("reads journalThreads.raised for the session under the 'Threads raised' heading", () => {
    renderIt();
    expect(seen.args.find((a) => a.name === "journalThreads:raised")?.args).toEqual({ campaignId, sessionId });
    expect(screen.getByRole("heading", { name: THREADS_RAISED_COPY.heading })).toBeTruthy();
  });

  it("lists each thread with its bullet glyph, kind and text, in the server's order", () => {
    renderIt();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("•");
    expect(items[0]!.textContent).toContain("Open task: The Sniper escaped toward the chapel");
    expect(items[0]!.getAttribute("data-kind")).toBe("task");
    expect(items[1]!.textContent).toContain("☠");
    expect(items[1]!.textContent).toContain("Looming Fear: ");
    expect(items[1]!.getAttribute("data-kind")).toBe("fear");
  });

  it("renders mentions with EntryText: a Codex link, never the raw token", () => {
    renderIt();
    const fear = screen.getAllByRole("listitem")[1]!;
    expect(fear.textContent).not.toContain("@[");
    const link = within(fear).getByRole("link", { name: "Tamsin" });
    expect(link.getAttribute("href")).toBe(`/campaigns/${campaignId}/codex?entry=${NPC}`);
  });

  it("'In Notes' opens the row's page", () => {
    const onOpenPage = renderIt();
    const buttons = screen.getAllByRole("button", { name: /^In Notes/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute("aria-label")).toBe(`In Notes: ${PAGE}`);
    expect(buttons[0]!.textContent).toBe("In Notes");
    fireEvent.click(buttons[1]!);
    expect(onOpenPage).toHaveBeenCalledWith("p7");
    fireEvent.click(buttons[0]!);
    expect(onOpenPage).toHaveBeenLastCalledWith("p6");
  });

  it("shows players their own threads too (J1 default; the server keeps it per viewer)", () => {
    renderIt(false);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows a loading line, then the empty state", () => {
    results["journalThreads:raised"] = undefined;
    renderIt();
    expect(screen.getByRole("status").textContent).toBe(THREADS_RAISED_COPY.loading);
    cleanup();
    results["journalThreads:raised"] = [];
    renderIt();
    expect(screen.getByText("No threads raised on this session's pages.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("labels the bullet kinds", () => {
    expect(threadKindLabel({ kind: "task" })).toBe("Open task");
    expect(threadKindLabel({ kind: "fear" })).toBe("Looming Fear");
  });
});
