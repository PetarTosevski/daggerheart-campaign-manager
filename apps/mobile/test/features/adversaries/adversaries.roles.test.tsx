import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import AdversariesRoute from "../../../app/campaign/[campaignId]/(gm)/adversaries";
import EncounterRoute from "../../../app/campaign/[campaignId]/(gm)/adversaries/[encounterId]";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { campaignId, campaignRecord, encounterId, encounterList, encounterView, gmQueries, inCampaign } from "./fixture";
import { campaignSummary } from "../../harness/records";

// A player sent off a GM route lands on the dashboard; the dashboard's own queries are its tests' business.
jest.mock("../../../src/features/dashboard", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native") as typeof import("react-native");
  return { DashboardScreen: () => <Text accessibilityRole="header">Dashboard</Text> };
});


const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ encounterId: "encounter-1" }),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));

const key = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  resetMotionTest();
  mockPush.mockReset();
});

/** The dashboard stub's campaign shape (no frame), so the player tests stay off the live dashboard. */
const playerStub = campaignSummary({ _id: campaignId, name: "The Table", role: "player" });

test("a player opening adversaries lands on the dashboard and never subscribes to encounters:list", async () => {
  const screen = await renderAsPlayer(inCampaign(<AdversariesRoute />), {
    queries: { "campaigns:get": playerStub },
  });
  expect(screen.getByRole("header", { name: "Dashboard" })).toBeTruthy();
  expect(screen.queryByRole("tab", { name: "Catalogue" })).toBeNull();
  expect(screen.client.subscribed).toEqual(["campaigns:get"]);
});

test("a player opening an encounter lands on the dashboard and never subscribes to encounters:get", async () => {
  const screen = await renderAsPlayer(inCampaign(<EncounterRoute />), {
    queries: { "campaigns:get": playerStub },
  });
  expect(screen.getByRole("header", { name: "Dashboard" })).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:get"]);
});

test("the GM sees the three tabs, the catalogue search and the custom adversaries section", async () => {
  const screen = await renderAsGm(inCampaign(<AdversariesRoute />), { queries: gmQueries() });
  expect(screen.getByRole("header", { name: "Adversaries" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Catalogue" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Encounters" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Environment" })).toBeTruthy();
  expect(screen.getByLabelText("Search adversaries")).toBeTruthy();
  expect(screen.getByRole("header", { name: "Custom adversaries" })).toBeTruthy();
  expect(screen.getByText("No custom adversaries yet.")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:get", "encounters:list", "customAdversaries:list"]);
});

test("catalogue search narrows the list and Add to encounter sends an SRD source", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(inCampaign(<AdversariesRoute />), {
    queries: gmQueries(),
    mutations: {
      "encounters:addAdversary": (args) => {
        calls.push(args);
        return { instanceIds: ["instance-2"] };
      },
    },
  });
  await fireEvent.changeText(screen.getByLabelText("Search adversaries"), "acid burrower");
  expect(screen.getByText("1 of 129 shown")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Acid Burrower" }));
  expect(screen.getByLabelText("Acid Burrower stat block")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Add Acid Burrower to an encounter" }));
  await fireEvent.press(screen.getByRole("button", { name: "Add to encounter" }));
  expect(calls).toEqual([
    {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId: "acid-burrower" },
      count: 1,
      summoned: false,
      idempotencyKey: key,
    },
  ]);
});

test("the Encounters tab loads the party, Fear and the selected encounter, and creates a new encounter", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(inCampaign(<AdversariesRoute />), {
    queries: gmQueries(),
    mutations: {
      "encounters:create": (args) => {
        calls.push(args);
        return { encounterId: "encounter-2" };
      },
    },
  });
  await fireEvent.press(screen.getByRole("tab", { name: "Encounters" }));
  expect(screen.client.subscribed).toEqual([
    "campaigns:get",
    "encounters:list",
    "customAdversaries:list",
    "charactersReads:listByCampaign",
    "campaigns:fear",
    "encounters:get",
  ]);
  expect(screen.getByLabelText("Encounter detail")).toBeTruthy();
  expect(screen.getByText("GM turn 1")).toBeTruthy();
  expect(screen.getAllByText("Spent 4 of 11 BP")).toHaveLength(2);

  await fireEvent.press(screen.getByRole("button", { name: "New encounter" }));
  expect(calls).toEqual([{ campaignId, name: "New encounter", pcs: 2, idempotencyKey: key }]);
});

test("the tracker marks HP with a keyed intent", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(inCampaign(<AdversariesRoute />), {
    queries: gmQueries(),
    mutations: {
      "encounterTracking:markHp": (args) => {
        calls.push(args);
        return { hp: 1, stress: 0, defeated: false };
      },
    },
  });
  await fireEvent.press(screen.getByRole("tab", { name: "Encounters" }));
  await fireEvent.press(screen.getByRole("button", { name: "More bear hp" }));
  expect(calls).toEqual([{ campaignId, instanceId: "instance-1", delta: 1, idempotencyKey: key }]);
});

test("a draft encounter shows no tracker", async () => {
  const screen = await renderAsGm(inCampaign(<AdversariesRoute />), {
    queries: gmQueries({
      "encounters:list": encounterList([{ _id: encounterId, name: "Ambush at the ford", status: "draft", pcs: 3, updatedAt: 1 }]),
      "encounters:get": encounterView("draft"),
    }),
  });
  await fireEvent.press(screen.getByRole("tab", { name: "Encounters" }));
  expect(screen.getByRole("button", { name: "Start encounter" })).toBeTruthy();
  expect(screen.queryByText("GM turn 1")).toBeNull();
});

test("the Environment tab lists environments and reads Fear", async () => {
  const screen = await renderAsGm(inCampaign(<AdversariesRoute />), { queries: gmQueries() });
  await fireEvent.press(screen.getByRole("tab", { name: "Environment" }));
  expect(screen.getByLabelText("Search environments")).toBeTruthy();
  expect(screen.client.subscribed).toContain("campaigns:fear");
  expect(screen.client.subscribed).not.toContain("encounters:get");
});

test("the GM encounter route shows the focused tracker", async () => {
  const screen = await renderAsGm(inCampaign(<EncounterRoute />), {
    queries: {
      "campaigns:get": campaignRecord("gm"),
      "encounters:get": encounterView(),
      "campaigns:fear": 2,
    },
  });
  expect(screen.getByRole("header", { name: "Ambush at the ford" })).toBeTruthy();
  expect(screen.getByText("GM turn 1")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:get", "encounters:get", "campaigns:fear"]);
  await fireEvent.press(screen.getByRole("button", { name: "‹ Adversaries" }));
  expect(mockPush).toHaveBeenCalledWith(`/campaign/${campaignId}/adversaries`);
});
