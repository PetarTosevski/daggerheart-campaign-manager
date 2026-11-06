import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { CampaignListScreen } from "../../../src/features/account/campaign-list";
import { renderAsGm, renderAsPlayer } from "../../harness";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

const options = {
  hopeAndFear: false,
  lessLethal: false,
  transformations: false,
  enduranceCountdowns: false,
  remnantCorruption: false,
  witherPersists: false,
};

const gmCampaign = {
  _id: "campaign-gm",
  name: "GM Table",
  frameId: "beast-feast" as const,
  tier: 1,
  level: 1,
  custom: null,
  tome: null,
  options,
  createdAt: 100,
  lastOpenedAt: 200,
  fear: 1,
  players: 1,
  role: "gm" as const,
  isCreator: true,
};

const playerCampaign = { ...gmCampaign, _id: "campaign-player", name: "Player Table", role: "player" as const, isCreator: false };
const coGmCampaign = { ...gmCampaign, _id: "campaign-cogm", name: "Co Table", isCreator: false, fear: null };

beforeEach(() => {
  resetMotionTest();
  mockPush.mockReset();
});

test("GM can delete a campaign and restore from deleted list", async () => {
  const removed: unknown[] = [];
  const restored: unknown[] = [];
  const purged: unknown[] = [];
  const screen = await renderAsGm(<CampaignListScreen />, {
    queries: {
      "campaigns:list": [gmCampaign],
      "campaigns:listDeleted": [
        {
          _id: "campaign-deleted",
          name: "Old Table",
          frameId: "beast-feast",
          createdAt: 50,
          deletedAt: 90,
        },
      ],
    },
    mutations: {
      "campaigns:remove": (args) => {
        removed.push(args);
        return null;
      },
      "campaigns:restore": (args) => {
        restored.push(args);
        return null;
      },
      "campaigns:purge": (args) => {
        purged.push(args);
        return null;
      },
    },
  });

  await fireEvent.press(screen.getByRole("button", { name: "Delete GM Table" }));
  await fireEvent.press(screen.getByRole("button", { name: "Delete" }));
  expect(removed).toEqual([{ campaignId: "campaign-gm" }]);

  await fireEvent.press(screen.getByRole("button", { name: "Restore Old Table" }));
  expect(restored).toEqual([{ campaignId: "campaign-deleted" }]);

  await fireEvent.press(screen.getByLabelText("Delete Old Table permanently"));
  await fireEvent.press(screen.getByText("Delete Old Table forever"));
  expect(purged).toEqual([{ campaignId: "campaign-deleted" }]);
});

test("a player leaves instead of deleting and never calls a GM mutation", async () => {
  const left: unknown[] = [];
  const screen = await renderAsPlayer(<CampaignListScreen />, {
    queries: {
      "campaigns:list": [playerCampaign],
      "campaigns:listDeleted": [],
    },
    mutations: {
      "members:leave": (args) => {
        left.push(args);
        return null;
      },
    },
  });

  expect(screen.getByLabelText("Leave Player Table")).toBeTruthy();
  expect(screen.queryByLabelText(/Delete Player Table/)).toBeNull();

  await fireEvent.press(screen.getByLabelText("Leave Player Table"));
  await fireEvent.press(screen.getByRole("button", { name: "Leave" }));
  expect(left).toEqual([{ campaignId: "campaign-player" }]);
  expect(screen.client.called.filter((name) => name.startsWith("campaigns:remove"))).toEqual([]);
});

test("a co-GM campaign wears the Co-GM badge and offers Leave, never Delete", async () => {
  const left: unknown[] = [];
  const screen = await renderAsGm(<CampaignListScreen />, {
    queries: { "campaigns:list": [coGmCampaign, gmCampaign], "campaigns:listDeleted": [] },
    mutations: {
      "members:leave": (args) => {
        left.push(args);
        return null;
      },
    },
  });
  expect(screen.getByText("Co-GM")).toBeTruthy();
  expect(screen.getByLabelText("Fear hidden by the GM")).toBeTruthy();
  expect(screen.queryByLabelText("Delete Co Table")).toBeNull();
  await fireEvent.press(screen.getByLabelText("Leave Co Table"));
  await fireEvent.press(screen.getByRole("button", { name: "Leave" }));
  expect(left).toEqual([{ campaignId: "campaign-cogm" }]);
  expect(screen.client.called).not.toContain("campaigns:remove");
});

test("the creator's campaign is badged Game Master and a player's Player", async () => {
  const screen = await renderAsGm(<CampaignListScreen />, {
    queries: { "campaigns:list": [gmCampaign, playerCampaign], "campaigns:listDeleted": [] },
  });
  expect(screen.getByText("Game Master")).toBeTruthy();
  expect(screen.getByText("Player")).toBeTruthy();
});
