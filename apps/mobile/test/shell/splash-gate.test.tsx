import { beforeEach, expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

const mockPrevent = jest.fn(async () => true);
const mockHide = jest.fn(async () => undefined);

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: () => mockPrevent(),
  hideAsync: () => mockHide(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useSplashUntil } = require("../../src/shell/splash-gate") as typeof import("../../src/shell/splash-gate");

function Probe({ ready }: { ready: boolean }) {
  useSplashUntil(ready);
  return <Text>probe</Text>;
}

beforeEach(() => {
  mockHide.mockClear();
});

test("holds the splash from import time", () => {
  expect(mockPrevent).toHaveBeenCalledTimes(1);
});

test("keeps the splash while the fonts load and hides it once they are ready", async () => {
  await render(<Probe ready={false} />);
  expect(mockHide).not.toHaveBeenCalled();
  await screen.rerender(<Probe ready />);
  expect(mockHide).toHaveBeenCalledTimes(1);
});
