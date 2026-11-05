import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, waitFor } from "@testing-library/react-native";

import "../../theme/mock-reanimated";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { WorldScreen } from "../../../src/features/world";
import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { renderAsGm, renderAsPlayer } from "../../harness";
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

jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  return {
    Canvas: ({ children }: { children: React.ReactNode }) => React.createElement(View, { testID: "skia-canvas" }, children),
    Path: () => React.createElement(View, { testID: "skia-path" }),
    Group: ({ children }: { children: React.ReactNode }) => children,
    Skia: {
      Path: {
        MakeFromSVGString: () => ({}),
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
