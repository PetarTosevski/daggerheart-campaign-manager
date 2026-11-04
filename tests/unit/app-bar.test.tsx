// Plan combat-hud H9.A: the Combat Map's app bar (src/components/app-bar). Nav from CAMPAIGN_SECTIONS in the user's
// order (Q1 a), the live dot, the Lorekeeper pill opening the drawer store, the full-screen hide with its way back
// (Q2 c), and the gear / avatar (config S1: the gear opens Campaign settings through ?settings=, the avatar the
// Preferences popover; the interim Players menu is gone).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";

const CAMPAIGN = "c1" as Id<"campaigns">;
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

const results: Record<string, unknown> = {};

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[functionName(ref)]),
}));

vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut: () => Promise.resolve() }) }));

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
    usePathname: () => `/campaigns/${CAMPAIGN}/combat-map`,
    useRouter: () => ({ push: () => undefined, replace: () => undefined }),
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
  };
});

const { CombatAppBarFrame, FULL_SCREEN_LABEL, SHOW_BAR_LABEL } = await import("@/components/app-bar");
const { closeLorekeeperDrawer, useLorekeeperDrawerState } = await import("@/components/app-bar/lorekeeper-store");
const { CAMPAIGN_SECTIONS } = await import("@/lib/campaign-sections");

function renderBar({ isGm = true, onPlayers = () => undefined } = {}) {
  return render(
    <CombatAppBarFrame campaignId={CAMPAIGN} isGm={isGm} header={<section aria-label="Campaign header" />} onPlayers={onPlayers}>
      <p>the page</p>
    </CombatAppBarFrame>,
  );
}

beforeEach(() => {
  for (const key of Object.keys(results)) delete results[key];
  results["lorekeeper:available"] = true;
  results["combatMaps:list"] = [];
  results["combatMaps:live"] = null;
  results["charactersReads:partySummary"] = [];
  window.history.replaceState(null, "", `/campaigns/${CAMPAIGN}/combat-map`);
  act(() => closeLorekeeperDrawer(null));
});

describe("app bar nav", () => {
  it("lists the GM's sections in CAMPAIGN_SECTIONS order, the Lorekeeper as the pill, Combat Map current", () => {
    renderBar();
    const nav = screen.getByRole("navigation", { name: "Campaign sections" });
    const expected = CAMPAIGN_SECTIONS.filter((s) => s.slug !== "lorekeeper").map((s) => s.label);
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(expected);
    expect(within(nav).getByRole("link", { name: /Combat Map/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByTestId("app-bar-live")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to main menu" })).toHaveAttribute("href", "/");
  });

  it("marks Combat Map live when one of the GM's maps is live", () => {
    results["combatMaps:list"] = [{ _id: "m1", live: false }, { _id: "m2", live: true }];
    renderBar();
    expect(screen.getByTestId("app-bar-live")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Combat Map\s*\(live\)$/ })).toBeInTheDocument();
  });

  it("hides GM-only sections and the gear from a player; the live map lights the dot", () => {
    results["combatMaps:live"] = { _id: "m2" };
    renderBar({ isGm: false });
    const nav = screen.getByRole("navigation", { name: "Campaign sections" });
    expect(within(nav).queryByRole("link", { name: "Adversaries" })).toBeNull();
    expect(screen.getByTestId("app-bar-live")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Campaign settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Your preferences" })).toBeInTheDocument();
  });
});

describe("Lorekeeper pill", () => {
  it("opens the drawer through the shared store on this page", () => {
    let state: ReturnType<typeof useLorekeeperDrawerState> | undefined;
    function Probe() {
      state = useLorekeeperDrawerState();
      return null;
    }
    renderBar();
    render(<Probe />);
    const pill = screen.getByRole("button", { name: "Ask the Lorekeeper" });
    expect(pill).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(pill);
    expect(state).toEqual({ openAt: `/campaigns/${CAMPAIGN}/combat-map`, wanted: true });
    expect(pill).toHaveAttribute("aria-expanded", "true");
    act(() => closeLorekeeperDrawer(null));
    expect(pill).toHaveFocus();
  });

  it("is a link to the Lorekeeper page while the Lorekeeper is unavailable", () => {
    results["lorekeeper:available"] = false;
    renderBar();
    expect(screen.getByRole("link", { name: "Ask the Lorekeeper" })).toHaveAttribute("href", `/campaigns/${CAMPAIGN}/lorekeeper`);
  });
});

describe("full screen", () => {
  it("hides the bar, focuses the way back, and Escape brings it back", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: FULL_SCREEN_LABEL }));
    expect(screen.queryByTestId("app-bar")).toBeNull();
    expect(screen.getByTestId("combat-app-frame")).toHaveAttribute("data-bar-hidden");
    expect(screen.getByText("the page")).toBeInTheDocument();
    const back = screen.getByRole("button", { name: SHOW_BAR_LABEL });
    expect(back).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("app-bar")).toBeInTheDocument();
    expect(screen.getByTestId("combat-app-frame")).not.toHaveAttribute("data-bar-hidden");
    expect(screen.getByRole("button", { name: FULL_SCREEN_LABEL })).toHaveFocus();
  });

  it("the floating button brings the bar back too", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: FULL_SCREEN_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: SHOW_BAR_LABEL }));
    expect(screen.getByTestId("app-bar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: SHOW_BAR_LABEL })).toBeNull();
  });
});

describe("gear and avatar", () => {
  it("the GM's gear opens Campaign settings (?settings=table); the old Players menu is gone", () => {
    const onPlayers = vi.fn();
    renderBar({ onPlayers });
    const gear = screen.getByRole("button", { name: "Campaign settings" });
    expect(gear).toHaveAttribute("aria-haspopup", "dialog");
    expect(gear).toHaveAttribute("aria-expanded", "false");
    expect(gear.className).toContain("gb-tool");
    fireEvent.click(gear);
    expect(window.location.search).toBe("?settings=table");
    expect(gear).toHaveAttribute("aria-expanded", "true");
    expect(onPlayers).not.toHaveBeenCalled();
    expect(screen.queryByText("More campaign settings are on the way.")).toBeNull();
    const avatar = screen.getByRole("button", { name: "Your preferences" });
    expect(within(avatar).getByText("GM")).toBeInTheDocument();
    expect(avatar.className).toContain("gb-tool");
    expect(screen.queryByText("Your preferences are on the way.")).toBeNull();
  });

  it("a player's avatar shows their character's initial without art", () => {
    results["charactersReads:partySummary"] = [
      { _id: "x", canEdit: false, sheet: { name: "Zed", ancestry: { kind: "single", id: "none" }, subclassId: "none", classId: "none" } },
      { _id: "y", canEdit: true, sheet: { name: "moss", ancestry: { kind: "single", id: "none" }, subclassId: "none", classId: "none" } },
    ];
    renderBar({ isGm: false });
    expect(within(screen.getByRole("button", { name: "Your preferences" })).getByText("M")).toBeInTheDocument();
  });
});
