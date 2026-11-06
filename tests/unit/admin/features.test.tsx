// Plan config AU4: App admin, Feature switches tab (design reference/designs/config/Admin.dc.html, `.s-flags`). The
// intro; one row per FEATURES entry in board order (no combat HUD, Q25 b) with its description, 'Changed <date>' and
// the four-way choice (Off / Only me / Testers / Everyone, aria-pressed glass buttons) that writes features.setMode
// with an optimistic update (rule 12) and rolls back on an error; the inert Journal / Share links rows carry N2's notes
// and save like the others; the Testers card lists the testers from AD3's account table and Edit opens a picker that
// adds / removes one account per click (optimistic), with more pages on demand.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { useSyncExternalStore } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FEATURES } from "@/lib/admin/features";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
const store = new Map<string, unknown>();
const listeners = new Set<() => void>();
let version = 0;
const calls: { name: string; args: Record<string, unknown> }[] = [];
let refuse: Error | null = null;
const paging = { status: "Exhausted" as string, loadMore: vi.fn() };

const keyOf = (ref: unknown, args: unknown) => `${functionName(ref)}:${JSON.stringify(args)}`;
function write(key: string, value: unknown) {
  store.set(key, value);
  version++;
  for (const l of listeners) l();
}
function useVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    useVersion();
    return store.get(keyOf(ref, args));
  },
  usePaginatedQuery: (ref: unknown, args: unknown) => {
    useVersion();
    const results = store.get(keyOf(ref, args)) as unknown[] | undefined;
    return { results: results ?? [], status: results === undefined ? "LoadingFirstPage" : paging.status, loadMore: paging.loadMore };
  },
  // The fake store keeps a paginated query's rows under its key; apply the update to them.
  optimisticallyUpdateValueInPaginatedQuery: (s: { getQuery: (q: unknown, a: unknown) => unknown; setQuery: (q: unknown, a: unknown, v: unknown) => void }, ref: unknown, args: unknown, fn: (row: unknown) => unknown) => {
    const rows = s.getQuery(ref, args) as unknown[] | undefined;
    if (rows) s.setQuery(ref, args, rows.map(fn));
  },
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    let update: ((s: unknown, args: Record<string, unknown>) => void) | null = null;
    const fake = { getQuery: (q: unknown, a: unknown) => store.get(keyOf(q, a)), setQuery: (q: unknown, a: unknown, value: unknown) => write(keyOf(q, a), value) };
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      const before = new Map(store);
      update?.(fake, args);
      if (refuse) {
        for (const [k, v] of before) write(k, v);
        throw refuse;
      }
      return null;
    };
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (s: unknown, args: Record<string, unknown>) => void) => {
        update = fn;
        return run;
      },
    });
  },
}));

const { FeatureSwitchesTab } = await import("@/components/admin/features");
const { changedLabel, joinNames } = await import("@/components/admin/features/text");

const LIST = "features:list:{}";
const ACCOUNTS = "adminAccounts:accounts:{}";

type Account = { userId: string; name: string | null; email: string | null; role: "owner" | "gm" | "player"; tester: boolean };
const account = (userId: string, name: string | null, role: Account["role"] = "player", tester = false, email: string | null = null): Account => ({
  userId,
  name,
  email,
  role,
  tester,
});

const NOV_2 = new Date(2026, 10, 2, 23, 40).getTime();

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  store.clear();
  calls.length = 0;
  refuse = null;
  paging.status = "Exhausted";
  paging.loadMore.mockReset();
  store.set(
    LIST,
    FEATURES.map((f) => ({ key: f.key, mode: f.key === "phoneLayout" ? "testers" : "everyone", changedAt: f.key === "journal" ? NOV_2 : null })),
  );
  store.set(ACCOUNTS, [account("u0", "Petar", "owner"), account("u1", "Luka", "player", true), account("u2", "Mira", "gm", true), account("u3", "Ana")]);
});
afterEach(cleanup);

const tab = () => render(<FeatureSwitchesTab onTab={vi.fn()} />);
const row = (key: string) => screen.getByTestId(`feature-${key}`);
const choice = (feature: string, mode: string) => within(screen.getByRole("group", { name: feature })).getByRole("button", { name: mode });
const modeOf = (key: string) => (store.get(LIST) as { key: string; mode: string }[]).find((r) => r.key === key)!.mode;

