import { expect, jest, test } from "@jest/globals";

import { resetMotionTest } from "../theme/mock-reanimated";
import AdversariesRoute from "../../app/campaign/[campaignId]/(gm)/adversaries";
import { CampaignProvider } from "../../src/shell/campaign-provider";
import { renderAsGm, renderAsPlayer } from "../harness";

// Stand-in until jest.setup stubs the native module (dcm-gdzi.40).
jest.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

const base = {
  _id: "campaign-1",
  name: "The Table",
};

const gmCampaign = {
  ...base,
  role: "gm",
  frameId: "witherwild",
  tier: 1,
  options: { hopeAndFear: false },
};

test("a player who opens adversaries lands on the dashboard and does not subscribe to encounters:list", async () => {
  const screen = await renderAsPlayer(
    <CampaignProvider campaignId="campaign-1">
      <AdversariesRoute />
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...base, role: "player" } } },
  );
  expect(screen.getByRole("header", { name: "Dashboard" })).toBeTruthy();
  expect(screen.queryByRole("header", { name: "Adversaries" })).toBeNull();
  expect(screen.getByText("Not built yet.")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:get"]);
  expect(screen.client.subscribed).not.toContain("encounters:list");
});

test("a GM query role opens the adversaries screen and subscribes to encounters:list", async () => {
  resetMotionTest();
  const screen = await renderAsGm(
    <CampaignProvider campaignId="campaign-1">
      <AdversariesRoute />
    </CampaignProvider>,
    {
      queries: {
        "campaigns:get": gmCampaign,
        "encounters:list": { active: [], ended: [], moreEnded: false },
        "customAdversaries:list": [],
      },
    },
  );
  expect(screen.getByRole("header", { name: "Adversaries" })).toBeTruthy();
  expect(screen.queryByText("Not built yet.")).toBeNull();
  expect(screen.getByRole("tab", { name: "Catalogue" })).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:get", "encounters:list", "customAdversaries:list"]);
});

test("the harness role does not decide the adversaries screen", async () => {
  const screen = await renderAsGm(
    <CampaignProvider campaignId="campaign-1">
      <AdversariesRoute />
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...base, role: "player" } } },
  );
  expect(screen.getByRole("header", { name: "Dashboard" })).toBeTruthy();
  expect(screen.client.subscribed).not.toContain("encounters:list");
});
