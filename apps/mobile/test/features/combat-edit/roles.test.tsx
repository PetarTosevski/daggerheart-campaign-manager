import "./mocks";
import { beforeEach, expect, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatEditSlot } from "../../../src/features/combat-map/edit";
import { CombatMapScreen } from "../../../src/features/combat-map";
import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { campaignId, campaignRecord, editSlotQueries, liveLayout, playerViewOk } from "./fixtures";

beforeEach(() => {
  resetMotionTest();
});

const live = liveLayout();
const view = playerViewOk();

function combatScreen() {
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

function editSlot(isGm: boolean) {
  return (
    <OfflineFrame offline={false}>
      <CombatEditSlot campaignId={campaignId} isGm={isGm} layout={live} view={view} />
    </OfflineFrame>
  );
}

test("a player never mounts the combat edit slot", async () => {
  const screen = await renderAsPlayer(combatScreen(), {
    queries: {
      "campaigns:get": campaignRecord("player"),
      "combatMaps:live": live,
      "combatVision:playerView": view,
    },
  });
  expect(screen.queryByTestId("combat-edit-slot", { includeHiddenElements: true })).toBeNull();
});

test("a closed GM edit slot does not subscribe to style or edit reads", async () => {
  const forbidden = ["combatMapStyle:settings", "combatMapStyle:spriteSources", "combatMaps:get"];
  const screen = await renderAsGm(editSlot(true), { queries: editSlotQueries(live) });
  expect(screen.getByRole("button", { name: "Open GM map editor" })).toBeTruthy();
  for (const name of forbidden) {
    expect(screen.client.subscribed).not.toContain(name);
  }
});

test("CombatEditSlot renders nothing for a player", async () => {
  const screen = await renderAsPlayer(editSlot(false), {
    queries: { "campaigns:get": campaignRecord("player") },
  });
  expect(screen.queryByTestId("combat-edit-slot")).toBeNull();
});

test("a GM keeps the object palette inside closed map editor", async () => {
  const screen = await renderAsGm(editSlot(true), { queries: editSlotQueries(live) });
  expect(screen.getByTestId("combat-edit-slot")).toBeTruthy();
  expect(screen.queryByTestId("combat-edit-palette")).toBeNull();
});

test("a GM sees the object palette after opening map editor and choosing Objects", async () => {
  const screen = await renderAsGm(editSlot(true), { queries: editSlotQueries(live) });
  await fireEvent.press(screen.getByText("GM map editor"));
  await fireEvent.press(screen.getByText("Objects"));
  expect(screen.getByTestId("combat-edit-palette")).toBeTruthy();
  expect(screen.getByText("Tree")).toBeTruthy();
});

test("opening map editor subscribes to combatMapStyle settings", async () => {
  const screen = await renderAsGm(editSlot(true), { queries: editSlotQueries(live) });
  await fireEvent.press(screen.getByText("GM map editor"));
  expect(screen.client.subscribed).toContain("combatMapStyle:settings");
});
