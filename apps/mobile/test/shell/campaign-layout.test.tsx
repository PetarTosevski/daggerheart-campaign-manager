import { beforeEach, expect, jest, test } from "@jest/globals";
import type { ReactNode } from "react";

// First: it mocks Reanimated before the layout's banners load the Button.
import "../theme/mock-reanimated";

import CampaignLayout from "../../app/campaign/[campaignId]/_layout";
import { api } from "../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../harness";
import { campaignSummary } from "../harness/records";

const mockProtected: { redirectTo?: string; guard?: boolean }[] = [];
const mockParams = { campaignId: "campaign-1" };

beforeEach(() => {
  mockProtected.length = 0;
  mockParams.campaignId = "campaign-1";
});

jest.mock("expo-router", () => {
  const Stack = Object.assign(({ children }: { children: ReactNode }) => children, {
    Screen: () => null,
    Protected: (props: { redirectTo: string; guard: boolean }) => {
      mockProtected.push({ redirectTo: props.redirectTo, guard: props.guard });
      return null;
    },
  });
  return {
    Stack,
    useLocalSearchParams: () => mockParams,
  };
});

jest.mock("../../src/shell/offline", () => ({
  LiveOffline: ({ children }: { children: ReactNode }) => children,
  WritesOffFrame: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../../src/shell/tab-bar", () => ({
  CampaignTabBar: () => null,
}));

const campaign = campaignSummary({ _id: "campaign-1", name: "The Table", ownerView: false });

test("opening a campaign records it once with campaigns.markOpened", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsPlayer(<CampaignLayout />, {
    queries: { "campaigns:get": { ...campaign, role: "player" } },
    mutations: {
      [fn(api.campaigns.markOpened)]: (args: unknown) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(calls).toEqual([{ campaignId: "campaign-1" }]);
  expect(screen.client.called).toEqual([fn(api.campaigns.markOpened)]);
});

test("the owner's read-only view does not record the open", async () => {
  const screen = await renderAsGm(<CampaignLayout />, {
    queries: { "campaigns:get": { ...campaign, ownerView: true, role: "gm" } },
  });
  expect(screen.client.called).toEqual([]);
});

test("the GM screens redirect a player to the campaign's dashboard, or to the list without an id", async () => {
  await renderAsPlayer(<CampaignLayout />, {
    queries: { "campaigns:get": { ...campaign, role: "player" } },
  });
  expect(mockProtected.at(-1)).toEqual({ redirectTo: "/campaign/campaign-1", guard: false });

  mockParams.campaignId = "";
  const missing = await renderAsPlayer(<CampaignLayout />);
  expect(mockProtected.at(-1)).toEqual({ redirectTo: "/campaigns", guard: false });
  expect(missing.client.called).toEqual([]);
});

test("the layout shows the campaign banners above every page (archived, read-only mode)", async () => {
  const screen = await renderAsPlayer(<CampaignLayout />, {
    queries: {
      "campaigns:get": { ...campaign, role: "player", archived: true, isCreator: false },
      "appStatus:get": { readOnly: true, message: null },
      "appAdmin:me": { isOwner: false },
    },
  });
  expect(screen.getByTestId("archived-banner")).toBeTruthy();
  expect(screen.getByTestId("read-only-banner")).toBeTruthy();
});
