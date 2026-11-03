import { beforeEach, expect, jest, test } from "@jest/globals";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { SessionDetailRoute, SessionsScreen } from "../../../src/features/sessions";
import { renderAsGm, renderAsPlayer } from "../../harness";
import {
  gmPlayQueries,
  gmPrepQueries,
  gmWrapQueries,
  inCampaign,
  listQueries,
  playerSession,
} from "./fixture";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSetParams = jest.fn();
const routeParams = { sessionId: "session-1", stage: "prep" as string | undefined };

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: mockReplace, setParams: mockSetParams }),
  useLocalSearchParams: () => routeParams,
}));

beforeEach(() => {
  resetMotionTest();
  mockPush.mockReset();
  mockReplace.mockReset();
  mockSetParams.mockReset();
  routeParams.sessionId = "session-1";
  routeParams.stage = "prep";
});

test("a player on the sessions list only subscribes to sessionRecords.list", async () => {
  const screen = await renderAsPlayer(inCampaign("player", <SessionsScreen />), {
    queries: listQueries("player"),
  });
  expect(screen.getByRole("header", { name: "Sessions" })).toBeTruthy();
  expect(screen.getByText("The Bridge")).toBeTruthy();
  expect(screen.queryByText("They held the ford.")).toBeNull();
  expect(screen.queryByRole("button", { name: "New session" })).toBeNull();
  expect(screen.client.subscribed).toEqual(["campaigns:get", "sessionRecords:list"]);
});

test("a player on session detail never subscribes to prep, play, or wrap queries", async () => {
  routeParams.sessionId = playerSession._id;
  routeParams.stage = undefined;
  const screen = await renderAsPlayer(inCampaign("player", <SessionDetailRoute />), {
    queries: listQueries("player"),
  });
  expect(screen.getByText("They held the ford.")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:get", "sessionRecords:list"]);
  expect(screen.client.subscribed).not.toContain("sessionPrep:get");
  expect(screen.client.subscribed).not.toContain("sessionPlay:log");
  expect(screen.client.subscribed).not.toContain("sessionWrap:get");
});

test("the GM prep stage subscribes to sessionPrep but not sessionWrap.get", async () => {
  routeParams.stage = "prep";
  const screen = await renderAsGm(inCampaign("gm", <SessionDetailRoute />), {
    queries: gmPrepQueries(),
  });
  expect(screen.getByRole("header", { name: "Planned scenes" })).toBeTruthy();
  expect(screen.client.subscribed).toContain("sessionPrep:get");
  expect(screen.client.subscribed).toContain("sessions:current");
  expect(screen.client.subscribed).not.toContain("sessionWrap:get");
  expect(screen.client.subscribed).not.toContain("sessionPlay:log");
});

test("the GM play stage subscribes to sessionPlay and sessionPrep for the encounter card", async () => {
  routeParams.stage = "play";
  const screen = await renderAsGm(inCampaign("gm", <SessionDetailRoute />), {
    queries: gmPlayQueries(),
  });
  expect(screen.getByRole("header", { name: "Spotlight" })).toBeTruthy();
  expect(screen.client.subscribed).toContain("sessionPlay:spotlight");
  expect(screen.client.subscribed).toContain("sessionPlay:tally");
  expect(screen.client.subscribed).toContain("sessionPlay:log");
  expect(screen.client.subscribed).toContain("sessionPrep:get");
  expect(screen.client.subscribed).not.toContain("sessionWrap:get");
});

test("the GM wrap stage subscribes to sessionWrap.get", async () => {
  routeParams.stage = "wrap";
  const screen = await renderAsGm(inCampaign("gm", <SessionDetailRoute />), {
    queries: gmWrapQueries(),
  });
  expect(screen.getByRole("header", { name: "Recap" })).toBeTruthy();
  expect(screen.client.subscribed).toContain("sessionWrap:get");
  expect(screen.client.subscribed).not.toContain("sessionPlay:log");
});
