// Plan combat-hud H9.0 (docs/tasks/TASK-HUD-H9.0.md): hud/panels.ts, one GM panel open at a time from one store;
// Escape closes the open one and focus goes back to its opener; "areas" is mirrored into the Areas flag. And the map
// controls store (map-view/controls.ts) the dock shares with the board.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useAreasOpen } from "../../../src/components/combat-map/hud/areas/open";
import {
  HUD_PANELS,
  closePanel,
  openPanel,
  openPanelNow,
  resetPanels,
  togglePanel,
  usePanel,
  usePanelEscape,
} from "../../../src/components/combat-map/hud/panels";
import {
  mapControlsSnapshot,
  publishBoard,
  releaseBoard,
  setMapTool,
  zoomLabel,
} from "../../../src/components/combat-map/map-view/controls";

afterEach(() => {
  act(() => resetPanels());
  document.body.innerHTML = "";
});

describe("hud/panels.ts", () => {
  it("lists every GM panel the wave reads", () => {
    expect(HUD_PANELS).toEqual(["queue", "log", "areas", "spotlight", "dice", "fog", "playerView", "endScene"]);
  });

  it("keeps one panel open at a time", () => {
    const { result } = renderHook(() => usePanel());
    expect(result.current).toBeNull();
    act(() => openPanel("dice"));
    expect(result.current).toBe("dice");
    act(() => openPanel("log"));
    expect(result.current).toBe("log");
    act(() => togglePanel("log"));
    expect(result.current).toBeNull();
    act(() => togglePanel("fog"));
    expect(result.current).toBe("fog");
    // Closing another panel than the open one changes nothing.
    act(() => closePanel("dice"));
    expect(result.current).toBe("fog");
    act(() => closePanel());
    expect(result.current).toBeNull();
  });

  it("mirrors Areas into the Areas flag, both ways", () => {
    const { result } = renderHook(() => ({ panel: usePanel(), areas: useAreasOpen() }));
    act(() => openPanel("areas"));
    expect(result.current).toEqual({ panel: "areas", areas: true });
    act(() => openPanel("dice"));
    expect(result.current).toEqual({ panel: "dice", areas: false });
    act(() => openPanel("areas"));
    act(() => closePanel("areas"));
    expect(result.current).toEqual({ panel: null, areas: false });
  });

  it("closes the open panel on Escape and gives the focus back to its opener", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    const other = document.createElement("button");
    document.body.append(other);
    const { result } = renderHook(() => {
      usePanelEscape();
      return usePanel();
    });
    act(() => openPanel("log", opener));
    other.focus();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current).toBeNull();
    expect(openPanelNow()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("leaves an Escape a panel handled itself alone", () => {
    renderHook(() => usePanelEscape());
    act(() => openPanel("dice"));
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    event.preventDefault();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(openPanelNow()).toBe("dice");
  });
});

describe("map-view/controls.ts", () => {
  it("drives the published board and lets go of it on unmount", () => {
    const calls: string[] = [];
    const board = {};
    publishBoard(board, { zoom: 0.91, zoomIn: () => calls.push("in"), zoomOut: () => calls.push("out"), fit: () => calls.push("fit") });
    expect(zoomLabel(mapControlsSnapshot().board?.zoom ?? null)).toBe("91%");
    mapControlsSnapshot().board?.zoomIn();
    mapControlsSnapshot().board?.fit();
    expect(calls).toEqual(["in", "fit"]);
    setMapTool("measure");
    expect(mapControlsSnapshot().tool).toBe("measure");
    // An older board unmounting does not clear a newer one.
    releaseBoard({});
    expect(mapControlsSnapshot().board).not.toBeNull();
    releaseBoard(board);
    expect(mapControlsSnapshot()).toMatchObject({ board: null, tool: "select" });
    expect(zoomLabel(null)).toBe("100%");
  });
});
