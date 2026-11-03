// Plan combat-hud H5.3 (docs/tasks/TASK-HUD-H5.3.md): "Spend n Fear?" (FearConfirm), the HUD's End scene confirm naming
// what ends (combatHud.sceneEndPreview) and the GM's "Areas on the map" panel. convex/react is replaced by the query
// results held here; mutations are recorded and their optimistic updates captured.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { CombatPageState } from "../../../src/components/combat-map/slots";

let results: Record<string, unknown> = {};
let calls: { name: string; args: Record<string, unknown> }[] = [];
let optimistic: Record<string, (store: FakeStore, args: Record<string, unknown>) => void> = {};
let mutationResult: unknown = null;

type FakeStore = { getQuery: (ref: unknown, args: unknown) => unknown; setQuery: (ref: unknown, args: unknown, value: unknown) => void };

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : results[getFunctionName(ref as never)]),
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    const fn = async (args: Record<string, unknown>) => {
      calls.push({ name, args });
      return mutationResult;
    };
    return Object.assign(fn, {
      withOptimisticUpdate: (update: (store: FakeStore, args: Record<string, unknown>) => void) => {
        optimistic[name] = update;
        return fn;
      },
    });
  },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ campaignId: "c1" }) }));

const { FearConfirm, fearAfterSpend, fearReasonsText } = await import("../../../src/components/combat-map/hud/fear");
const { HudEndScene, sceneEndText } = await import("../../../src/components/combat-map/hud/scene/end");
const { HudAreas, areaLine, setAreasOpen } = await import("../../../src/components/combat-map/hud/areas");

const CAMPAIGN = "c1" as Id<"campaigns">;
const MAP = { _id: "m1" as Id<"combatMaps">, name: "Forest Camp", live: true, source: "generated", w: 30, h: 20 } as CombatPageState["map"];

function state(role: "gm" | "player"): CombatPageState {
  return {
    campaignId: CAMPAIGN,
    role,
    mode: "play",
    map: MAP,
    selectedTokenId: null,
    onSelectToken: () => {},
    previewCharacterId: null,
    onPreview: () => {},
  };
}

beforeAll(() => {
  // jsdom has no showModal/close; model the browser: close() drops `open` and fires the dialog's close event.
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
  calls = [];
  optimistic = {};
  mutationResult = null;
  results = { "combatHud:scene": { fear: 5, light: "day", phase: null, day: { week: 1, day: 1, cycle: "DAY" }, canSetLight: true, canOpenTimeArc: false, canEndDay: true } };
});

afterEach(() => {
  act(() => setAreasOpen(false));
});

const REASONS = ["1 to spotlight the Lieutenant", "1 for Coup de Grace on Moss (Vulnerable)"];

