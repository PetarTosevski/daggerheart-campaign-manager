// Plan config AD1: the App admin shell (design reference/designs/config/Admin.dc.html). The owner gate (appAdmin.me,
// stubbed until AD0: loading, non-owner 'Not allowed' with no tab mounted, owner frame), the header text, the five ARIA
// tabs with ?tab= URL state (bad value -> Overview, Overview removes the param, other params stay, keyboard), only the
// selected tab mounted, each tab in an error boundary; the slot stubs render nothing.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const owner = vi.hoisted(() => ({ state: undefined as { isOwner: boolean } | null | undefined }));
const mounted = vi.hoisted(() => ({ tabs: [] as string[], fail: null as string | null }));

vi.mock("@/components/admin/shell/owner", () => ({ useAppOwner: () => owner.state }));

// Next syncs history.replaceState into useSearchParams; model that with a store over window.location.search.
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const listeners = new Set<() => void>();
  const replace = window.history.replaceState.bind(window.history);
  window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    replace(...args);
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return {
    usePathname: () => window.location.pathname,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
  };
});

/** A tab double: records that it mounted (where its queries would run) and can throw. */
function fakeTab(name: string) {
  return function FakeTab(): ReactNode {
    mounted.tabs.push(name);
    if (mounted.fail === name) throw new Error(`${name} broke`);
    return <p>{`${name} content`}</p>;
  };
}
vi.mock("@/components/admin/overview", () => ({ OverviewTab: fakeTab("overview") }));
vi.mock("@/components/admin/accounts", () => ({ AccountsTab: fakeTab("accounts") }));
vi.mock("@/components/admin/lorekeeper", () => ({ LorekeeperTab: fakeTab("lorekeeper") }));
vi.mock("@/components/admin/features", () => ({ FeatureSwitchesTab: fakeTab("features") }));
vi.mock("@/components/admin/maintenance", () => ({ MaintenanceTab: fakeTab("maintenance") }));

const { AdminShell } = await import("@/components/admin/shell");
const slots = await import("@/components/admin/slots");

function setUrl(url: string) {
  act(() => window.history.replaceState(null, "", url));
}

beforeEach(() => {
  owner.state = { isOwner: true };
  mounted.tabs = [];
  mounted.fail = null;
  setUrl("/admin");
});
afterEach(cleanup);

describe("owner gate", () => {
  it("shows a loading line and no admin text while appAdmin.me loads", () => {
    owner.state = undefined;
    render(<AdminShell />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByText("App admin")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(mounted.tabs).toEqual([]);
  });

  it.each([{ isOwner: false }, null])("a non-owner (%o) gets 'Not allowed', a link to the main menu and no tab ever mounts", (state) => {
    owner.state = state;
    setUrl("/admin?tab=accounts");
    render(<AdminShell />);
    expect(screen.getByRole("heading", { level: 1, name: "Not allowed" })).toBeInTheDocument();
    expect(screen.getByText("This page is for the app owner.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the main menu" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText(/App admin|Owner only|Saved/)).toBeNull();
    expect(mounted.tabs).toEqual([]);
  });

  it("the owner gets the design's header", () => {
    render(<AdminShell />);
    const header = screen.getByRole("region", { name: "App admin header" });
    expect(within(header).getByText("Owner only")).toBeInTheDocument();
    expect(within(header).getByText("Whole app · every campaign")).toBeInTheDocument();
    expect(within(header).getByRole("heading", { level: 1, name: "App admin" })).toBeInTheDocument();
    expect(within(header).getByText("Limits, costs and switches for the app. GMs and players never see this page.")).toBeInTheDocument();
    expect(within(header).getByText("Saved · changes apply right away")).toBeInTheDocument();
    expect(within(header).getByRole("link", { name: "Back to the main menu" })).toHaveAttribute("href", "/");
  });
});

describe("tabs", () => {
  const tabs = () => within(screen.getByRole("tablist", { name: "Admin sections" })).getAllByRole("tab");
  const tab = (name: string) => screen.getByRole("tab", { name });

  it("lists the five tabs in order, Overview selected by default, only its slot mounted", () => {
    render(<AdminShell />);
    expect(tabs().map((t) => t.textContent)).toEqual(["Overview", "Accounts", "Lorekeeper", "Feature switches", "Maintenance"]);
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    expect(tab("Overview")).toHaveAttribute("tabindex", "0");
    expect(tab("Accounts")).toHaveAttribute("tabindex", "-1");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", tab("Overview").id);
    expect(within(panel).getByText("overview content")).toBeInTheDocument();
    expect(new Set(mounted.tabs)).toEqual(new Set(["overview"]));
  });

  it("opens the tab from ?tab= and a bad value falls back to Overview", () => {
    setUrl("/admin?tab=maintenance");
    const { unmount } = render(<AdminShell />);
    expect(tab("Maintenance")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("maintenance content")).toBeInTheDocument();
    unmount();
    setUrl("/admin?tab=nope");
    render(<AdminShell />);
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
  });

  it("a click writes ?tab= and keeps other params; Overview removes it", () => {
    setUrl("/admin?x=1");
    render(<AdminShell />);
    fireEvent.click(tab("Feature switches"));
    expect(window.location.search).toBe("?x=1&tab=features");
    expect(tab("Feature switches")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("features content")).toBeInTheDocument();
    expect(screen.queryByText("overview content")).toBeNull();
    fireEvent.click(tab("Overview"));
    expect(window.location.search).toBe("?x=1");
  });

  it("arrow keys, Home and End move the selection and the focus", () => {
    render(<AdminShell />);
    const list = screen.getByRole("tablist");
    tab("Overview").focus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(tab("Accounts")).toHaveAttribute("aria-selected", "true");
    expect(tab("Accounts")).toHaveFocus();
    fireEvent.keyDown(list, { key: "End" });
    expect(tab("Maintenance")).toHaveFocus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(tab("Overview")).toHaveFocus();
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(tab("Maintenance")).toHaveFocus();
    fireEvent.keyDown(list, { key: "Home" });
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toBe("");
  });

  it("a failing tab shows its own alert; the header and the other tabs keep working", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mounted.fail = "accounts";
    setUrl("/admin?tab=accounts");
    render(<AdminShell />);
    expect(screen.getByRole("alert")).toHaveTextContent("Accounts failed to load.");
    expect(screen.getByRole("heading", { level: 1, name: "App admin" })).toBeInTheDocument();
    fireEvent.click(tab("Lorekeeper"));
    expect(screen.getByText("lorekeeper content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    vi.mocked(console.error).mockRestore();
  });
});

describe("stubs", () => {
  it("every tab stub renders nothing until its tracer lands", async () => {
    const onTab = vi.fn();
    const stubs = [
      // AccountsTab is built (AU2): tests/unit/admin/accounts.test.tsx.
      (await vi.importActual<typeof import("@/components/admin/lorekeeper")>("@/components/admin/lorekeeper")).LorekeeperTab,
    ];
    for (const Stub of stubs) {
      const { container, unmount } = render(<Stub onTab={onTab} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe("slots contract", () => {
  it("parseAdminTab / adminTabUrl", () => {
    expect(slots.parseAdminTab(null)).toBe("overview");
    expect(slots.parseAdminTab("lorekeeper")).toBe("lorekeeper");
    expect(slots.parseAdminTab("LOREKEEPER")).toBe("overview");
    expect(slots.adminTabUrl("/admin", "", "accounts")).toBe("/admin?tab=accounts");
    expect(slots.adminTabUrl("/admin", "?tab=accounts&a=b", "overview")).toBe("/admin?a=b");
  });
});
