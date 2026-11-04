// Plan config AU2: the App admin Accounts tab (design reference/designs/config/Admin.dc.html `.s-acc`). 'Who can join'
// (sign-up mode + the four caps as steppers, optimistic, bounded 1..1000, no 'Who can create a campaign' / 'Waiting for
// you'), the account table (columns, roles, campaigns, last seen, pages, '···' = Add to / Remove from testers, optimistic,
// no menu on the owner's row), loading lines, refused writes and each card's error boundary. Convex is mocked with a
// small store, so optimistic updates re-render like the real client.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConvexError } from "convex/values";

const fake = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  paged: { results: [] as Record<string, unknown>[], status: "Exhausted" as string },
  calls: [] as { name: string; args: Record<string, unknown> }[],
  fail: {} as Record<string, unknown>,
  throwIn: null as string | null,
  loadMore: [] as number[],
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
      const name = nameOf(ref);
      if (fake.throwIn === name) throw new Error("query broke");
      return fake.queries[name];
    },
    usePaginatedQuery: (ref: unknown) => {
      useSyncExternalStore(subscribe, () => fake.version);
      if (fake.throwIn === nameOf(ref)) throw new Error("query broke");
      return { ...fake.paged, loadMore: (n: number) => fake.loadMore.push(n) };
    },
    optimisticallyUpdateValueInPaginatedQuery: (_store: unknown, _ref: unknown, _args: unknown, update: (row: unknown) => unknown) => {
      fake.paged = { ...fake.paged, results: fake.paged.results.map((r) => update(r) as Record<string, unknown>) };
    },
    useMutation: (ref: unknown) => {
      const name = nameOf(ref);
      let optimistic: ((s: typeof store, args: Record<string, unknown>) => void) | null = null;
      const run = async (args: Record<string, unknown>) => {
        fake.calls.push({ name, args });
        const snapshot = { queries: { ...fake.queries }, paged: fake.paged };
        optimistic?.(store, args);
        bump();
        if (fake.fail[name]) {
          fake.queries = snapshot.queries;
          fake.paged = snapshot.paged;
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
const text = await import("@/components/admin/accounts/text");

const SETTINGS = {
  signUpMode: "open",
  caps: { campaignsPerGm: 10, campaignsApp: 100, charactersPerPlayer: 5, playersPerCampaign: 8 },
  lorekeeper: { monthlyUsd: 150, campaignMonthlyUsd: 50, dailyQuestions: 40, dailyWebSearches: 20, atLimit: "pause", allowGmRequests: false },
  spendAlertMonth: null,
};

const NOW = Date.UTC(2026, 10, 4, 12, 0);
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
  row({ userId: "u-own", name: "Petar", role: "owner", campaigns: ["The Witherwild"], lastSeen: NOW }),
  row({ userId: "u-mira", name: "Mira", role: "gm", campaigns: ["Age of Umbra"], lastSeen: NOW - 2 * 3_600_000 }),
  row({ userId: "u-luka", name: "Luka", campaigns: ["The Witherwild", "Age of Umbra"], moreCampaigns: true, tester: true, lastSeen: NOW - 86_400_000 }),
  row({ userId: "u-new", email: "new@example.com" }),
];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  fake.queries = { "appAdmin:settings": structuredClone(SETTINGS) };
  fake.paged = { results: structuredClone(ROWS), status: "Exhausted" };
  fake.calls = [];
  fake.fail = {};
  fake.throwIn = null;
  fake.loadMore = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderTab = () => render(<AccountsTab onTab={() => {}} />);
const joinCard = () => screen.getByRole("region", { name: "Who can join" });
const accountsCard = () => screen.getByRole("region", { name: "Accounts" });

describe("Who can join", () => {
  it("draws the board's rows and nothing that was dropped", () => {
    renderTab();
    const card = joinCard();
    const modes = within(card).getByRole("group", { name: "New accounts" });
    expect(within(modes).getAllByRole("button").map((b) => b.textContent)).toEqual(["Invite link only", "Open sign-up", "Closed"]);
    expect(within(modes).getByRole("button", { name: "Open sign-up" })).toHaveAttribute("aria-pressed", "true");
    for (const [label, hint, value] of [
      ["Campaigns per GM", "Archived campaigns don’t count.", "10"],
      ["Campaigns in the whole app", "New campaigns are refused past this.", "100"],
      ["Characters per player in a campaign", "Includes retired characters.", "5"],
      ["Players per campaign", null, "8"],
    ] as const) {
      const stepper = within(card).getByRole("group", { name: label });
      expect(stepper).toHaveTextContent(value);
      if (hint) expect(card).toHaveTextContent(hint);
    }
    expect(screen.queryByText(/Who can create a campaign/)).toBeNull();
    expect(screen.queryByText(/Waiting for you/)).toBeNull();
    expect(screen.queryByText(/Make GM/)).toBeNull();
  });

  it("sets the sign-up mode as one intent, optimistically", () => {
    renderTab();
    const modes = within(joinCard()).getByRole("group", { name: "New accounts" });
    act(() => fireEvent.click(within(modes).getByRole("button", { name: "Invite link only" })));
    expect(fake.calls).toEqual([{ name: "adminAccounts:setSignUpMode", args: { mode: "invite" } }]);
    expect(within(modes).getByRole("button", { name: "Invite link only" })).toHaveAttribute("aria-pressed", "true");
    // The mode already in force sends nothing.
    act(() => fireEvent.click(within(modes).getByRole("button", { name: "Invite link only" })));
    expect(fake.calls).toHaveLength(1);
  });

  it("steps a cap one at a time and counts up at once", () => {
    renderTab();
    const stepper = within(joinCard()).getByRole("group", { name: "Players per campaign" });
    act(() => fireEvent.click(within(stepper).getByRole("button", { name: "More" })));
    act(() => fireEvent.click(within(stepper).getByRole("button", { name: "More" })));
    expect(stepper).toHaveTextContent("10");
    act(() => fireEvent.click(within(stepper).getByRole("button", { name: "Fewer" })));
    expect(fake.calls.map((c) => c.args)).toEqual([
      { cap: "playersPerCampaign", value: 9 },
      { cap: "playersPerCampaign", value: 10 },
      { cap: "playersPerCampaign", value: 9 },
    ]);
    expect(stepper).toHaveTextContent("9");
  });

  it("stops at 1 and 1000", () => {
    fake.queries["appAdmin:settings"] = { ...SETTINGS, caps: { ...SETTINGS.caps, campaignsPerGm: 1, campaignsApp: 1000 } };
    renderTab();
    expect(within(within(joinCard()).getByRole("group", { name: "Campaigns per GM" })).getByRole("button", { name: "Fewer" })).toBeDisabled();
    expect(within(within(joinCard()).getByRole("group", { name: "Campaigns in the whole app" })).getByRole("button", { name: "More" })).toBeDisabled();
    expect(text.steppedCap(1, -1)).toBe(1);
    expect(text.steppedCap(1000, 1)).toBe(1000);
  });

  it("rolls back a refused write and says why", async () => {
    fake.fail["adminAccounts:setCap"] = new ConvexError({ code: "READ_ONLY_MODE" });
    renderTab();
    const stepper = within(joinCard()).getByRole("group", { name: "Campaigns per GM" });
    await act(async () => fireEvent.click(within(stepper).getByRole("button", { name: "More" })));
    expect(stepper).toHaveTextContent("10");
    expect(within(joinCard()).getByRole("alert")).toHaveTextContent("The app is read-only for maintenance right now.");
  });

  it("shows a loading line until the settings arrive", () => {
    delete fake.queries["appAdmin:settings"];
    renderTab();
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("Loading");
  });
});

describe("Account table", () => {
  it("lists accounts with role, campaigns and last seen", () => {
    renderTab();
    const table = within(accountsCard()).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Account", "Role", "Campaigns", "Last seen", "Actions"]);
    const rows = within(table).getAllByRole("row").slice(1);
    const cells = rows.map((r) => within(r).getAllByRole("cell").slice(0, 4).map((c) => c.textContent));
    expect(cells).toEqual([
      ["YYou", "Owner", "The Witherwild", "Now"],
      ["MMira", "GM", "Age of Umbra", "2 h ago"],
      ["LLukaTester", "Player", "The Witherwild, Age of Umbra and more", "1 day ago"],
      ["Nnew@example.com", "Player", "None", "Never"],
    ]);
  });

  it("has no menu on the owner's row", () => {
    renderTab();
    expect(screen.queryByRole("button", { name: "Options for You" })).toBeNull();
    expect(screen.getByRole("button", { name: "Options for Mira" })).toBeInTheDocument();
  });

  it("adds and removes testers from the ··· menu, optimistically", () => {
    renderTab();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Options for Mira" })));
    const menu = screen.getByRole("menu", { name: "Options for Mira" });
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Add to testers"]);
    act(() => fireEvent.click(within(menu).getByRole("menuitem", { name: "Add to testers" })));
    expect(fake.calls).toEqual([{ name: "adminAccounts:addTester", args: { userId: "u-mira" } }]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("row", { name: /Mira/ })).toHaveTextContent("Tester");

    act(() => fireEvent.click(screen.getByRole("button", { name: "Options for Luka" })));
    act(() => fireEvent.click(screen.getByRole("menuitem", { name: "Remove from testers" })));
    expect(fake.calls[1]).toEqual({ name: "adminAccounts:removeTester", args: { userId: "u-luka" } });
    expect(screen.getByRole("row", { name: /Luka/ })).not.toHaveTextContent("Tester");
  });

  it("closes the menu with Escape and returns focus", () => {
    renderTab();
    const trigger = screen.getByRole("button", { name: "Options for Mira" });
    act(() => fireEvent.click(trigger));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem")).toHaveFocus();
    act(() => fireEvent.keyDown(screen.getByRole("menuitem"), { key: "Escape" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("pages: Show more loads the next page", () => {
    fake.paged.status = "CanLoadMore";
    renderTab();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Show more accounts" })));
    expect(fake.loadMore).toEqual([text.ACCOUNTS_PAGE]);
  });

  it("shows a loading line for the first page", () => {
    fake.paged = { results: [], status: "LoadingFirstPage" };
    renderTab();
    expect(within(accountsCard()).getByRole("status")).toHaveTextContent("Loading");
  });
});

describe("error boundaries", () => {
  it("a failing account list leaves 'Who can join' working", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake.throwIn = "adminAccounts:accounts";
    renderTab();
    expect(screen.getByRole("alert")).toHaveTextContent("Accounts failed to load");
    expect(joinCard()).toBeInTheDocument();
  });

  it("failing settings leave the account table working", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fake.throwIn = "appAdmin:settings";
    renderTab();
    expect(screen.getByRole("alert")).toHaveTextContent("Who can join failed to load");
    expect(accountsCard()).toBeInTheDocument();
  });
});

describe("helpers", () => {
  it("formats last seen", () => {
    expect(text.lastSeenText(null, NOW)).toBe("Never");
    expect(text.lastSeenText(NOW - 60_000, NOW)).toBe("Now");
    expect(text.lastSeenText(NOW - 12 * 60_000, NOW)).toBe("12 min ago");
    expect(text.lastSeenText(NOW - 3 * 86_400_000, NOW)).toBe("3 days ago");
    expect(text.lastSeenText(Date.UTC(2026, 8, 29, 12), NOW)).toMatch(/^29 Sep/);
  });
});
