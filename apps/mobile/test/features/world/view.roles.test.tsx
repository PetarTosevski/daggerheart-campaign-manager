import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, waitFor } from "@testing-library/react-native";

import "../../theme/mock-reanimated";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { WorldScreen } from "../../../src/features/world";
import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { horizonPrintedGrid } from "../../../../../src/lib/world/map-state";
import { hexToPixel } from "../../../../../src/lib/world/hex";
import { campaignId, campaignRecord, horizonMapView, mapView } from "./fixtures";

jest.mock("react-native-gesture-handler", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  const chain = () => ({
    onBegin: () => chain(),
    onUpdate: () => chain(),
    onEnd: () => chain(),
    runOnJS: () => chain(),
  });
  return {
    Gesture: {
      Pan: chain,
      Pinch: chain,
      Simultaneous: () => chain(),
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
  };
});

/** Every SVG string the canvas parsed into a Skia path (parsing is the cost the canvas memoises). */
const mockParsed: string[] = [];

jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  return {
    Canvas: ({ children }: { children: React.ReactNode }) => React.createElement(View, { testID: "skia-canvas" }, children),
    Path: () => React.createElement(View, { testID: "skia-path" }),
    DashPathEffect: () => null,
    Group: ({ children }: { children: React.ReactNode }) => children,
    Skia: {
      Path: {
        MakeFromSVGString: (svg: string) => {
          mockParsed.push(svg);
          return {};
        },
        Make: () => ({}),
      },
    },
  };
});

jest.mock("expo-image", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  return {
    Image: () => React.createElement(View, { testID: "map-image" }),
  };
});

beforeEach(() => {
  resetMotionTest();
  mockParsed.length = 0;
});

afterEach(() => {
  cleanup();
});

function screenFor() {
  return (
    <OfflineFrame offline={false}>
      <CampaignProvider campaignId={campaignId}>
        <CampaignScreen>
          <WorldScreen />
        </CampaignScreen>
      </CampaignProvider>
    </OfflineFrame>
  );
}

const playerQueries = {
  "campaigns:get": campaignRecord("player"),
  "maps:get": mapView("player"),
};

const gmQueries = {
  "campaigns:get": campaignRecord("gm"),
  "maps:get": mapView("gm"),
};

async function layoutMap(screen: Awaited<ReturnType<typeof renderAsPlayer>>) {
  fireEvent(screen.getByTestId("world-map-shell"), "layout", {
    nativeEvent: { layout: { width: 360, height: 360, x: 0, y: 0 } },
  });
  await waitFor(() => {
    expect(screen.getByLabelText(/Map of The Table/)).toBeTruthy();
  });
}

test("a player world screen subscribes to maps.get and never mounts the palette", async () => {
  const screen = await renderAsPlayer(screenFor(), { queries: playerQueries });
  await layoutMap(screen);
  expect(screen.client.subscribed).toEqual(["campaigns:get", "maps:get"]);
  expect(screen.getByLabelText("Travel speeds")).toBeTruthy();
  expect(screen.getByLabelText(/Map of The Table/)).toBeTruthy();
  expect(screen.queryByTestId("world-palette")).toBeNull();
  expect(screen.queryByText("Place on map")).toBeNull();
});

test("a player map shows filtered tokens from maps.get", async () => {
  const screen = await renderAsPlayer(screenFor(), {
    queries: {
      ...playerQueries,
      "maps:get": mapView("player", {
        state: {
          ...mapView("player").state,
          tokens: [{ id: 2, type: "landmark", x: 20, y: 30, name: "Visible", notes: "", hidden: false, location: false }],
        },
      }),
    },
  });
  await layoutMap(screen);
  expect(screen.getByLabelText("Visible, Landmark")).toBeTruthy();
});

