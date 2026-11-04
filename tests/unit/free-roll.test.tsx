// Free rolls of mixed dice and the Revealed tag (user 2026-11-04): the pool builder works by buttons alone and by a typed
// formula, the forms send the pool to rolls.freeRoll / rolls.gmRoll, and the feed tags hidden and revealed GM rolls.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import { UI_STATE_DEFAULTS } from "@/lib/config/preferences";

const calls: { name: string; args: unknown }[] = [];
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
let feedRows: unknown[] = [];
/** `uiState.get` (config U6e: the Roll dice fold is stored on the account); undefined = loading, the defaults. */
let uiState: unknown = undefined;

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => (functionName(ref) === "uiState:get" ? uiState : undefined),
  usePaginatedQuery: () => ({ results: feedRows, status: "Exhausted", loadMore: () => undefined }),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: unknown) => {
      calls.push({ name, args });
      return { entryId: "e1", roll: { kind: "free", dice: [{ sides: 6, value: 4, role: "extra" }], modifier: 0, total: 4, outcome: "none", manual: false } };
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));
vi.mock("@/components/party/dice/dice3d", () => ({ play3d: async () => false }));
vi.mock("@/components/party/dice/sound", () => ({ playRollSound: () => undefined }));

const { FreeRollForm } = await import("@/components/party/dice/free-roll");
const { RollFeedPanel } = await import("@/components/party/dice/roll-feed");

const campaignId = "k1" as Id<"campaigns">;
const preview = () => screen.getByTestId("free-roll-preview");

