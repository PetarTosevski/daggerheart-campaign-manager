import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";

import { resetMotionTest } from "../theme/mock-reanimated";
import { OfflineFrame, WriteButton, offlineFromConnection } from "../../src/shell/offline";

beforeEach(() => {
  resetMotionTest();
});

test("offline shows the stale banner and turns write controls off", async () => {
  const onPress = jest.fn();
  const screen = await render(
    <OfflineFrame offline>
      <WriteButton onPress={onPress}>Spend Fear</WriteButton>
    </OfflineFrame>,
  );
  expect(screen.getByText("You're offline. Showing the last update.")).toBeTruthy();
  const button = screen.getByRole("button", { name: "Spend Fear" });
  expect(button.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
});

test("online hides the banner and leaves write controls on", async () => {
  const onPress = jest.fn();
  const screen = await render(
    <OfflineFrame offline={false}>
      <WriteButton onPress={onPress}>Spend Fear</WriteButton>
    </OfflineFrame>,
  );
  expect(screen.queryByText("You're offline. Showing the last update.")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Spend Fear" }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("a dropped or failed connection is offline, and the first attempt is not", () => {
  expect(
    offlineFromConnection({ isWebSocketConnected: false, hasEverConnected: false, connectionRetries: 0 }),
  ).toBe(false);
  expect(
    offlineFromConnection({ isWebSocketConnected: false, hasEverConnected: true, connectionRetries: 0 }),
  ).toBe(true);
  expect(
    offlineFromConnection({ isWebSocketConnected: false, hasEverConnected: false, connectionRetries: 1 }),
  ).toBe(true);
  expect(
    offlineFromConnection({ isWebSocketConnected: true, hasEverConnected: true, connectionRetries: 2 }),
  ).toBe(false);
});
