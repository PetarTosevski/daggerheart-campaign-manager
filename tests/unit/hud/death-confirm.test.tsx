/**
 * HD4 (plan combat-hud, answer 15b): a player's death move waits for the GM's confirm. The sheet's death strip shows
 * the player "Waiting for the GM to confirm …" with Take it back, and the GM the confirm card (Confirm the death move /
 * Send it back); the banner and party card show "<move>: waiting for the GM". Convex is mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DeathCardBadge, DeathMoveModal } from "@/components/party/death";
import { deathResultText } from "@/components/party/death/waiting";
import type { SlotProps } from "@/components/party/slots";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const queries: Record<string, unknown> = {};
const results: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : queries[functionName(ref)]),
  useMutation: (ref: unknown) => {
    const name = functionName(ref);
    const run = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return results[name];
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  calls.length = 0;
  for (const k of Object.keys(queries)) delete queries[k];
  for (const k of Object.keys(results)) delete results[k];
});

const STATE = "deathMoves:state";
const base = { awaitingMove: false, pending: null, request: null, undoEntryId: null, lessLethal: false, awayRequested: false };
const request = { move: "riskItAll", entryId: "row-1", at: 1 };

function props(isGm: boolean, sheet: Record<string, unknown> = {}): SlotProps {
  return {
    campaignId: "camp",
    isGm,
    hopeAndFear: false,
    canEdit: true,
    character: {
      _id: "c-ash",
      status: "active",
      updatedAt: 5,
      sheet: { name: "Ash", level: 2, hp: 6, hpMax: 6, stress: 3, conditions: [], ...sheet },
    },
  } as unknown as SlotProps;
}

describe("the death strip while a player's move waits for the GM", () => {
  it("the player sees the wait and takes it back by undoing the request row; no modal, no other undo", async () => {
    queries[STATE] = { ...base, request, undoEntryId: "row-1" };
    render(<DeathMoveModal {...props(false)} />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the GM to confirm Risk It All.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo death move" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Death move to confirm" })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Take it back" })));
    expect(calls).toEqual([{ name: "deathMoves:undo", args: expect.objectContaining({ entryId: "row-1" }) }]);
  });

  it("the GM sees the confirm card; Confirm the death move confirms and shows the result", async () => {
    queries[STATE] = { ...base, request: { ...request, move: "avoidDeath" }, undoEntryId: "row-1" };
    results["deathMoves:confirm"] = { entryId: "row-2", status: "active", pending: null, hopeDie: 1, fearDie: null, scarred: true, journeyEnds: false, awaitingGm: false };
    render(<DeathMoveModal {...props(true)} />);
    const card = screen.getByRole("group", { name: "Death move to confirm" });
    expect(card).toHaveTextContent("Ash chose Avoid Death.");
    expect(screen.queryByText(/Waiting for the GM/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo death move" })).toBeNull();
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Confirm the death move" })));
    expect(calls).toEqual([{ name: "deathMoves:confirm", args: expect.objectContaining({ characterId: "c-ash" }) }]);
    expect(screen.getByRole("status")).toHaveTextContent("Hope Die 1 against level 2: a scar.");
  });

  it("the GM's card shows Blaze of Glory's last action and the less-lethal request; Send it back declines", async () => {
    queries[STATE] = { ...base, lessLethal: true, request: { ...request, move: "blazeOfGlory", action: "holds the gate", awayReason: "sentHome" } };
    results["deathMoves:decline"] = null;
    render(<DeathMoveModal {...props(true)} />);
    const card = screen.getByRole("group", { name: "Death move to confirm" });
    expect(card).toHaveTextContent("Ash chose Blaze of Glory: holds the gate.");
    expect(card).toHaveTextContent("the player asks to be sent home instead of dying");
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Send it back" })));
    expect(calls).toEqual([{ name: "deathMoves:decline", args: expect.objectContaining({ characterId: "c-ash" }) }]);
    expect(screen.getByRole("status")).toHaveTextContent("Blaze of Glory sent back: Ash chooses again.");
  });

  it("a player's choose that waits for the GM shows no result line (the wait says it)", async () => {
    queries[STATE] = { ...base, awaitingMove: true };
    results["deathMoves:choose"] = { entryId: "row-1", status: "active", pending: null, hopeDie: null, fearDie: null, scarred: false, journeyEnds: false, awaitingGm: true };
    render(<DeathMoveModal {...props(false)} />);
    const dialog = screen.getByRole("dialog", { name: "Death move" });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Risk It All" })));
    expect(calls.map((c) => c.name)).toEqual(["deathMoves:choose"]);
    expect(screen.queryByText(/Hope/, { selector: "[role=status]" })).toBeNull();
  });
});

describe("the party card badge", () => {
  it("says '<move>: waiting for the GM' at the last Hit Point while a move waits, and nothing otherwise", () => {
    queries[STATE] = { ...base, request };
    const { unmount } = render(<DeathCardBadge {...props(true)} />);
    expect(screen.getByTestId("death-request")).toHaveTextContent("Risk It All: waiting for the GM");
    unmount();
    queries[STATE] = base;
    render(<DeathCardBadge {...props(true)} />);
    expect(screen.queryByTestId("death-request")).toBeNull();
  });

  it("asks nothing below the last Hit Point", () => {
    queries[STATE] = { ...base, request };
    const { container } = render(<DeathCardBadge {...props(true, { hp: 2 })} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("deathResultText", () => {
  const r = { status: "active", pending: null, hopeDie: 7, fearDie: 3, scarred: false, journeyEnds: false };
  it("words each move's result as the sheet did", () => {
    expect(deathResultText("avoidDeath", r, 3, false)).toBe("Hope Die 7 against level 3: no scar.");
    expect(deathResultText("riskItAll", { ...r, pending: { move: "riskItAll", value: 7 } }, 3, false)).toBe("Hope 7, Fear 3: clear Hit Points and Stress.");
    expect(deathResultText("riskItAll", { ...r, status: "dead" }, 3, false)).toBe("Hope 7, Fear 3: death.");
    expect(deathResultText("riskItAll", { ...r, status: "away" }, 3, true)).toBe("Hope 7, Fear 3: away instead of dead (requested; the GM decides).");
    expect(deathResultText("blazeOfGlory", r, 3, false)).toBe("Blaze of Glory: the action critically succeeds.");
  });
});