beforeEach(() => {
  calls.length = 0;
  feedRows = [];
  uiState = undefined;
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("the free roll form (public)", () => {
  it("builds 3d6 + 1d8 + 2 with buttons only and sends that pool", async () => {
    render(<FreeRollForm campaignId={campaignId} mode="public" />);
    expect(preview()).toHaveTextContent("pick a die");
    expect(screen.getByRole("button", { name: "Roll" })).toBeDisabled();
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Add a d6" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a d8" }));
    fireEvent.click(screen.getByRole("button", { name: "Raise the modifier" }));
    fireEvent.click(screen.getByRole("button", { name: "Raise the modifier" }));
    expect(preview()).toHaveTextContent("3d6 + 1d8 + 2");
    // The typed field follows the buttons.
    expect(screen.getByLabelText("Type a roll")).toHaveValue("3d6 + 1d8 + 2");
    const groups = screen.getByRole("list", { name: "Dice in this roll" });
    expect(within(groups).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["−3d6+", "−1d8+"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Roll" }));
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: "rolls:freeRoll",
      args: { campaignId, dice: [{ count: 3, sides: 6 }, { count: 1, sides: 8 }], modifier: 2 },
    });
    expect(calls[0]!.args).not.toHaveProperty("label");
  });

  it("a count steps down and the group leaves at zero; Clear empties the roll", () => {
    render(<FreeRollForm campaignId={campaignId} mode="public" />);
    fireEvent.click(screen.getByRole("button", { name: "Add a d4" }));
    fireEvent.click(screen.getByRole("button", { name: "One d4 more" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a d12" }));
    expect(preview()).toHaveTextContent("2d4 + 1d12");
    fireEvent.click(screen.getByRole("button", { name: "One d12 fewer" }));
    expect(preview()).toHaveTextContent("2d4");
    expect(screen.queryByRole("button", { name: "One d12 fewer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lower the modifier" }));
    expect(preview()).toHaveTextContent("2d4 - 1");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(preview()).toHaveTextContent("pick a die");
    expect(screen.getByLabelText("Type a roll")).toHaveValue("");
  });

  it("stops at 20 dice", () => {
    render(<FreeRollForm campaignId={campaignId} mode="public" />);
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Add a d6" }));
    expect(preview()).toHaveTextContent("20d6");
    for (const sides of [4, 6, 8, 10, 12, 20]) expect(screen.getByRole("button", { name: `Add a d${sides}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: "One d6 more" })).toBeDisabled();
  });

  it("reads a typed formula; an unreadable one says why and keeps the last good roll", async () => {
    render(<FreeRollForm campaignId={campaignId} mode="public" />);
    const field = screen.getByLabelText("Type a roll");
    fireEvent.change(field, { target: { value: "2d10+1d4-1" } });
    expect(preview()).toHaveTextContent("2d10 + 1d4 - 1");
    expect(field).toHaveAttribute("aria-invalid", "false");
    fireEvent.change(field, { target: { value: "2d10+1d7" } });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/isn't a die the app rolls/)).toBeInTheDocument();
    expect(preview()).toHaveTextContent("2d10 + 1d4 - 1");
    fireEvent.change(field, { target: { value: "3d6+1d8+2" } });
    fireEvent.change(screen.getByLabelText("For"), { target: { value: "Trap" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Roll" }));
    });
    expect(calls[0]).toMatchObject({ name: "rolls:freeRoll", args: { dice: [{ count: 3, sides: 6 }, { count: 1, sides: 8 }], modifier: 2, label: "Trap" } });
  });

  it("every button is a 44 px touch target", () => {
    render(<FreeRollForm campaignId={campaignId} mode="public" />);
    fireEvent.click(screen.getByRole("button", { name: "Add a d6" }));
    for (const button of screen.getAllByRole("button")) expect(button.className).toMatch(/min-h-11|size-11/);
  });
});

describe("the GM's secret roll", () => {
  it("starts at 1d20 and sends mixed dice to rolls.gmRoll, showing the result when asked", async () => {
    render(<FreeRollForm campaignId={campaignId} mode="gm" showResult />);
    expect(screen.getByRole("form", { name: "GM roll" })).toHaveAttribute("id", "gm-roll-form");
    expect(preview()).toHaveTextContent("1d20");
    fireEvent.click(screen.getByRole("button", { name: "Add a d8" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Roll in secret" }));
    });
    expect(calls[0]).toMatchObject({ name: "rolls:gmRoll", args: { dice: [{ count: 1, sides: 20 }, { count: 1, sides: 8 }], modifier: 0 } });
    expect(screen.getByTestId("gm-roll-result")).toHaveTextContent("1d20 + 1d8 = 4");
  });
});

const baseRow = { kind: "gmRoll", at: 0, actorId: "u1", undone: false, canUndo: true, roll: { kind: "free", dice: [{ sides: 12, value: 10, role: "extra" }], modifier: 0, total: 10, outcome: "none", manual: false } };

describe("the roll feed's Hidden and Revealed tags", () => {
  it("hidden in the Fear colours, revealed in the Hope colours, nothing on a roll never hidden", () => {
    feedRows = [
      { ...baseRow, _id: "r1", summary: "GM: 1d12 = 10", visibility: "gm", revealable: true },
      { ...baseRow, _id: "r2", summary: "GM: 1d12 = 7", visibility: "public", revealable: false, revealed: true },
      { ...baseRow, _id: "r3", summary: "GM: 1d12 = 3", visibility: "public", revealable: false },
      { ...baseRow, _id: "r4", kind: "roll", summary: "Pell: 3d6 + 1d8 + 2 = 21", visibility: "public", revealable: false, canUndo: false },
    ];
    render(<RollFeedPanel campaignId={campaignId} isGm />);
    const row = (name: string) => screen.getByRole("listitem", { name });
    const hidden = within(row("GM: 1d12 = 10")).getByText("hidden");
    expect(hidden.className).toMatch(/text-fear/);
    expect(within(row("GM: 1d12 = 10")).getByRole("button", { name: "Reveal" })).toBeInTheDocument();
    expect(within(row("GM: 1d12 = 10")).queryByText("revealed")).toBeNull();
    const revealed = within(row("GM: 1d12 = 7")).getByText("revealed");
    expect(revealed.className).toMatch(/text-hope/);
    expect(revealed.className).toMatch(/bg-hope-bg/);
    expect(within(row("GM: 1d12 = 7")).queryByText("hidden")).toBeNull();
    // An old reveal (no stamp) and a roll that was never hidden: no tag.
    for (const name of ["GM: 1d12 = 3", "Pell: 3d6 + 1d8 + 2 = 21"]) {
      expect(within(row(name)).queryByText("revealed")).toBeNull();
      expect(within(row(name)).queryByText("hidden")).toBeNull();
    }
  });

  it("a player sees the Revealed tag too, and opens Roll dice for a public free roll", () => {
    feedRows = [{ ...baseRow, _id: "r2", summary: "GM: 1d12 = 7", visibility: "public", canUndo: false, revealed: true }];
    const view = render(<RollFeedPanel campaignId={campaignId} isGm={false} />);
    expect(within(screen.getByRole("listitem", { name: "GM: 1d12 = 7" })).getByText("revealed")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Roll dice" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("form", { name: "Free roll" })).toBeNull();
    fireEvent.click(toggle);
    expect(calls).toContainEqual({ name: "uiState:set", args: { change: { key: "freeRollFormOpen", value: true } } });
    // The account now says open.
    uiState = { ...UI_STATE_DEFAULTS, freeRollFormOpen: true };
    view.rerender(<RollFeedPanel campaignId={campaignId} isGm={false} />);
    expect(screen.getByRole("form", { name: "Free roll" })).toHaveAttribute("id", "free-roll-form");
    expect(screen.queryByRole("form", { name: "GM roll" })).toBeNull();
  });
});
