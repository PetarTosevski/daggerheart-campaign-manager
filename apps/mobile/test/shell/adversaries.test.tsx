import { expect, jest, test } from "@jest/globals";

import { resetMotionTest } from "../theme/mock-reanimated";
import AdversariesRoute from "../../app/campaign/[campaignId]/(gm)/adversaries";
import { CampaignProvider } from "../../src/shell/campaign-provider";
import { renderAsGm, renderAsPlayer } from "../harness";
import { campaignSummary } from "../harness/records";

// A player sent off a GM route lands on the dashboard; the dashboard's own queries are its tests' business.
jest.mock("../../src/features/dashboard", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native") as typeof import("react-native");
  return { DashboardScreen: () => <Text accessibilityRole="header">Dashboard</Text> };
});


jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

const base = campaignSummary({
  _id: "campaign-1",
  name: "The Table",
});

const gmCampaign = campaignSummary({
  ...base,
  role: "gm",
  frameId: "witherwild",
  tier: 1,
  options: { hopeAndFear: false },
});

test("a player who opens adversaries lands on the dashboard and does not subscribe to encounters:list", async () => {
  const screen = await renderAsPlayer(
    <CampaignProvider campaignId="campaign-1">
      <AdversariesRoute />
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...base, role: "player" } } },
  );
  expect(screen.getByRole("header", { name: "Dashboard" })).toBeTruthy();
  expect(screen.queryByRole("header", { name: "Adversaries" })).toBeNull();
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