test("a GM world screen shows the map and edit slot but not the palette", async () => {
  const screen = await renderAsGm(screenFor(), { queries: gmQueries });
  await layoutMap(screen);
  expect(screen.client.subscribed).toContain("maps:get");
  expect(screen.getByTestId("world-edit-slot")).toBeTruthy();
  expect(screen.queryByTestId("world-palette")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Terrain overlay" }));
  expect(screen.getByTestId("skia-canvas")).toBeTruthy();
});

test("a horizon map uses hex overlays instead of terrain paint", async () => {
  const screen = await renderAsPlayer(screenFor(), {
    queries: {
      "campaigns:get": { ...campaignRecord("player"), frameId: "journey-to-horizon" },
      "maps:get": horizonMapView("player"),
    },
  });
  await layoutMap(screen);
  expect(screen.queryByLabelText("Travel speeds")).toBeNull();
  expect(screen.getByRole("button", { name: "Hex grid" })).toBeTruthy();
});

test("the map is not inside a vertical ScrollView, so a drag on it pans the map", async () => {
  const screen = await renderAsPlayer(screenFor(), { queries: playerQueries });
  await layoutMap(screen);
  let node = screen.getByTestId("world-map-shell").parent;
  while (node) {
    const type = node.type as unknown;
    const name = typeof type === "string" ? type : ((type as { displayName?: string; name?: string } | null)?.displayName ?? (type as { name?: string } | null)?.name);
    if (name === "RCTScrollView" || name === "ScrollView") expect(node.props.horizontal).toBe(true);
    node = node.parent;
  }
});

test("zooming reuses the parsed overlay paths instead of parsing them again", async () => {
  const screen = await renderAsGm(screenFor(), { queries: gmQueries });
  await layoutMap(screen);
  await fireEvent.press(screen.getByRole("button", { name: "Terrain overlay" }));
  const parsed = mockParsed.length;
  expect(parsed).toBeGreaterThan(0);
  await fireEvent.press(screen.getByRole("button", { name: "Zoom in" }));
  await fireEvent.press(screen.getByRole("button", { name: "Zoom in" }));
  await fireEvent.press(screen.getByRole("button", { name: "Zoom out" }));
  expect(screen.getByText("125%")).toBeTruthy();
  expect(mockParsed.length).toBe(parsed);
});

function hexHorizon(tokens: { id: number; x: number; y: number; name: string }[], partyAt: { x: number; y: number }) {
  const view = horizonMapView("player");
  return {
    ...view,
    state: {
      ...view.state,
      party: { ...view.state.party, x: partyAt.x, y: partyAt.y, trail: [] },
      tokens: tokens.map((t) => ({ ...t, type: "landmark", notes: "", hidden: false, location: false })),
    },
  } as typeof view;
}

/** Percent of the Horizon art (3400 × 2228) at the centre of a printed hex. */
function hexCentrePct(q: number, r: number) {
  const c = hexToPixel({ q, r }, horizonPrintedGrid());
  return { x: (c.x / 3400) * 100, y: (c.y / 2228) * 100 };
}

test("on the Horizon map every marker, the party included, is a hex of the printed grid", async () => {
  const away = hexCentrePct(20, 10);
  const screen = await renderAsPlayer(screenFor(), {
    queries: {
      "campaigns:get": { ...campaignRecord("player"), frameId: "journey-to-horizon" },
      "maps:get": hexHorizon([{ id: 2, ...away, name: "Spire" }], hexCentrePct(40, 5)),
    },
  });
  await layoutMap(screen);
  const party = screen.getByTestId("hex-marker-party");
  const marker = screen.getByTestId("hex-marker-t2");
  expect(screen.getByLabelText("Spire, Landmark")).toBe(marker);
  // At fit zoom the map is 360 px wide: a whole printed hex is 2 × 24.612 px of 3400.
  const style = Object.assign({}, ...[marker.props.style].flat()) as { width: number; left: number };
  expect(style.width).toBeCloseTo((2 * 24.612 * 360) / 3400, 3);
  expect(style.left + style.width / 2).toBeCloseTo((away.x / 100) * 360, 3);
  expect(party).toBeTruthy();
  expect(screen.getByText("Spire")).toBeTruthy();
});

test("markers sharing a hex become third-size hexes without names, and past seven a +n count", async () => {
  const here = hexCentrePct(20, 10);
  const tokens = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, ...here, name: `M${i + 1}` }));
  const screen = await renderAsPlayer(screenFor(), {
    queries: {
      "campaigns:get": { ...campaignRecord("player"), frameId: "journey-to-horizon" },
      "maps:get": hexHorizon(tokens, here),
    },
  });
  await layoutMap(screen);
  const style = Object.assign({}, ...[screen.getByTestId("hex-marker-t1").props.style].flat()) as { width: number };
  expect(style.width).toBeCloseTo((2 * 24.612 * 360) / 3400 / 3, 3);
  expect(screen.queryByText("M1")).toBeNull();
  // Party + 8 markers = 9 in one hex: 7 slots, 2 more stacked on the centre under the party.
  expect(screen.getByText("+2", { includeHiddenElements: true })).toBeTruthy();
});

test("maps without a printed grid keep round markers", async () => {
  const screen = await renderAsPlayer(screenFor(), { queries: playerQueries });
  await layoutMap(screen);
  expect(screen.getByLabelText("Haven, Village")).toBeTruthy();
  expect(screen.queryByTestId("hex-marker-t1")).toBeNull();
  expect(screen.queryByTestId("hex-marker-party")).toBeNull();
});
