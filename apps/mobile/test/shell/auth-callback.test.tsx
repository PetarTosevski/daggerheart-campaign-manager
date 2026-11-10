import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react-native";

import { resetMotionTest } from "../theme/mock-reanimated";
import { AUTH_CALLBACK_TIMEOUT_MS, AuthCallback } from "../../src/shell/auth-callback";

const mockRouter = { replace: jest.fn() };

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}));

beforeEach(() => {
  resetMotionTest();
  mockRouter.replace.mockClear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test("/auth says Signing in until the timeout, then shows an error and goes back to sign-in", async () => {
  const screen = await render(<AuthCallback />);
  expect(screen.getByRole("progressbar", { name: "Signing in…" })).toBeTruthy();

  await act(async () => {
    jest.advanceTimersByTime(AUTH_CALLBACK_TIMEOUT_MS - 1);
  });
  expect(screen.getByRole("progressbar", { name: "Signing in…" })).toBeTruthy();

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(screen.queryByRole("progressbar", { name: "Signing in…" })).toBeNull();
  expect(screen.getByRole("header", { name: "Sign-in stopped" })).toBeTruthy();
  expect(screen.getByText("Sign-in didn’t finish. Go back and try again.")).toBeTruthy();

  await fireEvent.press(screen.getByRole("button", { name: "Back to sign-in" }));
  expect(mockRouter.replace).toHaveBeenCalledWith("/sign-in");
});
