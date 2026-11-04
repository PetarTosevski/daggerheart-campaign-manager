/**
 * Config R1 (user Q3 changed 2026-11-04): where the server sends `fear: null` (a player, "Players see the GM's Fear"
 * off) the pool shows "?" with the Fear art kept: the HUD banner and the dashboard Fear panel. The GM's optimistic Fear
 * steps skip a null. Convex is mocked.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FearPanel } from "@/app/(gm)/campaigns/[campaignId]/fear-panel";
import { FearBanner, useAdjustFear } from "@/components/combat-map/hud/fear/banner";
import { FEAR_HIDDEN_LABEL, fearShown } from "@/components/combat-map/hud/fear/hidden";

import type { Id } from "../../convex/_generated/dataModel";

const queries: Record<string, unknown> = {};
const updaters: Record<string, (store: unknown, args: unknown) => void> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => queries[functionName(ref)],
  useMutation: (ref: unknown) => {
    const run = async () => null;
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (store: unknown, args: unknown) => void) => {
        updaters[functionName(ref)] = fn;
        return run;
      },
    });
  },
}));

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(updaters)) delete updaters[k];
});

const campaignId = "c1" as Id<"campaigns">;

describe("fearShown", () => {
  it("is the number, or '?' when hidden", () => {
    expect(fearShown(4)).toBe("4");
    expect(fearShown(0)).toBe("0");
    expect(fearShown(null)).toBe("?");
  });
});

describe("the HUD Fear banner (R1)", () => {
  it("hidden: '?', empty pips labelled 'Fear hidden by the GM', the banner and flame kept, no − / +", () => {
    render(<FearBanner campaignId={campaignId} fear={null} gm={false} />);
    const banner = screen.getByTestId("hud-fear");
    expect(screen.getByTestId("hud-fear-value").textContent).toBe("?");
    expect(screen.getByRole("img", { name: FEAR_HIDDEN_LABEL })).toBeTruthy();
    expect(banner.querySelector(".hud-fb-ic")).not.toBeNull();
    expect(banner.querySelectorAll(".hud-pp i.on")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Spend a Fear" })).toBeNull();
  });

  it("shown: the number and its pips", () => {
    render(<FearBanner campaignId={campaignId} fear={5} gm={false} />);
    expect(screen.getByTestId("hud-fear-value").textContent).toBe("5");
    expect(screen.getByRole("img", { name: "5 of 12 Fear" })).toBeTruthy();
  });

  it("the GM's optimistic step leaves a null alone", () => {
    function Probe() {
      useAdjustFear(campaignId);
      return null;
    }
    render(<Probe />);
    const set = vi.fn();
    const store = { getQuery: (ref: unknown) => (functionName(ref) === "combatHud:scene" ? { fear: null } : null), setQuery: set };
    updaters["fear:adjust"]!(store, { campaignId, direction: "increase" });
    expect(set).not.toHaveBeenCalled();
  });
});

describe("the dashboard Fear panel (R1)", () => {
  it("hidden: the core reads '?', every token dark and disabled, no 'Click a token to set'", () => {
    queries["campaigns:fear"] = null;
    render(<FearPanel campaignId={campaignId} />);
    const value = screen.getByTestId("fear-value");
    expect(value.textContent).toBe("?");
    expect(value.getAttribute("aria-label")).toBe(FEAR_HIDDEN_LABEL);
    const tokens = screen.getAllByRole("button", { name: /^Fear \d+ of 12$/ });
    expect(tokens).toHaveLength(12);
    expect(tokens.every((b) => b.getAttribute("aria-pressed") === "false" && (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByText("Click a token to set")).toBeNull();
  });

  it("shown: the Roman numeral", () => {
    queries["campaigns:fear"] = 3;
    render(<FearPanel campaignId={campaignId} readOnly />);
    expect(screen.getByTestId("fear-value").textContent).toBe("III");
  });
});
