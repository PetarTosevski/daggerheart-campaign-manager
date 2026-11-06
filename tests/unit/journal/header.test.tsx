// Journal JH (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JH.md): the header actions. The live chip with End
// and the extras menu (GM), the read-only chip (players), 'Start session N' and its target, the tome button and
// 'Open threads N'. convex/react returns the results held here; mutations are recorded.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../convex/sessionRecords";

let results: Record<string, unknown> = {};
const calls = vi.hoisted(() => ({ list: [] as { name: string; args: Record<string, unknown> }[], replies: {} as Record<string, unknown> }));
const tome = vi.hoisted(() => ({ open: vi.fn() }));
// Config JO1: the campaign's 'A new session opens on' setting and the router the Start moves.
const shell = vi.hoisted(() => ({ opensOn: "journal" as "journal" | "combatMap", push: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[getFunctionName(ref as never)]),
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const run = async (args: Record<string, unknown>) => {
      calls.list.push({ name, args });
      return calls.replies[name] ?? null;
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
vi.mock("@/app/(gm)/campaigns/[campaignId]/campaign-shell", () => ({
  useOpenTome: () => tome.open,
  useCampaign: () => ({ settings: { sessionOpensOn: shell.opensOn } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: shell.push }) }));
// The brand Modal uses <dialog>.showModal, which jsdom lacks: render it inline when open.
vi.mock("@/components/brand/modal", () => ({
  Modal: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));

const { JournalHeaderActions, startNumber, startTarget } = await import("../../../src/components/journal/header");

const s = (n: number, status: SessionListItem["status"]): SessionListItem => ({ _id: `s${n}` as Id<"sessions">, n, status });
const LIVE = [s(7, "planned"), s(6, "live"), s(5, "played")];
const IDLE = [s(8, "planned"), s(7, "planned"), s(6, "played")];

const onOpenSession = vi.fn();
const onNotesView = vi.fn();

function renderHeader(isGm = true, selectedId: Id<"sessions"> | null = null) {
  return render(<JournalHeaderActions campaignId={"c1" as Id<"campaigns">} isGm={isGm} selectedId={selectedId} onOpenSession={onOpenSession} onNotesView={onNotesView} />);
}

beforeEach(() => {
  calls.list = [];
  calls.replies = {};
  results = {
    "sessionRecords:list": LIVE,
    "sessions:current": { startedAt: 1000, extraCharacters: false, sessionId: "s6", n: 6 },
    "notesThreads:threads": [{ _id: "e1" }, { _id: "e2" }, { _id: "e3" }, { _id: "e4" }, { _id: "e5" }],
    "campaigns:get": { frameId: "witherwild", options: {} },
  };
});
afterEach(() => {
  cleanup();
  onOpenSession.mockReset();
  onNotesView.mockReset();
  tome.open.mockReset();
  shell.push.mockReset();
  shell.opensOn = "journal";
});

describe("start target", () => {
  it("is the selected planned session, else the newest planned; N is the next number without one", () => {
    expect(startTarget(IDLE, "s7" as Id<"sessions">)?.n).toBe(7);
    expect(startTarget(IDLE, "s6" as Id<"sessions">)?.n).toBe(8);
    expect(startTarget(IDLE, null)?.n).toBe(8);
    expect(startTarget([s(6, "played")], null)).toBeNull();
    expect(startNumber([s(6, "played")], null)).toBe(7);
    expect(startNumber([], null)).toBe(1);
  });
});

describe("GM, live", () => {
  it("shows 'Session N · live' with End session and the End dialog with the Wither choice", async () => {
    calls.replies["sessions:end"] = { tokens: 2, fearGained: 2, fearLost: 0, journeyEnds: [], doomTier: 2 };
    renderHeader();
    const chip = screen.getByTestId("journal-live-chip");
    expect(chip.textContent).toContain("Session 6 · live");
    expect(screen.queryByRole("button", { name: /Start session/ })).toBeNull();
    fireEvent.click(within(chip).getByRole("button", { name: "End session" }));
    const dialog = screen.getByRole("dialog", { name: "End the session?" });
    expect(within(dialog).getByRole("checkbox", { name: /Turn Wither tokens into Fear/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Turn Wither tokens into Fear/ }));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "End session" })));
    const end = calls.list.find((c) => c.name === "sessions:end");
    expect(end?.args).toMatchObject({ campaignId: "c1", convertWither: false });
    const status = screen.getAllByRole("status").find((el) => el.getAttribute("aria-live") === "polite")!;
    expect(status.textContent).toContain("Session ended. 2 Wither tokens → +2 Fear.");
    expect(within(status).getByRole("link", { name: "Open the Doom Track" }).getAttribute("href")).toBe("/campaigns/c1#tr-doom-track");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the session report" }));
    expect(status.textContent).toBe("");
  });

  it("the chip menu holds 'Allow extra characters this session' (Q10)", () => {
    renderHeader();
    const menu = screen.getByRole("button", { name: "Session options" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    const toggle = screen.getByRole("switch", { name: /Allow extra characters this session/ });
    fireEvent.click(toggle);
    expect(calls.list.find((c) => c.name === "sessions:allowExtraCharacters")?.args).toMatchObject({ campaignId: "c1", allow: true });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("GM, nothing live", () => {
  beforeEach(() => {
    results["sessionRecords:list"] = IDLE;
    results["sessions:current"] = { startedAt: null, extraCharacters: false };
  });

  it("starts the selected planned session and opens its Log & recap", async () => {
    calls.replies["sessions:start"] = { startedAt: 2000, alreadyStarted: false, sessionId: "s7", n: 7, notes: ["Ash rolled Prayer Dice: 3, 1"], features: [] };
    renderHeader(true, "s7" as Id<"sessions">);
    expect(screen.queryByTestId("journal-live-chip")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start session 7" }));
    const dialog = screen.getByRole("dialog", { name: "Start session 7?" });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Start session" })));
    expect(calls.list.find((c) => c.name === "sessions:start")?.args).toMatchObject({ campaignId: "c1", sessionId: "s7" });
    expect(onOpenSession).toHaveBeenCalledWith("s7", "log");
    expect(shell.push).not.toHaveBeenCalled();
    const status = screen.getAllByRole("status").find((el) => el.getAttribute("aria-live") === "polite")!;
    expect(status.textContent).toContain("Session started. Ash rolled Prayer Dice: 3, 1.");
  });

  it("JO1: with 'A new session opens on' Combat Map, the Start moves the GM to the Combat Map", async () => {
    shell.opensOn = "combatMap";
    calls.replies["sessions:start"] = { startedAt: 2000, alreadyStarted: false, sessionId: "s7", n: 7 };
    renderHeader(true, "s7" as Id<"sessions">);
    fireEvent.click(screen.getByRole("button", { name: "Start session 7" }));
    const dialog = screen.getByRole("dialog", { name: "Start session 7?" });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Start session" })));
    expect(shell.push).toHaveBeenCalledWith("/campaigns/c1/combat-map");
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it("JO1: a session already running moves no one", async () => {
    shell.opensOn = "combatMap";
    calls.replies["sessions:start"] = { startedAt: 2000, alreadyStarted: true };
    renderHeader(true, "s7" as Id<"sessions">);
    fireEvent.click(screen.getByRole("button", { name: "Start session 7" }));
    const dialog = screen.getByRole("dialog", { name: "Start session 7?" });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Start session" })));
    expect(shell.push).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it("starts the newest planned session when the selected one was played", () => {
    renderHeader(true, "s6" as Id<"sessions">);
    expect(screen.getByRole("button", { name: "Start session 8" })).toBeTruthy();
  });

  it("without a planned session the server creates the next one (no sessionId)", async () => {
    results["sessionRecords:list"] = [s(6, "played")];
    calls.replies["sessions:start"] = { startedAt: 2000, alreadyStarted: false, sessionId: "s7", n: 7 };
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Start session 7" }));
    const dialog = screen.getByRole("dialog", { name: "Start session 7?" });
    expect(dialog.textContent).toContain("Session 7 is created");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Start session" })));
    expect(calls.list.find((c) => c.name === "sessions:start")?.args).not.toHaveProperty("sessionId");
  });
});

describe("players", () => {
  it("see the live chip read only: no End, no menu", () => {
    renderHeader(false);
    expect(screen.getByTestId("journal-live-chip").textContent).toContain("Session 6 · live");
    expect(screen.queryByRole("button", { name: "End session" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Session options" })).toBeNull();
  });

  it("see no Start when nothing is live", () => {
    results["sessionRecords:list"] = [s(6, "played")];
    results["sessions:current"] = { startedAt: null, extraCharacters: false };
    renderHeader(false);
    expect(screen.queryByTestId("journal-live-chip")).toBeNull();
    expect(screen.queryByRole("button", { name: /Start session/ })).toBeNull();
  });
});

describe("everyone", () => {
  it("the tome button opens the Tome", () => {
    renderHeader(false);
    fireEvent.click(screen.getByRole("button", { name: "Open the Campaign Tome" }));
    expect(tome.open).toHaveBeenCalledWith("overview");
  });

  it("'Open threads N' counts the caller's threads and opens the Notes threads view (Q1)", () => {
    renderHeader(false);
    const button = screen.getByRole("button", { name: "Open threads: 5" });
    fireEvent.click(button);
    expect(onNotesView).toHaveBeenCalledWith("threads");
  });

  it("shows loading lines while the queries load", () => {
    results = {};
    renderHeader();
    expect(screen.getByText("Loading the session…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open threads (loading)" })).toBeTruthy();
  });
});
