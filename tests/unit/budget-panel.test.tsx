// The encounter builder's Battle Points panel (src/components/adversaries/builder/budget-panel.tsx) in both variants:
// the builder's default rendering (Adversaries tab) and the Journal Plan board's card (Journal JP2,
// docs/tasks/TASK-JOURNAL-JP2.md). Both send the same `encounters.setBudget` intent with the same optimistic update.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EncounterView } from "../../src/components/adversaries/builder/types";

type Store = { getQuery: (ref: unknown, args: unknown) => unknown; setQuery: (ref: unknown, args: unknown, value: unknown) => void };
const calls = vi.hoisted(() => ({
  list: [] as { name: string; args: Record<string, unknown> }[],
  optimistic: [] as ((store: Store, args: Record<string, unknown>) => void)[],
}));

vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const run = async (args: Record<string, unknown>) => {
      calls.list.push({ name, args });
      return null;
    };
    return Object.assign(run, {
      withOptimisticUpdate: (fn: (store: Store, args: Record<string, unknown>) => void) => {
        calls.optimistic.push(fn);
        return run;
      },
    });
  },
}));

const { BudgetPanel, BP_COST_ROWS, leftLabel } = await import("../../src/components/adversaries/builder/budget-panel");

const inst = (label: string, name: string, type: string, extra: Record<string, unknown> = {}) => ({
  _id: label,
  label,
  name,
  type,
  tier: 1,
  summoned: false,
  ...extra,
});

/** The design's encounter: Lieutenant (3), Bandit x2 (2 + 2), Sniper (2), Lackey x4 (one Minion group, 1) = 10 of 14. */
const VIEW = {
  encounter: { _id: "e1", name: "Jagged Knife ambush", status: "draft", pcs: 4, adjustments: [] },
  instances: [
    inst("Lieutenant", "Jagged Knife Lieutenant", "Leader"),
    inst("Bandit 1", "Jagged Knife Bandit", "Standard"),
    inst("Bandit 2", "Jagged Knife Bandit", "Standard"),
    inst("Sniper", "Jagged Knife Sniper", "Ranged"),
    inst("Lackey", "Jagged Knife Lackey", "Minion", { minionCount: 4 }),
  ],
} as unknown as EncounterView;

const campaignId = "c1" as never;

beforeEach(() => {
  calls.list = [];
  calls.optimistic = [];
});
afterEach(cleanup);

describe("builder variant (default)", () => {
  it("renders the builder panel: heading, party stepper, 'Spent X of Y' with the verdict", () => {
    render(<BudgetPanel campaignId={campaignId} view={VIEW} partyTier={1} />);
    expect(screen.getByRole("heading", { name: "Encounter builder" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More player characters" })).toBeTruthy();
    expect(screen.getByTestId("bp-spent").textContent).toBe("Spent 10 of 144 BP left");
    expect(screen.getByTestId("bp-panel").getAttribute("data-variant")).toBeNull();
    expect(screen.queryByRole("list", { name: "Battle Point costs" })).toBeNull();
  });

  it("sends the pcs intent from the stepper", () => {
    render(<BudgetPanel campaignId={campaignId} view={VIEW} partyTier={1} />);
    fireEvent.click(screen.getByRole("button", { name: "More player characters" }));
    expect(calls.list).toEqual([{ name: "encounters:setBudget", args: { campaignId, encounterId: "e1", change: { kind: "pcs", delta: 1 } } }]);
  });
});

describe("journal variant", () => {
  it("shows the title, 'X of Y spent', 'Z left', the party formula and the cost table; no stepper", () => {
    render(<BudgetPanel campaignId={campaignId} view={VIEW} partyTier={1} variant="journal" title="Battle points · Scene 3" />);
    const panel = screen.getByTestId("bp-panel");
    expect(panel.getAttribute("data-variant")).toBe("journal");
    expect(screen.getByRole("heading", { name: "Battle points · Scene 3" })).toBeTruthy();
    expect(screen.getByTestId("bp-spent").textContent).toBe("10of 14 spent4 left");
    expect(screen.getByRole("meter", { name: "Battle Points spent" }).getAttribute("aria-valuetext")).toBe("Spent 10 of 14");
    expect(screen.getByTestId("bp-party").textContent).toBe("Party of 4: 3 × 4 + 214");
    expect(screen.queryByRole("button", { name: "More player characters" })).toBeNull();
    const costs = within(screen.getByRole("list", { name: "Battle Point costs" })).getAllByRole("listitem");
    expect(costs.map((c) => c.textContent)).toEqual([
      "Minion group 1",
      "Social / Support 1",
      "Horde, Ranged, Skulk, Standard 2",
      "Leader 3",
      "Bruiser 4",
      "Solo 5",
    ]);
    expect(BP_COST_ROWS).toHaveLength(6);
  });

  it("lists the six adjustments with their deltas and sends the same adjustment intent", () => {
    render(<BudgetPanel campaignId={campaignId} view={VIEW} partyTier={1} variant="journal" title="Battle points · Scene 3" />);
    const group = screen.getByRole("group", { name: "Adjustments" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(6);
    const hard = within(group).getByRole("button", { name: /Harder or longer fight/ });
    expect(hard.textContent).toContain("+2");
    expect(hard.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(hard);
    expect(calls.list).toEqual([{ name: "encounters:setBudget", args: { campaignId, encounterId: "e1", change: { kind: "adjustment", adjustment: "hard", on: true } } }]);
  });

  it("applies the same optimistic update to encounters.get as the builder", () => {
    render(<BudgetPanel campaignId={campaignId} view={VIEW} partyTier={1} variant="journal" />);
    let stored: unknown = VIEW;
    const store: Store = { getQuery: () => stored, setQuery: (_ref, _args, value) => (stored = value) };
    calls.optimistic.at(-1)!(store, { campaignId, encounterId: "e1", change: { kind: "adjustment", adjustment: "easy", on: true } });
    expect((stored as EncounterView).encounter.adjustments).toEqual(["easy"]);
  });

  it("marks a pressed adjustment and reads over budget as 'N over'", () => {
    const over = { ...VIEW, encounter: { ...VIEW.encounter, adjustments: ["dmg"] }, instances: [...VIEW.instances, inst("Bear", "Bear", "Bruiser")] } as unknown as EncounterView;
    render(<BudgetPanel campaignId={campaignId} view={over} partyTier={1} variant="journal" />);
    expect(screen.getByRole("heading", { name: "Battle points" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+1d4/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("bp-spent").textContent).toBe("14of 12 spent2 over");
  });

  it("words the short verdict", () => {
    expect([leftLabel(4), leftLabel(0), leftLabel(-2)]).toEqual(["4 left", "On budget", "2 over"]);
  });
});
