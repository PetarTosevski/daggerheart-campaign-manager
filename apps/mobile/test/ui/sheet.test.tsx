import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import { Text } from "react-native";

import { resetMotionTest, setReducedMotion, timingCalls } from "../theme/mock-reanimated";
import { Sheet } from "../../src/ui/sheet";
import { duration } from "../../src/theme/motion";

beforeEach(() => {
  resetMotionTest();
});

test("the sheet closes from the backdrop, the close control, and Android back", async () => {
  const onClose = jest.fn();
  const screen = await render(
    <Sheet onClose={onClose} open title="Settings">
      <Text>Inside</Text>
    </Sheet>,
  );
  expect(screen.getByRole("header", { name: "Settings" })).toBeTruthy();
  expect(screen.getByText("Inside")).toBeTruthy();
  const modalViews = screen.container.queryAll((node) => node.props.accessibilityViewIsModal === true);
  expect(modalViews).toHaveLength(1);

  await fireEvent.press(screen.getByTestId("sheet-backdrop", { includeHiddenElements: true }));
  expect(onClose).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByRole("button", { name: "Close settings" }));
  expect(onClose).toHaveBeenCalledTimes(2);

  const modalHosts = screen.container.queryAll((node) => typeof node.props.onRequestClose === "function");
  expect(modalHosts).toHaveLength(1);
  const modalHost = modalHosts[0];
  if (!modalHost) throw new Error("sheet did not mount a modal");
  expect(modalHost.props.visible).toBe(true);
  await fireEvent(modalHost, "requestClose");
  expect(onClose).toHaveBeenCalledTimes(3);
});

test("a closed sheet renders nothing", async () => {
  const screen = await render(
    <Sheet onClose={() => undefined} open={false} title="Settings">
      <Text>Inside</Text>
    </Sheet>,
  );
  expect(screen.queryByText("Inside")).toBeNull();
  expect(screen.queryByText("Settings")).toBeNull();
});

test("reduced motion sets the sheet duration to 0", async () => {
  setReducedMotion(true);
  await render(
    <Sheet onClose={() => undefined} open title="Settings">
      <Text>Inside</Text>
    </Sheet>,
  );
  const seen = timingCalls().map((call) => call?.duration);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((value) => value === 0)).toBe(true);
});

test("the sheet animates with the shared sheet duration", async () => {
  await render(
    <Sheet onClose={() => undefined} open title="Settings">
      <Text>Inside</Text>
    </Sheet>,
  );
  const seen = timingCalls().map((call) => call?.duration);
  expect(seen).toContain(duration.sheet);
});
