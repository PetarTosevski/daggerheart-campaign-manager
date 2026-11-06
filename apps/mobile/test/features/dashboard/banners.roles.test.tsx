import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import DashboardRoute, {
  ARCHIVED_BANNER_TEXT,
  OWNER_VIEW_BANNER_TEXT,
  READ_ONLY_BANNER_DEFAULT,
} from "../../../app/campaign/[campaignId]/index";
import { CampaignProvider } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { api } from "../../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { campaign } from "./fixtures";

jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));

beforeEach(() => {
  resetMotionTest();
});

function route() {
  return (
    <OfflineFrame offline={false}>
      <CampaignProvider campaignId="campaign-1">
        <DashboardRoute />
      </CampaignProvider>
    </OfflineFrame>
  );
}

function gmCampaign(extra: { isCreator?: boolean; archived?: boolean; ownerView?: boolean }) {
  return { ...campaign("gm"), isCreator: false, archived: false, ownerView: false, ...extra };
}

test("an archived campaign shows the banner, and its creator can Restore", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(route(), {
    queries: { [fn(api.campaigns.get)]: gmCampaign({ isCreator: true, archived: true }), [fn(api.appStatus.get)]: null },
    mutations: {
      [fn(api.campaignSettings.unarchive)]: (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(screen.getByText(ARCHIVED_BANNER_TEXT)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Restore" }));
  expect(calls).toEqual([{ campaignId: "campaign-1" }]);
});

test("a co-GM sees the archived banner without Restore", async () => {
  const screen = await renderAsGm(route(), {
    queries: { [fn(api.campaigns.get)]: gmCampaign({ isCreator: false, archived: true }), [fn(api.appStatus.get)]: null },
  });
  expect(screen.getByText(ARCHIVED_BANNER_TEXT)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
});

test("a player in an archived campaign gets the notice only", async () => {
  const screen = await renderAsPlayer(route(), {
    queries: { [fn(api.campaigns.get)]: { ...campaign("player"), isCreator: false, archived: true, ownerView: false }, [fn(api.appStatus.get)]: null },
  });
  expect(screen.getByText(ARCHIVED_BANNER_TEXT)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
});

test("the owner's read-only view shows its banner with the archived line and no Restore", async () => {
  const screen = await renderAsGm(route(), {
    queries: { [fn(api.campaigns.get)]: gmCampaign({ ownerView: true, archived: true }), [fn(api.appStatus.get)]: null },
  });
  expect(screen.getByTestId("owner-view-banner")).toBeTruthy();
  expect(screen.getByText(OWNER_VIEW_BANNER_TEXT, { exact: false })).toBeTruthy();
  expect(screen.getByText(ARCHIVED_BANNER_TEXT)).toBeTruthy();
  expect(screen.queryByTestId("archived-banner")).toBeNull();
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
});

test("read-only mode shows its banner, with the owner's message when there is one", async () => {
  const plain = await renderAsPlayer(route(), {
    queries: { [fn(api.campaigns.get)]: { ...campaign("player"), isCreator: false, archived: false, ownerView: false }, [fn(api.appStatus.get)]: { readOnly: true, message: null } },
  });
  expect(plain.getByText(READ_ONLY_BANNER_DEFAULT, { exact: false })).toBeTruthy();

  const told = await renderAsPlayer(route(), {
    queries: {
      [fn(api.campaigns.get)]: { ...campaign("player"), isCreator: false, archived: false, ownerView: false },
      [fn(api.appStatus.get)]: { readOnly: true, message: "Back at noon." },
    },
  });
  expect(told.getByText("Back at noon.", { exact: false })).toBeTruthy();
});

test("a live campaign shows no banner", async () => {
  const screen = await renderAsGm(route(), {
    queries: { [fn(api.campaigns.get)]: gmCampaign({ isCreator: true }), [fn(api.appStatus.get)]: null },
  });
  expect(screen.queryByTestId("archived-banner")).toBeNull();
  expect(screen.queryByTestId("owner-view-banner")).toBeNull();
  expect(screen.queryByTestId("read-only-banner")).toBeNull();
});
