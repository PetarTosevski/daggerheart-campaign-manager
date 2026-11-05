// Plan config AU9 (on AD14, N11): Suspend / Lift suspension and Delete account / Undo in the account row's '···' menu
// of the App admin Accounts tab. A confirm dialog needs a reason and the account's email typed again before the danger
// button works; the row shows "Suspended" or "Deleted in N days · Undo"; the owner's row has no menu. Convex is mocked
// with a small store, so optimistic updates re-render like the real client.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ConvexError } from "convex/values";

const fake = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paged: { results: [] as Record<string, unknown>[], status: "Exhausted" as string },
  calls: [] as { name: string; args: Record<string, unknown> }[],
  fail: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  version: 0,
}));

const nameOf = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
function bump() {
  fake.version++;
  for (const l of fake.listeners) l();
}

vi.mock("convex/react", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (l: () => void) => {
    fake.listeners.add(l);
    return () => fake.listeners.delete(l);
  };
  const store = {
    getQuery: (ref: unknown) => fake.queries[nameOf(ref)],
    setQuery: (ref: unknown, _args: unknown, value: unknown) => {
      fake.queries[nameOf(ref)] = value;
    },
  };
  return {
    useQuery: (ref: unknown) => {
      useSyncExternalStore(subscribe, () => fake.version);
      return fake.queries[nameOf(ref)];
    },
    usePaginatedQuery: () => {
      useSyncExternalStore(subscribe, () => fake.version);
      return { ...fake.paged, loadMore: () => {} };
    },
    optimisticallyUpdateValueInPaginatedQuery: () => {},
    useMutation: (ref: unknown) => {
      const name = nameOf(ref);
      let optimistic: ((s: typeof store, args: Record<string, unknown>) => void) | null = null;
      const run = async (args: Record<string, unknown>) => {
        fake.calls.push({ name, args });
        const snapshot = { ...fake.queries };
        optimistic?.(store, args);
        bump();
        if (fake.fail[name]) {
          fake.queries = snapshot;
          bump();
          throw fake.fail[name];
        }
        return null;
      };
      return Object.assign(run, {
        withOptimisticUpdate: (fn: typeof optimistic) => {
          optimistic = fn;
          return run;
        },
      });
    },
  };
});

const { AccountsTab } = await import("@/components/admin/accounts");

const NOW = Date.UTC(2026, 10, 5, 12, 0);
const DAY = 86_400_000;
const SETTINGS = {
  signUpMode: "open",
  caps: { campaignsPerGm: 10, campaignsApp: 100, charactersPerPlayer: 5, playersPerCampaign: 8 },
  lorekeeper: { monthlyUsd: 150, campaignMonthlyUsd: 50, dailyQuestions: 40, dailyWebSearches: 20, atLimit: "pause", allowGmRequests: false },
  spendAlertMonth: null,
};
const row = (over: Record<string, unknown>) => ({
  userId: "u",
  name: null,
  email: null,
  role: "player",
  campaigns: [],
  moreCampaigns: false,
  lastSeen: null,
  tester: false,
  createdAt: 0,
  ...over,
});
const ROWS = [
  row({ userId: "u-own", name: "Petar", email: "petar@example.com", role: "owner" }),
  row({ userId: "u-mira", name: "Mira", email: "mira@example.com", role: "gm" }),
  row({ userId: "u-luka", name: "Luka", email: "luka@example.com" }),
  row({ userId: "u-ana", name: "Ana", email: "ana@example.com" }),
];
const STATUSES = "adminAccountActions:statuses";

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
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  fake.queries = {
    "appAdmin:settings": structuredClone(SETTINGS),
    [STATUSES]: [
      { userId: "u-luka", suspended: true, deleteAfter: null },
      { userId: "u-ana", suspended: false, deleteAfter: NOW + 12 * DAY + 3_600_000 },
    ],
  };
  fake.paged = { results: structuredClone(ROWS), status: "Exhausted" };
  fake.calls = [];
  fake.fail = {};
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderTab = () => render(<AccountsTab onTab={() => {}} />);
const openMenu = (name: string) => {
  act(() => fireEvent.click(screen.getByRole("button", { name: `Options for ${name}` })));
  return screen.getByRole("menu", { name: `Options for ${name}` });
};
const items = (menu: HTMLElement) => within(menu).getAllByRole("menuitem").map((m) => m.textContent);
const flush = () => act(async () => {});

describe("row marks", () => {
  it("shows Suspended and 'Deleted in N days · Undo'; Undo cancels the deletion optimistically", async () => {
    renderTab();
    expect(screen.getByRole("row", { name: /Luka/ })).toHaveTextContent("Suspended");
    const ana = screen.getByRole("row", { name: /Ana/ });
    expect(ana).toHaveTextContent("Deleted in 13 days ·");
    expect(screen.getByRole("row", { name: /Mira/ })).not.toHaveTextContent(/Suspended|Deleted/);
    act(() => fireEvent.click(within(ana).getByRole("button", { name: "Undo deleting Ana" })));
    await flush();
    expect(fake.calls).toEqual([{ name: "adminAccountActions:cancelDelete", args: { userId: "u-ana" } }]);
    expect(screen.getByRole("row", { name: /Ana/ })).not.toHaveTextContent("Deleted");
  });
});

