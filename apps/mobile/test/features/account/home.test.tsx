import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { HomeScreen } from "../../../src/features/account/home";
import { renderAsGm, renderAsPlayer } from "../../harness";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const settings = { tableName: "Thursday Night Crew", gmName: "Ada", accent: "#e3b45a", expansions: { hopeAndFear: true }, defaultMapStyle: "classic" as const };

const campaign = {
  _id: "campaign-1",
  name: "The Table",
  frameId: "beast-feast",
  tier: 1,
  level: 1,
  custom: null,
  tome: null,
  options: {
    hopeAndFear: false,
    lessLethal: false,
    transformations: false,
    enduranceCountdowns: false,
    remnantCorruption: false,
    witherPersists: false,
  },
  createdAt: 1,
  lastOpenedAt: 2,
  fear: 0,
  players: 2,
  role: "gm" as const,
};

beforeEach(() => {
  resetMotionTest();
  mockPush.mockReset();
});

test("home menu lists continue, create, load, join, and settings", async () => {
  const screen = await renderAsGm(<HomeScreen />, {
    queries: { "campaigns:list": [campaign], "settings:get": settings },
  });
  expect(screen.getByRole("menuitem", { name: /Continue/ })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: /Create New Campaign/ })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: /Load Campaign/ })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: /Join Campaign/ })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: /Settings/ })).toBeTruthy();
  expect(screen.getByText("Thursday Night Crew")).toBeTruthy();

  await fireEvent.press(screen.getByRole("menuitem", { name: /Continue/ }));
  expect(mockPush).toHaveBeenCalledWith("/campaign/campaign-1");
});

test("a player home render only uses account queries", async () => {
  const screen = await renderAsPlayer(<HomeScreen />, {
    queries: {
      "campaigns:list": [{ ...campaign, role: "player" as const }],
      "settings:get": settings,
    },
  });
  expect(screen.client.subscribed).toEqual(["campaigns:list", "settings:get"]);
  expect(screen.getByText(/Player/)).toBeTruthy();
});
