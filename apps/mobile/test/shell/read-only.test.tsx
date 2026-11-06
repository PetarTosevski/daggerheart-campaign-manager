import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../theme/mock-reanimated";
import { CampaignProvider } from "../../src/shell/campaign-provider";
import { OfflineFrame, WriteButton } from "../../src/shell/offline";
import {
  ARCHIVED_BANNER_TEXT,
  CampaignBanners,
  CampaignReadOnlyFrame,
  OWNER_VIEW_BANNER_TEXT,
  READ_ONLY_BANNER_DEFAULT,
} from "../../src/shell/read-only";
import { api } from "../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../harness";
import { campaign } from "../features/dashboard/fixtures";

jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));

beforeEach(() => {
  resetMotionTest();
});

/** The campaign layout's frame and banners around one write control, as every campaign page gets them. */
function shell(offline = false) {
  return (
    <OfflineFrame offline={offline}>
      <CampaignProvider campaignId="campaign-1">
        <CampaignReadOnlyFrame>
          <CampaignBanners />
          <WriteButton onPress={() => undefined}>Save</WriteButton>
        </CampaignReadOnlyFrame>
      </CampaignProvider>
    </OfflineFrame>
  );
}

function gmCampaign(extra: { isCreator?: boolean; archived?: boolean; ownerView?: boolean }) {
  return { ...campaign("gm"), isCreator: false, archived: false, ownerView: false, ...extra };
}

const playerCampaign = { ...campaign("player"), isCreator: false, archived: false, ownerView: false };

function saveDisabled(screen: { getByRole: (role: "button", options: { name: string }) => { props: { accessibilityState?: unknown } } }) {
  return (screen.getByRole("button", { name: "Save" }).props.accessibilityState as { disabled?: boolean } | undefined)?.disabled === true;
}

test("an archived campaign shows the banner, turns writes off, and its creator can still Restore", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(shell(), {
    queries: { [fn(api.campaigns.get)]: gmCampaign({ isCreator: true, archived: true }), [fn(api.appStatus.get)]: null },
    mutations: {
      [fn(api.campaignSettings.unarchive)]: (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(screen.getByText(ARCHIVED_BANNER_TEXT)).toBeTruthy();
  expect(saveDisabled(screen)).toBe(true);
  await fireEvent.press(screen.getByRole("button", { name: "Restore" }));
  expect(calls).toEqual([{ campaignId: "campaign-1" }]);
});

test("a co-GM sees the archived banner without Restore", async () => {
  const screen = await renderAsGm(shell(), {
    queries: { [fn(api.campaigns.get)]: gmCampaign({ isCreator: false, archived: true }), [fn(api.appStatus.get)]: null },
  });
  expect(screen.getByText(ARCHIVED_BANNER_TEXT)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  expect(saveDisabled(screen)).toBe(true);
});

test("a player in an archived campaign gets the notice only, with writes off", async () => {
  const screen = await renderAsPlayer(shell(), {
    queries: { [fn(api.campaigns.get)]: { ...playerCampaign, archived: true }, [fn(api.appStatus.get)]: null },
  });
  expect(screen.getByText(ARCHIVED_BANNER_TEXT)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  expect(saveDisabled(screen)).toBe(true);
});

test("the owner's read-only view shows its banner with the archived line, no Restore, writes off", async () => {
  const screen = await renderAsGm(shell(), {
    queries: { [fn(api.campaigns.get)]: gmCampaign({ ownerView: true, archived: true }), [fn(api.appStatus.get)]: null },
  });
  expect(screen.getByTestId("owner-view-banner")).toBeTruthy();
  expect(screen.getByText(OWNER_VIEW_BANNER_TEXT, { exact: false })).toBeTruthy();
  expect(screen.getByText(ARCHIVED_BANNER_TEXT)).toBeTruthy();
  expect(screen.queryByTestId("archived-banner")).toBeNull();
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  expect(saveDisabled(screen)).toBe(true);
});

test("read-only mode shows its banner (with the owner's message) and turns writes off", async () => {
  const plain = await renderAsPlayer(shell(), {
    queries: { [fn(api.campaigns.get)]: playerCampaign, [fn(api.appStatus.get)]: { readOnly: true, message: null }, [fn(api.appAdmin.me)]: { isOwner: false } },
  });
  expect(plain.getByText(READ_ONLY_BANNER_DEFAULT, { exact: false })).toBeTruthy();
  expect(saveDisabled(plain)).toBe(true);

  const told = await renderAsPlayer(shell(), {
    queries: {
      [fn(api.campaigns.get)]: playerCampaign,
      [fn(api.appStatus.get)]: { readOnly: true, message: "Back at noon." },
      [fn(api.appAdmin.me)]: { isOwner: false },
    },
  });
  expect(told.getByText("Back at noon.", { exact: false })).toBeTruthy();
});

test("in read-only mode the app owner sees the banner but may still write, as the server allows", async () => {
  const screen = await renderAsGm(shell(), {
    queries: { [fn(api.campaigns.get)]: gmCampaign({ isCreator: true }), [fn(api.appStatus.get)]: { readOnly: true, message: null }, [fn(api.appAdmin.me)]: { isOwner: true } },
  });
  expect(screen.getByTestId("read-only-banner")).toBeTruthy();
  expect(saveDisabled(screen)).toBe(false);
});

test("a live campaign shows no banner, writes stay on and the owner check is never asked", async () => {
  const screen = await renderAsGm(shell(), {
    queries: { [fn(api.campaigns.get)]: gmCampaign({ isCreator: true }), [fn(api.appStatus.get)]: null },
  });
  expect(screen.queryByTestId("archived-banner")).toBeNull();
  expect(screen.queryByTestId("owner-view-banner")).toBeNull();
  expect(screen.queryByTestId("read-only-banner")).toBeNull();
  expect(saveDisabled(screen)).toBe(false);
  expect(screen.client.subscribed).not.toContain(fn(api.appAdmin.me));
});

test("offline still turns writes off inside the frame", async () => {
  const screen = await renderAsGm(shell(true), {
    queries: { [fn(api.campaigns.get)]: gmCampaign({ isCreator: true }), [fn(api.appStatus.get)]: null },
  });
  expect(saveDisabled(screen)).toBe(true);
});
