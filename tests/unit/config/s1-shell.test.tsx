// Plan config S1: the Campaign settings slide-over and the Preferences popover (design
// reference/designs/config/Settings.dc.html). URL state ?settings=<section> (bad value -> Table, closing removes it,
// other params stay), the five-section nav with aria-current, the section heading + slot, the footer, Escape; the
// popover's head, account label, slots and footer buttons; the slot stubs render nothing.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../convex/campaigns";

const CAMPAIGN = "c1" as Id<"campaigns">;
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
const results: Record<string, unknown> = {};
const signOut = vi.fn(() => Promise.resolve());
const push = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[functionName(ref)]),
}));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut }) }));

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
    useRouter: () => ({ push, replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
  };
});

const { CampaignSettingsPanel, ConfigMounts } = await import("@/components/config/shell");
const { CampaignSettingsButton, PreferencesButton } = await import("@/components/app-bar/account");
const slots = await import("@/components/config/slots");

const campaign = { _id: CAMPAIGN, name: "The Witherwild", role: "gm" } as unknown as CampaignSummary;

function setUrl(url: string) {
  act(() => window.history.replaceState(null, "", url));
}

beforeAll(() => {
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
  for (const key of Object.keys(results)) delete results[key];
  results["users:viewer"] = { email: "ana@example.com", name: "Ana" };
  results["campaigns:get"] = campaign;
  results["charactersReads:partySummary"] = [];
  signOut.mockClear();
  push.mockClear();
  window.history.replaceState(null, "", `/campaigns/${CAMPAIGN}?tab=notes`);
});

describe("settings URL state", () => {
  it("parses ?settings=: absent is closed, a known section opens it, anything else opens Table", () => {
    expect(slots.parseSettingsSection(null)).toBeNull();
    expect(slots.parseSettingsSection(undefined)).toBeNull();
    for (const { id } of slots.SETTINGS_SECTIONS) expect(slots.parseSettingsSection(id)).toBe(id);
    expect(slots.parseSettingsSection("nope")).toBe("table");
    expect(slots.parseSettingsSection("")).toBe("table");
  });

  it("sets and removes only its own param", () => {
    expect(slots.settingsUrl("/c", "?tab=notes", "players")).toBe("/c?tab=notes&settings=players");
    expect(slots.settingsUrl("/c", "?tab=notes&settings=players", null)).toBe("/c?tab=notes");
    expect(slots.settingsUrl("/c", "?settings=rules", null)).toBe("/c");
  });

  it("lists the board's five sections in order", () => {
    expect(slots.SETTINGS_SECTIONS.map((s) => s.label)).toEqual(["Table", "House rules", "Players", "Lorekeeper", "Sessions"]);
  });
});

