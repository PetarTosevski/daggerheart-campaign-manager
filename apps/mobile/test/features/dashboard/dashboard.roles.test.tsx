import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { DashboardScreen } from "../../../src/features/dashboard";
import { CampaignProvider } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { api } from "../../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { ERROR_TEXT, actionRoll, campaign, character, countdown, restState, sessions } from "./fixtures";

jest.mock("expo-crypto", () => {
  let keys = 0;
  return {
    randomUUID: () => {
      keys += 1;
      return `00000000-0000-4000-8000-${String(keys).padStart(12, "0")}`;
    },
  };
});

beforeEach(() => {
  resetMotionTest();
});

const briar = character();
const ash = character({
  _id: "char-2",
  status: "dead",
  sheet: { name: "Ash", level: 1, hp: 0, hpMax: 6, stress: 0, stressMax: 6, hope: 0, scars: 0 },
});

const played = {
  ...sessions(null),
  dashboardNumber: "Session 2",
  lastSessionText: "The party left the caves.",
};

function screenFor(offline = false) {
  return (
    <OfflineFrame offline={offline}>
      <CampaignProvider campaignId="campaign-1">
        <DashboardScreen />
      </CampaignProvider>
    </OfflineFrame>
  );
}

function ready(role: "gm" | "player", extra: Record<string, unknown> = {}) {
  return {
    [fn(api.campaigns.get)]: campaign(role),
    [fn(api.sessionWrap.dashboard)]: played,
    [fn(api.campaigns.fear)]: 3,
    [fn(api.charactersReads.partySummary)]: [briar, ash],
    [fn(api.restsReads.current)]: restState(),
    [fn(api.feed.list)]: [actionRoll()],
    [fn(api.countdowns.listByCampaign)]: [countdown()],
    [fn(api.maps.locations)]: [{ id: "loc-1", name: "Haven", typeLabel: "Village", partyHere: true, hidden: false }],
    [fn(api.countdownTracks.afterRest)]: { restId: "rest-1", lines: [{ countdownId: "cd-9", line: "The Lure holds." }], reminders: [] },
    [fn(api.countdownRolls.countedRows)]: ["row-1"],
    ...extra,
  };
}

const playerSubscribed = [
  fn(api.campaigns.get),
  fn(api.sessionWrap.dashboard),
  fn(api.campaigns.fear),
  fn(api.charactersReads.partySummary),
  fn(api.restsReads.current),
  fn(api.feed.list),
  fn(api.countdowns.listByCampaign),
  fn(api.maps.locations),
];

test("a player dashboard never subscribes to a GM query", async () => {
  const calls: { delta: number }[] = [];
  const screen = await renderAsPlayer(screenFor(), {
    queries: ready("player"),
    mutations: {
      [fn(api.characters.adjustResource)]: (args) => {
        calls.push(args as { delta: number });
        return null;
      },
    },
  });

  expect(screen.client.subscribed).toEqual(playerSubscribed);
  expect(screen.client.subscribed).not.toContain(fn(api.countdownRolls.countedRows));
  expect(screen.client.subscribed).not.toContain(fn(api.countdownTracks.afterRest));
  expect(screen.queryByText(ERROR_TEXT)).toBeNull();

  expect(screen.getByRole("header", { name: "The Table" })).toBeTruthy();
  expect(screen.getByLabelText("Fear").props.children).toBe("3");
  expect(screen.getByText("Briar")).toBeTruthy();
  expect(screen.getByText("Haven · Village · party is here")).toBeTruthy();
  expect(screen.getByText("Carat")).toBeTruthy();
  expect(screen.getByText("Elmore's alchemist")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Increase Fear" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Start Session" })).toBeNull();
  expect(screen.queryByRole("button", { name: "New countdown" })).toBeNull();
  expect(screen.queryByRole("button", { name: "End scene" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Hope & Fear content" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Roll in secret" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Tick countdowns for Briar rolls" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Revive Ash" })).toBeNull();
  expect(screen.queryByRole("header", { name: "Rest" })).toBeNull();

  const stress = screen.getByRole("button", { name: "Mark one Stress for Briar" });
  expect(stress.props.accessibilityState?.disabled).not.toBe(true);
  await fireEvent.press(stress);
  await fireEvent.press(screen.getByRole("button", { name: "Mark one Hit Point for Briar" }));
  expect(calls).toEqual([
    expect.objectContaining({ characterId: "char-1", resource: "stress", delta: 1 }),
    expect.objectContaining({ characterId: "char-1", resource: "hp", delta: 1 }),
  ]);

  await fireEvent.press(screen.getByRole("button", { name: "Overview" }));
  expect(screen.getAllByText(/Hylaeus/).length).toBeGreaterThan(0);
});

