// Journal JR (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JR.md): the recap parchment (Q4: everyone writes
// it, no share gate) and 'After the session' (the GM edits, players read: JF2). convex/react returns the results held here; mutations are
// recorded.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";

let results: Record<string, unknown> = {};
const calls = vi.hoisted(() => ({ list: [] as { name: string; args: Record<string, unknown> }[], fail: {} as Record<string, unknown> }));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[getFunctionName(ref as never)]),
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const run = async (args: Record<string, unknown>) => {
      calls.list.push({ name, args });
      if (calls.fail[name]) throw calls.fail[name];
      return name === "sessionWrap:callMilestone" ? { flagged: 2, called: true, milestoneAt: 1 } : null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AfterSession, Recap } = await import("../../../src/components/journal/recap");
const { levelUpLine, milestoneLine } = await import("../../../src/lib/journal/sessions");

const campaignId = "c1" as Id<"campaigns">;
const sessionId = "s6" as Id<"sessions">;
const RECAP = "The party followed the cart tracks to Tamsin’s cottage.";

beforeEach(() => {
  calls.list = [];
  calls.fail = {};
  results = {
    "sessionWrap:get": { sessionId, n: 6, recap: RECAP },
    "sessionRecords:list": [{ _id: sessionId, n: 6, status: "live", recap: "Player view of the recap." }],
    "sessionWrap:after": {
      sessionId,
      levelUps: [{ characterId: "vex", summary: "Vex can level up to 4.", at: 1 }],
      milestoneAt: null,
      loot: "Tamsin’s axe · 2 handfuls of gold",
      truncated: false,
    },
    "charactersReads:partySummary": [{ _id: "vex", sheet: { name: "Vex" } }],
  };
});
afterEach(cleanup);

const saves = (name: string) => calls.list.filter((c) => c.name === name).map((c) => c.args);