describe("the ··· menu", () => {
  it("offers Suspend and Delete account for a normal account, Lift for a suspended one, Undo delete while deleting", () => {
    renderTab();
    expect(items(openMenu("Mira"))).toEqual(["Add to testers", "Suspend", "Delete account"]);
    act(() => fireEvent.keyDown(screen.getByRole("menuitem", { name: "Suspend" }), { key: "Escape" }));
    expect(items(openMenu("Luka"))).toEqual(["Add to testers", "Lift suspension", "Delete account"]);
    act(() => fireEvent.keyDown(screen.getByRole("menuitem", { name: "Lift suspension" }), { key: "Escape" }));
    expect(items(openMenu("Ana"))).toEqual(["Add to testers", "Undo delete"]);
    // The destructive items are glass danger.
    act(() => fireEvent.keyDown(screen.getByRole("menuitem", { name: "Undo delete" }), { key: "Escape" }));
    const mira = openMenu("Mira");
    expect(within(mira).getByRole("menuitem", { name: "Delete account" }).className).toContain("gb-danger");
  });

  it("has no menu on the owner's own row", () => {
    renderTab();
    expect(screen.queryByRole("button", { name: "Options for You" })).toBeNull();
  });

  it("lifts a suspension in one click, optimistically, and closes the menu", async () => {
    renderTab();
    {
      const menu = openMenu("Luka");
      act(() => fireEvent.click(within(menu).getByRole("menuitem", { name: "Lift suspension" })));
    }
    await flush();
    expect(fake.calls).toEqual([{ name: "adminAccountActions:unsuspend", args: { userId: "u-luka" } }]);
    expect(screen.getByRole("row", { name: /Luka/ })).not.toHaveTextContent("Suspended");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the confirm dialog", () => {
  it("suspends only after a reason and the account's email; the danger button stays off until then", async () => {
    renderTab();
    {
      const menu = openMenu("Mira");
      act(() => fireEvent.click(within(menu).getByRole("menuitem", { name: "Suspend" })));
    }
    const dialog = screen.getByRole("dialog", { name: "Suspend Mira?" });
    const confirm = within(dialog).getByRole("button", { name: "Suspend" });
    expect(confirm).toBeDisabled();
    expect(confirm.className).toContain("gb-danger");
    act(() => fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Spam campaigns" } }));
    expect(confirm).toBeDisabled();
    const email = within(dialog).getByLabelText("Type mira@example.com to confirm");
    act(() => fireEvent.change(email, { target: { value: "mira@example.co" } }));
    expect(confirm).toBeDisabled();
    act(() => fireEvent.change(email, { target: { value: " Mira@Example.com " } }));
    expect(confirm).toBeEnabled();
    act(() => fireEvent.click(confirm));
    await flush();
    expect(fake.calls).toEqual([
      { name: "adminAccountActions:suspend", args: { userId: "u-mira", reason: "Spam campaigns", confirmEmail: "Mira@Example.com" } },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("row", { name: /Mira/ })).toHaveTextContent("Suspended");
  });

  it("deletes after the same checks and shows 'Deleted in 30 days · Undo'", async () => {
    renderTab();
    {
      const menu = openMenu("Mira");
      act(() => fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete account" })));
    }
    const dialog = screen.getByRole("dialog", { name: "Delete Mira’s account?" });
    expect(dialog).toHaveTextContent("erased in 30 days");
    act(() => fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Asked to leave" } }));
    act(() => fireEvent.change(within(dialog).getByLabelText("Type mira@example.com to confirm"), { target: { value: "mira@example.com" } }));
    act(() => fireEvent.click(within(dialog).getByRole("button", { name: "Delete account" })));
    await flush();
    expect(fake.calls[0]).toEqual({
      name: "adminAccountActions:scheduleDelete",
      args: { userId: "u-mira", reason: "Asked to leave", confirmEmail: "mira@example.com" },
    });
    const mira = screen.getByRole("row", { name: /Mira/ });
    expect(mira).toHaveTextContent("Deleted in 30 days ·");
    expect(within(mira).getByRole("button", { name: "Undo deleting Mira" })).toBeInTheDocument();
  });

  it("Cancel writes nothing; a refusal shows in the dialog and rolls the row back", async () => {
    renderTab();
    {
      const menu = openMenu("Mira");
      act(() => fireEvent.click(within(menu).getByRole("menuitem", { name: "Suspend" })));
    }
    act(() => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fake.calls).toEqual([]);

    fake.fail["adminAccountActions:suspend"] = new ConvexError({ code: "INVALID", message: "Type the account's email exactly to confirm." });
    {
      const menu = openMenu("Mira");
      act(() => fireEvent.click(within(menu).getByRole("menuitem", { name: "Suspend" })));
    }
    const dialog = screen.getByRole("dialog");
    act(() => fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "x" } }));
    act(() => fireEvent.change(within(dialog).getByLabelText("Type mira@example.com to confirm"), { target: { value: "mira@example.com" } }));
    act(() => fireEvent.click(within(dialog).getByRole("button", { name: "Suspend" })));
    await flush();
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(/.+/);
    expect(screen.getByRole("row", { name: /Mira/ })).not.toHaveTextContent("Suspended");
  });
});
