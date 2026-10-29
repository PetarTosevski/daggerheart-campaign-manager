import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, waitFor } from "@testing-library/react-native";

import "../../theme/mock-reanimated";
import { resetMotionTest } from "../../theme/mock-reanimated";

jest.mock("react-native-gesture-handler", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  const chain = () => ({
    onBegin: () => chain(),
    onUpdate: () => chain(),
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
import { CombatMapScreen } from "../../../src/features/combat-map";
import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { campaignId, campaignRecord, liveLayout, playerViewOk } from "./fixtures";

jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  return {
    Canvas: ({ children }: { children: React.ReactNode }) => React.createElement(View, { testID: "skia-canvas" }, children),
    Image: () => React.createElement(View, { testID: "skia-image" }),
    Skia: {
      Data: { fromBytes: () => ({}) },
      Image: { MakeImage: () => ({}) },
    },
  };
});

jest.mock("expo-image", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react") as typeof import("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native") as typeof import("react-native");
  return { Image: () => React.createElement(View, { testID: "map-image" }) };
});

beforeEach(() => {
  resetMotionTest();
});

function screenFor() {
  return (
    <OfflineFrame offline={false}>
      <CampaignProvider campaignId={campaignId}>
        <CampaignScreen>
          <CombatMapScreen />
        </CampaignScreen>
      </CampaignProvider>
    </OfflineFrame>
  );
}

const live = liveLayout();
const view = playerViewOk();

const playerQueries = {
  "campaigns:get": campaignRecord("player"),
  "combatMaps:live": live,
  "combatVision:playerView": view,
};

const gmQueries = {
  "campaigns:get": campaignRecord("gm"),
  "combatMaps:live": live,
  "combatVision:playerView": { state: "noCharacter", mapId: live._id },
};

function layoutViewport(screen: Awaited<ReturnType<typeof renderAsPlayer>>) {
  fireEvent(screen.getByTestId("combat-viewport"), "layout", {
    nativeEvent: { layout: { width: 360, height: 360, x: 0, y: 0 } },
  });
}

const forbidden = ["combatMaps:list", "combatMaps:get", "combatTokensReads:list", "combatVision:previewAs"];

test("a player combat screen subscribes to live and playerView only among combat queries", async () => {
  const screen = await renderAsPlayer(screenFor(), { queries: playerQueries });
  layoutViewport(screen);
  expect(screen.client.subscribed).toEqual([
    "campaigns:get",
    "combatMaps:live",
    "combatVision:playerView",
    "combatHud:party",
    "combatHud:scene",
  ]);
  for (const name of forbidden) {
    expect(screen.client.subscribed).not.toContain(name);
  }
  await waitFor(() => expect(screen.getByTestId("combat-map-stage")).toBeTruthy());
  expect(screen.getByLabelText("Briar, yours, pc")).toBeTruthy();
  expect(screen.getByTestId("combat-play-slot", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId("combat-gm-slot", { includeHiddenElements: true })).toBeNull();
});

test("a GM combat screen uses live and playerView and never GM-only combat reads", async () => {
  const screen = await renderAsGm(screenFor(), { queries: gmQueries });
  layoutViewport(screen);
  expect(screen.client.subscribed).toContain("combatMaps:live");
  expect(screen.client.subscribed).toContain("combatVision:playerView");
  for (const name of forbidden) {
    expect(screen.client.subscribed).not.toContain(name);
  }
  await waitFor(() => expect(screen.getByTestId("combat-map-stage")).toBeTruthy());
  expect(screen.getByTestId("combat-gm-slot", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId("combat-play-slot", { includeHiddenElements: true })).toBeNull();
});

test("shows an empty state when no map is live", async () => {
  const screen = await renderAsPlayer(screenFor(), {
    queries: {
      ...playerQueries,
      "combatMaps:live": null,
      "combatVision:playerView": { state: "noMap" },
    },
  });
  expect(screen.getByText("The GM has not shown a map yet.")).toBeTruthy();
  expect(screen.queryByTestId("combat-empty-gm")).toBeNull();
  expect(screen.client.subscribed).not.toContain("combatMaps:list");
});

test("a GM with no live map can start one without opening the other GM tools", async () => {
  const screen = await renderAsGm(screenFor(), {
    queries: {
      ...gmQueries,
      "combatMaps:live": null,
      "combatVision:playerView": { state: "noMap" },
      "combatMaps:list": [],
    },
  });
  expect(screen.getByTestId("combat-empty-gm")).toBeTruthy();
  expect(screen.getByText("New Small map")).toBeTruthy();
  expect(screen.client.subscribed).toContain("combatMaps:list");
  expect(screen.client.subscribed).not.toContain("combatTokensReads:list");
});
