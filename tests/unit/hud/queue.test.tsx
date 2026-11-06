/**
 * Plan combat-hud H9.2 (GMDesktop / GMTablet `.wchip`, user answer Q10a): the GM's queue is closed behind the bottom-left
 * "Waiting on you" button with its count; the button opens it (hud/panels.ts "queue"); a request that arrives later
 * toasts "<who>: <what>" · "Waiting on you" while the queue is closed; Resolutions are not in the queue (the dock's Log
 * is their home) except in the GM's phone queue sheet; the Areas panel's ✕ gives the focus back to its opener.
 * Convex is mocked.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HudAreas } from "@/components/combat-map/hud/areas";
import { openPanel, openPanelNow, resetPanels } from "@/components/combat-map/hud/panels";
import { HudQueue, QueueInSheet } from "@/components/combat-map/hud/queue";
import { arrivalTitle, deathArrival, newArrivals, queueItems } from "@/components/combat-map/hud/queue/model";
import { hudToasts } from "@/components/combat-map/hud/toasts/store";
import type { CombatPageState } from "@/components/combat-map/slots";

const queries: Record<string, unknown> = {};
const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = functionName(ref);
    const value = queries[name];
    return name === "deathMoves:state" ? (value as Record<string, unknown> | undefined)?.[(args as { characterId: string }).characterId] : value;
  },
  useQueries: (request: Record<string, { query: unknown; args: { characterId: string } }>) =>
    Object.fromEntries(Object.entries(request).map(([k, q]) => [k, (queries[functionName(q.query)] as Record<string, unknown> | undefined)?.[q.args.characterId]])),
  useMutation: () => Object.assign(async () => null, { withOptimisticUpdate: () => async () => null }),
}));

afterEach(() => {
  for (const k of Object.keys(queries)) delete queries[k];
  resetPanels();
  hudToasts.reset();
});

function page(over: Partial<CombatPageState> = {}): CombatPageState {
  return { campaignId: "camp", role: "gm", mode: "play", map: null, selectedTokenId: null, onSelectToken: () => {}, previewCharacterId: null, onPreview: () => {}, ...over } as unknown as CombatPageState;
}

const deathBase = { awaitingMove: false, pending: null, request: null, undoEntryId: null, lessLethal: false, awayRequested: false };
const moss = { _id: "c-moss", mine: false, canEdit: true, corrupt: false, status: "active", updatedAt: 5, sheet: { name: "Moss", level: 1, hp: 6, hpMax: 6, stress: 0, conditions: [] } };
const sniper = { tokenId: "t-sniper", name: "Sniper" };
const attack = (id: string, name: string, at: number) => ({ kind: "sanction", requestId: id, characterId: "c-moss", characterName: name, createdAt: at, slot: "primary", targets: [sniper], outOfRange: [{ tokenId: "t-sniper", band: "veryFar" }] });

function empty() {
  queries["combatRequestsReads:mine"] = [];
  queries["combatCardsReads:pending"] = [];
  queries["combatFeaturesReads:pending"] = [];
  queries["combatRequestsReads:difficulties"] = [];
  queries["adversaryActionsReads:windows"] = [];
  queries["cloakPromptsReads:pending"] = [];
  queries["hitKeywordsReads:asks"] = [];
  queries["adversaryPromptsReads:pending"] = [];
  queries["allyPicksReads:open"] = [];
  queries["charactersReads:listByCampaign"] = [moss];
  queries["featurePromptsReads:allyRolls"] = { asks: [], waiting: [], allies: [], pending: [] };
  queries["deathMoves:state"] = { "c-moss": deathBase };
  queries["feed:list"] = { page: [], isDone: true, continueCursor: "" };
}

const button = () => screen.getByRole("button", { name: /^Waiting on you/ });

describe("Waiting on you (closed by default)", () => {
  it("shows the button with a grey 0 and keeps the queue closed; no Resolutions in it", () => {
    empty();
    render(<HudQueue state={page()} />);
    expect(button()).toHaveAttribute("aria-expanded", "false");
    expect(button()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("hud-wait-count")).toHaveTextContent("0");
    expect(screen.getByTestId("hud-wait-count")).toHaveClass("hud-wn0");
    expect(screen.getByTestId("hud-waiting")).toHaveAttribute("data-open", "false");
    expect(screen.queryByTestId("hud-resolutions")).toBeNull();
  });

  it("the count is purple with requests; the button opens the queue above it and closes it again", () => {
    empty();
    queries["combatRequestsReads:mine"] = [attack("r-1", "Vex", 1)];
    render(<HudQueue state={page()} />);
    expect(screen.getByTestId("hud-wait-count")).toHaveTextContent("1");
    expect(screen.getByTestId("hud-wait-count")).not.toHaveClass("hud-wn0");
    fireEvent.click(button());
    expect(openPanelNow()).toBe("queue");
    expect(button()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("hud-waiting")).toHaveAttribute("data-open", "true");
    expect(document.getElementById(button().getAttribute("aria-controls")!)).toBe(screen.getByTestId("hud-queue-column"));
    expect(within(screen.getByTestId("hud-queue-column")).getByTestId("hud-queue-range")).toBeInTheDocument();
    fireEvent.click(button());
    expect(openPanelNow()).toBeNull();
    expect(button()).toHaveAttribute("aria-expanded", "false");
  });

  it("Allow is Hope gold (allow) on the right, Decline Fear purple (deny) on the left", () => {
    empty();
    queries["combatRequestsReads:mine"] = [attack("r-1", "Vex", 1)];
    render(<HudQueue state={page()} />);
    const card = screen.getByTestId("hud-queue-range");
    const buttons = within(card).getAllByRole("button");
    const decline = within(card).getByRole("button", { name: /^Decline:/ });
    const allow = within(card).getByRole("button", { name: /^Allow:/ });
    expect(allow).toHaveClass("gb-allow");
    expect(decline).toHaveClass("gb-deny");
    expect(buttons.indexOf(decline)).toBeLessThan(buttons.indexOf(allow));
  });

  it("opening another GM panel closes the queue (one at a time)", () => {
    empty();
    render(<HudQueue state={page()} />);
    fireEvent.click(button());
    act(() => openPanel("log", null));
    expect(button()).toHaveAttribute("aria-expanded", "false");
  });

  it("a request that arrives later toasts '<who>: out of range · Waiting on you'; the ones open at load don't", () => {
    empty();
    queries["combatRequestsReads:mine"] = [attack("r-1", "Moss", 1)];
    const view = render(<HudQueue state={page()} />);
    expect(hudToasts.get()).toEqual([]);
    queries["combatRequestsReads:mine"] = [attack("r-1", "Moss", 1), attack("r-2", "Vex", 2)];
    view.rerender(<HudQueue state={page()} />);
    expect(hudToasts.get()).toEqual([expect.objectContaining({ title: "Vex: out of range", message: "Waiting on you", tone: "neutral" })]);
    expect(screen.getByTestId("hud-wait-count")).toHaveTextContent("2");
  });

  it("no toast while the queue is open (the GM sees the card)", () => {
    empty();
    const view = render(<HudQueue state={page()} />);
    fireEvent.click(button());
    queries["combatRequestsReads:mine"] = [attack("r-2", "Vex", 2)];
    view.rerender(<HudQueue state={page()} />);
    expect(hudToasts.get()).toEqual([]);
  });

  it("a death move to confirm counts and toasts", () => {
    empty();
    const view = render(<HudQueue state={page()} />);
    queries["deathMoves:state"] = { "c-moss": { ...deathBase, request: { move: "avoidDeath", entryId: "e", at: 8 } } };
    view.rerender(<HudQueue state={page()} />);
    expect(screen.getByTestId("hud-wait-count")).toHaveTextContent("1");
    expect(hudToasts.get()).toEqual([expect.objectContaining({ title: "Moss: death move" })]);
  });

  it("inside the GM's phone queue sheet: the queue inline with Resolutions, no button", () => {
    empty();
    render(
      <QueueInSheet.Provider value={true}>
        <HudQueue state={page()} />
      </QueueInSheet.Provider>,
    );
    expect(screen.queryByRole("button", { name: /^Waiting on you/ })).toBeNull();
    expect(screen.getByRole("region", { name: /Waiting on you/ })).toBeInTheDocument();
    expect(screen.getByTestId("hud-resolutions")).toBeInTheDocument();
  });
});

describe("arrivals (model)", () => {
  it("titles", () => {
    const items = queueItems({
      attacks: [{ requestId: "a", characterName: "Vex", createdAt: 1, targets: [], outOfRange: [] }],
      difficulties: [{ requestId: "d", characterName: "Brannoc", createdAt: 2, ask: "charge", target: null, seers: [] }],
      allyRolls: [{ requestId: "y", characterName: "Moss", rollerName: "Brannoc", featureName: "Cannonball", createdAt: 3 }],
    });
    expect(items.map(arrivalTitle)).toEqual(["Vex: out of range", "Brannoc: set the Difficulty", "Brannoc: ally roll"]);
    expect(deathArrival("c", "Moss", "8")).toEqual({ key: "death:c:8", title: "Moss: death move" });
  });

  it("nothing is new on the first load; then only the unseen keys", () => {
    const now = [
      { key: "a", title: "A" },
      { key: "b", title: "B" },
    ];
    expect(newArrivals(null, now)).toEqual([]);
    expect(newArrivals(new Set(["a"]), now)).toEqual([{ key: "b", title: "B" }]);
  });
});

describe("Areas (bottom right)", () => {
  it("its ✕ closes it through the panels store and the focus goes back to the dock's Areas button", () => {
    const opener = document.createElement("button");
    opener.textContent = "Areas";
    document.body.appendChild(opener);
    act(() => openPanel("areas", opener));
    render(<HudAreas state={page({ map: { _id: "m" } as CombatPageState["map"] })} />);
    expect(screen.getByRole("dialog", { name: "Areas" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Areas" }));
    expect(openPanelNow()).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Areas" })).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
