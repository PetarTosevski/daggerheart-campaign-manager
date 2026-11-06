import "./mocks";
import { beforeEach, expect, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { WorldScreen } from "../../../src/features/world";
import { WorldEditSlot } from "../../../src/features/world/edit";
import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { campaignId, campaignRecord, mapView } from "../world/fixtures";

beforeEach(() => {
  resetMotionTest();
});

function worldScreen() {
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

function editSlot(enabled: boolean) {
  return (
    <OfflineFrame offline={false}>
      <CampaignProvider campaignId={campaignId}>
        <CampaignScreen>
          <WorldEditSlot enabled={enabled} />
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

test("a player never mounts the place-on-map palette", async () => {
  const screen = await renderAsPlayer(worldScreen(), { queries: playerQueries });
  expect(screen.queryByTestId("world-palette")).toBeNull();
  expect(screen.queryByText("Place on map")).toBeNull();
});

test("a GM keeps the palette inside closed map tools", async () => {
  const screen = await renderAsGm(
    <OfflineFrame offline={false}>
      <CampaignProvider campaignId={campaignId}>
        <CampaignScreen>
          <WorldEditSlot enabled data={mapView("gm")} />
        </CampaignScreen>
      </CampaignProvider>
    </OfflineFrame>,
    { queries: gmQueries },
  );
  expect(screen.getByTestId("world-edit-slot")).toBeTruthy();
  expect(screen.queryByTestId("world-palette")).toBeNull();
  expect(screen.queryByText("Place on map")).toBeNull();
});

test("a GM sees the palette after opening map tools, and the edit map takes the view map's place", async () => {
  const screen = await renderAsGm(worldScreen(), { queries: gmQueries });
  expect(screen.getByTestId("world-map-shell")).toBeTruthy();
  await fireEvent.press(screen.getByText("GM map tools"));
  expect(screen.getByTestId("world-palette")).toBeTruthy();
  expect(screen.getByText("Place on map")).toBeTruthy();
  expect(screen.getByTestId("world-edit-map")).toBeTruthy();
  expect(screen.queryByTestId("world-map-shell")).toBeNull();
  await fireEvent.press(screen.getByText("Close GM map tools"));
  expect(screen.getByTestId("world-map-shell")).toBeTruthy();
  expect(screen.queryByTestId("world-palette")).toBeNull();
});

test("WorldEditSlot renders nothing for players", async () => {
  const screen = await renderAsPlayer(editSlot(false), { queries: playerQueries });
  expect(screen.queryByTestId("world-edit-slot")).toBeNull();
});
