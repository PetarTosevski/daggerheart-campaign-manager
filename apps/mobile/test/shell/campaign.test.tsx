import { expect, test } from "@jest/globals";
import { Text } from "react-native";

import { CampaignProvider, CampaignScreen, useCampaign } from "../../src/shell/campaign-provider";
import { renderAsGm, renderAsPlayer } from "../harness";
import { campaignSummary } from "../harness/records";

const base = campaignSummary({
  _id: "campaign-1",
  frameId: "witherwild",
  name: "The Table",
  tier: 1,
  level: 1,
  custom: null,
  tome: null,
  options: {
    hopeAndFear: true,
    lessLethal: false,
    transformations: false,
    enduranceCountdowns: false,
    remnantCorruption: false,
    witherPersists: false,
  },
  createdAt: 1,
  lastOpenedAt: 1,
  players: 2,
});

function RoleLabel() {
  const campaign = useCampaign();
  return <Text>{campaign.role}</Text>;
}

test("a null campaigns.get shows Not found and still subscribes once", async () => {
  const screen = await renderAsPlayer(
    <CampaignProvider campaignId="missing">
      <CampaignScreen>
        <Text>Ready</Text>
      </CampaignScreen>
    </CampaignProvider>,
    { queries: { "campaigns:get": null } },
  );
  expect(screen.getByRole("header", { name: "Not found" })).toBeTruthy();
  expect(screen.queryByText("Ready")).toBeNull();
  expect(screen.client.subscribed).toEqual(["campaigns:get"]);
});

test("campaigns.get is skipped when there is no id", async () => {
  const screen = await renderAsPlayer(
    <CampaignProvider campaignId="">
      <CampaignScreen>
        <Text>Ready</Text>
      </CampaignScreen>
    </CampaignProvider>,
  );
  expect(screen.getByRole("header", { name: "Not found" })).toBeTruthy();
  expect(screen.client.subscribed).toEqual([]);
});

test("an unanswered campaigns.get shows Loading", async () => {
  const screen = await renderAsPlayer(
    <CampaignProvider campaignId="campaign-1">
      <CampaignScreen>
        <Text>Ready</Text>
      </CampaignScreen>
    </CampaignProvider>,
  );
  expect(screen.getByRole("progressbar", { name: "Loading campaign" })).toBeTruthy();
  expect(screen.queryByText("Ready")).toBeNull();
  expect(screen.client.subscribed).toEqual(["campaigns:get"]);
});

test("the role is the one campaigns.get returned", async () => {
  const player = await renderAsGm(
    <CampaignProvider campaignId="campaign-1">
      <CampaignScreen>
        <RoleLabel />
      </CampaignScreen>
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...base, role: "player" } } },
  );
  expect(player.getByText("player")).toBeTruthy();
  expect(player.client.subscribed.filter((name) => name === "campaigns:get")).toEqual(["campaigns:get"]);

  const gm = await renderAsPlayer(
    <CampaignProvider campaignId="campaign-1">
      <CampaignScreen>
        <RoleLabel />
      </CampaignScreen>
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...base, role: "gm" } } },
  );
  expect(gm.getByText("gm")).toBeTruthy();
  expect(gm.client.subscribed).not.toContain("encounters:list");
});
