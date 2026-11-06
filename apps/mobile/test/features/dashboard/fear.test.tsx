import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { FearPanel } from "../../../src/features/dashboard/fear";
import { OfflineFrame } from "../../../src/shell/offline";
import { api } from "../../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { ERROR_TEXT, campaignId, failQuery } from "./fixtures";

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

type FearCall = { campaignId: string; direction: string; idempotencyKey: string };

function fearUi(isGm: boolean, offline = false) {
  return (
    <OfflineFrame offline={offline}>
      <FearPanel campaignId={campaignId} isGm={isGm} />
    </OfflineFrame>
  );
}

test("two taps send two increase intents and show an optimistic +2", async () => {
  const calls: FearCall[] = [];
  const screen = await renderAsGm(fearUi(true), {
    queries: { [fn(api.campaigns.fear)]: 3 },
    mutations: {
      [fn(api.fear.adjust)]: (args) => {
        calls.push(args as FearCall);
        return null;
      },
    },
  });

  const plus = screen.getByRole("button", { name: "Increase Fear" });
  await fireEvent.press(plus);
  expect(screen.getByText("4")).toBeTruthy();
  await fireEvent.press(plus);

  expect(screen.getByText("5")).toBeTruthy();
  expect(screen.queryByText("3")).toBeNull();
  expect(calls).toHaveLength(2);
  expect(calls.map((call) => call.direction)).toEqual(["increase", "increase"]);
  expect(calls[0]?.campaignId).toBe(campaignId);
  expect(calls[1]?.campaignId).toBe(campaignId);
  expect(calls[0]?.idempotencyKey).not.toBe(calls[1]?.idempotencyKey);
  expect(screen.client.called).toEqual([fn(api.fear.adjust), fn(api.fear.adjust)]);
});

test("a decrease is one intent, and Fear does not pass 0 or 12", async () => {
  const calls: FearCall[] = [];
  const low = await renderAsGm(fearUi(true), {
    queries: { [fn(api.campaigns.fear)]: 0 },
    mutations: {
      [fn(api.fear.adjust)]: (args) => {
        calls.push(args as FearCall);
        return null;
      },
    },
  });
  expect(low.getByText("0")).toBeTruthy();
  await fireEvent.press(low.getByRole("button", { name: "Decrease Fear" }));
  expect(calls).toHaveLength(0);
  expect(low.getByText("0")).toBeTruthy();

  calls.length = 0;
  const high = await renderAsGm(fearUi(true), {
    queries: { [fn(api.campaigns.fear)]: 12 },
    mutations: {
      [fn(api.fear.adjust)]: (args) => {
        calls.push(args as FearCall);
        return null;
      },
    },
  });
  await fireEvent.press(high.getByRole("button", { name: "Increase Fear" }));
  expect(calls).toHaveLength(0);
  expect(high.getByText("12")).toBeTruthy();
});

test("a player sees the number and no Fear controls", async () => {
  const screen = await renderAsPlayer(fearUi(false), { queries: { [fn(api.campaigns.fear)]: 3 } });
  expect(screen.getByText("3")).toBeTruthy();
  expect(screen.getByLabelText("Fear")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Increase Fear" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Decrease Fear" })).toBeNull();
  expect(screen.client.subscribed).toEqual([fn(api.campaigns.fear)]);
});

test("Fear covers loading, and a failed query stays inside the panel", async () => {
  const loading = await renderAsPlayer(fearUi(false), { queries: {} });
  expect(loading.getByText("Loading Fear")).toBeTruthy();

  jest.spyOn(console, "error").mockImplementation(() => undefined);
  const broken = await renderAsPlayer(fearUi(false), { queries: { [fn(api.campaigns.fear)]: failQuery } });
  expect(broken.getByRole("header", { name: "GM Fear" })).toBeTruthy();
  expect(broken.getByText(ERROR_TEXT)).toBeTruthy();
});

test("offline disables Fear plus and minus", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(fearUi(true, true), {
    queries: { [fn(api.campaigns.fear)]: 3 },
    mutations: {
      [fn(api.fear.adjust)]: (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(screen.getByText("You're offline. Showing the last update.")).toBeTruthy();
  const plus = screen.getByRole("button", { name: "Increase Fear" });
  expect(plus.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(plus);
  expect(calls).toHaveLength(0);
});

test("Fear hidden from a player shows '?', never 0", async () => {
  const screen = await renderAsPlayer(fearUi(false), { queries: { [fn(api.campaigns.fear)]: null } });
  expect(screen.getByText("?")).toBeTruthy();
  expect(screen.getByLabelText("Fear: Fear hidden by the GM")).toBeTruthy();
  expect(screen.queryByText("0")).toBeNull();
  expect(screen.queryByText("null")).toBeNull();
});

test("a null Fear never offers an edit, even on a GM panel", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(fearUi(true), {
    queries: { [fn(api.campaigns.fear)]: null },
    mutations: {
      [fn(api.fear.adjust)]: (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(screen.getByText("?")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Increase Fear" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Decrease Fear" })).toBeNull();
  expect(calls).toHaveLength(0);
});
