import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { getPhaseName } from "../../../../../src/lib/domain/campaign-time";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { SessionBlock } from "../../../src/features/dashboard/header";
import { OfflineFrame } from "../../../src/shell/offline";
import { api } from "../../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { ERROR_TEXT, campaign, failQuery, sessions } from "./fixtures";

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

const played = {
  ...sessions(null),
  dashboardNumber: "Session 2",
  lastSessionText: "The party left the caves.",
};

test("the header names the frame, the session line, and the last session", async () => {
  const screen = await renderAsPlayer(
    <SessionBlock campaign={campaign("player")} />,
    { queries: { [fn(api.sessionWrap.dashboard)]: played } },
  );
  expect(screen.getByText("Active campaign · Beast Feast")).toBeTruthy();
  expect(screen.getByRole("header", { name: "The Table" })).toBeTruthy();
  expect(screen.getByText("Session 2 · Tier 2 · Level 3 · Next session not scheduled")).toBeTruthy();
  expect(screen.getByRole("header", { name: "Last Session" })).toBeTruthy();
  expect(screen.getByText("The party left the caves.")).toBeTruthy();
  expect(screen.queryByLabelText("Time of the long cycle")).toBeNull();
  expect(screen.queryByRole("button", { name: "Start Session" })).toBeNull();
  expect(screen.client.subscribed).toEqual([fn(api.sessionWrap.dashboard)]);
});

test("a live session is shown to both roles and the GM does not get Start Session", async () => {
  const live = sessions({ sessionId: "session-1", n: 4 });
  const player = await renderAsPlayer(<SessionBlock campaign={campaign("player")} />, {
    queries: { [fn(api.sessionWrap.dashboard)]: live },
  });
  expect(player.getByText("Session 4 in progress")).toBeTruthy();
  expect(player.queryByRole("button", { name: "Start Session" })).toBeNull();

  const gm = await renderAsGm(<SessionBlock campaign={campaign("gm")} />, {
    queries: { [fn(api.sessionWrap.dashboard)]: live },
  });
  expect(gm.getByText("Session 4 in progress")).toBeTruthy();
  expect(gm.queryByRole("button", { name: "Start Session" })).toBeNull();
});

test("the GM confirms Start Session once", async () => {
  const calls: { campaignId: string; idempotencyKey: string }[] = [];
  const screen = await renderAsGm(<SessionBlock campaign={campaign("gm")} />, {
    queries: { [fn(api.sessionWrap.dashboard)]: sessions(null) },
    mutations: {
      [fn(api.sessions.start)]: (args) => {
        calls.push(args as { campaignId: string; idempotencyKey: string });
        return { sessionId: "session-9" };
      },
    },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Start Session" }));
  expect(screen.getByRole("header", { name: "Start the session?" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Start session" }));
  expect(calls).toHaveLength(1);
  expect(calls[0]?.campaignId).toBe(campaign("gm")._id);
  expect(calls[0]?.idempotencyKey).toEqual(expect.any(String));
});

test("the header covers loading, an empty session line, a failed query, and offline", async () => {
  const loading = await renderAsPlayer(<SessionBlock campaign={campaign("player")} />, { queries: {} });
  expect(loading.getByText("Loading sessions")).toBeTruthy();
  expect(loading.getByText("Loading the last session")).toBeTruthy();

  const empty = await renderAsGm(<SessionBlock campaign={campaign("gm")} />, {
    queries: { [fn(api.sessionWrap.dashboard)]: sessions(null) },
  });
  expect(empty.getByText("No sessions yet · Tier 2 · Level 3 · Next session not scheduled")).toBeTruthy();
  expect(empty.getByText("No session has been played yet.")).toBeTruthy();

  jest.spyOn(console, "error").mockImplementation(() => undefined);
  const broken = await renderAsPlayer(<SessionBlock campaign={campaign("player")} />, {
    queries: { [fn(api.sessionWrap.dashboard)]: failQuery },
  });
  expect(broken.getByRole("header", { name: "Campaign" })).toBeTruthy();
  expect(broken.getByText(ERROR_TEXT)).toBeTruthy();

  const offline = await renderAsGm(
    <OfflineFrame offline>
      <SessionBlock campaign={campaign("gm")} />
    </OfflineFrame>,
    { queries: { [fn(api.sessionWrap.dashboard)]: sessions(null) } },
  );
  expect(offline.getByText("You're offline. Showing the last update.")).toBeTruthy();
  const start = offline.getByRole("button", { name: "Start Session" });
  expect(start.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(start);
  expect(offline.client.called).not.toContain(fn(api.sessions.start));
});

test("a player can read the long cycle and cannot change the day", async () => {
  const time = { cycle: "DAY" as const, cycleDay: 1, week: 1 };
  const screen = await renderAsPlayer(<SessionBlock campaign={campaign("player", "witherwild")} />, {
    queries: { [fn(api.sessionWrap.dashboard)]: played, [fn(api.campaignTime.get)]: time },
  });
  expect(screen.getByLabelText("Time stage").props.children).toBe(getPhaseName("DAY", 1));
  const day = screen.getByRole("button", { name: `Day 2: ${getPhaseName("DAY", 2)}` });
  expect(day.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(day);
  expect(screen.queryByRole("button", { name: "Bring the Night" })).toBeNull();
  expect(screen.client.called).not.toContain(fn(api.campaignTime.setDay));
  expect(screen.client.subscribed).toEqual([fn(api.sessionWrap.dashboard), fn(api.campaignTime.get)]);
});

test("the GM sets another day and brings the night from day 7", async () => {
  const days: { cycleDay: number }[] = [];
  const advances: unknown[] = [];
  const choosing = await renderAsGm(<SessionBlock campaign={campaign("gm", "witherwild")} />, {
    queries: {
      [fn(api.sessionWrap.dashboard)]: played,
      [fn(api.campaignTime.get)]: { cycle: "DAY", cycleDay: 1, week: 1 },
    },
    mutations: {
      [fn(api.campaignTime.setDay)]: (args) => {
        days.push(args as { cycleDay: number });
        return null;
      },
    },
  });
  await fireEvent.press(choosing.getByRole("button", { name: `Day 2: ${getPhaseName("DAY", 2)}` }));
  expect(days).toEqual([expect.objectContaining({ cycleDay: 2, campaignId: campaign("gm")._id })]);

  const last = await renderAsGm(<SessionBlock campaign={campaign("gm", "witherwild")} />, {
    queries: {
      [fn(api.sessionWrap.dashboard)]: played,
      [fn(api.campaignTime.get)]: { cycle: "DAY", cycleDay: 7, week: 1 },
    },
    mutations: {
      [fn(api.campaignTime.advance)]: (args) => {
        advances.push(args);
        return null;
      },
    },
  });
  await fireEvent.press(last.getByRole("button", { name: "Bring the Night" }));
  expect(advances).toHaveLength(1);
  expect(last.queryByRole("button", { name: "Bring the Dawn" })).toBeNull();
});