describe("Feature switches card", () => {
  it("shows the intro and one row per feature in board order, without the combat HUD", () => {
    tab();
    expect(screen.getByRole("heading", { level: 3, name: "Feature switches" })).toBeInTheDocument();
    expect(
      screen.getByText("Turn new parts of the app on for yourself first, then testers, then everyone. Nothing is lost when a feature is off."),
    ).toBeInTheDocument();
    const groups = screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Journal", "3D dice", "Phone layout", "Lorekeeper internet search", "Sprite tokens", "Share links"]);
    expect(screen.queryByText(/combat HUD/i)).toBeNull();
    for (const f of FEATURES) expect(within(row(f.key)).getByText(f.description)).toBeInTheDocument();
  });

  it("shows 'Changed <date>' or 'Changed —' and the saved mode pressed", () => {
    tab();
    expect(within(row("journal")).getByText(changedLabel(NOV_2))).toBeInTheDocument();
    expect(within(row("dice3d")).getByText("Changed —")).toBeInTheDocument();
    const buttons = within(screen.getByRole("group", { name: "Phone layout" })).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Off", "Only me", "Testers", "Everyone"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);
    for (const b of buttons) expect(b).toHaveClass("gb", "gb-neutral");
  });

  it("Journal and Share links carry N2's notes and save like the others", () => {
    tab();
    expect(within(row("journal")).getByText("Always on for now: the old Sessions and Notes pages are gone.")).toBeInTheDocument();
    expect(within(row("shareLinks")).getByText("Not built yet.")).toBeInTheDocument();
    expect(within(row("dice3d")).queryByText(/Always on|Not built/)).toBeNull();
    fireEvent.click(choice("Journal", "Off"));
    expect(calls).toEqual([{ name: "features:setMode", args: { key: "journal", mode: "off" } }]);
  });

  it("a choice writes one intent with an optimistic update; the current mode writes nothing", async () => {
    tab();
    fireEvent.click(choice("Sprite tokens", "Everyone"));
    expect(calls).toEqual([]);
    fireEvent.click(choice("Sprite tokens", "Only me"));
    expect(calls).toEqual([{ name: "features:setMode", args: { key: "spriteTokens", mode: "owner" } }]);
    expect(modeOf("spriteTokens")).toBe("owner");
    await waitFor(() => expect(choice("Sprite tokens", "Only me")).toHaveAttribute("aria-pressed", "true"));
    expect(within(row("spriteTokens")).queryByText("Changed —")).toBeNull();
  });

  it("a refused write rolls back and shows the error", async () => {
    refuse = new ConvexError({ code: "FORBIDDEN" });
    tab();
    fireEvent.click(choice("3D dice", "Off"));
    await waitFor(() => expect(choice("3D dice", "Everyone")).toHaveAttribute("aria-pressed", "true"));
    expect(modeOf("dice3d")).toBe("everyone");
    await waitFor(() => expect(document.querySelector(".afs-err")?.textContent).not.toBe(""));
  });

  it("shows a loading line until the list answers", () => {
    store.delete(LIST);
    store.delete(ACCOUNTS);
    tab();
    expect(screen.getAllByRole("status").map((s) => s.textContent)).toEqual(["Loading …", "Loading …"]);
  });
});

describe("Testers card", () => {
  it("lists the testers from the account table", () => {
    tab();
    const r = screen.getByTestId("testers-row");
    expect(within(r).getByText("Luka and Mira")).toBeInTheDocument();
    expect(within(r).getByText("See features set to Testers.")).toBeInTheDocument();
    expect(within(r).getByRole("button", { name: "Edit" })).toHaveClass("gb");
  });

  it("says when there are no testers, and when older accounts are not loaded", () => {
    store.set(ACCOUNTS, [account("u0", "Petar", "owner", true), account("u3", "Ana")]);
    paging.status = "CanLoadMore";
    tab();
    expect(screen.getByText("No testers yet")).toBeInTheDocument();
    expect(screen.getByText("Older accounts are not loaded yet; Edit shows them.")).toBeInTheDocument();
  });

  it("Edit opens a picker over the accounts (owner left out) that adds and removes testers optimistically", async () => {
    tab();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Testers" });
    const list = within(dialog).getByRole("list", { name: "Accounts" });
    expect(within(list).getAllByRole("listitem").map((li) => li.querySelector("b")?.textContent)).toEqual(["Luka", "Mira", "Ana"]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Add Ana to testers" }));
    expect(calls.at(-1)).toEqual({ name: "adminAccounts:addTester", args: { userId: "u3" } });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Remove Ana from testers" })).toBeInTheDocument());
    expect(screen.getByTestId("testers-row")).toHaveTextContent("Luka, Mira and Ana");

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Luka from testers" }));
    expect(calls.at(-1)).toEqual({ name: "adminAccounts:removeTester", args: { userId: "u1" } });
    await waitFor(() => expect(screen.getByTestId("testers-row")).toHaveTextContent("Mira and Ana"));
  });

  it("the picker loads more accounts on demand and shows a refused change", async () => {
    paging.status = "CanLoadMore";
    refuse = new ConvexError({ code: "NOT_FOUND" });
    tab();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Testers" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Show more accounts" }));
    expect(paging.loadMore).toHaveBeenCalledWith(50);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Ana to testers" }));
    await waitFor(() => expect(dialog.querySelector(".afs-err")?.textContent).not.toBe(""));
    expect(within(dialog).getByRole("button", { name: "Add Ana to testers" })).toBeInTheDocument();
  });
});

describe("text helpers", () => {
  it("changedLabel / joinNames", () => {
    const now = new Date(2026, 10, 4).getTime();
    expect(changedLabel(null, now)).toBe("Changed —");
    expect(changedLabel(NOV_2, now)).toBe("Changed 2 Nov");
    expect(changedLabel(new Date(2025, 9, 14).getTime(), now)).toBe("Changed 14 Oct 2025");
    expect(joinNames(["Luka"])).toBe("Luka");
    expect(joinNames(["Luka", "Mira", "Ana"])).toBe("Luka, Mira and Ana");
  });
});
