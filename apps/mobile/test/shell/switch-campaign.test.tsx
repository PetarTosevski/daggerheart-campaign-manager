import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

import { resetMotionTest } from "../theme/mock-reanimated";
import { CampaignTabBar } from "../../src/shell/tab-bar";

const mockRouter = { navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock("expo-router", () => ({
  usePathname: () => "/campaign/campaign-1/party",
  useRouter: () => mockRouter,
}));

beforeEach(() => {
  resetMotionTest();
  mockRouter.navigate.mockClear();
  mockRouter.replace.mockClear();
});

test("Switch campaign opens the campaign list, not the old /campaign test screen", async () => {
  const screen = await render(<CampaignTabBar campaignId="campaign-1" isGm={false} />);
  await fireEvent.press(screen.getByRole("button", { name: "More" }));
  await fireEvent.press(screen.getByRole("button", { name: "Switch campaign" }));
  expect(mockRouter.replace).toHaveBeenCalledWith("/campaigns");
  expect(mockRouter.navigate).not.toHaveBeenCalled();
});

test("a More section still navigates inside the campaign", async () => {
  const screen = await render(<CampaignTabBar campaignId="campaign-1" isGm />);
  await fireEvent.press(screen.getByRole("button", { name: "More" }));
  await fireEvent.press(screen.getByRole("button", { name: "Adversaries" }));
  expect(mockRouter.navigate).toHaveBeenCalledWith("/campaign/campaign-1/adversaries");
});