test("GM controls render for the GM, including the two GM-only queries", async () => {
  const rules: { option: string; enabled: boolean }[] = [];
  const screen = await renderAsGm(screenFor(), {
    queries: ready("gm"),
    mutations: {
      [fn(api.campaigns.setOption)]: (args) => {
        rules.push(args as { option: string; enabled: boolean });
        return null;
      },
    },
  });

  expect(screen.client.subscribed).toEqual([
    ...playerSubscribed.slice(0, 5),
    fn(api.countdownTracks.afterRest),
    fn(api.feed.list),
    fn(api.countdownRolls.countedRows),
    fn(api.countdowns.listByCampaign),
    fn(api.maps.locations),
  ]);
  expect(screen.getByRole("button", { name: "Increase Fear" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Decrease Fear" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start short rest" })).toBeTruthy();
  expect(screen.getByText("The Lure holds.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Roll in secret" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Tick countdowns for Briar rolls" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "New countdown" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "End scene" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Revive Ash" })).toBeTruthy();
  expect(screen.getByRole("header", { name: "Campaign Rules" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Hope & Fear content" }));
  expect(rules).toEqual([expect.objectContaining({ option: "hopeAndFear", enabled: false, campaignId: "campaign-1" })]);
});

test("the dashboard shows a loading line for each section", async () => {
  const loading = await renderAsPlayer(screenFor(), { queries: { [fn(api.campaigns.get)]: campaign("player") } });
  expect(loading.getByText("Loading sessions")).toBeTruthy();
  expect(loading.getByText("Loading Fear")).toBeTruthy();
  expect(loading.getByText("Loading the party")).toBeTruthy();
  expect(loading.getByText("Loading rests")).toBeTruthy();
  expect(loading.getByText("Loading rolls")).toBeTruthy();
  expect(loading.getByText("Loading countdowns")).toBeTruthy();
  expect(loading.getByText("Loading locations")).toBeTruthy();
});

test("an empty dashboard shows the empty copy and hides Rest from a player", async () => {
  const empty = await renderAsPlayer(screenFor(), {
    queries: {
      [fn(api.campaigns.get)]: campaign("player"),
      [fn(api.sessionWrap.dashboard)]: sessions(null),
      [fn(api.campaigns.fear)]: 0,
      [fn(api.charactersReads.partySummary)]: [],
      [fn(api.restsReads.current)]: { open: null, shortRestsSinceLong: 0, last: null },
      [fn(api.feed.list)]: [],
      [fn(api.countdowns.listByCampaign)]: [],
      [fn(api.maps.locations)]: [],
    },
  });
  expect(empty.getByLabelText("Fear").props.children).toBe("0");
  expect(empty.getByText("No sessions yet · Tier 2 · Level 3 · Next session not scheduled")).toBeTruthy();
  expect(empty.getByText("No characters yet. Open the Party tab to create the first hero.")).toBeTruthy();
  expect(empty.getByText("No rolls yet. Roll from a character sheet and it shows up here for everyone.")).toBeTruthy();
  expect(empty.getByText("No countdowns running.")).toBeTruthy();
  expect(empty.getByText("No locations yet. On the World map, select a marker and tick “Location” to pin it here.")).toBeTruthy();
  expect(empty.queryByRole("header", { name: "Rest" })).toBeNull();
});

test("offline disables a GM Fear change", async () => {
  const offline = await renderAsGm(screenFor(true), { queries: ready("gm") });
  expect(offline.getByText("You're offline. Showing the last update.")).toBeTruthy();
  expect(offline.getByRole("button", { name: "Increase Fear" }).props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(offline.getByRole("button", { name: "Increase Fear" }));
  expect(offline.client.called).not.toContain(fn(api.fear.adjust));
});
