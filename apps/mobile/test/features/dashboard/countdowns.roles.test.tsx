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
  mode: "standard",
  visibility: { mode: "private" },
  steps: [{ value: 4, text: "The caves shake" }],
});

type RestTickCall = { countdownId: string; rest: string; setting: unknown; idempotencyKey: string };

async function gmWithRestTicks(rows: unknown[]) {
  const calls: RestTickCall[] = [];
  const screen = await renderAsGm(ui(true), {
    queries: { [fn(api.countdowns.listByCampaign)]: rows },
    mutations: {
      [fn(api.countdowns.setRestTick)]: (args) => {
        const call = args as RestTickCall;
        calls.push(call);
        return { rest: call.rest, setting: call.setting };
      },
    },
  });
  return { screen, calls };
}

test("the GM turns a rest setting on, and each change is one setRestTick intent", async () => {
  const { screen, calls } = await gmWithRestTicks([gmRow]);
  expect(screen.getByText("On long rest: Off")).toBeTruthy();
  expect(screen.getByText("On short rest: Off")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "On long rest: Automatic" })).toBeNull();

  await fireEvent.press(screen.getByRole("button", { name: "On long rest: Fixed" }));
  await fireEvent.press(screen.getByRole("button", { name: "On short rest: PCs who rested" }));
  await fireEvent.press(screen.getByRole("button", { name: "On short rest: Die" }));
  await fireEvent.press(screen.getByRole("button", { name: "On long rest: Die + PCs" }));
  expect(calls.map(({ countdownId, rest, setting }) => ({ countdownId, rest, setting }))).toEqual([
    { countdownId: "cd-1", rest: "long", setting: { amount: { kind: "fixed", n: 1 }, mode: "auto" } },
    { countdownId: "cd-1", rest: "short", setting: { amount: { kind: "pcs" }, mode: "auto" } },
    { countdownId: "cd-1", rest: "short", setting: { amount: { kind: "die", sides: 6 }, mode: "auto" } },
    { countdownId: "cd-1", rest: "long", setting: { amount: { kind: "diePlusPcs", sides: 6 }, mode: "auto" } },
  ]);
  expect(new Set(calls.map((c) => c.idempotencyKey)).size).toBe(4);
  expect(screen.client.called).not.toContain(fn(api.countdownTracks.setRestMode));
});

test("an existing setting shows its N, die and mode, and edits keep the rest of it", async () => {
  const row = countdown({
    armed: false,
    mode: "standard",
    onLongRest: { amount: { kind: "fixed", n: 3 }, mode: "remind" },
    onShortRest: { amount: { kind: "diePlusPcs", sides: 8 }, mode: "auto" },
  });
  const { screen, calls } = await gmWithRestTicks([row]);
  expect(screen.getByText("On long rest: Fixed 3, Reminder")).toBeTruthy();
  expect(screen.getByText("On short rest: d8 + PCs who rested, Automatic")).toBeTruthy();

  await fireEvent.press(screen.getByRole("button", { name: "On long rest: more" }));
  await fireEvent.press(screen.getByRole("button", { name: "On long rest: fewer" }));
  await fireEvent.press(screen.getByRole("button", { name: "On long rest: Automatic" }));
  await fireEvent.press(screen.getByRole("button", { name: "On short rest: d20" }));
  await fireEvent.press(screen.getByRole("button", { name: "On short rest: Reminder" }));
  await fireEvent.press(screen.getByRole("button", { name: "On short rest: Die" }));
  await fireEvent.press(screen.getByRole("button", { name: "On long rest: Off" }));
  expect(calls.map(({ rest, setting }) => ({ rest, setting }))).toEqual([
    { rest: "long", setting: { amount: { kind: "fixed", n: 4 }, mode: "remind" } },
    { rest: "long", setting: { amount: { kind: "fixed", n: 2 }, mode: "remind" } },
    { rest: "long", setting: { amount: { kind: "fixed", n: 3 }, mode: "auto" } },
    { rest: "short", setting: { amount: { kind: "diePlusPcs", sides: 20 }, mode: "auto" } },
    { rest: "short", setting: { amount: { kind: "diePlusPcs", sides: 8 }, mode: "remind" } },
    { rest: "short", setting: { amount: { kind: "die", sides: 8 }, mode: "auto" } },
    { rest: "long", setting: null },
  ]);
});

test("the fixed amount stays within 1..20", async () => {
  const { screen } = await gmWithRestTicks([
    countdown({
      onLongRest: { amount: { kind: "fixed", n: 1 }, mode: "auto" },
      onShortRest: { amount: { kind: "fixed", n: 20 }, mode: "auto" },
    }),
  ]);
  expect(screen.getByRole("button", { name: "On long rest: fewer" }).props.accessibilityState).toEqual({ disabled: true });
  expect(screen.getByRole("button", { name: "On short rest: more" }).props.accessibilityState).toEqual({ disabled: true });
});

test("a long-term countdown has rest settings but no Arm, and a cancelled one has neither", async () => {
  const longTerm = countdown({
    mode: "longTerm",
    armed: true,
    restMode: "auto",
    steps: [],
    onLongRest: { amount: { kind: "fixed", n: 1 }, mode: "auto" },
  });
  const { screen } = await gmWithRestTicks([longTerm]);
  expect(screen.queryByRole("button", { name: "Arm countdown" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Disarm countdown" })).toBeNull();
  expect(screen.getByText("On long rest: Fixed 1, Automatic")).toBeTruthy();

  const cancelled = await gmWithRestTicks([countdown({ status: "cancelled", armed: false, mode: "standard" })]);
  expect(cancelled.screen.queryByText("On long rest: Off")).toBeNull();
});

test("a chase shows one rest control for the pair", async () => {
  const chase = (id: string, partnerId: string, side: string, name: string) =>
    countdown({ _id: id, name, mode: side === "party" ? "progress" : "consequence", armed: false, chase: { partnerId, side, party: "pursuing" } });
  const { screen, calls } = await gmWithRestTicks([chase("cd-p", "cd-r", "party", "The party"), chase("cd-r", "cd-p", "rivals", "The wolves")]);
  expect(screen.getAllByText("On long rest: Off")).toHaveLength(1);
  expect(screen.getAllByText("On short rest: Off")).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "On short rest: Fixed" }));
  expect(calls).toHaveLength(1);
  expect(calls[0]?.countdownId).toBe("cd-p");
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
