// Plan config AU1: the App admin Overview tab (design reference/designs/config/Admin.dc.html `.s-ov`; server AD2
// convex/adminOverview.ts, AD13 appAdmin.openCampaign). Tiles, alert text from codes (the limit-request alert links to
// the Lorekeeper tab), the campaigns card (Open logs the visit, then navigates; a failed log does not navigate),
// Recent changes paginated, a failing card's own boundary.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { name: string; args: Record<string, unknown> };
type Paged = { results: unknown[]; status: string; loadMore: (n: number) => void };

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  queryArgs: {} as Record<string, unknown>,
  paged: {} as Record<string, Paged>,
  calls: [] as Call[],
  reject: null as unknown,
  push: [] as string[],
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    const name = getFunctionName(ref as never);
    state.queryArgs[name] = args;
    const value = state.queries[name];
    if (value instanceof Error) throw value;
    return value;
  },
  usePaginatedQuery: (ref: unknown) => state.paged[getFunctionName(ref as never)],
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    return async (args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      if (state.reject) throw state.reject;
      return { logged: true };
    };
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => {
      state.calls.push({ name: "router.push", args: { url } });
      state.push.push(url);
    },
  }),
}));

const { OverviewTab } = await import("@/components/admin/overview");
const text = await import("@/components/admin/overview/text");

const STATS = {
  accounts: { total: 7, owner: 1, gms: 1, players: 5, more: false },
  campaigns: { live: { count: 2, more: false }, cap: 6 },
  lorekeeper: { questions: 412, costMicros: 8_400_000, limitMicros: 20_000_000 },
};

const LATE = new Date(2026, 9, 29, 21, 5).getTime();

const CAMPAIGNS = [
  {
    campaignId: "c1",
    name: "The Witherwild",
    gmId: "u1",
    gmName: "Petar",
    players: { count: 4, more: false },
    archived: false,
    liveNow: true,
    lastPlayedAt: null,
    createdAt: 1,
  },
  {
    campaignId: "c2",
    name: "Age of Umbra",
    gmId: "u2",
    gmName: null,
    players: { count: 1, more: false },
    archived: false,
    liveNow: false,
    lastPlayedAt: LATE,
    createdAt: 2,
  },
];

const AUDIT = [
  { _id: "a1", at: LATE, actorId: "u1", actorName: "Petar", action: "feature.set", field: "dice3d", from: "off", to: "everyone" },
  { _id: "a2", at: LATE, actorId: "u2", actorName: "Mira", action: "campaign.create", target: "c2" },
];

function paged(results: unknown[], status = "Exhausted"): Paged {
  return { results, status, loadMore: vi.fn() };
}

beforeEach(() => {
  state.queries = { "adminOverview:stats": STATS, "adminOverview:alerts": [] };
  state.queryArgs = {};
  state.paged = { "adminOverview:campaigns": paged(CAMPAIGNS), "adminOverview:audit": paged(AUDIT) };
  state.calls = [];
  state.reject = null;
  state.push = [];
});

afterEach(cleanup);

const card = (title: string) => screen.getByRole("heading", { level: 3, name: title }).closest("section")!;

describe("tiles", () => {
  it("shows the four tiles as the board draws them, for the UTC month", () => {
    render(<OverviewTab onTab={vi.fn()} />);
    const tiles = within(screen.getByRole("list", { name: "This month in numbers" })).getAllByRole("listitem");
    expect(tiles.map((t) => t.textContent)).toEqual([
      "Accounts71 owner · 1 GM · 5 players",
      "Campaigns2of 6 allowed",
      "Lorekeeper questions412this month",
      "Lorekeeper spend$8.40of $20.00 this month",
    ]);
    expect(state.queryArgs["adminOverview:stats"]).toEqual({ month: text.utcPeriods().month });
  });

  it("shows bounded counts with a plus and a loading line", () => {
    state.queries["adminOverview:stats"] = {
      ...STATS,
      accounts: { ...STATS.accounts, total: 1000, more: true },
      campaigns: { live: { count: 1000, more: true }, cap: 6 },
    };
    render(<OverviewTab onTab={vi.fn()} />);
    expect(screen.getAllByText("1000+")).toHaveLength(2);
    cleanup();
    state.queries["adminOverview:stats"] = undefined;
    render(<OverviewTab onTab={vi.fn()} />);
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("Loading …");
  });
});

