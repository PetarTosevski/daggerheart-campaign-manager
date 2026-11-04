// Plan combat-hud H9.0 (docs/tasks/TASK-HUD-H9.0.md): the GM's bottom dock (GMDesktop `.dock`): Map tools (Q4a) |
// Select, Measure, Areas, Fog, Names | zoom − % + | Dice, Player view, Log | End scene; real buttons with
// aria-pressed / aria-expanded; the zoom and Names drive the published board; Dice and Fog open pop-overs from one
// panel store; a player's map controls (Q9b); and the Measure layer's text (the app's range model). convex/react is
// replaced by the results held here; the reused heavy parts (dice box, vision card, player-view menu) are stubs.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import { UI_STATE_DEFAULTS } from "../../../src/lib/config/preferences";
import type { CombatPageState } from "../../../src/components/combat-map/slots";

let results: Record<string, unknown> = {};
const sent: { name: string; args: unknown }[] = [];

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[getFunctionName(ref as never)]),
  useMutation: (ref: unknown) => {
    const run = async (args: unknown) => {
      sent.push({ name: getFunctionName(ref as never), args });
      return null;
    };
    return Object.assign(run, { withOptimisticUpdate: () => run });
  },
}));
vi.mock("@/lib/use-intent", () => ({ useIntent: () => ({ fire: async () => null, pending: false, error: null }) }));
vi.mock("@/app/(gm)/campaigns/[campaignId]/campaign-shell", () => ({ useCampaign: () => ({ options: { hopeAndFear: true } }) }));
vi.mock("@/components/combat-map/vision", () => ({
  PreviewPicker: () => createElement("button", { type: "button" }, "👁 Player view ▾"),
  VisionPanel: () => createElement("p", { "data-testid": "vision-stub" }, "fog brush"),
}));
vi.mock("next/dynamic", () => ({ default: () => () => createElement("p", { "data-testid": "dice-box-stub" }, "dice box") }));

const { HudDock, PlayerMapControls } = await import("../../../src/components/combat-map/hud/dock");
const { HudProvider, useHud } = await import("../../../src/components/combat-map/hud/state");
const { resetPanels } = await import("../../../src/components/combat-map/hud/panels");
const { useAreasOpen } = await import("../../../src/components/combat-map/hud/areas/open");
const { publishBoard, releaseBoard, mapControlsSnapshot } = await import("../../../src/components/combat-map/map-view/controls");
const { measureText, squareAt } = await import("../../../src/components/combat-map/map-view/measure");

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = { _id: "m1" as Id<"combatMaps">, name: "Forest Camp", live: true, source: "generated", w: 30, h: 20 } as CombatPageState["map"];

function state(over: Partial<CombatPageState> = {}): CombatPageState {
  return {
    campaignId: CAMPAIGN,
    role: "gm",
    mode: "play",
    map: MAP,
    selectedTokenId: null,
    onSelectToken: () => {},
    previewCharacterId: null,
    onPreview: () => {},
    ...over,
  };
}

/** Shows the drawer flag beside the dock (the Map tools button toggles it). */
function Drawer() {
  const { toolsOpen } = useHud();
  return createElement("output", { "data-testid": "drawer" }, toolsOpen ? "open" : "closed");
}
function AreasFlag() {
  return createElement("output", { "data-testid": "areas-flag" }, useAreasOpen() ? "open" : "closed");
}

function wrap(children: ReactNode) {
  return render(createElement(HudProvider, null, children, createElement(Drawer), createElement(AreasFlag)));
}

const board = {};
let calls: string[] = [];

beforeEach(() => {
  results = { "combatHud:party": [] };
  calls = [];
  sent.length = 0;
  publishBoard(board, { zoom: 0.91, zoomIn: () => calls.push("in"), zoomOut: () => calls.push("out"), fit: () => calls.push("fit") });
});
afterEach(() => {
  act(() => {
    releaseBoard(board);
    resetPanels();
  });
});