describe("Recap", () => {
  it("shows the GM the recap from sessionWrap.get, with no share button", () => {
    render(<Recap campaignId={campaignId} sessionId={sessionId} isGm />);
    expect(screen.getByRole("heading", { name: "Recap" })).toBeTruthy();
    expect(screen.getByText(RECAP)).toBeTruthy();
    expect(screen.getByText("Visible to the table")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /share/i })).toBeNull();
  });

  it("shows a player the recap from their session list row", () => {
    render(<Recap campaignId={campaignId} sessionId={sessionId} isGm={false} />);
    expect(screen.getByText("Player view of the recap.")).toBeTruthy();
  });

  it("shows a loading line, and a stale session", () => {
    results["sessionWrap:get"] = undefined;
    const { rerender } = render(<Recap campaignId={campaignId} sessionId={sessionId} isGm />);
    expect(screen.getByRole("status").textContent).toContain("Loading the recap");
    results["sessionWrap:get"] = null;
    rerender(<Recap campaignId={campaignId} sessionId={sessionId} isGm />);
    expect(screen.getByText(/isn.t in this campaign anymore/)).toBeTruthy();
  });

  it("Edit recap → Save sends one setRecap intent", async () => {
    render(<Recap campaignId={campaignId} sessionId={sessionId} isGm />);
    fireEvent.click(screen.getByRole("button", { name: "Edit recap" }));
    const box = screen.getByRole("textbox", { name: "Recap" }) as HTMLTextAreaElement;
    expect(box.value).toBe(RECAP);
    fireEvent.change(box, { target: { value: "New recap." } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save recap" })));
    expect(saves("sessionWrap:setRecap")).toEqual([{ campaignId, sessionId, recap: "New recap." }]);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("saves on blur out of the editor, sends nothing when unchanged, Cancel / Escape drop the draft", async () => {
    render(<Recap campaignId={campaignId} sessionId={sessionId} isGm={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit recap" }));
    await act(async () => fireEvent.blur(screen.getByRole("textbox", { name: "Recap" }), { relatedTarget: document.body }));
    expect(saves("sessionWrap:setRecap")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Edit recap" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Recap" }), { target: { value: "Typed by a player." } });
    await act(async () => fireEvent.blur(screen.getByRole("textbox", { name: "Recap" }), { relatedTarget: document.body }));
    expect(saves("sessionWrap:setRecap")).toEqual([{ campaignId, sessionId, recap: "Typed by a player." }]);

    fireEvent.click(screen.getByRole("button", { name: "Edit recap" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Recap" }), { target: { value: "Dropped." } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit recap" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Recap" }), { target: { value: "Dropped too." } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Recap" }), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(saves("sessionWrap:setRecap")).toHaveLength(1);
  });

  it("an empty recap offers 'Write the recap'; a refused save keeps the draft and shows the error", async () => {
    results["sessionWrap:get"] = { sessionId, n: 6 };
    calls.fail["sessionWrap:setRecap"] = new Error("network");
    render(<Recap campaignId={campaignId} sessionId={sessionId} isGm />);
    expect(screen.getByText(/No recap yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Write the recap" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Recap" }), { target: { value: "Draft." } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save recap" })));
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
    expect((screen.getByRole("textbox", { name: "Recap" }) as HTMLTextAreaElement).value).toBe("Draft.");
  });
});

describe("After the session", () => {
  it("JF2 (dcm-z9rz.32): players read level-ups, milestone and loot, with no edit controls", () => {
    render(<AfterSession campaignId={campaignId} sessionId={sessionId} isGm={false} />);
    expect(screen.getByRole("heading", { name: "After the session" })).toBeTruthy();
    expect(screen.getByText("Vex")).toBeTruthy();
    expect(screen.getByText("Not yet")).toBeTruthy();
    expect(screen.getByText("Tamsin’s axe · 2 handfuls of gold")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();

    results["sessionWrap:after"] = { ...(results["sessionWrap:after"] as object), milestoneAt: new Date(2025, 10, 2, 21, 0).getTime(), loot: null };
    render(<AfterSession campaignId={campaignId} sessionId={sessionId} isGm={false} />);
    expect(screen.getByText("Reached 2 Nov")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Party to level up" })).toHaveAttribute("href", "/campaigns/c1/party");
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows level-up names and the loot", () => {
    render(<AfterSession campaignId={campaignId} sessionId={sessionId} isGm />);
    expect(screen.getByRole("heading", { name: "After the session" })).toBeTruthy();
    expect(screen.getByText("Vex")).toBeTruthy();
    expect(screen.getByText("Tamsin’s axe · 2 handfuls of gold")).toBeTruthy();
  });

  it("level-up line: None, names, the feed line for a character not in the party", () => {
    expect(levelUpLine([], new Map())).toBe("None");
    expect(
      levelUpLine(
        [
          { characterId: "a" as Id<"characters">, summary: "A can level up to 2.", at: 1 },
          { characterId: "b" as Id<"characters">, summary: "B reached level 3.", at: 2 },
        ],
        new Map([["a", "Moss"]]),
      ),
    ).toBe("Moss, B reached level 3.");
  });

  it("edits the loot inline: Enter saves, Escape cancels", async () => {
    render(<AfterSession campaignId={campaignId} sessionId={sessionId} isGm />);
    fireEvent.click(screen.getByRole("button", { name: /^Edit loot/ }));
    const input = screen.getByRole("textbox", { name: "Loot" });
    fireEvent.change(input, { target: { value: "A silver key" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(saves("sessionWrap:setLoot")).toEqual([{ campaignId, sessionId, loot: "A silver key" }]);

    fireEvent.click(screen.getByRole("button", { name: /^Edit loot/ }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Loot" }), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(saves("sessionWrap:setLoot")).toHaveLength(1);
  });

  it("dcm-z9rz.29: shows the milestone; 'Call milestone' asks to confirm, then calls it once", async () => {
    render(<AfterSession campaignId={campaignId} sessionId={sessionId} isGm />);
    expect(screen.getByText("Milestone")).toBeTruthy();
    expect(screen.getByText("Not yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Call milestone" }));
    expect(saves("sessionWrap:callMilestone")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Confirm the milestone" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Call milestone" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Level up the party" })));
    expect(saves("sessionWrap:callMilestone")).toEqual([{ campaignId, sessionId, idempotencyKey: expect.any(String) }]);
    expect(screen.getByText("2 characters can level up.")).toBeTruthy();
    cleanup();

    const reached = new Date(2025, 10, 2, 21, 0).getTime();
    results["sessionWrap:after"] = { ...(results["sessionWrap:after"] as object), milestoneAt: reached };
    render(<AfterSession campaignId={campaignId} sessionId={sessionId} isGm />);
    expect(screen.getByText("Reached 2 Nov")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Party to level up" })).toHaveAttribute("href", "/campaigns/c1/party");
    expect(screen.queryByRole("button", { name: "Call milestone" })).toBeNull();
    expect(milestoneLine(null)).toBe("Not yet");
  });

  it("shows None without loot or level-ups, and a note when truncated", () => {
    results["sessionWrap:after"] = { sessionId, levelUps: [], milestoneAt: null, loot: null, truncated: true };
    render(<AfterSession campaignId={campaignId} sessionId={sessionId} isGm />);
    expect(screen.getAllByText("None")).toHaveLength(2);
    expect(screen.getByText(/later level-ups may be missing/)).toBeTruthy();
  });
});