describe("alerts", () => {
  it("writes each alert's text from its code", () => {
    const alerts = [
      { code: "limitRequestsWaiting", params: { count: 2, more: false } },
      { code: "readOnly", params: {} },
      { code: "keyMissing", params: { service: "email" } },
      { code: "spendNearLimit", params: { costMicros: 16_400_000, limitMicros: 20_000_000 } },
      { code: "userNearDailyCap", params: { userId: "u2", name: "Mira", questions: 27, cap: 30 } },
      { code: "userNearDailyCap", params: { userId: "u3", name: null, questions: 30, cap: 30 } },
    ];
    state.queries["adminOverview:alerts"] = alerts;
    render(<OverviewTab onTab={vi.fn()} />);
    const items = within(screen.getByRole("list", { name: "Alerts" })).getAllByRole("listitem");
    expect(items).toHaveLength(6);
    expect(items[0]).toHaveTextContent("2 GMs are asking for higher Lorekeeper limits");
    expect(items[1]).toHaveTextContent("The app is read-only");
    expect(items[2]).toHaveTextContent("Email has no key");
    expect(items[3]).toHaveTextContent("Lorekeeper spend is at $16.40 of $20.00 this month");
    expect(items[4]).toHaveTextContent("Mira is at 27 of 30 Lorekeeper questions today");
    expect(items[5]).toHaveTextContent("Unnamed account is at 30 of 30 Lorekeeper questions today");
    const periods = text.utcPeriods();
    expect(state.queryArgs["adminOverview:alerts"]).toEqual(periods);
    expect(periods.day.startsWith(`${periods.month}-`)).toBe(true);
  });

  it("the limit-request alert opens the Lorekeeper tab; read-only opens Maintenance", () => {
    state.queries["adminOverview:alerts"] = [
      { code: "limitRequestsWaiting", params: { count: 1, more: false } },
      { code: "readOnly", params: {} },
    ];
    const onTab = vi.fn();
    render(<OverviewTab onTab={onTab} />);
    expect(screen.getByText("1 GM is asking for higher Lorekeeper limits")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review requests" }));
    expect(onTab).toHaveBeenLastCalledWith("lorekeeper");
    fireEvent.click(screen.getByRole("button", { name: "Maintenance" }));
    expect(onTab).toHaveBeenLastCalledWith("maintenance");
  });

  it("no alerts: no list; 50+ requests", () => {
    render(<OverviewTab onTab={vi.fn()} />);
    expect(screen.queryByRole("list", { name: "Alerts" })).toBeNull();
    expect(text.alertText({ code: "limitRequestsWaiting", params: { count: 50, more: true } }).title).toBe(
      "50+ GMs are asking for higher Lorekeeper limits",
    );
    expect(text.alertText({ code: "spendAtLimit", params: { costMicros: 21_000_000, limitMicros: 20_000_000 } }).title).toBe(
      "Lorekeeper spend reached the monthly limit: $21.00 of $20.00",
    );
    expect(text.alertText({ code: "keyMissing", params: { service: "lorekeeper" } }).title).toBe("The Lorekeeper has no API key");
  });
});

describe("campaigns card", () => {
  it("lists every campaign with its GM, players, state and Open", () => {
    render(<OverviewTab onTab={vi.fn()} />);
    const rows = within(card("Campaigns")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("The Witherwild");
    expect(rows[0]).toHaveTextContent("GM Petar · 4 players");
    expect(rows[0]).toHaveTextContent("Live now");
    expect(rows[1]).toHaveTextContent("GM Unnamed account · 1 player");
    expect(rows[1]).toHaveTextContent("Last played 29 Oct");
    expect(within(rows[1]).getByRole("button", { name: "Open Age of Umbra" })).toBeInTheDocument();
  });

  it("Open logs the visit with appAdmin.openCampaign, then opens the campaign", async () => {
    render(<OverviewTab onTab={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Age of Umbra" }));
    await waitFor(() => expect(state.push).toEqual(["/campaigns/c2"]));
    expect(state.calls).toEqual([
      { name: "appAdmin:openCampaign", args: { campaignId: "c2" } },
      { name: "router.push", args: { url: "/campaigns/c2" } },
    ]);
  });

  it("a failed log shows the error and does not navigate", async () => {
    state.reject = new ConvexError({ code: "NOT_FOUND" });
    render(<OverviewTab onTab={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open The Witherwild" }));
    expect(await within(card("Campaigns")).findByRole("alert")).toBeInTheDocument();
    expect(state.push).toEqual([]);
    expect(screen.getByRole("button", { name: "Open The Witherwild" })).toBeEnabled();
  });

  it("pages, and says when there are none", () => {
    const more = paged(CAMPAIGNS, "CanLoadMore");
    state.paged["adminOverview:campaigns"] = more;
    render(<OverviewTab onTab={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Show more campaigns" }));
    expect(more.loadMore).toHaveBeenCalledWith(text.CAMPAIGNS_PAGE);
    cleanup();
    state.paged["adminOverview:campaigns"] = paged([]);
    render(<OverviewTab onTab={vi.fn()} />);
    expect(within(card("Campaigns")).getByText("No campaigns yet.")).toBeInTheDocument();
  });

  it("status text: archived and never played", () => {
    const row = { ...CAMPAIGNS[1], archived: true, lastPlayedAt: null };
    expect(text.campaignStatus(row)).toEqual({ text: "Archived · Not played yet", live: false });
    expect(text.campaignLine({ ...row, players: { count: 100, more: true } })).toBe("GM Unnamed account · 100+ players");
  });
});

describe("recent changes", () => {
  it("shows the hint and each change with who made it, paginated", () => {
    const more = paged(AUDIT, "CanLoadMore");
    state.paged["adminOverview:audit"] = more;
    render(<OverviewTab onTab={vi.fn()} />);
    const changes = card("Recent changes");
    expect(changes).toHaveTextContent("Every change on this page is logged with who made it.");
    const items = within(changes).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("29 Oct · 21:05You switched 3D dice to Everyone");
    expect(items[1]).toHaveTextContent("Mira created a campaign");
    fireEvent.click(screen.getByRole("button", { name: "Show older changes" }));
    expect(more.loadMore).toHaveBeenCalledWith(text.CHANGES_PAGE);
  });

  it("writes every audit action", () => {
    const row = (action: string, extra: Record<string, unknown> = {}) =>
      text.logText({ action, actorName: null, ...extra } as Parameters<typeof text.logText>[0]);
    expect(row("cap.set", { field: "campaignsApp", to: 8 })).toBe("set Campaigns in the whole app to 8");
    expect(row("signUpMode.set", { to: "invite" })).toBe("set New accounts to Invite link only");
    expect(row("lorekeeper.set", { field: "monthlyUsd", to: 20 })).toBe("set the Lorekeeper monthly spend limit to $20");
    expect(row("lorekeeper.set", { field: "allowGmRequests", to: true })).toBe("turned “Let GMs ask for higher limits” on");
    expect(row("readOnly.set", { to: false })).toBe("turned read-only off");
    expect(row("limits.campaign.set", { field: "dailyQuestions", to: "default" })).toBe("set a campaign’s questions per day to the default");
    expect(row("campaign.view")).toBe("opened a campaign from App admin");
    expect(text.logActor({ action: "campaign.delete", actorName: null })).toBe("Unnamed account");
    expect(text.logActor({ action: "tester.add", actorName: "Petar" })).toBe("You");
  });

  it("empty log", () => {
    state.paged["adminOverview:audit"] = paged([]);
    render(<OverviewTab onTab={vi.fn()} />);
    expect(within(card("Recent changes")).getByText("No changes yet.")).toBeInTheDocument();
  });
});

describe("error boundaries", () => {
  it("a failing card shows its own alert and the others still render", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.queries["adminOverview:stats"] = new Error("boom");
    render(<OverviewTab onTab={vi.fn()} />);
    expect(screen.getByText("The numbers failed to load. Reload the page to try again.")).toBeInTheDocument();
    expect(card("Campaigns")).toBeInTheDocument();
    expect(card("Recent changes")).toBeInTheDocument();
    vi.mocked(console.error).mockRestore();
  });
});