describe("Campaign settings panel", () => {
  it("is closed without the param and opens at Table from the gear, keeping the other params", () => {
    render(
      <>
        <CampaignSettingsButton />
        <CampaignSettingsPanel campaign={campaign} />
      </>,
    );
    const dialog = screen.getByTestId("campaign-settings");
    expect(dialog).not.toHaveAttribute("open");
    expect(within(dialog).queryByRole("heading")).toBeNull();
    const gear = screen.getByRole("button", { name: "Campaign settings" });
    expect(gear).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(gear);
    expect(window.location.search).toBe("?tab=notes&settings=table");
    expect(dialog).toHaveAttribute("open");
    expect(gear).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByText("The Witherwild · GM only")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { level: 2, name: "Campaign settings" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { level: 3, name: "At the table" })).toBeInTheDocument();
    expect(within(dialog).getByText("Changes save as you make them and reach every player at once.")).toBeInTheDocument();
    const nav = within(dialog).getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Table", "House rules", "Players", "Lorekeeper", "Sessions"]);
    expect(within(nav).getByRole("button", { name: "Table" })).toHaveAttribute("aria-current", "true");
    expect(within(nav).getByRole("button", { name: "Table" })).toHaveFocus();
  });

  it("switches sections through the URL and closes with the ✕, removing only ?settings=", () => {
    setUrl(`/campaigns/${CAMPAIGN}?tab=notes&settings=table`);
    render(<CampaignSettingsPanel campaign={campaign} />);
    const dialog = screen.getByTestId("campaign-settings");
    fireEvent.click(within(dialog).getByRole("button", { name: "Players" }));
    expect(window.location.search).toBe("?tab=notes&settings=players");
    expect(within(dialog).getByRole("heading", { level: 3, name: "Players" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Players" })).toHaveAttribute("aria-current", "true");
    expect(within(dialog).getByRole("button", { name: "Table" })).not.toHaveAttribute("aria-current");

    fireEvent.click(within(dialog).getByRole("button", { name: "Close campaign settings" }));
    expect(window.location.search).toBe("?tab=notes");
    expect(dialog).not.toHaveAttribute("open");
  });

  it("a bad value opens Table; the dialog's close event (Escape) removes the param", () => {
    setUrl(`/campaigns/${CAMPAIGN}?settings=bogus`);
    render(<CampaignSettingsPanel campaign={campaign} />);
    const dialog = screen.getByTestId("campaign-settings");
    expect(within(dialog).getByRole("heading", { level: 3, name: "At the table" })).toBeInTheDocument();
    act(() => (dialog as HTMLDialogElement).close());
    expect(window.location.search).toBe("");
  });

  it("each section heading comes with its (empty) slot", () => {
    for (const { id, title } of slots.SETTINGS_SECTIONS) {
      setUrl(`/campaigns/${CAMPAIGN}?settings=${id}`);
      const { unmount } = render(<CampaignSettingsPanel campaign={campaign} />);
      const section = screen.getByRole("region", { name: title });
      expect(section).toHaveAttribute("data-section", id);
      // Only the heading: the stub renders nothing until its tracer lands.
      expect(section.children).toHaveLength(1);
      unmount();
    }
  });
});

describe("ConfigMounts", () => {
  it("mounts the panel for the GM only; presence and spotlight stubs render nothing", () => {
    setUrl(`/campaigns/${CAMPAIGN}?settings=table`);
    const { container, unmount } = render(<ConfigMounts campaign={{ ...campaign, role: "player" } as CampaignSummary} />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    render(<ConfigMounts campaign={campaign} />);
    expect(screen.getByTestId("campaign-settings")).toHaveAttribute("open");
  });
});

function openPopover() {
  const popover = screen.getByTestId("preferences");
  // jsdom has no popover API (and keeps every [popover] display: none, so role queries pass hidden: true): the
  // browser's toggle event, as it fires after the avatar opens it.
  act(() => {
    popover.dispatchEvent(Object.assign(new Event("toggle"), { newState: "open", oldState: "closed" }));
  });
  return popover;
}

describe("Preferences popover", () => {
  it("the GM's: face, name, role · campaign, the account label, Campaign settings and Sign out", async () => {
    render(<PreferencesButton campaignId={CAMPAIGN} isGm />);
    const avatar = screen.getByRole("button", { name: "Your preferences" });
    expect(avatar).toHaveTextContent("GM");
    expect(avatar).toHaveAttribute("aria-expanded", "false");
    const popover = screen.getByTestId("preferences");
    expect(popover).toHaveAttribute("popover", "auto");
    expect(popover).toBeEmptyDOMElement();

    openPopover();
    expect(avatar).toHaveAttribute("aria-expanded", "true");
    expect(within(popover).getByText("Ana")).toBeInTheDocument();
    expect(within(popover).getByText("Game Master · The Witherwild")).toBeInTheDocument();
    expect(within(popover).getByText("Saved to your account · follows you to every device")).toBeInTheDocument();
    expect(within(popover).queryByText(/Only on this device/)).toBeNull();

    fireEvent.click(within(popover).getByRole("button", { name: "Campaign settings", hidden: true }));
    expect(window.location.search).toBe("?tab=notes&settings=table");

    fireEvent.click(within(popover).getByRole("button", { name: "Sign out", hidden: true }));
    expect(signOut).toHaveBeenCalledTimes(1);
    await act(async () => undefined);
    expect(push).toHaveBeenCalledWith("/signin");
  });

  it("a player's: their character's initial, 'Player', no Campaign settings", () => {
    results["users:viewer"] = { email: "m@example.com", name: null };
    results["charactersReads:partySummary"] = [
      { _id: "y", canEdit: true, sheet: { name: "moss", ancestry: { kind: "single", id: "none" }, subclassId: "none", classId: "none" } },
    ];
    render(<PreferencesButton campaignId={CAMPAIGN} isGm={false} />);
    expect(screen.getByRole("button", { name: "Your preferences" })).toHaveTextContent("M");
    const popover = openPopover();
    expect(within(popover).getByText("You")).toBeInTheDocument();
    expect(within(popover).getByText("Player · The Witherwild")).toBeInTheDocument();
    expect(within(popover).queryByRole("button", { name: "Campaign settings", hidden: true })).toBeNull();
    expect(within(popover).getByRole("button", { name: "Sign out", hidden: true })).toBeInTheDocument();
  });
});