describe("HudDock (GM)", () => {
  it("draws the board's groups in order, as real buttons, named 'Map controls'", () => {
    wrap(createElement(HudDock, { state: state() }));
    const dock = screen.getByRole("toolbar", { name: "Map controls" });
    const names = within(dock)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
    expect(names).toEqual(["Map tools", "Select", "Measure", "Areas", "Fog", "Names", "Zoom out", "Fit the map to the screen", "Zoom in", "Dice", "👁 Player view ▾", "Log", "End scene"]);
    // Select is pressed by default; the % shows the board's zoom.
    expect(within(dock).getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dock).getByRole("button", { name: "Measure" })).toHaveAttribute("aria-pressed", "false");
    expect(within(dock).getByTestId("combat-zoom")).toHaveTextContent("91%");
  });

  it("Map tools opens the drawer (Q4a)", () => {
    wrap(createElement(HudDock, { state: state() }));
    const button = screen.getByRole("button", { name: "Map tools" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(screen.getByTestId("drawer")).toHaveTextContent("open");
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("zoom − / % / + drive the published board; Names toggles the viewer's account flag (config U6e)", () => {
    const view = wrap(createElement(HudDock, { state: state() }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Fit the map to the screen" }));
    expect(calls).toEqual(["in", "out", "fit"]);
    const names = screen.getByRole("button", { name: "Names" });
    expect(names).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(names);
    expect(sent).toContainEqual({ name: "uiState:set", args: { change: { key: "tokenNames", value: true } } });
    results = { ...results, "uiState:get": { ...UI_STATE_DEFAULTS, tokenNames: true } };
    view.rerender(createElement(HudProvider, null, createElement(HudDock, { state: state() }), createElement(Drawer), createElement(AreasFlag)));
    expect(screen.getByRole("button", { name: "Names" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Select and Measure switch the pointer tool", () => {
    wrap(createElement(HudDock, { state: state() }));
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(mapControlsSnapshot().tool).toBe("measure");
    expect(screen.getByRole("button", { name: "Measure" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(mapControlsSnapshot().tool).toBe("select");
  });

  it("opens one panel at a time: Dice, Fog, Areas, Log", () => {
    wrap(createElement(HudDock, { state: state() }));
    const dice = screen.getByRole("button", { name: "Dice" });
    fireEvent.click(dice);
    expect(dice).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Dice" })).toBeInTheDocument();
    expect(screen.getByTestId("dice-box-stub")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fog" }));
    expect(screen.queryByRole("dialog", { name: "Dice" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Vision and fog" })).toBeInTheDocument();
    expect(dice).toHaveAttribute("aria-expanded", "false");

    const areas = screen.getByRole("button", { name: "Areas" });
    fireEvent.click(areas);
    expect(areas).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("areas-flag")).toHaveTextContent("open");
    expect(screen.queryByRole("dialog", { name: "Vision and fog" })).not.toBeInTheDocument();

    const log = screen.getByRole("button", { name: "Log" });
    fireEvent.click(log);
    expect(log).toHaveAttribute("aria-pressed", "true");
    expect(areas).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("areas-flag")).toHaveTextContent("closed");
    fireEvent.click(log);
    expect(log).toHaveAttribute("aria-pressed", "false");
  });

  it("Escape in a pop-over closes it and the focus goes back to its dock button", () => {
    wrap(createElement(HudDock, { state: state() }));
    const dice = screen.getByRole("button", { name: "Dice" });
    dice.focus();
    fireEvent.click(dice);
    const pop = screen.getByRole("dialog", { name: "Dice" });
    expect(pop).toHaveFocus();
    fireEvent.keyDown(pop, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Dice" })).not.toBeInTheDocument();
    expect(dice).toHaveFocus();
  });

  it("without a map: no Areas, Fog or Player view", () => {
    wrap(createElement(HudDock, { state: state({ map: null }) }));
    const dock = screen.getByRole("toolbar", { name: "Map controls" });
    expect(within(dock).queryByRole("button", { name: "Areas" })).not.toBeInTheDocument();
    expect(within(dock).queryByRole("button", { name: "Fog" })).not.toBeInTheDocument();
    expect(within(dock).queryByRole("button", { name: /Player view/ })).not.toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: "End scene" })).toBeInTheDocument();
  });
});

describe("PlayerMapControls (Q9b)", () => {
  it("gives a player Measure, Names and the zoom", () => {
    wrap(createElement(PlayerMapControls));
    const bar = screen.getByRole("toolbar", { name: "Map controls" });
    const names = within(bar)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
    expect(names).toEqual(["Measure", "Names", "Zoom out", "Fit the map to the screen", "Zoom in"]);
    fireEvent.click(within(bar).getByRole("button", { name: "Measure" }));
    expect(mapControlsSnapshot().tool).toBe("measure");
    fireEvent.click(within(bar).getByRole("button", { name: "Measure" }));
    expect(mapControlsSnapshot().tool).toBe("select");
  });
});

describe("Measure", () => {
  it("names the distance and band with the app's range model (CB p.103)", () => {
    expect(measureText({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe("0 squares · Melee");
    expect(measureText({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe("1 square · Melee");
    expect(measureText({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe("3 squares · Very Close");
    expect(measureText({ x: 2, y: 2 }, { x: 8, y: 5 })).toBe("6 squares · Close");
    expect(measureText({ x: 0, y: 0 }, { x: 7, y: 0 })).toBe("7 squares · Far");
    expect(measureText({ x: 0, y: 0 }, { x: 13, y: 4 })).toBe("13 squares · Very Far");
  });

  it("keeps the measured square on the map", () => {
    expect(squareAt({ x: 3.7, y: 4.2 }, 30, 20)).toEqual({ x: 3, y: 4 });
    expect(squareAt({ x: -2.5, y: 25 }, 30, 20)).toEqual({ x: 0, y: 19 });
  });
});
