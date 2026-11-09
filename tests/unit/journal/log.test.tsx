// Journal JL (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JL.md): the session log. Lines oldest first with
// time, icon, title and sub; × hides a generated line and deletes a GM line; 'Show N hidden' and Unhide; re-wording a
// title; 'Add a log entry…' + Add; players read only (Q5); loading and empty states; the optimistic updates.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { JournalLog, JournalLogLine } from "../../../convex/journalLog";

let result: JournalLog | undefined;
const calls = vi.hoisted(() => ({ list: [] as { name: string; args: Record<string, unknown> }[], fail: {} as Record<string, Error> }));

vi.mock("convex/react", () => ({
  useQuery: () => result,
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const run = async (args: Record<string, unknown>) => {
      calls.list.push({ name, args });
      if (calls.fail[name]) throw calls.fail[name];
      return null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

const { SessionLog } = await import("../../../src/components/journal/log");
// The pure log helpers live in src/lib/journal/log.ts (shared with the phone, dcm-gdzi.46); the icons stay on the website.
const model = { ...(await import("../../../src/lib/journal/log")), ...(await import("../../../src/components/journal/log/model")) };

const CAMPAIGN = "c1" as Id<"campaigns">;
const SESSION = "s6" as Id<"sessions">;
const at = (h: number, m: number) => new Date(2025, 10, 2, h, m).getTime();

function line(source: JournalLogLine["source"], sourceId: string, title: string, extra: Partial<JournalLogLine> = {}): JournalLogLine {
  return {
    key: `${source}:${sourceId}`,
    source,
    sourceId,
    at: at(19, 12),
    title,
    icon: source === "gm" ? "note" : "auto",
    hidden: false,
    edited: false,
    removable: source === "gm",
    ...extra,
  };
}

const LINES: JournalLogLine[] = [
  line("auto", "a1", "Scene 1 began · The old road north", { icon: "scene", at: at(19, 12) }),
  line("feed", "f1", "Tamsin agreed to help", { icon: "roll", sub: "Vex rolled 16 with Hope", at: at(19, 40) }),
  line("fear", "h1", "The GM spent 1 Fear", { icon: "fear", sub: "Fear 4 → 3", at: at(20, 14) }),
  line("encounter", "e1:began", "Combat began: Jagged Knife ambush", { icon: "combatBegan", at: at(20, 5), hidden: true }),
  line("gm", "g1", "Brannoc owes Tamsin a favour", { at: at(20, 22) }),
];

function renderLog(isGm = true) {
  return render(<SessionLog campaignId={CAMPAIGN} sessionId={SESSION} isGm={isGm} />);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls.list = [];
  calls.fail = {};
  result = { lines: LINES, truncated: false };
});
afterEach(cleanup);

describe("SessionLog (GM)", () => {
  it("renders the visible lines in order with time, title, sub and the caption", () => {
    renderLog();
    expect(screen.getByRole("heading", { name: "Session log" })).toBeTruthy();
    expect(screen.getByText("Written by the Combat Map as you play · edit anything")).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: /Session log lines/ })).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]!.textContent).toContain("19:12");
    expect(rows[0]!.textContent).toContain("Scene 1 began · The old road north");
    expect(rows[1]!.textContent).toContain("Vex rolled 16 with Hope");
    expect(rows[1]!.textContent).toContain("Roll");
    expect(screen.queryByText("Combat began: Jagged Knife ambush")).toBeNull();
  });

  it("× hides a generated line and deletes a GM line", () => {
    renderLog();
    fireEvent.click(screen.getByRole("button", { name: "Hide log line: Tamsin agreed to help" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete log line: Brannoc owes Tamsin a favour" }));
    expect(calls.list).toEqual([
      { name: "journalLog:hide", args: { campaignId: CAMPAIGN, sessionId: SESSION, source: "feed", sourceId: "f1" } },
      { name: "sessionPlay:removeLog", args: { campaignId: CAMPAIGN, sessionId: SESSION, logId: "g1" } },
    ]);
  });

  it("'Show 1 hidden' lists the hidden line with Unhide", () => {
    renderLog();
    const toggle = screen.getByRole("button", { name: "Show 1 hidden" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide 1 hidden" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Combat began: Jagged Knife ambush")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unhide log line: Combat began: Jagged Knife ambush" }));
    expect(calls.list).toEqual([
      { name: "journalLog:unhide", args: { campaignId: CAMPAIGN, sessionId: SESSION, source: "encounter", sourceId: "e1:began" } },
    ]);
  });

  it("re-words a title on Enter, cancels on Escape and skips an unchanged title", () => {
    renderLog();
    fireEvent.click(screen.getByRole("button", { name: "The GM spent 1 Fear, re-word" }));
    const input = screen.getByRole("textbox", { name: "Re-word the line" });
    fireEvent.change(input, { target: { value: "  The Lieutenant took the spotlight " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls.list).toEqual([
      {
        name: "journalLog:setText",
        args: { campaignId: CAMPAIGN, sessionId: SESSION, source: "fear", sourceId: "h1", text: "The Lieutenant took the spotlight" },
      },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Tamsin agreed to help, re-word" }));
    const again = screen.getByRole("textbox", { name: "Re-word the line" });
    fireEvent.change(again, { target: { value: "Something else" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Re-word the line" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tamsin agreed to help, re-word" }));
    fireEvent.blur(screen.getByRole("textbox", { name: "Re-word the line" }));
    expect(calls.list).toHaveLength(1);
  });

  it("an empty GM line is not sent; an empty generated line restores its words", () => {
    renderLog();
    fireEvent.click(screen.getByRole("button", { name: "Brannoc owes Tamsin a favour, re-word" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Re-word the line" }), { target: { value: " " } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Re-word the line" }), { key: "Enter" });
    expect(calls.list).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Tamsin agreed to help, re-word" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Re-word the line" }), { target: { value: "" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Re-word the line" }), { key: "Enter" });
    expect(calls.list[0]!.args.text).toBe("");
  });

  it("adds a line (keyed), clears the field, and puts the text back on failure", async () => {
    renderLog();
    const input = screen.getByRole("textbox", { name: "New log entry" }) as HTMLInputElement;
    expect(input.placeholder).toBe("Add a log entry…");
    fireEvent.change(input, { target: { value: "  The Sniper fled  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(calls.list[0]!.name).toBe("sessionPlay:addLog");
    expect(calls.list[0]!.args).toMatchObject({ campaignId: CAMPAIGN, sessionId: SESSION, text: "The Sniper fled" });
    expect(typeof calls.list[0]!.args.idempotencyKey).toBe("string");
    expect(input.value).toBe("");

    calls.fail["sessionPlay:addLog"] = new Error("The log is full.");
    fireEvent.change(input, { target: { value: "Another" } });
    fireEvent.submit(input.closest("form")!);
    await act(flush);
    expect(screen.getByRole("alert").textContent).not.toBe("");
    expect(input.value).toBe("Another");
  });

  it("shows the loading line, the empty state and the truncated note", () => {
    result = undefined;
    const { rerender } = renderLog();
    expect(screen.getByRole("status").textContent).toContain("Loading the session log");
    result = { lines: [], truncated: false };
    rerender(<SessionLog campaignId={CAMPAIGN} sessionId={SESSION} isGm />);
    expect(screen.getByText(/Nothing logged yet/)).toBeTruthy();
    result = { lines: LINES, truncated: true };
    rerender(<SessionLog campaignId={CAMPAIGN} sessionId={SESSION} isGm />);
    expect(screen.getByText(/too long to show whole/)).toBeTruthy();
  });

  it("a line being added has its × disabled and no re-word button", () => {
    result = { lines: [line("gm", `${model.OPTIMISTIC}k1`, "Pending")], truncated: false };
    renderLog();
    expect((screen.getByRole("button", { name: "Delete log line: Pending" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Pending, re-word" })).toBeNull();
  });
});

describe("SessionLog (player, Q5)", () => {
  it("is read only: no ×, no re-word, no hidden toggle, no add form", () => {
    result = { lines: LINES.filter((l) => !l.hidden).map((l) => ({ ...l, removable: false })), truncated: false };
    renderLog(false);
    expect(screen.getByText("Written by the Combat Map as you play")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Tamsin agreed to help")).toBeTruthy();
  });
});

describe("log model", () => {
  function fakeStore(log: JournalLog | undefined) {
    let value = log;
    return {
      store: {
        getQuery: () => value,
        setQuery: (_ref: unknown, _args: unknown, next: JournalLog) => {
          value = next;
        },
      } as never,
      get: () => value,
    };
  }
  const args = { campaignId: CAMPAIGN, sessionId: SESSION };

  it("addPending appends a removable GM note at the end", () => {
    const s = fakeStore({ lines: LINES, truncated: false });
    model.addPending(s.store, { ...args, text: " New line ", idempotencyKey: "k" });
    const last = s.get()!.lines.at(-1)!;
    expect(last).toMatchObject({ source: "gm", sourceId: `${model.OPTIMISTIC}k`, title: "New line", icon: "note", removable: true });
    expect(model.isPending(last)).toBe(true);
  });

  it("removePending drops the GM line; hiddenPending flips hidden; textPending re-words", () => {
    const s = fakeStore({ lines: LINES, truncated: false });
    model.removePending(s.store, { ...args, logId: "g1" });
    expect(s.get()!.lines.some((l) => l.sourceId === "g1")).toBe(false);
    model.hiddenPending(true)(s.store, { ...args, source: "feed", sourceId: "f1" });
    expect(s.get()!.lines.find((l) => l.sourceId === "f1")!.hidden).toBe(true);
    model.hiddenPending(false)(s.store, { ...args, source: "encounter", sourceId: "e1:began" });
    expect(s.get()!.lines.find((l) => l.sourceId === "e1:began")!.hidden).toBe(false);
    model.textPending(s.store, { ...args, source: "fear", sourceId: "h1", text: " Re-worded " });
    expect(s.get()!.lines.find((l) => l.sourceId === "h1")).toMatchObject({ title: "Re-worded", edited: true });
    model.textPending(s.store, { ...args, source: "fear", sourceId: "h1", text: "" });
    expect(s.get()!.lines.find((l) => l.sourceId === "h1")!.title).toBe("Re-worded");
  });

  it("does nothing before the log is loaded", () => {
    const s = fakeStore(undefined);
    model.addPending(s.store, { ...args, text: "x", idempotencyKey: "k" });
    expect(s.get()).toBeUndefined();
  });

  it("has an icon for every kind and a 24 h clock", () => {
    for (const [, { Icon, label }] of Object.entries(model.LOG_ICONS)) {
      expect(Icon).toBeTruthy();
      expect(label).not.toBe("");
    }
    expect(model.clock(at(9, 5))).toBe("09:05");
  });
});