describe("FearConfirm (Spend n Fear?)", () => {
  it("writes the reasons as one sentence and Fear after the spend", () => {
    expect(fearReasonsText(REASONS)).toBe("1 to spotlight the Lieutenant, 1 for Coup de Grace on Moss (Vulnerable).");
    expect(fearReasonsText(["1 for the spotlight."])).toBe("1 for the spotlight.");
    expect(fearReasonsText([])).toBe("");
    expect(fearAfterSpend(5, 2)).toBe(3);
    expect(fearAfterSpend(1, 2)).toBe(0);
  });

  it("asks 'Spend 2 Fear?' with the reasons and '5 → 3' from the campaign's Fear (the route's campaign)", () => {
    render(createElement(FearConfirm, { amount: 2, reasons: REASONS, onConfirm: () => {}, onCancel: () => {} }));
    const card = screen.getByRole("dialog", { name: "Spend 2 Fear?" });
    expect(card).toHaveTextContent("1 to spotlight the Lieutenant, 1 for Coup de Grace on Moss (Vulnerable).");
    expect(within(card).getByTestId("hud-fear-confirm-change")).toHaveTextContent("5 → 3");
    expect(within(card).getByText("Fear 5 to 3")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Spend 2 Fear" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(card).toHaveFocus();
  });

  it("uses the caller's Fear when given, and says when it is loading", () => {
    const { unmount } = render(createElement(FearConfirm, { amount: 1, reasons: [], onConfirm: () => {}, fear: 9 }));
    expect(screen.getByTestId("hud-fear-confirm-change")).toHaveTextContent("9 → 8");
    // No onCancel: no Cancel button.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    unmount();
    results = {};
    render(createElement(FearConfirm, { amount: 1, reasons: [], onConfirm: () => {} }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading Fear…");
  });

  it("Spend runs onConfirm and waits for it; Cancel and Escape cancel", async () => {
    let resolve: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const onCancel = vi.fn();
    render(createElement(FearConfirm, { amount: 2, reasons: REASONS, onConfirm, onCancel }));
    const spend = screen.getByRole("button", { name: "Spend 2 Fear" });
    fireEvent.click(spend);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(spend).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => resolve());
    expect(spend).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("shows a refusal from onConfirm and lets the GM try again", async () => {
    const onConfirm = vi.fn(async () => {
      throw new ConvexError({ code: "NOT_ENOUGH_FEAR" });
    });
    render(createElement(FearConfirm, { amount: 2, reasons: REASONS, onConfirm, onCancel: () => {} }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Spend 2 Fear" })));
    expect(screen.getByRole("alert")).not.toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Spend 2 Fear" })).toBeEnabled();
  });

  it("with less Fear than it costs, Spend is disabled and the card says so", () => {
    render(createElement(FearConfirm, { amount: 3, reasons: [], onConfirm: () => {}, onCancel: () => {}, fear: 1 }));
    expect(screen.getByRole("button", { name: "Spend 3 Fear" })).toBeDisabled();
    // H6.3: the refusal table's NOT_ENOUGH_FEAR sentence, the same words as every GM Fear control.
    expect(screen.getByText("This needs 3 Fear. You have 1.")).toBeInTheDocument();
  });

  it("hangs in the HUD's fear region when there is one", () => {
    const region = document.createElement("div");
    region.setAttribute("data-hud-region", "fear");
    document.body.appendChild(region);
    try {
      render(createElement(FearConfirm, { amount: 1, reasons: [], onConfirm: () => {}, fear: 4 }));
      expect(region).toContainElement(screen.getByRole("dialog", { name: "Spend 1 Fear?" }));
    } finally {
      region.remove();
    }
  });
});

describe("End scene (End the scene?)", () => {
  it("names what ends, the limits that refresh and what stays", () => {
    expect(sceneEndText({ effects: ["Wall Walk"], limits: 2, areas: ["Dark Cloud"] })).toBe(
      "Effects that last “until the end of the scene” end: Wall Walk, Dark Cloud. 2 feature limits refresh. Fear, Hope, HP and Stress stay as they are. The players see a short summary.",
    );
    expect(sceneEndText({ effects: [], limits: 1, areas: [] })).toBe(
      "Nothing lasts “until the end of the scene” right now. 1 feature limit refreshes. Fear, Hope, HP and Stress stay as they are. The players see a short summary.",
    );
  });

  it("End scene asks first, with the scene's name and the preview; Keep playing ends nothing", () => {
    results["combatHud:sceneEndPreview"] = { effects: ["Wall Walk"], limits: 0, areas: ["Dark Cloud"] };
    render(createElement(HudEndScene, { campaignId: CAMPAIGN, sceneName: "Forest Camp" }));
    fireEvent.click(screen.getByRole("button", { name: "End scene" }));
    const dialog = screen.getByRole("dialog", { name: "End the scene?" });
    expect(dialog).toHaveTextContent("Forest Camp");
    expect(within(dialog).getByTestId("hud-end-scene-text")).toHaveTextContent("end: Wall Walk, Dark Cloud.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep playing" }));
    expect(calls).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("End the scene runs combatScenes.end once and reports what ended", async () => {
    results["combatHud:sceneEndPreview"] = { effects: [], limits: 0, areas: ["Dark Cloud"] };
    mutationResult = { ended: 1, areas: 1, entryId: null };
    render(createElement(HudEndScene, { campaignId: CAMPAIGN, sceneName: "Forest Camp" }));
    fireEvent.click(screen.getByRole("button", { name: "End scene" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "End the scene" })));
    expect(calls.map((c) => c.name)).toEqual(["combatScenes:end"]);
    expect(calls[0]?.args).toMatchObject({ campaignId: CAMPAIGN });
    expect(screen.getByTestId("end-scene-status")).toHaveTextContent("Scene ended: 1 scene effect and limit ended, 1 map area closed.");
  });

  it("says it is checking while the preview loads", () => {
    render(createElement(HudEndScene, { campaignId: CAMPAIGN, sceneName: "Forest Camp" }));
    fireEvent.click(screen.getByRole("button", { name: "End scene" }));
    expect(within(screen.getByRole("dialog", { name: "End the scene?" })).getByRole("status")).toHaveTextContent("Checking what ends…");
  });
});

describe("Areas on the map", () => {
  const DARK = {
    _id: "a1",
    label: "Dark Cloud",
    shape: "circle",
    centre: { kind: "square", x: 3, y: 4 },
    radius: "close",
    blocksSight: true,
    characterId: "ch-vex",
  };
  const WALL = { _id: "a2", label: "Wall of Thorns", shape: "wall", centre: { kind: "square", x: 1, y: 1 }, radius: "close", wall: { a: [1, 1], b: [3, 1] }, blocksSight: false, characterId: "ch-vex" };

  beforeEach(() => {
    results["combatAreas:list"] = [DARK, WALL];
    results["combatTokens:list"] = [{ _id: "t-vex", kind: "pc", characterId: "ch-vex", name: "Vex" }];
  });

  it("writes an area's line", () => {
    expect(areaLine(DARK as never, "Vex")).toBe("Circle · radius Close · blocks sight · Vex");
    expect(areaLine(WALL as never, null)).toBe("Wall");
  });

  it("shows nothing until the Areas button opens it, and only for the GM", () => {
    const { rerender } = render(createElement(HudAreas, { state: state("gm") }));
    expect(screen.queryByRole("dialog", { name: "Areas" })).toBeNull();
    act(() => setAreasOpen(true));
    expect(screen.getByRole("dialog", { name: "Areas" })).toBeInTheDocument();
    rerender(createElement(HudAreas, { state: state("player") }));
    expect(screen.queryByRole("dialog", { name: "Areas" })).toBeNull();
  });

  it("folds to its header bar once focus leaves it; the header unfolds it (user answer 2026-11-02)", () => {
    act(() => setAreasOpen(true));
    render(createElement(HudAreas, { state: state("gm") }));
    const panel = screen.getByRole("dialog", { name: "Areas" });
    const fold = within(panel).getByRole("button", { name: "Areas on the map" });
    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(within(panel).getByTestId("area-tools")).toBeVisible();
    // Focus moves inside: still unfolded.
    fireEvent.focusOut(panel, { relatedTarget: fold });
    expect(fold).toHaveAttribute("aria-expanded", "true");
    // Focus leaves for the map: folded; the body stays mounted but hidden.
    fireEvent.focusOut(panel, { relatedTarget: null });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveAttribute("data-folded", "true");
    expect(within(panel).getByTestId("area-tools")).not.toBeVisible();
    expect(within(panel).getByRole("button", { name: "Close Areas" })).toBeVisible();
    fireEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(within(panel).getByTestId("area-tools")).toBeVisible();
    // A press inside keeps it; a press on the map (outside) folds it, even when focus stays where it was.
    fireEvent.pointerDown(within(panel).getByRole("button", { name: "Pick on the map" }));
    expect(fold).toHaveAttribute("aria-expanded", "true");
    fireEvent.pointerDown(document.body);
    expect(fold).toHaveAttribute("aria-expanded", "false");
  });

  it("lists the map's live areas with Move / Remove and the draw form", async () => {
    act(() => setAreasOpen(true));
    render(createElement(HudAreas, { state: state("gm") }));
    const panel = screen.getByRole("dialog", { name: "Areas" });
    expect(within(panel).getByRole("heading", { name: "Areas on the map" })).toBeInTheDocument();
    const rows = within(panel).getAllByTestId("area-row");
    expect(rows.map((r) => r.getAttribute("data-label"))).toEqual(["Dark Cloud", "Wall of Thorns"]);
    expect(rows[0]).toHaveTextContent("Circle · radius Close · blocks sight · Vex");
    expect(within(panel).getByRole("combobox", { name: "Radius of Dark Cloud" })).toHaveValue("close");
    expect(within(panel).queryByRole("combobox", { name: "Radius of Wall of Thorns" })).toBeNull();
    expect(within(panel).getByRole("group", { name: "Shape" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Pick on the map" })).toBeEnabled();

    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Remove Dark Cloud" })));
    expect(calls).toEqual([{ name: "combatAreas:remove", args: { campaignId: CAMPAIGN, areaId: "a1" } }]);
    const store = new Map<string, unknown>([["combatAreas:list", [DARK, WALL]]]);
    optimistic["combatAreas:remove"](
      { getQuery: (ref) => store.get(getFunctionName(ref as never)), setQuery: (ref, _a, value) => store.set(getFunctionName(ref as never), value) },
      { campaignId: CAMPAIGN, areaId: "a1" },
    );
    expect((store.get("combatAreas:list") as { _id: string }[]).map((a) => a._id)).toEqual(["a2"]);
  });

  it("Circle / Wall switch the shape (a wall has no radius); ✕ and Escape close it", () => {
    act(() => setAreasOpen(true));
    render(createElement(HudAreas, { state: state("gm") }));
    const shape = screen.getByRole("group", { name: "Shape" });
    expect(screen.getByLabelText("Radius")).toBeInTheDocument();
    fireEvent.click(within(shape).getByRole("button", { name: "Wall" }));
    expect(within(shape).getByRole("button", { name: "Wall" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Radius")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close Areas" }));
    expect(screen.queryByRole("dialog", { name: "Areas" })).toBeNull();
    act(() => setAreasOpen(true));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Areas" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Areas" })).toBeNull();
  });

  it("says when the map has no area or no PC token", () => {
    results["combatAreas:list"] = [];
    results["combatTokens:list"] = [];
    act(() => setAreasOpen(true));
    render(createElement(HudAreas, { state: state("gm") }));
    expect(screen.getByText("No live area on this map.")).toBeInTheDocument();
    expect(screen.getByText("Add a PC token first: an area belongs to a character.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick on the map" })).toBeDisabled();
  });
});
