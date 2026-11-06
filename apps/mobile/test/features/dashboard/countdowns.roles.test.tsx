import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { Countdowns } from "../../../src/features/dashboard/countdowns";
import { OfflineFrame } from "../../../src/shell/offline";
import { api } from "../../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { ERROR_TEXT, campaignId, countdown, failQuery } from "./fixtures";

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

function ui(isGm: boolean, offline = false) {
  return (
    <OfflineFrame offline={offline}>
      <Countdowns campaignId={campaignId} isGm={isGm} />
    </OfflineFrame>
  );
}

const playerRow = countdown();
const gmRow = countdown({
  armed: false,
  visibility: { mode: "private" },
  restMode: "remind",
  steps: [{ value: 4, text: "The caves shake" }],
});

test("a player sees the server countdown and none of the GM tools", async () => {
  const screen = await renderAsPlayer(ui(false), {
    queries: { [fn(api.countdowns.listByCampaign)]: [playerRow] },
  });
  expect(screen.getByText("The Lure")).toBeTruthy();
  expect(screen.getByText("4 / 6")).toBeTruthy();
  expect(screen.queryByText("The caves shake")).toBeNull();
  expect(screen.queryByRole("button", { name: "New countdown" })).toBeNull();
  expect(screen.queryByRole("button", { name: "New chase" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Advance The Lure" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Arm countdown" })).toBeNull();
  expect(screen.client.subscribed).toEqual([fn(api.countdowns.listByCampaign)]);
  expect(screen.client.subscribed).not.toContain(fn(api.countdownTracks.setStep));
});

test("a hidden step is shown only when the server sends it, and Advance is one intent", async () => {
  const calls: { countdownId: string; action: string; idempotencyKey: string }[] = [];
  const screen = await renderAsGm(ui(true), {
    queries: { [fn(api.countdowns.listByCampaign)]: [gmRow] },
    mutations: {
      [fn(api.countdowns.operate)]: (args) => {
        calls.push(args as { countdownId: string; action: string; idempotencyKey: string });
        return { previousValue: 4, newValue: 3, status: "active" };
      },
    },
  });
  expect(screen.getByText("The caves shake")).toBeTruthy();
  expect(screen.getByRole("button", { name: "New countdown" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Arm countdown" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show to players" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Advance The Lure" }));
  expect(calls).toHaveLength(1);
  expect(calls[0]?.action).toBe("advance");
  expect(calls[0]?.countdownId).toBe("cd-1");
  expect(calls[0]?.idempotencyKey).toEqual(expect.any(String));
});

test("a nameless countdown is Countdown", async () => {
  const screen = await renderAsPlayer(ui(false), {
    queries: { [fn(api.countdowns.listByCampaign)]: [countdown({ name: null, currentValue: null, startingValue: null })] },
  });
  expect(screen.getByText("Countdown")).toBeTruthy();
  expect(screen.queryByText("4 / 6")).toBeNull();
});

test("countdowns cover loading, empty, error, and offline", async () => {
  const loading = await renderAsPlayer(ui(false), { queries: {} });
  expect(loading.getByText("Loading countdowns")).toBeTruthy();

  const playerEmpty = await renderAsPlayer(ui(false), { queries: { [fn(api.countdowns.listByCampaign)]: [] } });
  expect(playerEmpty.getByText("No countdowns running.")).toBeTruthy();

  const gmEmpty = await renderAsGm(ui(true), { queries: { [fn(api.countdowns.listByCampaign)]: [] } });
  expect(gmEmpty.getByText("No countdowns running. Start one from 20 down to 1.")).toBeTruthy();

  jest.spyOn(console, "error").mockImplementation(() => undefined);
  const broken = await renderAsGm(ui(true), { queries: { [fn(api.countdowns.listByCampaign)]: failQuery } });
  expect(broken.getByRole("header", { name: "Countdowns" })).toBeTruthy();
  expect(broken.getByText(ERROR_TEXT)).toBeTruthy();

  const offline = await renderAsGm(ui(true, true), { queries: { [fn(api.countdowns.listByCampaign)]: [gmRow] } });
  expect(offline.getByText("You're offline. Showing the last update.")).toBeTruthy();
  const advance = offline.getByRole("button", { name: "Advance The Lure" });
  expect(advance.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(advance);
  expect(offline.client.called).not.toContain(fn(api.countdowns.operate));
});
