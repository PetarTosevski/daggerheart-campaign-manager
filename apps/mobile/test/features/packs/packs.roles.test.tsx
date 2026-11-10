import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import PacksRoute from "../../../app/campaign/[campaignId]/(gm)/packs";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { campaignId, emptyPacks, gmCampaign, inCampaign, onePack, packId, playerCampaign, spriteA } from "./fixture";

// A player sent off a GM route lands on the dashboard; the dashboard's own queries are its tests' business.
jest.mock("../../../src/features/dashboard", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native") as typeof import("react-native");
  return { DashboardScreen: () => <Text accessibilityRole="header">Dashboard</Text> };
});


jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));

jest.mock("../../../src/features/packs/sheet-image", () => ({
  SHEET_TYPES: ["image/png"],
  SheetError: class SheetError extends Error {},
  readPickedSheet: async () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
  asyncThumbnail: async () => "data:image/png;base64,aa",
  encodeSprite: async () => ({ blob: new Blob(), px: { w: 1, h: 1 }, contentType: "image/png" }),
  maxSideForLabels: () => 160,
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));

const key = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  resetMotionTest();
});

test("a player opening packs lands on the dashboard and never subscribes to spritePacks:packs", async () => {
  const screen = await renderAsPlayer(inCampaign(<PacksRoute />), {
    queries: { "campaigns:get": playerCampaign() },
  });
  expect(screen.getByRole("header", { name: "Dashboard" })).toBeTruthy();
  expect(screen.queryByRole("header", { name: "Sprite packs" })).toBeNull();
  expect(screen.client.subscribed).toEqual(["campaigns:get"]);
});

test("the GM sees sprite packs, subscribes to spritePacks:packs, and can create a pack", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(inCampaign(<PacksRoute />), {
    queries: { "campaigns:get": gmCampaign(), "spritePacks:packs": emptyPacks },
    mutations: {
      "spritePacks:createPack": (args) => {
        calls.push(args);
        return { packId };
      },
    },
  });
  expect(screen.getByRole("header", { name: "Sprite packs" })).toBeTruthy();
  expect(screen.getByRole("header", { name: "New pack" })).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:get", "spritePacks:packs"]);
  await fireEvent.changeText(screen.getByLabelText("Pack name"), "Moorland");
  await fireEvent.press(screen.getByRole("button", { name: "Create pack" }));
  expect(calls).toEqual([{ campaignId, name: "Moorland", idempotencyKey: key }]);
});

test("the GM renames a pack and reorders a sprite", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(inCampaign(<PacksRoute />), {
    queries: { "campaigns:get": gmCampaign(), "spritePacks:packs": onePack },
    mutations: {
      "spritePacks:renamePack": (args) => {
        calls.push(args);
        return null;
      },
      "spritePacks:reorderSprite": (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(screen.getByText("Deep halls")).toBeTruthy();
  const packNameFields = screen.getAllByLabelText("Pack name");
  const packName = packNameFields.find((node) => node.props.value === "Deep halls") ?? packNameFields[1]!;
  await fireEvent.changeText(packName, "Heath");
  await fireEvent(packName, "blur");
  expect(calls[0]).toEqual({ campaignId, packId, name: "Heath" });
  await fireEvent.press(screen.getByLabelText("Move Rune stone down"));
  expect(calls[1]).toEqual({ campaignId, spriteId: spriteA, direction: "down" });
});

test("the GM renames a saved sprite on blur", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(inCampaign(<PacksRoute />), {
    queries: { "campaigns:get": gmCampaign(), "spritePacks:packs": onePack },
    mutations: {
      "spritePacks:updateSprite": (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  const spriteName = screen.getByDisplayValue("Rune stone");
  await fireEvent.changeText(spriteName, "Grand arch");
  await fireEvent(spriteName, "blur");
  expect(calls).toEqual([{ campaignId, spriteId: spriteA, patch: { name: "Grand arch" } }]);
});
